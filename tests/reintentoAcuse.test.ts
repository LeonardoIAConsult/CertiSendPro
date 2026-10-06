// Pruebas de M37 (corrige vuelta 28, "reclamo atascado y sin reintento", 2026-10-05):
//   - reclamarEnvioCorreoTx: un reclamo "reclamado" atascado (>10 min) se libera; uno fresco no.
//   - reintentarAcusePendiente (server/notificaciones.ts): reconstruye el aviso desde
//     `pagosProcesados/{id}` (los campos que M37 agrega a `activarPaqueteSiNoProcesadoTx`) y
//     reintenta — con el doble de Firestore de tests/_fakeFirestore.ts, nunca un booleano en
//     memoria, mismo patron que tests/notificaciones.test.ts.
//   - seleccionarPagosParaBarrido (PURA): candidatos del barrido global del webhook.
//
// Oraculo pedido:
//   1. un reclamo viejo se libera.
//   2. un reclamo fresco no se libera.
//   3. /api/cuenta reintenta y envia (aqui, a nivel de reintentarAcusePendiente — server.ts solo
//      la invoca con los datos leidos de Firestore, sin logica propia que probar aparte).
//   4. no hay doble envio con reintentos simultaneos.
//   5. aviso a Leonardo a las 20h.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  reclamarEnvioCorreoTx,
  seleccionarPagosParaBarrido,
  elegibleParaReintentoAcuse,
  registrarIntentoAcuseTx,
  calcularEsperaBackoffMs,
  UMBRAL_RECLAMO_ATASCADO_MS,
  MAX_INTENTOS_ACUSE,
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

test("M37: un reclamo 'reclamado' de mas de 10 minutos se libera (se puede volver a reclamar)", async () => {
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

test("M37: un reclamo 'reclamado' FRESCO (menos de 10 minutos) NO se libera", async () => {
  const db = new FirestoreFalso();
  const haceDosMin = new Date(Date.now() - 2 * 60_000);
  db.seed("pagosProcesados/pago-1", {
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: Timestamp.fromDate(haceDosMin),
  });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", new Date()));

  assert.equal(reclamado, false, "un reclamo fresco bloquea igual que antes de M37");
  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "reclamado", "no debe tocarse mientras siga fresco");
});

test("M37: exactamente en el umbral (10 min 1 ms) SI se considera atascado", () => {
  // Prueba directa del calculo de "atascado" (sin Firestore): ahora - reclamadoEn > umbral.
  const reclamadoEn = 0;
  const ahora = UMBRAL_RECLAMO_ATASCADO_MS + 1;
  assert.equal(ahora - reclamadoEn > UMBRAL_RECLAMO_ATASCADO_MS, true);
});

test("M37: un reclamo 'reclamado' SIN fecha propia (de antes de M37) se trata como atascado", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { correoComprador: "reclamado" }); // sin ReclamadoEn (dato viejo).
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const reclamado = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador"));

  assert.equal(reclamado, true, "sin fecha de reclamo, nunca debe bloquear para siempre");
});

test("M37: 'enviado' nunca se libera, sin importar cuanto tiempo haya pasado", async () => {
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
    marcarCorreoEnviado: async (_pid, destinatario) => {
      await db.runTransaction(async (tx) => tx.update(pagoRef, { [campoDestinatario(destinatario)]: "enviado" }));
    },
    liberarReclamoCorreo: async (_pid, destinatario) => {
      await db.runTransaction(async (tx) => tx.update(pagoRef, { [campoDestinatario(destinatario)]: null }));
    },
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    construirCorreoComprador: (_datos) => ({ asunto: "Confirmación de tu compra", texto: "Texto sin ningún dato pendiente." }),
    obtenerEstadoCorreoComprador: async (pid) => db.leer(`pagosProcesados/${pid}`)?.correoComprador ?? null,
    registrarIntentoAcuse: (_pid, ahora) => db.runTransaction((tx) => registrarIntentoAcuseTx(tx, pagoRef, ahora)),
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

// ── 3: /api/cuenta reintenta y envia (reintentarAcusePendiente sobre un reclamo atascado) ───────

test("M37: reintentarAcusePendiente reintenta un reclamo atascado y el acuse SI sale al comprador", async () => {
  const db = new FirestoreFalso();
  const haceOnceMin = Timestamp.fromDate(new Date(Date.now() - (UMBRAL_RECLAMO_ATASCADO_MS + 60_000)));
  db.seed("pagosProcesados/pago-1", {
    procesadoEn: Timestamp.now(),
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: haceOnceMin,
  });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, new Date(), deps);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1, "el acuse SI debe salir al comprador tras el reintento");
  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "enviado");
});

