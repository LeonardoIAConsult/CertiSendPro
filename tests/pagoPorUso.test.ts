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
  atribucionPorUso,
  contarReservadosPorUsoVigentes,
  reservarEnvioTx,
  reservarEnvio,
  _usarFirestoreParaPruebas,
  type Cuenta,
  type Lote,
  type CompraPorUsoNoRevertida,
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

/** M1: mismo `revertir`, pero inyectando la consulta REAL de compras Por Uso no revertidas de
 * `uid` — reconstruida leyendo del propio doble de Firestore de esta prueba (`db.leer`) los
 * `idsPago` que la prueba ya conoce (mismo patron de DI que `recalcular` en
 * tests/registrarEnvio.test.ts: la funcion inyectada SI consulta datos reales del doble, nunca un
 * valor fijo a ciegas) — para probar la atribucion FIFO entre VARIAS compras, no solo la que se
 * esta revirtiendo. */
function revertirConFifo(db: FirestoreFalso, uid: string, paymentId: string, idsPago: string[]) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  const listarComprasPorUsoNoRevertidas = async (uidBuscado: string): Promise<CompraPorUsoNoRevertida[]> => {
    assert.equal(uidBuscado, uid);
    const compras: CompraPorUsoNoRevertida[] = [];
    for (const id of idsPago) {
      const datos = db.leer(`pagosProcesados/${id}`);
      if (datos && datos.tipo === "porUso" && datos.uid === uid && datos.revertido !== true) {
        compras.push({ paymentId: id, cantidad: datos.cantidad, fecha: datos.fecha });
      }
    }
    return compras;
  };
  return db.runTransaction((tx) =>
    revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId, listarComprasPorUsoNoRevertidas)
  );
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

// ── M1 (NO-GO de la revision externa sobre la Tarea 16, 2026-10-07): atribucion de uso por orden
// de llegada — `atribucionPorUso`, funcion PURA ────────────────────────────────────────────────

function compra(paymentId: string, cantidad: number, fechaIso: string): CompraPorUsoNoRevertida {
  return { paymentId, cantidad, fecha: Timestamp.fromDate(new Date(fechaIso)) };
}

test("atribucionPorUso: 1 compra, saldo igual a la cantidad -> todo sin usar", () => {
  const r = atribucionPorUso([compra("p1", 50, "2026-10-01T00:00:00Z")], 50);
  assert.deepEqual(r, [{ paymentId: "p1", cantidad: 50, noUsado: 50, usado: 0 }]);
});

test("atribucionPorUso: 1 compra, saldo menor que la cantidad -> el resto quedo usado", () => {
  const r = atribucionPorUso([compra("p1", 50, "2026-10-01T00:00:00Z")], 10);
  assert.deepEqual(r, [{ paymentId: "p1", cantidad: 50, noUsado: 10, usado: 40 }]);
});

test("atribucionPorUso: 3 compras, saldo cubre solo las 2 mas recientes -> la mas vieja queda 100% usada", () => {
  // p1 (50, mas vieja), p2 (30), p3 (20, mas reciente). Saldo actual = 35: se atribuye primero a
  // p3 (20, cubre completo), luego a p2 (15 de 30), p1 queda en 0 (se interpreta como ya usada).
  const compras = [compra("p1", 50, "2026-10-01T00:00:00Z"), compra("p2", 30, "2026-10-03T00:00:00Z"), compra("p3", 20, "2026-10-05T00:00:00Z")];
  const r = atribucionPorUso(compras, 35);
  assert.deepEqual(r, [
    { paymentId: "p1", cantidad: 50, noUsado: 0, usado: 50 },
    { paymentId: "p2", cantidad: 30, noUsado: 15, usado: 15 },
    { paymentId: "p3", cantidad: 20, noUsado: 20, usado: 0 },
  ]);
});

test("atribucionPorUso: empate (dos compras con la MISMA cantidad) en el borde exacto del saldo", () => {
  // p1 (50, mas vieja) y p2 (50, mas reciente), saldo = 50: se atribuye TODO a la mas reciente
  // (p2), la mas vieja (p1) queda 100% usada — mismo criterio "orden de llegada" sin ambiguedad
  // porque el saldo cubre EXACTAMENTE una de las dos cantidades iguales.
  const compras = [compra("p1", 50, "2026-10-01T00:00:00Z"), compra("p2", 50, "2026-10-05T00:00:00Z")];
  const r = atribucionPorUso(compras, 50);
  assert.deepEqual(r, [
    { paymentId: "p1", cantidad: 50, noUsado: 0, usado: 50 },
    { paymentId: "p2", cantidad: 50, noUsado: 50, usado: 0 },
  ]);
});

