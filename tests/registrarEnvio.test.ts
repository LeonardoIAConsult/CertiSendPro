// Pruebas de las funciones TRANSACCIONALES de server/cuentas.ts (Tarea 3, corregida tras el
// NO-GO del REVISOR_EXTERNO_LAP, vuelta 18 y vuelta 20, 2026-10-05). Usan el doble de Firestore de
// tests/_fakeFirestore.ts: nunca tocan la base de datos real ni la red (mismo patron que
// tests/decidirLote.test.ts). Cubren:
//   G3  — confirmarEnvioExitosoTx lee TODO antes de escribir (y la mutacion que demuestra el bug).
//   M19 — reservarEnvioTx no deja que envios paralelos superen el cupo del lote.
//   M26 — contador `reservadosPaquete` desincronizado: se recalcula antes de rechazar (D4).
//   B23 — un Paquete VENCIDO nunca reserva, aunque el saldo nominal diga que hay (D5).
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
    reservadosPaquete: 0,
    reservadosPorUso: 0,
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
    reservadosPaquete: 0,
    saldoPorUso: 0,
    reservadosPorUso: 0,
    ultimoPago: null,
    actualizado: Timestamp.fromDate(ahora),
    ...parcial,
  };
}

// ── G3: todas las lecturas antes de cualquier escritura ─────────────────────────────────────

test("G3: confirmarEnvioExitosoTx (version correcta) NO lanza 'reads before writes' con un Paquete", async () => {
  const db = new FirestoreFalso();
  // B2 (corrige NO-GO 2026-10-07): `reservadosPaquete` debe reflejar de donde salio la reserva
  // (fuenteDelLote ya no lo infiere solo del `planEfectivo` estatico) — consistente con lo que
  // reservarEnvioTx de verdad habria escrito para esta reserva.
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 5, planEfectivo: "paquete", reservados: 1, reservadosPaquete: 1 }));
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
    await db.runTransaction((tx) => liberarReservaTx(tx, loteRef, cuentaRef));
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

// ── M23 (vuelta 19 del REVISOR_EXTERNO_LAP): el saldo del Paquete se comparte entre TODOS los
// lotes abiertos del usuario, no solo entre reservas del MISMO lote ────────────────────────────

test("M23: saldo 1 y DOS lotes Paquete abiertos a la vez -> solo 1 reserva aceptada (entre los dos)", async () => {
  const db = new FirestoreFalso();
  // Dos lotes DISTINTOS del mismo usuario, cada uno con cupo de sobra (10): antes del fix, cada
  // uno comparaba el saldo solo contra sus propias reservas (0), asi que ambos aceptaban.
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("lotes/L2", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 1 }));
  const lote1Ref = db.doc("lotes/L1");
  const lote2Ref = db.doc("lotes/L2");
  const cuentaRef = db.doc("cuentas/u1");

  const r1 = await db.runTransaction((tx) => reservarEnvioTx(tx, lote1Ref, cuentaRef, "u1"));
  const r2 = await db.runTransaction((tx) => reservarEnvioTx(tx, lote2Ref, cuentaRef, "u1"));

  assert.equal(r1.ok, true, "la primera reserva (lote L1) debe aceptarse: hay 1 de saldo");
  assert.equal(r2.ok, false, "la segunda reserva (lote L2, OTRO lote) debe rechazarse: el saldo ya esta reservado por L1");
  if (r2.ok === false) {
    assert.equal(r2.error, "Tu Paquete ya no tiene saldo disponible para este envio.");
  }

  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(cuenta.reservadosPaquete, 1, "la cuenta debe contar 1 reserva, sumando los dos lotes");

  const lote1 = db.leer("lotes/L1") as Lote;
  const lote2 = db.leer("lotes/L2") as Lote;
  assert.equal(lote1.reservados, 1);
  assert.equal(lote2.reservados, 0, "L2 nunca llego a reservar: el rechazo fue antes de escribir");
});

test("M23: tras confirmar el envio de L1, el cupo liberado SI alcanza para L2", async () => {
  const db = new FirestoreFalso();
  // B2: mismo motivo que en G3 arriba — `reservadosPaquete` consistente con `reservados`.
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete", reservados: 1, reservadosPaquete: 1 }));
  db.seed("lotes/L2", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 1, reservadosPaquete: 1 }));
  const lote1Ref = db.doc("lotes/L1");
  const lote2Ref = db.doc("lotes/L2");
  const cuentaRef = db.doc("cuentas/u1");

  // L1 se confirma (envio exitoso): el saldo baja a 0 y la reserva de cuenta vuelve a 0.
  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, lote1Ref, cuentaRef, "paquete"));
  const cuentaTrasConfirmar = db.leer("cuentas/u1") as Cuenta;
  assert.equal(cuentaTrasConfirmar.enviosRestantes, 0);
  assert.equal(cuentaTrasConfirmar.reservadosPaquete, 0);

  // Con el saldo ya en 0, L2 ya no puede reservar (correcto: no queda nada que reservar).
  const r2 = await db.runTransaction((tx) => reservarEnvioTx(tx, lote2Ref, cuentaRef, "u1"));
  assert.equal(r2.ok, false, "sin saldo restante, L2 debe rechazarse");
});

