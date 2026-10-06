// Pruebas de la autorizacion de tratamiento de datos personales (Ley 1581, Tarea 15 requisito
// B.3; GRAVE 1, correccion vuelta 31, 2026-10-06).
//
// GRAVE 1 (NO-GO del REVISOR_EXTERNO_LAP, vuelta 31): la activacion (`activarPaqueteSiNoProcesado`)
// y la reversion (`revertirPagoSiNoRevertido`) de un Paquete hacen `tx.set(cuentaRef, {...})` SIN
// merge — eso REEMPLAZA el documento completo de `cuentas/{uid}`. Cuando la autorizacion vivia
// como un campo de ESE mismo documento (`cuentas/{uid}.autorizacionDatos`), cualquier activacion o
// reversion posterior la borraba sin querer. El arreglo mueve la autorizacion a su PROPIA
// coleccion (`autorizaciones/{uid}`), completamente desacoplada: estas pruebas usan el MISMO
// doble de Firestore (tests/_fakeFirestore.ts) para `cuentas/pagosProcesados` Y `autorizaciones`
// (misma instancia, mismo patron que tests/reembolso.test.ts/tests/webhook.test.ts) para probar,
// de punta a punta, que activar y revertir un Paquete NUNCA borra la autorizacion ya guardada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  guardarAutorizacionDatos,
  obtenerAutorizacionDatos,
  activarPaqueteSiNoProcesadoTx,
  revertirPagoSiNoRevertidoTx,
  decidirAutorizacionLote,
  decidirRegistroAutorizacion,
  _usarFirestoreParaPruebas,
  type Cuenta,
  type AutorizacionDatos,
  type AutorizacionGuardada,
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

test("guardarAutorizacionDatos/obtenerAutorizacionDatos: guarda version/idioma/texto y los devuelve tal cual", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAutorizacionDatos("uid-1", "2.3", "es", "Autorizo a X a tratar mis datos.");
  const autorizacion = await obtenerAutorizacionDatos("uid-1");

  assert.ok(autorizacion);
  assert.equal(autorizacion!.version, "2.3");
  assert.equal(autorizacion!.idioma, "es");
  assert.equal(autorizacion!.texto, "Autorizo a X a tratar mis datos.");
});

test("obtenerAutorizacionDatos: uid sin autorizacion -> null", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  assert.equal(await obtenerAutorizacionDatos("uid-sin-autorizar"), null);
});

test("guardarAutorizacionDatos: una SEGUNDA autorizacion (version nueva de la Politica) archiva la anterior en historial", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAutorizacionDatos("uid-1", "2.3", "es", "Texto v2.3");
  await guardarAutorizacionDatos("uid-1", "2.4", "en", "Texto v2.4");

  const vigente = await obtenerAutorizacionDatos("uid-1");
  assert.equal(vigente!.version, "2.4");
  assert.equal(vigente!.idioma, "en");

  const guardado = db.leer("autorizaciones/uid-1") as AutorizacionGuardada;
  assert.equal(guardado.historial.length, 1);
  assert.equal(guardado.historial[0].version, "2.3");
  assert.equal(guardado.historial[0].texto, "Texto v2.3");
});

// ── GRAVE 1: activar y revertir un Paquete con autorizacion presente -> la autorizacion sigue ───

test("GRAVE 1: activar un Paquete NO borra una autorizacion de datos ya guardada", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAutorizacionDatos("uid-1", "2.3", "es", "Autorizo a X.");
  await activar(db, "uid-1", "pago-1");

  const autorizacion = await obtenerAutorizacionDatos("uid-1");
  assert.ok(autorizacion, "la autorizacion debe SEGUIR existiendo tras activar el Paquete (tx.set de la cuenta)");
  assert.equal(autorizacion!.version, "2.3");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete"); // confirma que la activacion si corrio de verdad.
});

