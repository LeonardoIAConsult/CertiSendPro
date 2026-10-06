// Pruebas de la aceptacion de Terminos y Condiciones ANTES del primer uso (O2, Dictamen
// Abogado_LAP ronda 5, 2026-10-06, Alto). Mismo patron EXACTO que tests/autorizacionCliente.test.ts
// para `autorizaciones/{uid}`: coleccion PROPIA (`aceptacionesUso/{uid}`), deny-all en
// firestore.rules, desacoplada de `cuentas/{uid}` para que un `tx.set` sin merge de la
// activacion/reversion de un Paquete nunca la borre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  guardarAceptacionUso,
  obtenerAceptacionUso,
  decidirAceptacionUso,
  activarPaqueteSiNoProcesadoTx,
  revertirPagoSiNoRevertidoTx,
  _usarFirestoreParaPruebas,
  type Cuenta,
  type AceptacionUso,
  type AceptacionUsoGuardada,
} from "../server/cuentas";
import { FirestoreFalso } from "./_fakeFirestore";

function activar(db: FirestoreFalso, uid: string, paymentId: string) {
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const cuentaRef = db.doc(`cuentas/${uid}`);
  return db.runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(tx, pagoRef, cuentaRef, {
      paymentId,
      cop: 49102,
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

test("guardarAceptacionUso/obtenerAceptacionUso: guarda version/idioma/texto y los devuelve tal cual", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAceptacionUso("uid-1", "1.3", "es", "Acepto los Términos y Condiciones.");
  const aceptacion = await obtenerAceptacionUso("uid-1");

  assert.ok(aceptacion);
  assert.equal(aceptacion!.version, "1.3");
  assert.equal(aceptacion!.idioma, "es");
  assert.equal(aceptacion!.texto, "Acepto los Términos y Condiciones.");
});

test("obtenerAceptacionUso: uid sin aceptacion -> null", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  assert.equal(await obtenerAceptacionUso("uid-sin-aceptar"), null);
});

test("guardarAceptacionUso: una SEGUNDA aceptacion (version nueva de los Terminos) archiva la anterior en historial", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAceptacionUso("uid-1", "1.3", "es", "Texto v1.3");
  await guardarAceptacionUso("uid-1", "1.4", "en", "Texto v1.4");

  const vigente = await obtenerAceptacionUso("uid-1");
  assert.equal(vigente!.version, "1.4");
  assert.equal(vigente!.idioma, "en");

  const guardado = db.leer("aceptacionesUso/uid-1") as AceptacionUsoGuardada;
  assert.equal(guardado.historial.length, 1);
  assert.equal(guardado.historial[0].version, "1.3");
  assert.equal(guardado.historial[0].texto, "Texto v1.3");
});

// ── Coleccion separada: activar y revertir un Paquete con aceptacion presente -> la aceptacion sigue ──

test("activar un Paquete NO borra una aceptacion de Terminos ya guardada", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAceptacionUso("uid-1", "1.3", "es", "Acepto.");
  await activar(db, "uid-1", "pago-1");

  const aceptacion = await obtenerAceptacionUso("uid-1");
  assert.ok(aceptacion, "la aceptacion debe SEGUIR existiendo tras activar el Paquete (tx.set de la cuenta)");
  assert.equal(aceptacion!.version, "1.3");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete"); // confirma que la activacion si corrio de verdad.
});

test("revertir (reembolso/contracargo) un Paquete tampoco borra la aceptacion de Terminos", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAceptacionUso("uid-1", "1.3", "es", "Acepto.");
  await activar(db, "uid-1", "pago-1");
  const resultado = await revertir(db, "uid-1", "pago-1");
  assert.equal(resultado, "revertido");

  const aceptacion = await obtenerAceptacionUso("uid-1");
  assert.ok(aceptacion, "la aceptacion debe SEGUIR existiendo tras revertir el Paquete");
  assert.equal(aceptacion!.version, "1.3");
});

// ── decidirAceptacionUso (O2): decision PURA de /api/lote/iniciar y /api/mercadopago/create-preference ──

function aceptacion(version: string): AceptacionUso {
  return { version, fecha: Timestamp.now(), idioma: "es", texto: "Acepto." };
}

test("decidirAceptacionUso: sin aceptacion (null) -> 403 con motivo 'terminos'", () => {
  const r = decidirAceptacionUso(null, "1.3");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 403);
  assert.equal((r as any).motivo, "terminos");
});

test("decidirAceptacionUso: version guardada DISTINTA de la vigente -> 403 (se volvio a pedir)", () => {
  const r = decidirAceptacionUso(aceptacion("1.2"), "1.3");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 403);
});

test("decidirAceptacionUso: version guardada IGUAL a la vigente -> ok", () => {
  assert.deepEqual(decidirAceptacionUso(aceptacion("1.3"), "1.3"), { ok: true });
});

// ── Mutacion del oraculo: si esta aceptacion viviera DENTRO de cuentas/{uid} (como el bug viejo de
// GRAVE 1 para autorizaciones), activar/revertir SI la borraria. Confirma que la separacion de
// coleccion es necesaria, no una casualidad del doble de Firestore.
test("mutacion de control: si la aceptacion viviera en cuentas/{uid}, activar SI la borraria", () => {
  const db = new FirestoreFalso();
  db.seed("cuentas/uid-1", {
    plan: "gratis",
    enviosRestantes: 0,
    vence: null,
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    ultimoPago: null,
    actualizado: Timestamp.now(),
    aceptacionUso: { version: "1.3", fecha: Timestamp.now() }, // patron VIEJO, nunca usado en este modulo.
  });

  return db.runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(tx, db.doc("pagosProcesados/pago-1"), db.doc("cuentas/uid-1"), {
      paymentId: "pago-1",
      cop: 49102,
      trm: 3273.49,
      fecha: Timestamp.fromDate(new Date("2026-10-05T15:00:00.000Z")),
    })
  ).then(() => {
    const cuenta = db.leer("cuentas/uid-1") as any;
    assert.equal(cuenta.plan, "paquete");
    assert.equal(cuenta.aceptacionUso, undefined, "tx.set sin merge SI borra un campo ajeno del documento — por eso esta aceptacion vive en su PROPIA coleccion");
  });
});
