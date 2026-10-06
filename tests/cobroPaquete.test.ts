// Pruebas de `crearCobroPaquete` (Tarea 14, registro de aceptacion de terminos, 2026-10-05).
// Inyectan Mercado Pago (fetch falso) y Firestore (FirestoreFalso de tests/_fakeFirestore.ts,
// mismo doble que usan webhook.test.ts y registrarEnvio.test.ts) para probar, sin red ni
// Firestore real:
//   - sin aceptaTerminos o sin aceptaRetracto -> 400 y NO se crea nada (ni preferencia, ni
//     aceptacion, ni llamada a Mercado Pago).
//   - con las dos casillas -> la aceptacion queda guardada y ENLAZADA a la preferencia (mismo
//     id) ANTES de llamar a Mercado Pago (orden verificado, no solo el resultado final).
//   - sin TRM disponible -> 503, tampoco se crea nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCobroPaquete, type RespuestaCrearPreferenciaMP } from "../server/cobroPaquete";
import { copDesdeUsd } from "../server/trm";
import { TERMINOS_VERSION, TEXTO_CASILLA_RETRACTO } from "../server/cuentas";
import { FirestoreFalso } from "./_fakeFirestore";

/** Arma las dependencias inyectadas de produccion (guardarPreferencia/guardarAceptacion) sobre
 * un FirestoreFalso, y un `orden` que registra en que secuencia se llamo cada una — asi la
 * prueba de "antes de MP" compara el ORDEN real de ejecucion, no solo el estado final. */
function construirDependencias(db: FirestoreFalso, orden: string[]) {
  return {
    guardarPreferencia: async (id: string, datos: any) => {
      orden.push("preferencia");
      db.seed(`preferencias/${id}`, datos);
    },
    guardarAceptacion: async (id: string, datos: any) => {
      orden.push("aceptacion");
      db.seed(`aceptaciones/${id}`, datos);
    },
    crearPreferenciaMP: async (): Promise<RespuestaCrearPreferenciaMP> => {
      orden.push("mp");
      return { ok: true, status: 200, json: async () => ({ init_point: "https://mp.test/init-point" }) };
    },
  };
}

// cop esperado con la TRM/usd por defecto de abajo (4123 * 15, redondeado) — `copMostrado` debe
// coincidir con esto en la mayoria de las pruebas (las que SI deben llegar a crear algo); las
// pruebas de M28 (precio cambiado) lo pisan a proposito con `overrides`.
const COP_POR_DEFECTO = copDesdeUsd(15, 4123);

function opcionesBase(overrides: Partial<Parameters<typeof crearCobroPaquete>[0]> = {}) {
  const db = new FirestoreFalso();
  const orden: string[] = [];
  const deps = construirDependencias(db, orden);
  return {
    db,
    orden,
    opts: {
      uid: "uid-1",
      email: "cliente@test.com",
      aceptaTerminos: true,
      aceptaRetracto: true,
      copMostrado: COP_POR_DEFECTO,
      idioma: "es",
      modalidad: "unico",
      // B.2 (Tarea 15, decision del Brain 2026-10-06): por defecto SIN Paquete vigente, para que
      // las pruebas existentes (que esperan 200/400/503/409 de precio) sigan llegando a esa
      // rama; las pruebas del 409 de recompra lo pisan con `overrides`.
      tienePaqueteVigente: async () => false,
      obtenerTrm: async () => ({ valor: 4123, fechaDesde: "2026-10-05" }),
      copDesdeUsd,
      usdPaquete: 15,
      generarId: () => "ref-1",
      log: () => {},
      ...deps,
      ...overrides,
    },
  };
}

// ── Sin casilla -> 400, nada se crea ────────────────────────────────────────────────────────

test("sin aceptaTerminos -> 400 y no se crea preferencia, aceptacion ni llamada a MP", async () => {
  const { db, orden, opts } = opcionesBase({ aceptaTerminos: false });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, [], "ninguna dependencia debe llamarse");
  assert.equal(db.leer("preferencias/ref-1"), undefined);
  assert.equal(db.leer("aceptaciones/ref-1"), undefined);
});