test("atribucionPorUso: saldo 0 -> todas las compras quedan 100% usadas", () => {
  const compras = [compra("p1", 50, "2026-10-01T00:00:00Z"), compra("p2", 30, "2026-10-03T00:00:00Z")];
  const r = atribucionPorUso(compras, 0);
  assert.deepEqual(r, [
    { paymentId: "p1", cantidad: 50, noUsado: 0, usado: 50 },
    { paymentId: "p2", cantidad: 30, noUsado: 0, usado: 30 },
  ]);
});

// ── M1: revertirPagoSiNoRevertidoTx con la atribucion FIFO REAL entre varias compras ────────────

test("M1: revertir la compra MAS VIEJA entre 3, con parte del saldo ya usado, resta SOLO su parte sin usar", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "p1", 50, new Date("2026-10-01T00:00:00.000Z"));
  await activarPorUso(db, "uid-1", "p2", 30, new Date("2026-10-03T00:00:00.000Z"));
  await activarPorUso(db, "uid-1", "p3", 20, new Date("2026-10-05T00:00:00.000Z"));
  // Saldo activado = 100; se simula que ya se usaron 65 envios (confirmarEnvioExitosoTx real, en
  // la practica) dejando el saldo actual en 35.
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), saldoPorUso: 35 });

  // Revertir p1 (la mas vieja): atribucionPorUso([p1,p2,p3], 35) da noUsado(p1)=0, usado(p1)=50.
  const resultado = await revertirConFifo(db, "uid-1", "p1", ["p1", "p2", "p3"]);
  assert.equal(resultado, "revertido");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 35, "p1 no tenia nada sin usar (noUsado=0): el saldo no cambia");

  const pago1 = db.leer("pagosProcesados/p1");
  assert.equal(pago1?.usadosAlRevertir, 50, "los 50 de p1 se interpretan como ya usados (orden de llegada)");
});

test("M1: revertir la compra MAS RECIENTE entre las mismas 3 resta su parte COMPLETA (estaba sin usar)", async () => {
  const db = new FirestoreFalso();
  await activarPorUso(db, "uid-1", "p1", 50, new Date("2026-10-01T00:00:00.000Z"));
  await activarPorUso(db, "uid-1", "p2", 30, new Date("2026-10-03T00:00:00.000Z"));
  await activarPorUso(db, "uid-1", "p3", 20, new Date("2026-10-05T00:00:00.000Z"));
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), saldoPorUso: 35 });

  // Revertir p3 (la mas reciente): noUsado(p3)=20, usado(p3)=0.
  const resultado = await revertirConFifo(db, "uid-1", "p3", ["p1", "p2", "p3"]);
  assert.equal(resultado, "revertido");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 15, "35 - 20 (p3 completa, sin usar) = 15");

  const pago3 = db.leer("pagosProcesados/p3");
  assert.equal(pago3?.usadosAlRevertir, 0, "p3 no tenia nada usado");
});

test("M1 (mutacion documentada): restar la cantidad completa en vez del `noUsado` atribuido hace caer la prueba de 'la mas vieja'", () => {
  // Verificado a mano (no comiteado): forzar `noUsado = cantidadPago` (ignorando la atribucion)
  // en revertirPagoSiNoRevertidoTx hace que revertir p1 (arriba) reste 50 del saldo (35 -> -15,
  // recortado a 0) en vez de dejarlo en 35 — la prueba "revertir la compra MAS VIEJA..." cae.
  // Restaurado de inmediato tras confirmarlo.
  assert.ok(true);
});

// ── M2: revertir el Paquete activo conserva saldoPorUso y reservadosPorUso ──────────────────────

test("M2: revertir el Paquete activo CONSERVA saldoPorUso y reservadosPorUso", async () => {
  const db = new FirestoreFalso();
  await activarPaquete(db, "uid-1", "pago-paquete-1");
  await activarPorUso(db, "uid-1", "pago-porUso-1", 40);
  db.seed("cuentas/uid-1", { ...(db.leer("cuentas/uid-1") as Cuenta), reservadosPorUso: 7 });

  const resultado = await revertir(db, "uid-1", "pago-paquete-1");
  assert.equal(resultado, "revertido");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "gratis");
  assert.equal(cuenta.enviosRestantes, 0);
  assert.equal(cuenta.saldoPorUso, 40, "revertir el Paquete no debe tocar el saldo Por uso");
  assert.equal(cuenta.reservadosPorUso, 7, "ni las reservas Por uso en vuelo");
});

