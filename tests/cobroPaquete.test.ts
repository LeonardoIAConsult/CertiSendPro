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
import { crearCobroPaquete, crearCobroPorUso, planCobroValido, type RespuestaCrearPreferenciaMP } from "../server/cobroPaquete";
import { copDesdeUsd } from "../server/trm";
import { TERMINOS_VERSION, TEXTO_CASILLA_RETRACTO } from "../server/cuentas";
import { TEXTO_CASILLA_RETRACTO_POR_USO } from "../shared/textosCasillas";
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

// ── Tarea 16A-2 (decision del Brain 2026-10-06): planCobroValido — "pro" desaparece de todo lo
// vendible; solo "paquete"/"porUso" son planes validos ───────────────────────────────────────────

test('planCobroValido: "paquete" y "porUso" son validos; "pro" y cualquier otro valor -> invalido', () => {
  assert.equal(planCobroValido("paquete"), true);
  assert.equal(planCobroValido("porUso"), true);
  assert.equal(planCobroValido("pro"), false);
  assert.equal(planCobroValido(undefined), false);
  assert.equal(planCobroValido("otra-cosa"), false);
  assert.equal(planCobroValido(null), false);
});

// ── crearCobroPorUso (Tarea 16A-2): US$0,15 por envio, minimo 50, maximo 5000, entero ───────────

const COP_50_POR_USO = copDesdeUsd(0.15 * 50, 4123);

function opcionesPorUsoBase(overrides: Partial<Parameters<typeof crearCobroPorUso>[0]> = {}) {
  const db = new FirestoreFalso();
  const orden: string[] = [];
  const deps = construirDependencias(db, orden);
  return {
    db,
    orden,
    opts: {
      uid: "uid-1",
      email: "cliente@test.com",
      cantidad: 50,
      aceptaTerminos: true,
      aceptaRetracto: true,
      copMostrado: COP_50_POR_USO,
      idioma: "es",
      modalidad: "unico",
      obtenerTrm: async () => ({ valor: 4123, fechaDesde: "2026-10-05" }),
      copDesdeUsd,
      usdUnidad: 0.15,
      minimoCantidad: 50,
      maximoCantidad: 5000,
      generarId: () => "ref-1",
      log: () => {},
      ...deps,
      ...overrides,
    },
  };
}