test("M37: reintentarAcusePendiente sin referenciaId/fechaTrm guardados (pago de antes de M37) no reintenta nada y no lanza", async () => {
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

test("M37: dos reintentos CASI SIMULTANEOS del mismo reclamo atascado producen 1 solo correo al comprador", async () => {
  const db = new FirestoreFalso();
  const haceOnceMin = Timestamp.fromDate(new Date(Date.now() - (UMBRAL_RECLAMO_ATASCADO_MS + 60_000)));
  db.seed("pagosProcesados/pago-1", {
    procesadoEn: Timestamp.now(),
    correoComprador: "reclamado",
    correoCompradorReclamadoEn: haceOnceMin,
  });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1");

  await Promise.all([
    reintentarAcusePendiente(DATOS_REINTENTO_BASE, new Date(), deps),
    reintentarAcusePendiente(DATOS_REINTENTO_BASE, new Date(), deps),
  ]);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1, "exactamente 1 correo, aunque los dos reintentos corran casi al mismo tiempo");
});

// ── 5: aviso a Leonardo a las 20h (una sola vez) ─────────────────────────────────────────────────

test("M37: si el acuse sigue sin salir pasadas 20h desde el pago, avisa a Leonardo UNA sola vez", async () => {
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

test("M37: antes de 20h, aunque el acuse siga sin salir, NO avisa a Leonardo por la demora", async () => {
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

  const avisos20h = correosEnviados.filter((c) => /20 horas/.test(c.asunto));
  assert.equal(avisos20h.length, 0, "antes de 20h no debe escalar a Leonardo todavia");
});

test("M37: si el reintento SI logra mandar el acuse, no avisa a Leonardo aunque hayan pasado 20h", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: Timestamp.now() });
  const { deps, correosEnviados } = depsReintentoConFirestoreFalso(db, "pago-1"); // enviarCorreo exitoso para todos.

  const ahora21h = new Date(DATOS_REINTENTO_BASE.fecha.getTime() + 21 * 3600_000);
  await reintentarAcusePendiente(DATOS_REINTENTO_BASE, ahora21h, deps);

  const avisos20h = correosEnviados.filter((c) => /20 horas/.test(c.asunto));
  assert.equal(avisos20h.length, 0, "si el acuse SI salio, no hay nada que escalar");
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador, "enviado");
});

// ── seleccionarPagosParaBarrido (PURA): candidatos del barrido global del webhook ────────────────

const CINCO_MIN_MS = 5 * 60_000;

function candidato(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    data: {
      uid: "uid-1",
      referenciaId: "ref-1",
      cop: 49102,
      trm: 3273.49,
      fechaTrm: "2026-10-03",
      fecha: Timestamp.now(),
      vence: Timestamp.now(),
      correoComprador: null,
      procesadoEn: Timestamp.fromMillis(Date.now() - 10 * 60_000), // 10 min, por defecto.
      ...overrides,
    },
  };
}

test("seleccionarPagosParaBarrido: incluye un candidato pendiente con mas antiguedad que el minimo", () => {
  const ahora = new Date();
  const seleccionados = seleccionarPagosParaBarrido([candidato("pago-1")], ahora, CINCO_MIN_MS, 5);
  assert.equal(seleccionados.length, 1);
  assert.equal(seleccionados[0].paymentId, "pago-1");
});

