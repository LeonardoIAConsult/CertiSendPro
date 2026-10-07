// Pruebas de `reintentarAcusePendiente` (server/notificaciones.ts) y del reclamo transaccional de
// correo (server/cuentas.ts) — simplificacion 2026-10-06 (decision del Brain tras el NO-GO de la
// revision externa, vuelta 32 sobre b93fbed, 3 vueltas seguidas parchando esta misma pieza): se
// quita el tope de intentos con espera exponencial creciente (MAX_INTENTOS_ACUSE/backoff) y se
// reemplaza por una decision puramente por ANTIGUEDAD del pago: reintenta siempre que lleve <48h
// pendiente, alerta a Leonardo UNA vez a las 20h (sigue reintentando) y UNA vez a las 48h
// (abandona, deja de reintentar).
//
// Oraculo pedido:
//   1. un reclamo viejo (atascado) se libera.
//   2. un reclamo fresco no se libera.
//   3. el barrido reintenta y envia.
//   4. no hay doble envio con reintentos simultaneos.
//   5. aviso a Leonardo a las 20h (una sola vez), nunca antes de 20h, nunca si el acuse SI salio.
//   6. a las 48h deja de reintentar y avisa "abandonado" (una sola vez).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  reclamarEnvioCorreoTx,
  marcarCorreoEnviadoTx,
  liberarReclamoCorreoTx,
  UMBRAL_RECLAMO_ATASCADO_MS,
  type DestinatarioCorreo,
} from "../server/cuentas";
import {
  reintentarAcusePendiente,
  CORREO_LEONARDO,
  type ReintentarAcuseDeps,
  type DatosReintentoAcusePendiente,
} from "../server/notificaciones";
import { type DatosCorreo } from "../server/avisos";
import { FirestoreFalso } from "./_fakeFirestore";

// ── 1/2: reclamo atascado (>10 min) se libera; reclamo fresco (<10 min) NO se libera ────────────

test("un reclamo 'reclamado' de mas de 10 minutos se libera (se puede volver a reclamar)", async () => {
  const db = new FirestoreFalso();
  const haceOnceMin = new Date(Date.now() - (UMBRAL_RECLAMO_ATASCADO_MS + 60_000));
  db.seed("pagosProcesados/pago-1", {
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: Timestamp.fromDate(haceOnceMin),
  });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const ahora = new Date();
  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", ahora));

  assert.equal(reclamado, true, "un reclamo atascado debe poder volver a reclamarse");
  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "reclamado");
  assert.equal(
    (pago?.correoCompradorReclamadoEn as Timestamp).toMillis(),
    ahora.getTime(),
    "la fecha del reclamo debe actualizarse a AHORA, no seguir siendo la vieja"
  );
});

test("un reclamo 'reclamado' FRESCO (menos de 10 minutos) NO se libera", async () => {
  const db = new FirestoreFalso();
  const haceDosMin = new Date(Date.now() - 2 * 60_000);
  db.seed("pagosProcesados/pago-1", {
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: Timestamp.fromDate(haceDosMin),
  });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", new Date()));

  assert.equal(reclamado, false, "un reclamo fresco bloquea igual que antes");
  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "reclamado", "no debe tocarse mientras siga fresco");
});

test("exactamente en el umbral (10 min 1 ms) SI se considera atascado", () => {
  // Prueba directa del calculo de "atascado" (sin Firestore): ahora - reclamadoEn > umbral.
  const reclamadoEn = 0;
  const ahora = UMBRAL_RECLAMO_ATASCADO_MS + 1;
  assert.equal(ahora - reclamadoEn > UMBRAL_RECLAMO_ATASCADO_MS, true);
});

test("un reclamo 'reclamado' SIN fecha propia (de datos viejos) se trata como atascado", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { correoComprador: "reclamado" }); // sin ReclamadoEn (dato viejo).
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador"));

  assert.equal(reclamado, true, "sin fecha de reclamo, nunca debe bloquear para siempre");
});

test("'enviado' nunca se libera, sin importar cuanto tiempo haya pasado", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", {
    correoComprador: "enviado",
    correoCompradorReclamadoEn: Timestamp.fromDate(new Date(0)), // hace decadas.
  });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador"));

  assert.equal(reclamado, false, "un correo YA enviado nunca se reintenta");
});

// ── reintentarAcusePendiente: reconstruye desde pagosProcesados y reintenta con el doble real ───

function campoDestinatario(destinatario: DestinatarioCorreo): string {
  if (destinatario === "comprador") return "correoComprador";
  if (destinatario === "leonardo") return "correoLeonardo";
  if (destinatario === "acuse20h") return "avisoAcuse20h";
  if (destinatario === "acuse48h") return "avisoAcuse48h";
  return "avisoBloqueoProveedor";
}