test("crearCobroPorUso: cantidad=49 (bajo el minimo de 50) -> 400, nada se crea", async () => {
  const { orden, opts } = opcionesPorUsoBase({ cantidad: 49, copMostrado: copDesdeUsd(0.15 * 49, 4123) });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

test("crearCobroPorUso: cantidad=5001 (sobre el maximo de 5000) -> 400, nada se crea", async () => {
  const { orden, opts } = opcionesPorUsoBase({ cantidad: 5001, copMostrado: copDesdeUsd(0.15 * 5001, 4123) });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

test("crearCobroPorUso: cantidad=50 (el minimo exacto) -> 200, COP == copDesdeUsd(7.5) y external_reference correcto", async () => {
  let externalReferenceRecibida = "";
  const { db, opts } = opcionesPorUsoBase({
    crearPreferenciaMP: async ({ cop, externalReference }: any) => {
      externalReferenceRecibida = externalReference;
      return { ok: true, status: 200, json: async () => ({ init_point: "https://mp.test/init-point" }) };
    },
  });
  const resultado = await crearCobroPorUso(opts);

  assert.equal(resultado.httpStatus, 200);
  const copEsperado = copDesdeUsd(7.5, 4123);
  assert.equal(copEsperado, COP_50_POR_USO);
  assert.equal((resultado.body as any).cop, copEsperado);
  assert.equal((resultado.body as any).cantidad, 50);
  assert.equal(externalReferenceRecibida, `CERTISEND|uid-1|porUso|50|${copEsperado}|ref-1`);

  const preferencia = db.leer("preferencias/ref-1") as any;
  assert.equal(preferencia.plan, "porUso");
  assert.equal(preferencia.cantidad, 50);
  assert.equal(preferencia.cop, copEsperado);

  const aceptacion = db.leer("aceptaciones/ref-1") as any;
  assert.equal(aceptacion.plan, "porUso");
  assert.equal(aceptacion.textoRetracto, TEXTO_CASILLA_RETRACTO_POR_USO);
});

test("crearCobroPorUso: cantidad=5000 (el maximo exacto) -> 200", async () => {
  const { opts } = opcionesPorUsoBase({ cantidad: 5000, copMostrado: copDesdeUsd(0.15 * 5000, 4123) });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 200);
});

test("crearCobroPorUso: cantidad decimal (no entera) -> 400", async () => {
  const { orden, opts } = opcionesPorUsoBase({ cantidad: 50.5 });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

test("crearCobroPorUso: cantidad como texto (no numero) -> 400 (nunca se confia en un texto numerico para la cantidad)", async () => {
  const { orden, opts } = opcionesPorUsoBase({ cantidad: "50" as any });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

test("crearCobroPorUso: sin aceptaTerminos/aceptaRetracto -> 400, nada se crea", async () => {
  const { orden, opts } = opcionesPorUsoBase({ aceptaTerminos: false });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 400);
  assert.deepEqual(orden, []);
});

test("crearCobroPorUso: copMostrado distinto del recalculado -> 409 con copNuevo, nada se crea", async () => {
  const { orden, opts } = opcionesPorUsoBase({ copMostrado: COP_50_POR_USO - 1 });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 409);
  assert.equal((resultado.body as any).copNuevo, COP_50_POR_USO);
  assert.deepEqual(orden, []);
});

// Mutacion documentada (punto 1 del Paso 16A-2): el COP de N envios debe salir de
// `copDesdeUsd(usdUnidad * cantidad, trm)`, NUNCA de multiplicar un COP unitario ya redondeado por
// N — esta prueba falla si alguien cambia la formula a `copDesdeUsd(usdUnidad, trm) * cantidad`
// (el redondeo por unidad, multiplicado 333 veces, da un numero distinto del redondeo del total).
test("crearCobroPorUso: el COP sale de redondear el TOTAL (usdUnidad*cantidad), nunca de multiplicar el unitario ya redondeado", async () => {
  const cantidad = 333;
  const trm = 4123.37; // decimal real, para que el redondeo por unidad SI difiera del total.
  const copUnitarioRedondeado = copDesdeUsd(0.15, trm);
  const copTotalCorrecto = copDesdeUsd(0.15 * cantidad, trm);
  assert.notEqual(
    copUnitarioRedondeado * cantidad,
    copTotalCorrecto,
    "con esta TRM, las dos formulas deben dar numeros distintos (si no, la prueba no prueba nada)"
  );

  const { opts } = opcionesPorUsoBase({
    cantidad,
    copMostrado: copTotalCorrecto,
    obtenerTrm: async () => ({ valor: trm, fechaDesde: "2026-10-05" }),
  });
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 200, "el cliente mostro el COP correcto (del total), debe coincidir");
  assert.equal((resultado.body as any).cop, copTotalCorrecto);
});

// ── Comprar porUso con un Paquete vigente SI esta permitido (a diferencia del Paquete, nunca hay
// un chequeo de "ya tienes uno vigente" en crearCobroPorUso) ───────────────────────────────────

test("crearCobroPorUso: no existe ningun chequeo de Paquete vigente -> 200 sin importar el estado de otro plan", async () => {
  // A diferencia de crearCobroPaquete, CrearCobroPorUsoOpts ni siquiera recibe un
  // `tienePaqueteVigente`: la ausencia misma de esa dependencia es la prueba de que esta funcion
  // nunca puede bloquear por esa razon.
  const { opts } = opcionesPorUsoBase();
  assert.equal((opts as any).tienePaqueteVigente, undefined, "crearCobroPorUso no debe depender de tienePaqueteVigente");
  const resultado = await crearCobroPorUso(opts);
  assert.equal(resultado.httpStatus, 200, "comprar porUso con (o sin) un Paquete vigente siempre sigue el flujo normal");
});