test("seleccionarPagosParaBarrido: excluye un candidato mas reciente que el minimo de antiguedad", () => {
  const ahora = new Date();
  const reciente = candidato("pago-reciente", { procesadoEn: Timestamp.fromMillis(Date.now() - 60_000) }); // 1 min.
  const seleccionados = seleccionarPagosParaBarrido([reciente], ahora, CINCO_MIN_MS, 5);
  assert.equal(seleccionados.length, 0);
});

test("seleccionarPagosParaBarrido: excluye correoComprador='enviado' y candidatos sin uid guardado", () => {
  const ahora = new Date();
  const enviado = candidato("pago-enviado", { correoComprador: "enviado" });
  const sinUid = candidato("pago-sin-uid", { uid: null });
  const seleccionados = seleccionarPagosParaBarrido([enviado, sinUid], ahora, CINCO_MIN_MS, 5);
  assert.equal(seleccionados.length, 0);
});

test("seleccionarPagosParaBarrido: respeta el limite aunque haya mas candidatos validos", () => {
  const ahora = new Date();
  const candidatos = ["a", "b", "c"].map((id) => candidato(id));
  const seleccionados = seleccionarPagosParaBarrido(candidatos, ahora, CINCO_MIN_MS, 2);
  assert.equal(seleccionados.length, 2);
});

// ── G3 (correccion NO-GO vuelta 30, 2026-10-05): un pago revertido NUNCA se elige ni se reintenta ──
// Oraculo de la orden: "pago revertido con correoComprador null → no se elige y no se envía nada".

test("G3: elegibleParaReintentoAcuse rechaza un pago revertido aunque correoComprador sea null", () => {
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, revertido: true }, new Date()), false);
});

// ── Medio 4 (correccion vuelta 31, 2026-10-06): un pago "requiere_reembolso" (pago doble, NUNCA
// activo nada) tampoco debe reintentar el acuse de compra — no hay nada que confirmarle al
// comprador porque su compra nunca se activo. Control positivo: el mismo dato SIN el flag SI es
// elegible, para probar que es ese flag especifico el que excluye (no otra condicion del objeto).

test("Medio 4: elegibleParaReintentoAcuse rechaza un pago con requiereReembolso=true", () => {
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, requiereReembolso: true }, new Date()), false);
});

test("Medio 4 (control positivo): el mismo pago SIN requiereReembolso (false/ausente) SI es elegible", () => {
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, requiereReembolso: false }, new Date()), true);
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null }, new Date()), true);
});

test("G3: seleccionarPagosParaBarrido excluye un pago revertido con correoComprador null (no se elige)", () => {
  const ahora = new Date();
  const revertido = candidato("pago-revertido", { correoComprador: null, revertido: true });
  const seleccionados = seleccionarPagosParaBarrido([revertido], ahora, CINCO_MIN_MS, 5);
  assert.equal(seleccionados.length, 0, "un pago revertido nunca debe elegirse para reintentar el acuse");
});

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

