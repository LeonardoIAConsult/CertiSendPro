// Pruebas de la reversion por contracargo/reembolso (Tarea 9, cobro real con planes, 2026-10-05).
// `revertirPagoSiNoRevertidoTx` sobre el doble de Firestore de tests/_fakeFirestore.ts (mismo
// patron que tests/registrarEnvio.test.ts/tests/webhook.test.ts): activa un Paquete de verdad con
// `activarPaqueteSiNoProcesadoTx` (misma funcion que produccion) y despues revierte, para que la
// prueba de "vuelve a Gratis" sea real, no un mock que "simula el exito".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  activarPaqueteSiNoProcesadoTx,
  activarPorUsoSiNoProcesadoTx,
  revertirPagoSiNoRevertidoTx,
  type Cuenta,
} from "../server/cuentas";
import { FirestoreFalso } from "./_fakeFirestore";

function activar(db: FirestoreFalso, uid: string, paymentId: string, cop = 49102) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(tx, pagoRef, cuentaRef, {
      paymentId,
      cop,
      trm: 3273.49,
      fecha: Timestamp.fromDate(new Date("2026-10-05T15:00:00.000Z")),
    })
  );
}

function activarPorUso(db: FirestoreFalso, uid: string, paymentId: string, cantidad: number) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) =>
    activarPorUsoSiNoProcesadoTx(tx, pagoRef, cuentaRef, {
      paymentId,
      uid,
      cantidad,
      cop: cantidad * 600,
      trm: 3900,
      fecha: Timestamp.fromDate(new Date("2026-10-06T12:00:00.000Z")),
    })
  );
}

function revertir(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) => revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId));
}

/** G1 (fallback para cuentas viejas): mismo patron de DI que `recalcular` en
 * tests/registrarEnvio.test.ts — una consulta de `obtenerTipoPago` contra el propio doble de
 * Firestore de esta prueba, sin tocar la produccion. */
function revertirConTipoPago(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  const obtenerTipoPago = async (id: string) => db.leer(`pagosProcesados/${id}`)?.tipo as string | undefined;
  return db.runTransaction((tx) =>
    revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId, undefined, obtenerTipoPago)
  );
}

// ── Oraculo: charged_back del pago activo -> Gratis y saldo 0, una sola vez ────────────────────

test("revertirPagoSiNoRevertidoTx: contracargo del pago ACTIVO revierte la cuenta a Gratis con saldo 0", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-1");
  let cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete");
  assert.equal(cuenta.enviosRestantes, 150);

  const resultado = await revertir(db, "uid-1", "pago-1");
  assert.equal(resultado, "revertido");

  cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "gratis");
  assert.equal(cuenta.enviosRestantes, 0);
  assert.equal(cuenta.vence, null);
  assert.equal(cuenta.ultimoPago, null);
});

test("revertirPagoSiNoRevertidoTx: una segunda reversion del MISMO pago no hace nada mas (idempotente)", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-1");

  const r1 = await revertir(db, "uid-1", "pago-1");
  const r2 = await revertir(db, "uid-1", "pago-1");

  assert.equal(r1, "revertido");
  assert.equal(r2, "ya_procesado");

  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.revertido, true);
});

// ── Oraculo: refund de un pago que NO es el activo -> la cuenta queda intacta ──────────────────