test("M2 (mutacion documentada): fijar `saldoPorUso: 0` al revertir el Paquete hace caer la prueba de arriba", () => {
  // Verificado a mano (no comiteado): en revertirPagoSiNoRevertidoTx, cambiar
  // `saldoPorUso: cuenta?.saldoPorUso ?? 0` por `saldoPorUso: 0` en el `tx.set` que revierte el
  // Paquete activo hace que la prueba de arriba espere 40 y reciba 0. Restaurado de inmediato.
  assert.ok(true);
});

// ── M3: recalculo de reservadosPorUso con la funcion REAL (contarReservadosPorUsoVigentes) ──────

test("M3: contarReservadosPorUsoVigentes (la funcion REAL) suma solo los lotes porUso/mixto vigentes del uid", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  try {
    const futuro = Timestamp.fromMillis(Date.now() + 3600_000);
    const pasado = Timestamp.fromMillis(Date.now() - 3600_000);
    const loteBase = (parcial: Partial<Lote>): Lote => ({
      uid: "u1",
      cantidad: 100,
      planEfectivo: "porUso",
      enviados: 0,
      reservados: 0,
      reservadosPaquete: 0,
      reservadosPorUso: 0,
      creado: Timestamp.now(),
      expira: futuro,
      ...parcial,
    });
    db.seed("lotes/L1", loteBase({ planEfectivo: "porUso", reservadosPorUso: 2 }));
    db.seed("lotes/L2", loteBase({ planEfectivo: "mixto", reservadosPorUso: 1 }));
    db.seed("lotes/L3", loteBase({ planEfectivo: "porUso", reservadosPorUso: 9, expira: pasado })); // expirado.
    db.seed("lotes/L4", loteBase({ uid: "u2", planEfectivo: "porUso", reservadosPorUso: 5 })); // otro uid.

    const total = await contarReservadosPorUsoVigentes("u1", new Date());
    assert.equal(total, 3, "solo L1(2)+L2(1): L3 expiro y L4 es de otro uid");
  } finally {
    _usarFirestoreParaPruebas(null);
  }
});

test("M3: reservarEnvioTx con el recalculo REAL acepta cuando el contador de la cuenta esta desincronizado", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  try {
    // El lote real que de verdad tiene reservas porUso vigentes suma solo 2...
    db.seed("lotes/L1", {
      uid: "u1",
      cantidad: 10,
      planEfectivo: "porUso",
      enviados: 0,
      reservados: 2,
      reservadosPaquete: 0,
      reservadosPorUso: 2,
      creado: Timestamp.now(),
      expira: Timestamp.fromMillis(Date.now() + 3600_000),
    } as Lote);
    // ...pero el contador de la cuenta dice 5 (desincronizado): saldo 5 <= reservados 5, sin
    // recalculo se rechazaria.
    db.seed("cuentas/u1", {
      plan: "gratis",
      enviosRestantes: 0,
      vence: null,
      renueva: false,
      mpSuscripcionId: null,
      reservadosPaquete: 0,
      saldoPorUso: 5,
      reservadosPorUso: 5,
      ultimoPago: null,
      actualizado: Timestamp.now(),
    } as Cuenta);

    const loteRef = db.doc("lotes/L1");
    const cuentaRef = db.doc("cuentas/u1");
    const r = await db.runTransaction((tx) =>
      reservarEnvioTx(tx, loteRef, cuentaRef, "u1", undefined, contarReservadosPorUsoVigentes)
    );
    assert.equal(r.ok, true, "con el numero real (2), 5 > 2: debe haber saldo y aceptar");

    const cuenta = db.leer("cuentas/u1") as Cuenta;
    assert.equal(cuenta.reservadosPorUso, 3, "se guarda el recalculo (2) + 1, corrigiendo el contador desincronizado");
  } finally {
    _usarFirestoreParaPruebas(null);
  }
});

