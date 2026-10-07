// Pruebas del plan "Pago por uso" (Tarea 16A-1, decision del Brain 2026-10-06: US$0,15 por envio,
// saldo SIN vencimiento y ACUMULABLE; el Paquete sigue igual; "Pro" desaparece). Mismo patron que
// tests/reembolso.test.ts: doble de Firestore de tests/_fakeFirestore.ts, nunca toca la red ni
// Firestore real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  activarPorUsoSiNoProcesadoTx,
  activarPaqueteSiNoProcesadoTx,
  revertirPagoSiNoRevertidoTx,
  decidirLote,
  type Cuenta,
} from "../server/cuentas";
import { FirestoreFalso, MENSAJE_LECTURAS_DESPUES_DE_ESCRITURAS } from "./_fakeFirestore";

function activarPorUso(db: FirestoreFalso, uid: string, paymentId: string, cantidad: number, fecha = new Date("2026-10-06T12:00:00.000Z")) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) =>
    activarPorUsoSiNoProcesadoTx(tx, pagoRef, cuentaRef, {
      paymentId,
      uid,
      cantidad,
      cop: cantidad * 600, // cifra cualquiera, no es el foco de estas pruebas.
      trm: 3900,
      fecha: Timestamp.fromDate(fecha),
    })
  );
}

function activarPaquete(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(tx, pagoRef, cuentaRef, {
      paymentId,
      cop: 49102,
      trm: 3273.49,
      fecha: Timestamp.fromDate(new Date("2026-10-06T12:00:00.000Z")),
    })
  );
}

function revertir(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) => revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId));
}

// ── Activa y suma; la misma activacion dos veces solo suma una vez (idempotencia) ──────────────

test("activarPorUsoSiNoProcesadoTx: dos activaciones DISTINTAS se suman", async () => {
  const db = new FirestoreFalso();
  const r1 = await activarPorUso(db, "uid-1", "pago-1", 50);
  const r2 = await activarPorUso(db, "uid-1", "pago-2", 30);
  assert.equal(r1, "activado");
  assert.equal(r2, "activado");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 80, "50 + 30 = 80, el saldo Por uso es acumulable");
  assert.equal(cuenta.ultimoPago!.id, "pago-2");
});

test("activarPorUsoSiNoProcesadoTx: la MISMA activacion (mismo paymentId) aplicada dos veces suma solo una vez", async () => {
  const db = new FirestoreFalso();
  const r1 = await activarPorUso(db, "uid-1", "pago-1", 50);
  const r2 = await activarPorUso(db, "uid-1", "pago-1", 50); // aviso repetido del mismo pago.
  assert.equal(r1, "activado");
  assert.equal(r2, "repetido");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 50, "nunca 100: el segundo aviso del mismo pago no suma de nuevo");
});

test("activarPorUsoSiNoProcesadoTx: sobre una cuenta nueva (sin documento previo) la crea con el saldo", async () => {
  const db = new FirestoreFalso();
  const r = await activarPorUso(db, "uid-nuevo", "pago-1", 20);
  assert.equal(r, "activado");

  const cuenta = db.leer("cuentas/uid-nuevo") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 20);
  assert.equal(cuenta.plan, "gratis", "una cuenta nueva con solo saldo Por uso sigue en Gratis");
  assert.equal(cuenta.enviosRestantes, 0);
});

// ── Mutacion (oraculo real, no solo documentada): si `activarPorUsoSiNoProcesadoTx` leyera la
// cuenta DESPUES de escribir el pago (orden invertido), el doble de Firestore debe lanzar el
// mismo error que el SDK real — mismo patron que la prueba G3 de tests/registrarEnvio.test.ts. ──

test("activarPorUsoSiNoProcesadoTx: la version real NO lanza 'reads before writes' (todas las lecturas van primero)", async () => {
  const db = new FirestoreFalso();
  // Si el orden estuviera invertido, esta llamada lanzaria (sin try/catch: fallaria aqui mismo).
  await activarPorUso(db, "uid-1", "pago-1", 10);
  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 10);
});

test("mutacion de control: invertir el orden (escribir el pago y DESPUES leer la cuenta) SI reproduce el error real de Firestore", async () => {
  const db = new FirestoreFalso();
  const pagoRef = db.doc("pagosProcesados/pago-1");
  const cuentaRef = db.doc("cuentas/uid-1");

  async function activarPorUsoConBug(tx: any) {
    tx.set(pagoRef, { procesadoEn: Timestamp.now(), tipo: "porUso", cantidad: 10 });
    await tx.get(cuentaRef); // <- lectura DESPUES de una escritura: el orden que NO debe tener la real.
  }

  await assert.rejects(
    () => db.runTransaction((tx) => activarPorUsoConBug(tx)),
    (err: any) => {
      assert.equal(err.message, MENSAJE_LECTURAS_DESPUES_DE_ESCRITURAS);
      return true;
    }
  );
});

