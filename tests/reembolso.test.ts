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

function revertir(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) => revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId));
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
  // Compra vieja (pago-1), luego una compra NUEVA (pago-2) que reemplaza el ultimoPago activo —
  // mismo patron de "no se acumulan los sobrantes" de la Tarea 6: activar de nuevo REEMPLAZA la
  // cuenta entera (tx.set), asi que pago-1 deja de ser el `ultimoPago`.
  await activar(db, "uid-1", "pago-1");
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