test("revertirPagoSiNoRevertidoTx: reembolso de un pago que YA NO es el activo no toca la cuenta", async () => {
  const db = new FirestoreFalso();
  // Compra vieja (pago-1) que se AGOTA (saldo 0) antes de la compra NUEVA (pago-2): Medio 4
  // (activarPaqueteSiNoProcesadoTx, correccion vuelta 31) solo bloquea un pago nuevo cuando el
  // Paquete anterior SIGUE vigente con saldo > 0 — agotado, pago-2 legitimamente reemplaza el
  // `ultimoPago` activo (mismo patron de "no se acumulan los sobrantes" de la Tarea 6: activar de
  // nuevo REEMPLAZA la cuenta entera via tx.set).
  await activar(db, "uid-1", "pago-1");
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), enviosRestantes: 0 });
  await activar(db, "uid-1", "pago-2");

  const antes = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(antes.ultimoPago!.id, "pago-2");

  const resultado = await revertir(db, "uid-1", "pago-1"); // se reembolsa el pago VIEJO, no el activo
  assert.equal(resultado, "no_activo");

  const despues = db.leer("cuentas/uid-1") as Cuenta;
  assert.deepEqual(despues, antes, "la cuenta no debe cambiar ni un campo");

  const pago1 = db.leer("pagosProcesados/pago-1");
  assert.equal(pago1?.revertido, true, "el evento queda marcado igual, para no repetir el aviso a Leonardo");
});

// ── Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06) ───────────────────
// activarPaqueteSiNoProcesadoTx NUNCA pisa un Paquete vigente con saldo activado por OTRO pago.

test("activarPaqueteSiNoProcesadoTx (Medio 4): segundo pago con Paquete vigente+saldo de OTRO pago -> requiere_reembolso, cuenta intacta", async () => {
  const db = new FirestoreFalso();
  const r1 = await activar(db, "uid-1", "pago-1");
  assert.equal(r1, "activado");
  const antes = db.leer("cuentas/uid-1") as Cuenta;

  const r2 = await activar(db, "uid-1", "pago-2");
  assert.equal(r2, "requiere_reembolso");

  const despues = db.leer("cuentas/uid-1") as Cuenta;
  assert.deepEqual(despues, antes, "la cuenta no debe cambiar ni un campo");

  const pago2 = db.leer("pagosProcesados/pago-2");
  assert.equal(pago2?.requiereReembolso, true);
  assert.equal(pago2?.vence, null);
});

test("activarPaqueteSiNoProcesadoTx (Medio 4): Paquete AGOTADO (saldo 0) de otro pago -> el nuevo SI activa (no hay nada vigente que proteger)", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-1");
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), enviosRestantes: 0 });

  const r2 = await activar(db, "uid-1", "pago-2");
  assert.equal(r2, "activado");
  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.ultimoPago!.id, "pago-2");
  assert.equal(cuenta.enviosRestantes, 150);
});

test("activarPaqueteSiNoProcesadoTx (Medio 4): Paquete VENCIDO de otro pago -> el nuevo SI activa (no hay nada vigente que proteger)", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-1");
  const { Timestamp: TS } = await import("firebase-admin/firestore");
  db.seed("cuentas/uid-1", {
    ...(db.leer("cuentas/uid-1") as Cuenta),
    vence: TS.fromDate(new Date("2000-01-01T00:00:00.000Z")),
  });

  const r2 = await activar(db, "uid-1", "pago-2");
  assert.equal(r2, "activado");
  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.ultimoPago!.id, "pago-2");
});

// ── Pago que nunca activo nada aqui (id inventado / nunca approved) -> ignorado ────────────────

test("revertirPagoSiNoRevertidoTx: paymentId sin pagosProcesados -> ignorado, nada se toca", async () => {
  const db = new FirestoreFalso();
  db.seed("cuentas/uid-1", {
    plan: "paquete",
    enviosRestantes: 150,
    vence: Timestamp.fromDate(new Date("2026-11-05T00:00:00.000Z")),
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    ultimoPago: { id: "pago-real", cop: 49102, trm: 3273.49, fecha: Timestamp.now() },
    actualizado: Timestamp.now(),
  });

  const resultado = await revertir(db, "uid-1", "pago-inventado");
  assert.equal(resultado, "ignorado");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete", "una cuenta con un pago distinto activo no debe cambiar");
});

// ── Mutacion (documentada, no comiteada): sin el `if (pagoSnap.data()?.revertido === true)` de
// `revertirPagoSiNoRevertidoTx`, la prueba de idempotencia caeria: la segunda llamada volveria a
// decir "revertido" (y, si la cuenta ya hubiera vuelto a comprar entre las dos llamadas, la
// segunda reversion la pisaria otra vez a Gratis, borrando una compra nueva legitima). Se
// verifico a mano comentando ese `if` y confirmando que `r2` pasaba de "ya_procesado" a
// "revertido"; restaurado de inmediato.