function depsReintentoConFirestoreFalso(
  db: FirestoreFalso,
  paymentId: string,
  overrides: Partial<ReintentarAcuseDeps> = {}
) {
  const correosEnviados: DatosCorreo[] = [];
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const deps: ReintentarAcuseDeps = {
    reclamarEnvioCorreo: (_pid, destinatario, ahora) =>
      db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, destinatario, ahora)),
    marcarCorreoEnviado: (_pid, destinatario, reclamadoEn) =>
      db.runTransaction((tx) => marcarCorreoEnviadoTx(tx, pagoRef, destinatario, reclamadoEn)),
    liberarReclamoCorreo: (_pid, destinatario, reclamadoEn) =>
      db.runTransaction((tx) => liberarReclamoCorreoTx(tx, pagoRef, destinatario, reclamadoEn)),
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    construirCorreoComprador: (_datos) => ({ asunto: "Confirmación de tu compra", texto: "Texto sin ningún dato pendiente." }),
    obtenerEstadoCorreoComprador: async (pid) => db.leer(`pagosProcesados/${pid}`)?.correoComprador ?? null,
    ...overrides,
  };
  return { deps, correosEnviados };
}

const DATOS_REINTENTO_BASE: DatosReintentoAcusePendiente = {
  paymentId: "pago-1",
  uid: "uid-1",
  referenciaId: "ref-1",
  cop: 49102,
  trm: 3273.49,
  fechaTrm: "2026-10-03",
  fecha: new Date("2026-10-05T15:00:00.000Z"),
  vence: new Date("2026-11-05T15:00:00.000Z"),
};

// ── 3: el barrido reintenta y envia (reintentarAcusePendiente sobre un reclamo atascado) ───────

test("reintentarAcusePendiente reintenta un reclamo atascado y el acuse SI sale al comprador", async () => {
  const db = new FirestoreFalso();
  // Fix (Paso 16A-2, hallazgo incidental): `new Date()`/`Date.now()` reales aqui eran una bomba de
  // tiempo — una vez que el reloj real cruzara las 48h desde `DATOS_REINTENTO_BASE.fecha`
  // (2026-10-05T15:00Z), esta prueba empezaba a caer en la rama ">=48h abandona" en vez de la rama
  // "reintenta y envia" que de verdad quiere probar. Mismo patron que el resto del archivo: un
  // `ahora` RELATIVO a `DATOS_REINTENTO_BASE.fecha` (nunca el reloj real), bien dentro de la
  // ventana <20h — y el reclamo sembrado se marca "atascado" relativo a ESE MISMO `ahora`, no a
  // `Date.now()` real (si no, el reclamo atascado podria dejar de parecer atascado o viceversa
  // segun cuando corra la prueba).
  const ahora2h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 2 * 3600_000);
  const haceOnceMin = Timestamp.fromDate(new Date(ahora2h.getTime() - (UMBRAL_RECLAMO_ATASCADO_MS + 60_000)));
  db.seed("pagosProcesados/pago-1", {
    procesadoEn: Timestamp.now(),
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: haceOnceMin,
  });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora2h, deps);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1, "el acuse SI debe salir al comprador tras el reintento");
  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "enviado");
});

test("reintentarAcusePendiente sin referenciaId/fechaTrm guardados (pago viejo) no reintenta nada y no lanza", async () => {
  const db = new FirestoreFalso();
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-viejo");

  await assert.doesNotReject(
    reintentarAcusePendiente(
      { ...DATOS_REINTENTO_BASE, paymentId: "pago-viejo", referenciaId: null, fechaTrm: null },
      new Date(),
      deps
    )
  );
  assert.equal(correosEnviados.length, 0);
});

// ── 4: no hay doble envio con reintentos simultaneos ─────────────────────────────────────────────

test("dos reintentos CASI SIMULTANEOS del mismo reclamo atascado producen 1 solo correo al comprador", async () => {
  const db = new FirestoreFalso();
  // Mismo fix que la prueba anterior: `ahora` RELATIVO a `DATOS_REINTENTO_BASE.fecha` (nunca el
  // reloj real), bien dentro de la ventana <20h, y el reclamo sembrado "atascado" relativo a ESE
  // MISMO `ahora`.
  const ahora = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 2 * 3600_000);
  const haceOnceMin = Timestamp.fromDate(new Date(ahora.getTime() - (UMBRAL_RECLAMO_ATASCADO_MS + 60_000)));
  db.seed("pagosProcesados/pago-1", {
    procesadoEn: Timestamp.now(),
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: haceOnceMin,
  });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  await Promise.all([
    reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora, deps),
    reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora, deps),
  ]);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1, "exactamente 1 correo, aunque los dos reintentos corran casi al mismo tiempo");
});