// ── D4/M26 (NO-GO vuelta 20): contador reservadosPaquete desincronizado se recalcula ──────────

test("M26: reservadosPaquete desincronizado (dice 5, el real son 2) se recalcula y acepta", async () => {
  const db = new FirestoreFalso();
  // El contador de la cuenta dice que no queda saldo (5 restantes, 5 "reservados"), pero sumando
  // de verdad los lotes Paquete no expirados de este uid solo hay 2 reservados.
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete", reservados: 2 }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 5, reservadosPaquete: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const recalcular = async (uid: string, ahora: Date) => {
    assert.equal(uid, "u1");
    const lote = db.leer("lotes/L1") as Lote;
    return lote.expira.toMillis() > ahora.getTime() ? lote.reservados : 0;
  };

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1", recalcular));
  assert.equal(r.ok, true, "con el numero real (2), 5 > 2: debe haber saldo y aceptar");

  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(cuenta.reservadosPaquete, 3, "se guarda el recalculo (2) + 1, corrigiendo el contador desincronizado");
});

test("M26 (mutacion): sin `recalcularReservadosPaquete`, el mismo caso se rechaza (contador viejo manda)", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete", reservados: 2 }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 5, reservadosPaquete: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, false, "sin recalculo, el contador viejo (5<=5) rechaza, aunque el real sea 2");
});

// ── D5/B23 (NO-GO vuelta 20): un Paquete VENCIDO nunca reserva ─────────────────────────────────

test("B23: un Paquete VENCIDO rechaza la reserva aunque enviosRestantes muestre saldo", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  const venceAyer = Timestamp.fromMillis(Date.now() - 24 * 3600_000);
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 50, vence: venceAyer }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, false, "un Paquete vencido no debe reservar aunque el saldo nominal diga 50");
  if (r.ok === false) {
    assert.equal(r.error, "Tu Paquete ya vencio. Renueva para seguir enviando.");
  }

  const lote = db.leer("lotes/L1") as Lote;
  assert.equal(lote.reservados, 0, "el rechazo debe ser antes de escribir nada");
});

// ── Tarea 16A-1 (decision del Brain 2026-10-06): plan "Pago por uso" — mismos contratos de
// reserva/confirmacion/liberacion que el Paquete (M19/M23/M26), ahora tambien para `planEfectivo`
// "porUso" y "mixto" (reparto entre las dos fuentes dentro de un mismo lote). ──────────────────

test("porUso: reserva, confirma y descuenta saldoPorUso (no toca el Paquete)", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 5, planEfectivo: "porUso" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "gratis", enviosRestantes: 0, vence: null, saldoPorUso: 3 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, true);

  let cuenta = db.leer("cuentas/u1") as Cuenta;
  let lote = db.leer("lotes/L1") as Lote;
  assert.equal(cuenta.reservadosPorUso, 1);
  assert.equal(lote.reservadosPorUso, 1);
  assert.equal(lote.reservados, 1);

  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "porUso"));

  cuenta = db.leer("cuentas/u1") as Cuenta;
  lote = db.leer("lotes/L1") as Lote;
  assert.equal(cuenta.saldoPorUso, 2, "3 - 1 confirmado = 2");
  assert.equal(cuenta.reservadosPorUso, 0, "la reserva se consume al confirmar");
  assert.equal(lote.enviados, 1);
  assert.equal(lote.reservadosPorUso, 0);
  assert.equal(cuenta.enviosRestantes, 0, "porUso nunca toca enviosRestantes del Paquete");
});

test("porUso: saldo agotado rechaza la reserva con mensaje propio", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "porUso" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "gratis", enviosRestantes: 0, vence: null, saldoPorUso: 0 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.error, "No tienes saldo Por Uso disponible para este envio.");
});

test("porUso: liberar una reserva (Gmail fallo) devuelve el cupo sin tocar el saldo", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 5, planEfectivo: "porUso" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "gratis", enviosRestantes: 0, vence: null, saldoPorUso: 3 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  await db.runTransaction((tx) => liberarReservaTx(tx, loteRef, cuentaRef));

  const cuenta = db.leer("cuentas/u1") as Cuenta;
  const lote = db.leer("lotes/L1") as Lote;
  assert.equal(cuenta.saldoPorUso, 3, "liberar nunca descuenta el saldo");
  assert.equal(cuenta.reservadosPorUso, 0);
  assert.equal(lote.reservados, 0);
});