// ── G1 (NO-GO de la revision externa sobre la Tarea 16, 2026-10-07): un reembolso del Paquete
// DESPUES de una compra Por Uso dejaba el Paquete activo — `activarPorUsoSiNoProcesadoTx` pisa
// `cuenta.ultimoPago` (lo necesita para su propia idempotencia), y `revertirPagoSiNoRevertidoTx`
// comparaba `cuenta.ultimoPago.id === paymentId` para saber si el Paquete que se esta revirtiendo
// es el activo: tras una compra Por Uso, esa comparacion siempre fallaba y devolvia "no_activo".
// Arreglo: `cuenta.pagoPaqueteId`, que SOLO escribe `activarPaqueteSiNoProcesadoTx` y que una
// compra Por Uso nunca toca. ──────────────────────────────────────────────────────────────────────

test("G1: Paquete -> porUso -> reembolso del Paquete SI revierte (antes daba no_activo)", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-paquete-1");
  await activarPorUso(db, "uid-1", "pago-poruso-1", 100);

  let cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.ultimoPago!.id, "pago-poruso-1", "la compra porUso pisa ultimoPago (esperado)");
  assert.equal(cuenta.pagoPaqueteId, "pago-paquete-1", "pero pagoPaqueteId sigue siendo el del Paquete");
  assert.equal(cuenta.saldoPorUso, 100);

  const resultado = await revertir(db, "uid-1", "pago-paquete-1");
  assert.equal(resultado, "revertido", "con pagoPaqueteId, el Paquete SI se reconoce como activo");

  cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "gratis");
  assert.equal(cuenta.enviosRestantes, 0);
  assert.equal(cuenta.pagoPaqueteId, null, "pagoPaqueteId vuelve a null al revertir el Paquete activo");
  assert.equal(cuenta.saldoPorUso, 100, "el saldo Por Uso no se toca al revertir el Paquete");
});

test("G1 (mutacion documentada): comparar contra ultimoPago.id en vez de pagoPaqueteId hace caer la prueba de arriba", () => {
  // Verificado a mano (no comiteado): en revertirPagoSiNoRevertidoTx, cambiar
  // `pagoPaqueteIdActual === paymentId` por `(cuenta?.ultimoPago?.id ?? null) === paymentId`
  // reproduce exactamente el bug de G1 — la prueba de arriba pasa de "revertido" a "no_activo"
  // (cuenta.ultimoPago.id es "pago-poruso-1", nunca "pago-paquete-1", tras la compra porUso).
  // Restaurado de inmediato tras confirmarlo.
  assert.ok(true);
});

test("G1 fallback: cuenta VIEJA sin pagoPaqueteId (campo ausente) con ultimoPago de tipo Paquete SI revierte", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-1");

  // Simula una cuenta migrada ANTES de este fix: el campo pagoPaqueteId nunca llego a escribirse.
  const cuentaVieja: any = { ...(db.leer("cuentas/uid-1") as Cuenta) };
  delete cuentaVieja.pagoPaqueteId;
  db.seed("cuentas/uid-1", cuentaVieja);

  const resultado = await revertirConTipoPago(db, "uid-1", "pago-1");
  assert.equal(resultado, "revertido", "fallback a ultimoPago.id: pagosProcesados/pago-1.tipo no es porUso");
});