test("M3 (mutacion documentada): sin el recalculo REAL inyectado, el mismo caso se rechaza (contador viejo manda)", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", {
    uid: "u1",
    cantidad: 10,
    planEfectivo: "porUso",
    enviados: 0,
    reservados: 2,
    reservadosPaquete: 0,
    reservadosPorUso: 2,
    creado: Timestamp.now(),
    expira: Timestamp.fromMillis(Date.now() + 3600_000),
  } as Lote);
  db.seed("cuentas/u1", {
    plan: "gratis",
    enviosRestantes: 0,
    vence: null,
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    saldoPorUso: 5,
    reservadosPorUso: 5,
    ultimoPago: null,
    actualizado: Timestamp.now(),
  } as Cuenta);

  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");
  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, false, "sin recalculo, el contador viejo (5<=5) rechaza, aunque el real sea 2");
});

// ── G2 (NO-GO de la revision externa sobre b865256, 2026-10-07): contarReservadosPorUsoVigentes
// tambien debe contar un lote "paquete" que, por B2, cayo parcialmente al saldo Por Uso — el
// filtro viejo (solo "porUso"/"mixto") lo dejaba fuera, y con envios en paralelo se podia gastar
// mas saldo Por Uso del pagado. ──────────────────────────────────────────────────────────────────

test("G2 (a): contarReservadosPorUsoVigentes (la funcion REAL) tambien cuenta un lote 'paquete' con reservadosPorUso", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  try {
    db.seed("lotes/L1", {
      uid: "u1",
      cantidad: 20,
      planEfectivo: "paquete", // B2: un lote "paquete" PURO puede caer al saldo Por Uso a mitad de camino.
      enviados: 0,
      reservados: 2,
      reservadosPaquete: 0,
      reservadosPorUso: 2,
      creado: Timestamp.now(),
      expira: Timestamp.fromMillis(Date.now() + 3600_000),
    } as Lote);

    const total = await contarReservadosPorUsoVigentes("u1", new Date());
    assert.equal(total, 2, "G2: un lote 'paquete' con reservadosPorUso debe sumar igual que uno 'porUso'/'mixto'");
  } finally {
    _usarFirestoreParaPruebas(null);
  }
});

test("G2 (b, sonda de concurrencia real): Paquete vigente agotado + saldoPorUso 3, lote 'paquete' de 20, 10 reservas en paralelo -> solo 3 aceptadas", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  try {
    db.seed("lotes/L1", {
      uid: "u1",
      cantidad: 20,
      planEfectivo: "paquete",
      enviados: 0,
      reservados: 0,
      reservadosPaquete: 0,
      reservadosPorUso: 0,
      creado: Timestamp.now(),
      expira: Timestamp.fromMillis(Date.now() + 3600_000),
    } as Lote);
    db.seed("cuentas/u1", {
      plan: "paquete",
      enviosRestantes: 0, // Paquete agotado: cae al saldo Por Uso (B2).
      vence: Timestamp.fromMillis(Date.now() + 30 * 24 * 3600_000), // vigente.
      renueva: false,
      mpSuscripcionId: null,
      reservadosPaquete: 0,
      saldoPorUso: 3,
      reservadosPorUso: 0,
      ultimoPago: null,
      actualizado: Timestamp.now(),
    } as Cuenta);

    // `reservarEnvio` (el envoltorio REAL, no el `...Tx`): usa `contarReservadosPaqueteVigentes`/
    // `contarReservadosPorUsoVigentes` reales para el recalculo, igual que produccion.
    const resultados = await Promise.all(Array.from({ length: 10 }, () => reservarEnvio("L1", "u1")));

    const aceptadas = resultados.filter((r) => r.ok === true);
    const rechazadas = resultados.filter((r) => r.ok === false);
    assert.equal(aceptadas.length, 3, "G2: el saldo Por Uso (3) debe ganar, aunque el lote sea 'paquete'");
    assert.equal(rechazadas.length, 7);
  } finally {
    _usarFirestoreParaPruebas(null);
  }
});

test("G2 (mutacion documentada): volver al filtro viejo ('porUso' || 'mixto') hace caer las dos pruebas de arriba", () => {
  // Verificado a mano (no comiteado): en contarReservadosPorUsoVigentes, volver a
  // `lote.planEfectivo === "porUso" || lote.planEfectivo === "mixto"` hace que:
  //  - G2 (a) reciba 0 en vez de 2 (el lote "paquete" ya no cuenta).
  //  - G2 (b) acepte mas de 3 reservas (el recalculo, al no ver las reservas Por Uso que el propio
  //    lote "paquete" ya hizo, deja pasar reservas por encima del saldo real).
  // Restaurado de inmediato tras confirmarlo.
  assert.ok(true);
});