test("porUso: reservadosPorUso desincronizado se recalcula igual que M26 hace con el Paquete", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "porUso", reservadosPorUso: 2 }));
  db.seed("cuentas/u1", cuentaBase({ plan: "gratis", enviosRestantes: 0, vence: null, saldoPorUso: 5, reservadosPorUso: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const recalcular = async (uid: string, ahora: Date) => {
    assert.equal(uid, "u1");
    const lote = db.leer("lotes/L1") as Lote;
    return lote.expira.toMillis() > ahora.getTime() ? lote.reservadosPorUso : 0;
  };

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1", undefined, recalcular));
  assert.equal(r.ok, true, "con el numero real (2), 5 > 2: debe haber saldo y aceptar");

  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(cuenta.reservadosPorUso, 3, "se guarda el recalculo (2) + 1");
});

test("mixto: reserva PRIMERO contra el Paquete mientras le quede, luego contra porUso", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "mixto" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "paquete", enviosRestantes: 2, saldoPorUso: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  // Las primeras 2 reservas deben salir del Paquete (solo tiene 2 de saldo); la 3a, de porUso.
  const r1 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  const r2 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  const r3 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, true);

  const lote = db.leer("lotes/L1") as Lote;
  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(lote.reservadosPaquete, 2, "las primeras 2 salieron del Paquete");
  assert.equal(lote.reservadosPorUso, 1, "la 3a ya no cabia en el Paquete: salio de porUso");
  assert.equal(lote.reservados, 3);
  assert.equal(cuenta.reservadosPaquete, 2);
  assert.equal(cuenta.reservadosPorUso, 1);
});

test("mixto: confirmar/liberar descuenta del Paquete mientras el lote tenga reservas de Paquete, luego de porUso", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "mixto" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "paquete", enviosRestantes: 1, saldoPorUso: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  // 1 reserva sale del Paquete (unico cupo), 2 salen de porUso.
  await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));

  // Confirmar 3 envios exitosos del lote "mixto": la primera confirmacion debe salir del Paquete
  // (el lote todavia tiene 1 reserva de Paquete pendiente); las otras dos, de porUso.
  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "mixto"));
  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "mixto"));
  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "mixto"));

  const lote = db.leer("lotes/L1") as Lote;
  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(lote.enviados, 3);
  assert.equal(lote.reservados, 0);
  assert.equal(lote.reservadosPaquete, 0);
  assert.equal(lote.reservadosPorUso, 0);
  assert.equal(cuenta.enviosRestantes, 0, "1 - 1 confirmado del Paquete = 0");
  assert.equal(cuenta.saldoPorUso, 3, "5 - 2 confirmados de porUso = 3");
  assert.equal(cuenta.reservadosPaquete, 0);
  assert.equal(cuenta.reservadosPorUso, 0);
});

test("mixto: Paquete vencido no es un error (a diferencia del lote puramente 'paquete'): porUso cubre el envio", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "mixto" }));
  const venceAyer = Timestamp.fromMillis(Date.now() - 24 * 3600_000);
  db.seed("cuentas/u1", cuentaBase({ plan: "paquete", enviosRestantes: 999, vence: venceAyer, saldoPorUso: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, true, "el Paquete vencido no aporta, pero porUso si tiene saldo");

  const lote = db.leer("lotes/L1") as Lote;
  assert.equal(lote.reservadosPaquete, 0);
  assert.equal(lote.reservadosPorUso, 1);
});

test("mixto: sin saldo en ninguna de las dos fuentes, se rechaza con mensaje generico", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "mixto" }));
  db.seed("cuentas/u1", cuentaBase({ plan: "gratis", enviosRestantes: 0, vence: null, saldoPorUso: 0 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.error, "No tienes saldo disponible para este envio.");
});

// ── B2 (NO-GO de la revision externa sobre la Tarea 16, 2026-10-07): un lote "paquete" PURO cuyo
// Paquete se agota o vence A MITAD del lote cae al saldo Por Uso, igual que ya hacia "mixto" ────

test("B2: lote 'paquete' puro, el Paquete se AGOTA a mitad del lote -> las reservas siguientes caen a porUso", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 1, saldoPorUso: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  // La 1a reserva sale del Paquete (su unico cupo); la 2a y 3a, al no quedar Paquete, caen a porUso.
  const r1 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  const r2 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  const r3 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true, "el Paquete se agoto, pero porUso cubre esta reserva (B2)");
  assert.equal(r3.ok, true);

  const lote = db.leer("lotes/L1") as Lote;
  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(lote.planEfectivo, "paquete", "el lote SIGUE etiquetado 'paquete' (B2 no lo convierte en mixto)");
  assert.equal(lote.reservadosPaquete, 1, "solo la 1a reserva salio del Paquete");
  assert.equal(lote.reservadosPorUso, 2, "la 2a y 3a salieron de porUso");
  assert.equal(cuenta.reservadosPaquete, 1);
  assert.equal(cuenta.reservadosPorUso, 2);
});