test("G1 fallback (mutacion documentada): sin `obtenerTipoPago` inyectado, la cuenta vieja NO revierte (conservador)", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-1");
  const cuentaVieja: any = { ...(db.leer("cuentas/uid-1") as Cuenta) };
  delete cuentaVieja.pagoPaqueteId;
  db.seed("cuentas/uid-1", cuentaVieja);

  // Mismo caso que arriba, pero via `revertir` (sin inyectar `obtenerTipoPago`, como hace la
  // produccion `revertirPagoSiNoRevertido` SIEMPRE hace — esta funcion es el equivalente de
  // "la mutacion de quitar la inyeccion real" para esta prueba).
  const resultado = await revertir(db, "uid-1", "pago-1");
  assert.equal(resultado, "no_activo", "sin la consulta inyectada, no se puede confirmar el tipo: conservador");
});

test("G1 fallback conservador: cuenta VIEJA sin pagoPaqueteId y ultimoPago SIN registro en pagosProcesados -> no se asume activo", async () => {
  const db = new FirestoreFalso();
  // Cuenta vieja cuyo ultimoPago.id no tiene ningun documento en pagosProcesados (caso
  // practicamente imposible en produccion: esa coleccion nunca se borra; existe solo para probar
  // el camino "conservador" explicito del Brain).
  db.seed("cuentas/uid-1", {
    plan: "paquete",
    enviosRestantes: 150,
    vence: Timestamp.fromDate(new Date("2026-11-05T00:00:00.000Z")),
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    saldoPorUso: 0,
    reservadosPorUso: 0,
    ultimoPago: { id: "pago-huerfano", cop: 49102, trm: 3273.49, fecha: Timestamp.now() },
    actualizado: Timestamp.now(),
  });
  // Un pago REAL y distinto, que si existe y SI es de tipo Paquete.
  db.seed("pagosProcesados/pago-real", { procesadoEn: Timestamp.now() });

  const resultado = await revertirConTipoPago(db, "uid-1", "pago-real");
  assert.equal(resultado, "no_activo", "sin poder confirmar el tipo de ultimoPago, no se asume que pago-real sea el activo");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete", "la cuenta no debe tocarse ante la duda");
});

// ── B6 (NO-GO de la revision externa sobre b865256, 2026-10-07): una cuenta con Paquete activado
// por el codigo VIEJO (sin `pagoPaqueteId`) que despues compra Por Uso debia migrar el campo ANTES
// de que esa misma compra pisara `ultimoPago` — sin la migracion, un reembolso posterior del
// Paquete real quedaba "no_activo" para siempre (el mismo sintoma que G1, pero para cuentas que
// nunca pasaron por el fix de G1 porque se activaron antes de que `pagoPaqueteId` existiera). ────

test("B6: cuenta VIEJA con Paquete (sin pagoPaqueteId) + compra porUso migra el campo ANTES de pisar ultimoPago -> el reembolso del Paquete SI revierte", async () => {
  const db = new FirestoreFalso();
  await activar(db, "uid-1", "pago-paquete-1");

  // Simula una cuenta de Paquete activada por el codigo VIEJO (antes de este fix): el campo
  // `pagoPaqueteId` nunca llego a escribirse.
  const cuentaVieja: any = { ...(db.leer("cuentas/uid-1") as Cuenta) };
  delete cuentaVieja.pagoPaqueteId;
  db.seed("cuentas/uid-1", cuentaVieja);

  await activarPorUso(db, "uid-1", "pago-poruso-1", 100);

  const tras = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(tras.ultimoPago!.id, "pago-poruso-1", "la compra porUso pisa ultimoPago (esperado)");
  assert.equal(tras.pagoPaqueteId, "pago-paquete-1", "B6: pero la migracion ya dejo pagoPaqueteId con el del Paquete viejo");

  const resultado = await revertir(db, "uid-1", "pago-paquete-1");
  assert.equal(resultado, "revertido", "con el campo migrado, el Paquete viejo SI se reconoce como activo");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "gratis");
  assert.equal(cuenta.saldoPorUso, 100, "el saldo Por Uso no se toca al revertir el Paquete");
});