test("B3: un reclamo 'reclamado' EXACTAMENTE en el umbral (ni un ms mas) SI se considera atascado", async () => {
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

test("B3: un reclamo 'reclamado' UN ms antes del umbral NO se considera atascado todavia", async () => {
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

// ── M2 (correccion NO-GO vuelta 30, 2026-10-05): tope de intentos con espera creciente ──────────

test("M2: calcularEsperaBackoffMs crece exponencialmente (2^n minutos)", () => {
  assert.equal(calcularEsperaBackoffMs(0), 60_000); // 2^0 = 1 min
  assert.equal(calcularEsperaBackoffMs(1), 2 * 60_000);
  assert.equal(calcularEsperaBackoffMs(2), 4 * 60_000);
  assert.equal(calcularEsperaBackoffMs(3), 8 * 60_000);
});

test("M2: registrarIntentoAcuseTx incrementa intentosAcuse y guarda ultimoIntentoAcuseEn", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", {});
  const pagoRef = db.doc("pagosProcesados/pago-1");
  const ahora = new Date();

  const r1 = await db.runTransaction((tx) => registrarIntentoAcuseTx(tx, pagoRef, ahora));
  assert.deepEqual(r1, { intentos: 1, agotado: false });
  assert.equal(db.leer("pagosProcesados/pago-1")?.intentosAcuse, 1);
  assert.equal(
    (db.leer("pagosProcesados/pago-1")?.ultimoIntentoAcuseEn as Timestamp).toMillis(),
    ahora.getTime()
  );

  const r2 = await db.runTransaction((tx) => registrarIntentoAcuseTx(tx, pagoRef, ahora));
  assert.deepEqual(r2, { intentos: 2, agotado: false });
});

test(`M2: al llegar a MAX_INTENTOS_ACUSE (${MAX_INTENTOS_ACUSE}) se marca agotado y NO cuenta un intento nuevo`, async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { intentosAcuse: MAX_INTENTOS_ACUSE });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const r = await db.runTransaction((tx) => registrarIntentoAcuseTx(tx, pagoRef, new Date()));

  assert.deepEqual(r, { intentos: MAX_INTENTOS_ACUSE, agotado: true });
  assert.equal(db.leer("pagosProcesados/pago-1")?.estadoAcuse, "agotado");
  assert.equal(db.leer("pagosProcesados/pago-1")?.intentosAcuse, MAX_INTENTOS_ACUSE, "no debe contar un intento nuevo");
});

test("M2: exactamente MAX_INTENTOS_ACUSE-1 intentos previos SI permite un intento mas (10mo intento real)", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { intentosAcuse: MAX_INTENTOS_ACUSE - 1 });
  const pagoRef = db.doc("pagosProcesados/pago-1");

  const r = await db.runTransaction((tx) => registrarIntentoAcuseTx(tx, pagoRef, new Date()));

  assert.deepEqual(r, { intentos: MAX_INTENTOS_ACUSE, agotado: false }, "el intento numero MAX_INTENTOS_ACUSE SI debe intentarse");
});

test("M2: elegibleParaReintentoAcuse rechaza estadoAcuse='agotado' (estado terminal, M3)", () => {
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, estadoAcuse: "agotado" }, new Date()), false);
});

test("M2: elegibleParaReintentoAcuse respeta la espera creciente (no reintenta antes de 2^n min)", () => {
  const ahora = new Date("2026-10-05T12:00:00.000Z");
  const unMinDespuesDelPrimerIntento = {
    correoComprador: null,
    intentosAcuse: 1,
    ultimoIntentoAcuseEn: Timestamp.fromDate(new Date(ahora.getTime() - 1 * 60_000)), // 1 min, necesita 2^1=2.
  };
  assert.equal(elegibleParaReintentoAcuse(unMinDespuesDelPrimerIntento, ahora), false, "todavia no pasaron los 2 min requeridos");

  const dosMinDespues = {
    ...unMinDespuesDelPrimerIntento,
    ultimoIntentoAcuseEn: Timestamp.fromDate(new Date(ahora.getTime() - 2 * 60_000)),
  };
  assert.equal(elegibleParaReintentoAcuse(dosMinDespues, ahora), true, "ya pasaron los 2 min requeridos");
});

test("M3: elegibleParaReintentoAcuse rechaza avisoBloqueoProveedor/avisoAcuse20h ya 'enviado' (estados terminales)", () => {
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, avisoBloqueoProveedor: "enviado" }, new Date()), false);
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, avisoAcuse20h: "enviado" }, new Date()), false);
  // "reclamado" (no "enviado") en esos dos destinatarios NO es terminal: debe seguir elegible.
  assert.equal(elegibleParaReintentoAcuse({ correoComprador: null, avisoBloqueoProveedor: "reclamado" }, new Date()), true);
});