test("GRAVE 1: revertir (reembolso/contracargo) un Paquete tampoco borra la autorizacion de datos", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  await guardarAutorizacionDatos("uid-1", "2.3", "es", "Autorizo a X.");
  await activar(db, "uid-1", "pago-1");
  const resultado = await revertir(db, "uid-1", "pago-1");
  assert.equal(resultado, "revertido");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "gratis"); // confirma que la reversion si corrio de verdad.

  const autorizacion = await obtenerAutorizacionDatos("uid-1");
  assert.ok(autorizacion, "la autorizacion debe SEGUIR existiendo tras revertir el Paquete (tx.set de la cuenta)");
  assert.equal(autorizacion!.version, "2.3");
});

// ── Mutacion del oraculo: volver a guardar la autorizacion DENTRO de cuentas/{uid} (como antes de
// GRAVE 1) hace que activar/revertir SI la borre — confirma que la correccion depende de verdad
// de la coleccion separada, no de una casualidad del doble de Firestore.

test("GRAVE 1 (mutacion de control): si la autorizacion viviera en cuentas/{uid}, activar SI la borraria", async () => {
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
    autorizacionDatos: { version: "2.3", fecha: Timestamp.now() }, // patron VIEJO, antes de GRAVE 1.
  });

  await activar(db, "uid-1", "pago-1");

  const cuenta = db.leer("cuentas/uid-1") as any;
  assert.equal(cuenta.plan, "paquete");
  assert.equal(cuenta.autorizacionDatos, undefined, "tx.set sin merge SI borra un campo ajeno del documento — por eso GRAVE 1 lo saca de aqui");
});

// ── decidirAutorizacionLote (correccion vuelta 33, 2026-10-06): decision de /api/lote/iniciar
// sobre la autorizacion de datos, extraida como funcion PURA. ──────────────────────────────────

function autorizacion(version: string): AutorizacionDatos {
  return { version, fecha: Timestamp.now(), idioma: "es", texto: "Autorizo." };
}

test("decidirAutorizacionLote: sin autorizacion (null) -> 403 con motivo 'autorizacion'", () => {
  const r = decidirAutorizacionLote(null, "2.3");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 403);
  assert.equal((r as any).motivo, "autorizacion");
});

test("decidirAutorizacionLote: version guardada DISTINTA de la vigente -> 403 (se volvio a pedir)", () => {
  const r = decidirAutorizacionLote(autorizacion("2.2"), "2.3");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 403);
});

test("decidirAutorizacionLote: version guardada IGUAL a la vigente -> ok", () => {
  assert.deepEqual(decidirAutorizacionLote(autorizacion("2.3"), "2.3"), { ok: true });
});

// ── decidirRegistroAutorizacion (Medio 2, correccion vuelta 33, 2026-10-06): decision de
// POST /api/autorizacion-datos sobre PROVEEDOR_NOMBRE. ──────────────────────────────────────────

test("decidirRegistroAutorizacion: PROVEEDOR_NOMBRE vacio -> 503, nunca se registra", () => {
  const r = decidirRegistroAutorizacion("Ana S.A.S.", "");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 503);
});

test("decidirRegistroAutorizacion: PROVEEDOR_NOMBRE todavia es el marcador '[PENDIENTE]' -> 503", () => {
  const r = decidirRegistroAutorizacion("[PENDIENTE]", "[PENDIENTE]");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 503);
});

test("decidirRegistroAutorizacion: el cliente no manda nombreProveedorMostrado -> 409 (no coincide con nada)", () => {
  const r = decidirRegistroAutorizacion(undefined, "Leonardo Antolinez");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 409);
});

test("decidirRegistroAutorizacion: el nombre mostrado por el cliente NO coincide con PROVEEDOR_NOMBRE -> 409", () => {
  const r = decidirRegistroAutorizacion("Otro Nombre", "Leonardo Antolinez");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 409);
});

test("decidirRegistroAutorizacion: el nombre mostrado coincide EXACTO -> ok", () => {
  assert.deepEqual(decidirRegistroAutorizacion("Leonardo Antolinez", "Leonardo Antolinez"), { ok: true });
});

test("decidirRegistroAutorizacion: espacios de mas alrededor del nombre no rompen la coincidencia", () => {
  assert.deepEqual(decidirRegistroAutorizacion("  Leonardo Antolinez  ", "Leonardo Antolinez"), { ok: true });
});