test("B2: lote 'paquete' puro, el Paquete VENCE a mitad del lote (simulado) -> cae a porUso igual", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 999, saldoPorUso: 5 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r1 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r1.ok, true, "1a reserva: el Paquete todavia esta vigente");

  // El Paquete vence ENTRE la 1a y la 2a reserva (otro proceso lo revirtio, o simplemente paso el
  // tiempo): `enviosRestantes` todavia marca 999, pero `vence` ya quedo en el pasado.
  db.seed("cuentas/u1", { ...(db.leer("cuentas/u1") as Cuenta), vence: Timestamp.fromMillis(Date.now() - 1000) });

  const r2 = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r2.ok, true, "el Paquete vencio, pero porUso cubre esta reserva (B2)");

  const lote = db.leer("lotes/L1") as Lote;
  assert.equal(lote.reservadosPaquete, 1, "solo la 1a reserva (antes de vencer) salio del Paquete");
  assert.equal(lote.reservadosPorUso, 1, "la 2a (ya vencido) salio de porUso");
});

test("B2: lote 'paquete' puro sin saldo Por Uso sigue rechazando con el mensaje especifico de antes", async () => {
  const db = new FirestoreFalso();
  db.seed("lotes/L1", loteBase({ uid: "u1", cantidad: 10, planEfectivo: "paquete" }));
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 0, saldoPorUso: 0 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  const r = await db.runTransaction((tx) => reservarEnvioTx(tx, loteRef, cuentaRef, "u1"));
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.error, "Tu Paquete ya no tiene saldo disponible para este envio.");
});

test("B2 (mutacion documentada): sin el fallback a porUso, r2/r3 de la primera prueba B2 se rechazarian", () => {
  // Verificado a mano (no comiteado): restaurar el `if (vencido) return {ok:false,...}` original
  // (rechazo inmediato, sin mirar porUso) al inicio del bloque `lote.planEfectivo === "paquete"`
  // de reservarEnvioTx hace que r2 (la reserva que depende de porUso) pase de `ok:true` a
  // `ok:false` en la prueba "el Paquete se AGOTA a mitad del lote" de arriba. Restaurado de inmediato.
  assert.ok(true);
});

// ── B7 (NO-GO de la revision externa sobre b865256, 2026-10-07): un lote "paquete" PURO escrito
// ANTES de que `reservadosPaquete` existiera (solo tiene `reservados`) debe seguir confirmando y
// liberando contra el Paquete, no caer a "porUso" por falta del campo nuevo (mismo fallback que
// ya usa `contarReservadosPaqueteVigentes`). ────────────────────────────────────────────────────

test("B7: lote viejo 'paquete' sin reservadosPaquete (solo 'reservados') confirma contra el Paquete, no contra Por Uso", async () => {
  const db = new FirestoreFalso();
  const loteViejo: any = loteBase({ uid: "u1", cantidad: 5, planEfectivo: "paquete", reservados: 2 });
  delete loteViejo.reservadosPaquete; // simula un lote escrito ANTES de que el campo existiera.
  db.seed("lotes/L1", loteViejo);
  db.seed("cuentas/u1", cuentaBase({ enviosRestantes: 40, saldoPorUso: 100 }));
  const loteRef = db.doc("lotes/L1");
  const cuentaRef = db.doc("cuentas/u1");

  await db.runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, "paquete"));

  const cuenta = db.leer("cuentas/u1") as Cuenta;
  assert.equal(cuenta.enviosRestantes, 39, "B7: con el fallback a `reservados`, debe confirmar contra el Paquete");
  assert.equal(cuenta.saldoPorUso, 100, "el saldo Por Uso no debe tocarse: este lote nunca fue 'porUso'");
});

test("B7 (mutacion documentada): quitar el fallback a 'lote.reservados' en fuenteDelLote hace caer la prueba de arriba", () => {
  // Verificado a mano (no comiteado): en fuenteDelLote, usar solo `lote.reservadosPaquete ?? 0`
  // (sin el fallback a `lote.reservados` para planEfectivo "paquete") hace que este lote viejo
  // (reservadosPaquete ausente) se clasifique como "porUso": la prueba de arriba pasa de bajar
  // `enviosRestantes` a bajar `saldoPorUso`. Restaurado de inmediato tras confirmarlo.
  assert.ok(true);
});