// ── 5: aviso a Leonardo a las 20h (una sola vez) ─────────────────────────────────────────────────

test("si el acuse sigue sin salir pasadas 20h desde el pago, avisa a Leonardo UNA sola vez", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now() }); // nunca se habia reclamado nada.
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1", {
    enviarCorreo: async (datos) => {
      if (datos.para === "comprador@test.com") return false; // el comprador SIGUE sin recibirlo.
      correosEnviados.push(datos);
      return true;
    },
  });

  const ahora21h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 21 * 3600_000);
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora21h, deps);

  const avisos20h = correosEnviados.filter((c) => c.para === CORREO_LEONARDO && /20 horas/.test(c.asunto));
  assert.equal(avisos20h.length, 1, "debe avisar a Leonardo exactamente 1 vez");

  // Segunda llamada, mismo escenario (el comprador sigue sin recibirlo) -> el aviso de 20h NO se repite.
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora21h, deps);
  const avisos20hTotal = correosEnviados.filter((c) => c.para === CORREO_LEONARDO && /20 horas/.test(c.asunto));
  assert.equal(avisos20hTotal.length, 1, "el aviso de 20h no se repite para el mismo pago");
});

test("antes de 20h, aunque el acuse siga sin salir, NO avisa a Leonardo por la demora", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now() });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1", {
    enviarCorreo: async (datos) => {
      if (datos.para === "comprador@test.com") return false;
      correosEnviados.push(datos);
      return true;
    },
  });

  const ahora19h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 19 * 3600_000);
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora19h, deps);

  const avisos20h = correosEnviados.filter((c) => /horas/.test(c.asunto));
  assert.equal(avisos20h.length, 0, "antes de 20h no debe escalar a Leonardo todavia");
});

test("si el reintento SI logra mandar el acuse, no avisa a Leonardo aunque hayan pasado 20h", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now() });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1"); // enviarCorreo exitoso para todos.

  const ahora21h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 21 * 3600_000);
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora21h, deps);

  const avisos20h = correosEnviados.filter((c) => /20 horas/.test(c.asunto));
  assert.equal(avisos20h.length, 0, "si el acuse SI salio, no hay nada que escalar");
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador, "enviado");
});

// ── 6: a las 48h deja de reintentar y avisa "abandonado" (simplificacion 2026-10-06) ────────────

test(">=48h: NO reintenta el envio del acuse y avisa a Leonardo 'abandonado' UNA sola vez", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now(), correoComprador: null });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  const ahora49h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 49 * 3600_000);
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora49h, deps);

  // Ningun intento de mandar el acuse al comprador (nunca se llamo a notificarActivacionPaquete).
  assert.equal(correosEnviados.filter((c) => c.para === "comprador@test.com").length, 0);
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador, null, "el estado del acuse no se toca al abandonar");

  const avisosAbandono = correosEnviados.filter((c) => c.para === CORREO_LEONARDO && /ABANDONADO/.test(c.asunto));
  assert.equal(avisosAbandono.length, 1, "debe avisar 'abandonado' exactamente 1 vez");

  // Segunda llamada (siguiente barrido), mismo escenario -> el aviso NO se repite.
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora49h, deps);
  const avisosAbandonoTotal = correosEnviados.filter((c) => c.para === CORREO_LEONARDO && /ABANDONADO/.test(c.asunto));
  assert.equal(avisosAbandonoTotal.length, 1, "el aviso de abandono no se repite para el mismo pago");
});

test("justo antes de 48h (47h) SI sigue reintentando el envio del acuse", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now(), correoComprador: null });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  const ahora47h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 47 * 3600_000);
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora47h, deps);

  assert.equal(correosEnviados.filter((c) => c.para === "comprador@test.com").length, 1, "a las 47h SI debe reintentar el envio");
});

// ── G3: un pago revertido NUNCA reintenta ni envia nada (defensa en profundidad) ──────────────

// G3/Medio 4 (seleccion de candidatos del barrido: "nunca revertido", "nunca requiereReembolso")
// se prueban ahora sobre `esCandidatoBarridoAcuse` en tests/tareasFondo.test.ts — unico filtro de
// seleccion desde la simplificacion 2026-10-06; `elegibleParaReintentoAcuse`/
// `seleccionarPagosParaBarrido` (con backoff/tope de intentos) ya no existen.

test("G3: reintentarAcusePendiente con datos.revertido=true no envia nada (defensa en profundidad)", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now(), correoComprador: null });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  await reintentarAcusePendiente({ ...DATOS_REINTENTO_BASE, revertido: true }, new Date(), deps);

  assert.equal(correosEnviados.length, 0, "ningun correo debe salir para un pago revertido");
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador, null, "el estado del correo no debe tocarse");
});

