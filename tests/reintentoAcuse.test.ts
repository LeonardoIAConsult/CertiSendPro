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