test("sin aceptaRetracto -> 400 y no se crea nada", async () => {
  const { db, orden, opts } = opcionesBase({ aceptaRetracto: false });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
  assert.equal(db.leer("preferencias/ref-1"), undefined);
  assert.equal(db.leer("aceptaciones/ref-1"), undefined);
});

test("aceptaTerminos/aceptaRetracto ausentes (undefined, no enviados) -> 400", async () => {
  const { orden, opts } = opcionesBase({ aceptaTerminos: undefined, aceptaRetracto: undefined });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

test('aceptaTerminos="true" (string, no booleano) -> 400: solo el booleano true exacto vale', async () => {
  const { orden, opts } = opcionesBase({ aceptaTerminos: "true" as any });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

// ── Con las dos casillas -> aceptacion guardada y ENLAZADA, ANTES de llamar a MP ────────────

test("con las dos casillas -> preferencia y aceptacion se guardan, enlazadas por el mismo id, ANTES de llamar a Mercado Pago", async () => {
  const { db, orden, opts } = opcionesBase();
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 200);
  assert.deepEqual(orden, ["preferencia", "aceptacion", "mp"], "orden exacto: preferencia, aceptacion, y SOLO despues Mercado Pago");

  const preferencia = db.leer("preferencias/ref-1");
  const aceptacion = db.leer("aceptaciones/ref-1") as any;
  assert.ok(preferencia, "debe existir preferencias/ref-1");
  assert.ok(aceptacion, "debe existir aceptaciones/ref-1");
  assert.equal(aceptacion.preferenciaId, "ref-1", "la aceptacion debe enlazar al mismo id de la preferencia");
  assert.equal(aceptacion.uid, "uid-1");
  assert.equal(aceptacion.versionTerminos, TERMINOS_VERSION);
  assert.equal(aceptacion.plan, "paquete");
  assert.equal(aceptacion.trm, 4123);
  assert.equal(aceptacion.cop, copDesdeUsd(15, 4123));
  assert.ok(aceptacion.textoCasilla.includes(String(aceptacion.cop)) || aceptacion.textoCasilla.includes((aceptacion.cop as number).toLocaleString("es-CO")), "el texto de la casilla debe citar el monto cobrado");
  assert.equal(aceptacion.textoRetracto, TEXTO_CASILLA_RETRACTO);

  assert.equal((resultado.body as any).initPoint, "https://mp.test/init-point");
  assert.equal((resultado.body as any).cop, copDesdeUsd(15, 4123));
});

// ── Sin TRM disponible -> 503, tampoco se crea nada ─────────────────────────────────────────

test("sin TRM disponible -> 503 y no se crea preferencia ni aceptacion (nunca se llega a Mercado Pago)", async () => {
  const { db, orden, opts } = opcionesBase({ obtenerTrm: async () => null });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 503);
  assert.deepEqual(orden, []);
  assert.equal(db.leer("preferencias/ref-1"), undefined);
  assert.equal(db.leer("aceptaciones/ref-1"), undefined);
});

// ── M28 (corrige vuelta 24): copMostrado no coincide -> 409 y NO se crea nada ──────────────────

test("copMostrado distinto del cop recalculado -> 409 con copNuevo, y NO se crea preferencia, aceptacion ni llamada a MP", async () => {
  const { db, orden, opts } = opcionesBase({ copMostrado: COP_POR_DEFECTO - 1 });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 409);
  assert.equal((resultado.body as any).copNuevo, COP_POR_DEFECTO);
  assert.deepEqual(orden, [], "ninguna dependencia debe llamarse con el precio desactualizado");
  assert.equal(db.leer("preferencias/ref-1"), undefined);
  assert.equal(db.leer("aceptaciones/ref-1"), undefined);
});

test("copMostrado ausente (undefined, no enviado) -> 409, nunca se asume que coincide", async () => {
  const { orden, opts } = opcionesBase({ copMostrado: undefined });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 409);
  assert.deepEqual(orden, []);
});