// ── B3 (correccion NO-GO vuelta 30): el borde exacto de UMBRAL_RECLAMO_ATASCADO_MS SI es atascado ──

// Las dos pruebas de abajo usan un `ahora` FIJO (nunca `Date.now()`/`new Date()` capturados en
// dos instantes distintos del test): con margenes de 1ms, depender del reloj real haria estas
// pruebas flaky bajo carga de CPU (el tiempo real entre "sembrar el dato" y "llamar a la funcion"
// puede superar 1ms facilmente) — confirmado como la causa real de un flake intermitente visto al
// correr la suite completa varias veces seguidas.
const AHORA_FIJO_B3 = new Date("2026-10-05T12:00:00.000Z");

test("un reclamo 'reclamado' EXACTAMENTE en el umbral (ni un ms mas) SI se considera atascado", async () => {
  const db = new FirestoreFalso();
  const haceExactoElUmbral = new Date(AHORA_FIJO_B3.getTime() - UMBRAL_RECLAMO_ATASCADO_MS);
  db.seed("pagosProcesados/pago-1", {
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: Timestamp.fromDate(haceExactoElUmbral),
  });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", AHORA_FIJO_B3));

  assert.equal(reclamado, true, "exactamente en el umbral (>=) ya debe tratarse como atascado");
});

test("un reclamo 'reclamado' UN ms antes del umbral NO se considera atascado todavia", async () => {
  const db = new FirestoreFalso();
  const unMsAntes = new Date(AHORA_FIJO_B3.getTime() - (UMBRAL_RECLAMO_ATASCADO_MS - 1));
  db.seed("pagosProcesados/pago-1", {
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: Timestamp.fromDate(unMsAntes),
  });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", AHORA_FIJO_B3));

  assert.equal(reclamado, false, "todavia no llega al umbral: sigue fresco");
});

// ── M-2 (corrige vuelta 34 del REVISOR_EXTERNO): log JSON estructurado de ALERTA_ACUSE_ATRASADO/
// ALERTA_ACUSE_ABANDONADO — severity="ERROR", message EXACTO, sin uid/email/ningun valor con "@"
// (oraculo explicito de la orden: capturar, JSON.parse, verificar los tres). ───────────────────

function assertLogEstructurado(linea: string, mensajeEsperado: string): Record<string, any> {
  const json = JSON.parse(linea);
  assert.equal(json.severity, "ERROR");
  assert.equal(json.message, mensajeEsperado);
  for (const [clave, valor] of Object.entries(json)) {
    assert.notEqual(clave, "uid", `el log de ${mensajeEsperado} nunca debe llevar uid`);
    assert.notEqual(clave, "email", `el log de ${mensajeEsperado} nunca debe llevar email`);
    if (typeof valor === "string") {
      assert.ok(!valor.includes("@"), `el log de ${mensajeEsperado} tiene un valor con '@' (campo ${clave}: ${valor})`);
    }
  }
  return json;
}

async function capturarConsoleError(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logs;
}

test("ALERTA_ACUSE_ATRASADO: log JSON estructurado, severity ERROR, message exacto, sin uid/email/@", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now() });
  const { deps } = depsReintentoConFirestoreFalso(db, "pago-1", {
    enviarCorreo: async (datos) => datos.para !== "comprador@test.com",
  });

  const ahora21h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 21 * 3600_000);
  const logs = await capturarConsoleError(() => reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora21h, deps));

  const linea = logs.find((l) => l.includes("ALERTA_ACUSE_ATRASADO"));
  assert.ok(linea, "debe existir un log de ALERTA_ACUSE_ATRASADO");
  const json = assertLogEstructurado(linea!, "ALERTA_ACUSE_ATRASADO");
  assert.equal(json.paymentId, DATOS_REINTENTO_BASE.paymentId);
});

test("ALERTA_ACUSE_ABANDONADO: log JSON estructurado, severity ERROR, message exacto, sin uid/email/@", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now(), correoComprador: null });
  const { deps } = depsReintentoConFirestoreFalso(db, "pago-1");

  const ahora49h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 49 * 3600_000);
  const logs = await capturarConsoleError(() => reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora49h, deps));

  const linea = logs.find((l) => l.includes("ALERTA_ACUSE_ABANDONADO"));
  assert.ok(linea, "debe existir un log de ALERTA_ACUSE_ABANDONADO");
  const json = assertLogEstructurado(linea!, "ALERTA_ACUSE_ABANDONADO");
  assert.equal(json.paymentId, DATOS_REINTENTO_BASE.paymentId);
});