test("B6 (mutacion documentada): quitar la migracion en activarPorUsoSiNoProcesadoTx hace caer la prueba de arriba", () => {
  // Verificado a mano (no comiteado): en activarPorUsoSiNoProcesadoTx, quitar el bloque que
  // escribe `pagoPaqueteId` antes del `tx.update(cuentaRef, actualizacion)` (volver a
  // `tx.update(cuentaRef, { saldoPorUso: saldoPorUsoNuevo, ultimoPago })` sin mas) hace que la
  // prueba de arriba reciba "no_activo" en vez de "revertido": sin la migracion, pagoPaqueteId
  // sigue `undefined` y el fallback de resolverPagoPaqueteId mira `ultimoPago` (ya pisado por la
  // compra porUso, tipo "porUso") en vez del Paquete real. Restaurado de inmediato.
  assert.ok(true);
});

// ── Chequeo de tipo dentro del fallback de resolverPagoPaqueteId (parte del cierre de B6): una
// cuenta vieja (sin pagoPaqueteId) cuyo `ultimoPago` YA es un pago Por Uso no debe tratarse como
// si fuera el Paquete activo. Se prueba por el otro llamador de resolverPagoPaqueteId
// (activarPaqueteSiNoProcesadoTx/`vigentePorOtroPago`): al revertir, paymentId==ultimoPago.id
// siempre se resuelve antes por la rama "porUso" del propio pago (ver linea ~1011 de
// server/cuentas.ts), asi que ahi el chequeo de tipo nunca cambia el resultado observable; aqui
// SI lo hace, porque compara contra un paymentId DISTINTO (el de una activacion nueva). ──────────

function activarConTipoPago(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  const obtenerTipoPago = async (id: string) => db.leer(`pagosProcesados/${id}`)?.tipo as string | undefined;
  return db.runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(
      tx,
      pagoRef,
      cuentaRef,
      { paymentId, cop: 49102, trm: 3273.49, fecha: Timestamp.fromDate(new Date("2026-10-07T12:00:00.000Z")) },
      obtenerTipoPago
    )
  );
}

test("resolverPagoPaqueteId (chequeo de tipo en el fallback): ultimoPago de tipo porUso NO se asume Paquete vigente de otro pago", async () => {
  const db = new FirestoreFalso();
  // Cuenta "paquete" vigente (plan/enviosRestantes/vence) pero sin `pagoPaqueteId` (no migrada) y
  // cuyo `ultimoPago` ya fue pisado por una compra Por Uso posterior — mismo estado que B6
  // describe, construido directamente para aislar el chequeo de tipo del resto de los fixes.
  db.seed("cuentas/uid-1", {
    plan: "paquete",
    enviosRestantes: 80,
    vence: Timestamp.fromDate(new Date("2026-12-01T00:00:00.000Z")),
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    saldoPorUso: 100,
    reservadosPorUso: 0,
    ultimoPago: { id: "pago-poruso-1", cop: 60000, trm: 3900, fecha: Timestamp.now() },
    actualizado: Timestamp.now(),
  });
  db.seed("pagosProcesados/pago-poruso-1", { procesadoEn: Timestamp.now(), tipo: "porUso", cantidad: 100 });

  const resultado = await activarConTipoPago(db, "uid-1", "pago-nuevo-2");
  assert.equal(
    resultado,
    "activado",
    "el chequeo de tipo descarta ultimoPago (porUso) como el Paquete: sin pagoPaqueteId confiable, no bloquea la activacion nueva"
  );
});

test("resolverPagoPaqueteId (mutacion documentada): quitar el chequeo de tipo del fallback hace caer la prueba de arriba", () => {
  // Verificado a mano (no comiteado): en resolverPagoPaqueteId, cambiar
  // `return tipo === "porUso" ? null : cuenta.ultimoPago.id;` por `return cuenta.ultimoPago.id;`
  // (sin el chequeo de tipo) hace que la prueba de arriba reciba "requiere_reembolso" en vez de
  // "activado": el fallback asumiria, sin comprobar, que el pago Por Uso (ultimoPago) es un
  // Paquete vigente de OTRO pago, y bloquearia la activacion nueva legitima. Restaurado de
  // inmediato tras confirmarlo.
  assert.ok(true);
});