// ── Activar un Paquete conserva saldoPorUso y reservadosPorUso (el `tx.set` del Paquete REEMPLAZA
// el documento completo: sin la correccion, borraria el saldo Por uso de la misma cuenta) ──────

test("activarPaqueteSiNoProcesadoTx: activar un Paquete CONSERVA el saldoPorUso ya acumulado", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "pago-porUso-1", 70);
  let cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 70);

  const r = await activarPaquete(db, "uid-1", "pago-paquete-1");
  assert.equal(r, "activado");

  cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete");
  assert.equal(cuenta.enviosRestantes, 150);
  assert.equal(cuenta.saldoPorUso, 70, "activar el Paquete NUNCA debe borrar el saldo Por uso");
});

test("activarPaqueteSiNoProcesadoTx: conserva tambien reservadosPorUso (no solo el saldo)", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "pago-porUso-1", 70);
  // Simula un lote "porUso" abierto con 5 cupos reservados (mismo patron que M23 para el Paquete).
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), reservadosPorUso: 5 });

  await activarPaquete(db, "uid-1", "pago-paquete-1");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.reservadosPorUso, 5, "las reservas Por uso en vuelo no deben perderse al activar un Paquete");
});

// ── Revertir un pago Por uso resta SOLO lo que ese pago sumo, sin tocar el Paquete ──────────────

test("revertirPagoSiNoRevertidoTx: revertir un pago porUso resta exactamente su cantidad", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "pago-1", 50);
  await activarPorUso(db, "uid-1", "pago-2", 30);
  let cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 80);

  const resultado = await revertir(db, "uid-1", "pago-1");
  assert.equal(resultado, "revertido");

  cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 30, "80 - 50 (lo que pago-1 habia sumado) = 30, pago-2 queda intacto");

  const pago1 = db.leer("pagosProcesados/pago-1");
  assert.equal(pago1?.revertido, true);
  assert.equal(pago1?.tipo, "porUso", "el tipo del pago revertido queda legible (nunca se borra)");
});

test("revertirPagoSiNoRevertidoTx: revertir un pago porUso NUNCA resetea la cuenta a Gratis ni toca el Paquete", async () => {
  const db = new FirestoreFalso();
  await activarPaquete(db, "uid-1", "pago-paquete-1");
  await activarPorUso(db, "uid-1", "pago-porUso-1", 40);

  await revertir(db, "uid-1", "pago-porUso-1");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete", "revertir un pago Por uso no debe tocar el plan Paquete");
  assert.equal(cuenta.enviosRestantes, 150);
  assert.equal(cuenta.saldoPorUso, 0);
});

test("revertirPagoSiNoRevertidoTx (idempotencia quitada seria un bug): una segunda reversion del MISMO pago porUso no resta de nuevo", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "pago-1", 50);

  const r1 = await revertir(db, "uid-1", "pago-1");
  const r2 = await revertir(db, "uid-1", "pago-1");

  assert.equal(r1, "revertido");
  assert.equal(r2, "ya_procesado");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 0, "nunca negativo ni restado dos veces");
});

test("revertirPagoSiNoRevertidoTx: saldoPorUso nunca queda negativo (resta con minimo 0)", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "pago-1", 50);
  // La cuenta ya gasto parte del saldo (consumo real vía confirmarEnvioExitosoTx, simulado aqui
  // directo): queda con menos saldo del que el pago original habia sumado.
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), saldoPorUso: 10 });

  await revertir(db, "uid-1", "pago-1");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 0, "10 - 50 se recorta a 0, nunca negativo");
});

// ── El saldo Por uso NO VENCE: sigue disponible aunque `ahora` sea una fecha muy futura ─────────

test("Por uso no vence: decidirLote lo sigue aceptando con `ahora` muy en el futuro", () => {
  const cuentaConSaldo: Cuenta = {
    plan: "gratis",
    enviosRestantes: 0,
    vence: null,
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    saldoPorUso: 200,
    reservadosPorUso: 0,
    ultimoPago: null,
    actualizado: Timestamp.now(),
  };

  const dentroDeUnMes = decidirLote(cuentaConSaldo, 50, new Date("2026-11-06T00:00:00Z"));
  const dentroDeDiezAnios = decidirLote(cuentaConSaldo, 50, new Date("2036-10-06T00:00:00Z"));

  assert.equal(dentroDeUnMes.permitido, true);
  assert.equal(dentroDeDiezAnios.permitido, true, "el saldo Por uso no tiene fecha de vencimiento");
  assert.deepEqual(dentroDeUnMes.consumo, dentroDeDiezAnios.consumo);
});

test("Por uso no vence: un pago activado con fecha vieja sigue 100% disponible mucho despues", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "pago-1", 100, new Date("2020-01-01T00:00:00.000Z"));

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  const d = decidirLote(cuenta as Cuenta, 90, new Date("2036-01-01T00:00:00Z"));
  assert.equal(d.permitido, true, "16 anios despues del pago, el saldo Por uso sigue intacto");
  assert.deepEqual(d.consumo, { paquete: 0, porUso: 90 });
});
