// Pruebas de las funciones TRANSACCIONALES de server/cuentas.ts (Tarea 3, corregida tras el
// NO-GO del REVISOR_EXTERNO_LAP, vuelta 18, 2026-10-05). Usan el doble de Firestore de
// tests/_fakeFirestore.ts: nunca tocan la base de datos real ni la red (mismo patron que
// tests/decidirLote.test.ts). Cubren:
//   G3  — confirmarEnvioExitosoTx lee TODO antes de escribir (y la mutacion que demuestra el bug).
//   M19 — reservarEnvioTx no deja que envios paralelos superen el cupo del lote.
//   "10 exitos + 2 fallos ⇒ el saldo baja exactamente 10" sobre cuentas.ts con el doble.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  reservarEnvioTx,
  confirmarEnvioExitosoTx,
  liberarReservaTx,
  type Lote,
  type Cuenta,
} from "../server/cuentas";
import { FirestoreFalso, MENSAJE_LECTURAS_DESPUES_DE_ESCRITURAS } from "./_fakeFirestore";

// reservarEnvioTx comprueba la expiracion del lote contra el reloj REAL (Date.now()), no contra
// una fecha de referencia como decidirLote: es la misma red de seguridad de produccion (M19,
// "las reservas viejas no bloquean para siempre porque el lote expira a las 2 h"). Por eso estos
// fixtures se calculan desde Date.now() y no desde una fecha fija.
const ahora = new Date();
const expiraFuturo = Timestamp.fromMillis(ahora.getTime() + 2 * 3600_000);
const venceFuturo = Timestamp.fromMillis(ahora.getTime() + 30 * 24 * 3600_000);

function loteBase(parcial: Partial<Lote>): Lote {
  return {
    uid: "uid-1",
    cantidad: 10,
    planEfectivo: "gratis",
    enviados: 0,
    reservados: 0,
    creado: Timestamp.fromDate(ahora),
    expira: expiraFuturo,
    ...parcial,
  };
}

function cuentaBase(parcial: Partial<Cuenta>): Cuenta {
  return {
    plan: "paquete",
    enviosRestantes: 0,
    vence: venceFuturo,
    renueva: false,
    mpSuscripcionId: null,
    actualizado: Timestamp.fromDate(ahora),
    ...parcial,
  };
}

// ── G3: todas las lecturas antes de cualquier escritura ─────────────────────────────────────

test("G3: confirmarEnvioExitosoTx (version correcta) NO lanza 'reads before writes' con un Paquete", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 5, planEfectivo: "paquete", reservados: 1 }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 40 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  // Si esta prueba lanzara, fallaria aqui (no hay try/catch): confirma que, con el orden
  // correcto (leer lote + leer cuenta, LUEGO escribir), el doble nunca reproduce el error de G3.
  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "paquete"));

  const lote = db.leer("lotes/L1") as Lote;
  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(lote.enviados, 1);
  assert.equal(lote.reservados, 0);
  assert.equal(cuenta.enviosRestantes, 39);
});

test("G3 (mutacion): invertir el orden (escribir el lote y DESPUES leer la cuenta) reproduce el error real de Firestore", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 5, planEfectivo: "paquete", reservados: 1 }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 40 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  // Reproduccion LOCAL del bug G3 original (tx.update(lote) y LUEGO tx.get(cuenta)), sin tocar
  // el codigo de produccion: demuestra que el doble SI detecta la violacion cuando ocurre,
  // confirmando que la prueba de arriba es real y no pasa "por casualidad".
  async function confirmarEnvioExitosoTxConBug(tx: any, loteRef: any, cuentaRef: any) {
    const loteSnap = await tx.get(loteRef);
    const lote = loteSnap.data() as Lote;
    tx.update(loteRef, { enviados: lote.enviados + 1, reservados: Math.max(0, lote.reservados - 1) });
    await tx.get(cuentaRef); // <- lectura DESPUES de una escritura: esto es exactamente G3.
  }

  await assert.rejects(
    () => db.runTransaction((tx) => confirmarEnvioExitosoTxConBug(tx, loteRef, cuentaRef)),
    (err: any) => {
      assert.equal(err.message, MENSAJE_LECTURAS_DESPUES_DE_ESCRITURAS);
      return true;
    }
  );
});

// ── "10 exitos + 2 fallos ⇒ el saldo baja exactamente 10" ───────────────────────────────────

test("10 exitos + 2 fallos: el saldo del Paquete baja exactamente 10 (ni mas, ni menos)", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 20, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 50 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  // 12 reservas (como si /api/send-email las pidiera una por una antes de llamar a Gmail).
  for (let i = 0; i < 12; i++) {
    const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
    assert.equal(r.ok, true, `la reserva #${i} deberia haber sido aceptada`);
  }

  // 10 de esas reservas terminan en un envio EXITOSO de Gmail -> se confirman.
  for (let i = 0; i < 10; i++) {
    await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "paquete"));
  }
  // Las otras 2 fallan en Gmail (nunca se enviaron de verdad) -> se liberan, no se descuenta nada.
  for (let i = 0; i < 2; i++) {
    await db.runTransaction((tx) => liberarReservaTx(tx, loteRef));
  }

  const lote = db.leer("lotes/L1") as Lote;
  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(lote.enviados, 10, "enviados debe reflejar solo los 10 exitosos");
  assert.equal(lote.reservados, 0, "no deben quedar reservas colgadas");
  assert.equal(cuenta.enviosRestantes, 40, "50 - 10 exitosos = 40 (los 2 fallos no descuentan)");
});

// ── M19: envios paralelos no superan el cupo del lote ────────────────────────────────────────

test("M19 (concurrencia): lote de cupo 3 con 5 reservas en paralelo -> solo 3 aceptadas", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 3, planEfectivo: "gratis" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "gratis", enviosRestantes: 0, vence: null }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1")))
  );

  const aceptadas = resultados.filter((r) => r.ok === true);
  const rechazadas = resultados.filter((r) => r.ok === false);
  assert.equal(aceptadas.length, 3, "deben aceptarse exactamente 3 (el cupo del lote)");
  assert.equal(rechazadas.length, 2);
  for (const r of rechazadas as any[]) {
    assert.equal(r.error, "Este lote de envio ya alcanzo su cupo autorizado.");
  }

  const lote = db.leer("lotes/L1") as Lote;
  assert.equal(lote.reservados, 3, "las reservas aceptadas deben quedar registradas en el lote");
});

test("M19 (concurrencia + saldo): Paquete con saldo 3, 5 reservas en paralelo -> solo 3 aceptadas", async () => {
  const db = new FirestoreFalso();
  // Cupo del lote (10) mayor que el saldo real (3): el limite que debe ganar es el saldo.
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 3 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1")))
  );

  const aceptadas = resultados.filter((r) => r.ok === true);
  assert.equal(aceptadas.length, 3, "no se debe reservar mas de lo que el saldo del Paquete alcanza");
});