test("copMostrado como texto numerico igual al cop recalculado SI coincide (Number() lo convierte)", async () => {
  const { opts } = opcionesBase({ copMostrado: String(COP_POR_DEFECTO) as any });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 200);
});

// ── M28: idioma del checkout -> texto de la casilla guardado en ESE idioma, mas email y modalidad ──

test('idioma="en" -> textoCasilla y textoRetracto guardados en ingles, email y modalidad guardados', async () => {
  const { db, opts } = opcionesBase({ idioma: "en", email: "english@test.com" });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 200);
  const aceptacion = db.leer("aceptaciones/ref-1") as any;
  assert.equal(aceptacion.email, "english@test.com");
  assert.equal(aceptacion.modalidad, "unico");
  assert.equal(aceptacion.idioma, "en");
  assert.match(aceptacion.textoCasilla, /I have read and accept/);
  assert.match(aceptacion.textoRetracto, /I want the service to start immediately/);
  assert.doesNotMatch(aceptacion.textoCasilla, /He leído/);
});

test('idioma invalido/ausente -> se guarda como "es" (nunca se asume ingles por defecto)', async () => {
  const { db, opts } = opcionesBase({ idioma: "fr" as any });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 200);
  const aceptacion = db.leer("aceptaciones/ref-1") as any;
  assert.equal(aceptacion.idioma, "es");
  assert.match(aceptacion.textoCasilla, /He leído y acepto/);
});

test("email ausente en el token (null) -> se guarda null, nunca se inventa uno", async () => {
  const { db, opts } = opcionesBase({ email: null });
  await crearCobroPaquete(opts);
  const aceptacion = db.leer("aceptaciones/ref-1") as any;
  assert.equal(aceptacion.email, null);
});

// ── M28: modalidad distinta de "unico" se rechaza (Tarea 7, renovable, no existe todavia) ──────

test('modalidad="renovable" -> 400, nada se crea (esta ruta solo activa "unico")', async () => {
  const { orden, opts } = opcionesBase({ modalidad: "renovable" });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

// ── Mercado Pago responde error -> 500, pero la aceptacion YA quedo guardada (se cobro lo que se mostro) ──

test("Mercado Pago responde error -> 500, pero preferencia y aceptacion ya quedaron guardadas (se crearon antes de la llamada)", async () => {
  const { db, orden, opts } = opcionesBase({
    crearPreferenciaMP: async (): Promise<RespuestaCrearPreferenciaMP> => {
      orden.push("mp");
      return { ok: false, status: 500, json: async () => ({ message: "fallo simulado de MP" }) };
    },
  });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 500);
  assert.deepEqual(orden, ["preferencia", "aceptacion", "mp"]);
  assert.ok(db.leer("preferencias/ref-1"));
  assert.ok(db.leer("aceptaciones/ref-1"));
});

// ── B.2 (Tarea 15, decision del Brain 2026-10-06): 409 si ya hay un Paquete vigente con saldo ──

test("con Paquete vigente y saldo -> 409, nada se crea (ni preferencia, ni aceptacion, ni llamada a MP)", async () => {
  const { orden, opts } = opcionesBase({ tienePaqueteVigente: async () => true });
  const resultado = await crearCobroPaquete(opts);

  assert.equal(resultado.httpStatus, 409);
  assert.match((resultado.body as { error: string }).error, /Ya tienes un Paquete vigente/);
  assert.deepEqual(orden, [], "ninguna dependencia debe llamarse");
});

test("sin Paquete vigente (tienePaqueteVigente=false) -> sigue el flujo normal (200)", async () => {
  const { opts } = opcionesBase({ tienePaqueteVigente: async () => false });
  const resultado = await crearCobroPaquete(opts);
  assert.equal(resultado.httpStatus, 200);
});
