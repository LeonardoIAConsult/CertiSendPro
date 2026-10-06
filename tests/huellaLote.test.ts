// Pruebas de server/huellaLote.ts (Tarea 15, requisito A.3, 2026-10-06): huella HMAC-SHA256 por
// cada par pagina-fila-correo de un lote confirmado, SIN guardar la lista ni los correos en
// claro. node:test puro, sin Firestore ni Express — mismo patron que tests/webhook.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarCorreo,
  cadenaCanonicaPar,
  huellaPar,
  huellasLote,
  paresInvalidos,
  huellaConfigurada,
  validarSecretoYPares,
  parConfirmado,
  decidirEnvioConHuella,
  type ParConfirmacion,
} from "../server/huellaLote";

const SECRETO = "secreto-de-prueba-no-real";

test("normalizarCorreo: lowercase + trim", () => {
  assert.equal(normalizarCorreo("  Ana@Correo.com  "), "ana@correo.com");
});

test("cadenaCanonicaPar: pagina|fila|correoNormalizado", () => {
  const par: ParConfirmacion = { pagina: 3, fila: 7, correo: "Ana@Correo.com" };
  assert.equal(cadenaCanonicaPar(par), "3|7|ana@correo.com");
});

test("huellaPar: mismo par + mismo secreto -> siempre la misma huella (determinista)", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  const h1 = huellaPar(par, SECRETO);
  const h2 = huellaPar(par, SECRETO);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64); // hex de SHA-256
});

test("huellaPar: cambiar el correo cambia la huella", () => {
  const h1 = huellaPar({ pagina: 1, fila: 2, correo: "ana@correo.com" }, SECRETO);
  const h2 = huellaPar({ pagina: 1, fila: 2, correo: "otra@correo.com" }, SECRETO);
  assert.notEqual(h1, h2);
});

test("huellaPar: una mayuscula/espacio distinto en el correo da la MISMA huella (normalizado)", () => {
  const h1 = huellaPar({ pagina: 1, fila: 2, correo: "ana@correo.com" }, SECRETO);
  const h2 = huellaPar({ pagina: 1, fila: 2, correo: "  Ana@Correo.com  " }, SECRETO);
  assert.equal(h1, h2);
});

test("huellaPar: cambiar la pagina o la fila cambia la huella", () => {
  const base = huellaPar({ pagina: 1, fila: 2, correo: "ana@correo.com" }, SECRETO);
  assert.notEqual(base, huellaPar({ pagina: 9, fila: 2, correo: "ana@correo.com" }, SECRETO));
  assert.notEqual(base, huellaPar({ pagina: 1, fila: 9, correo: "ana@correo.com" }, SECRETO));
});

test("huellaPar: cambiar el secreto cambia la huella", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  assert.notEqual(huellaPar(par, SECRETO), huellaPar(par, "otro-secreto"));
});

test("huellasLote: una huella por par, en el mismo orden", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 1, correo: "a@x.com" },
    { pagina: 2, fila: 2, correo: "b@x.com" },
    { pagina: 3, fila: 3, correo: "c@x.com" },
  ];
  const huellas = huellasLote(pares, SECRETO);
  assert.equal(huellas.length, 3);
  assert.deepEqual(huellas, pares.map((p) => huellaPar(p, SECRETO)));
});

test("huellasLote: nunca contiene el correo en claro", () => {
  const pares: ParConfirmacion[] = [{ pagina: 1, fila: 1, correo: "secreto@correo.com" }];
  const [huella] = huellasLote(pares, SECRETO);
  assert.doesNotMatch(huella, /secreto@correo\.com/);
});

// ── Medio 3 (correccion vuelta 31, 2026-10-06): integridad de los pares de un lote ──────────────

test("paresInvalidos: lote vacio -> invalido", () => {
  assert.ok(paresInvalidos([]));
});

test("paresInvalidos: pares validos y distintos -> null (sin error)", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 10, correo: "a@x.com" },
    { pagina: 2, fila: 20, correo: "b@x.com" },
  ];
  assert.equal(paresInvalidos(pares), null);
});

test("paresInvalidos: correo vacio -> invalido", () => {
  const pares: ParConfirmacion[] = [{ pagina: 1, fila: 10, correo: "   " }];
  assert.ok(paresInvalidos(pares));
});

test("paresInvalidos: pagina/fila no finitas -> invalido", () => {
  assert.ok(paresInvalidos([{ pagina: NaN, fila: 1, correo: "a@x.com" }]));
  assert.ok(paresInvalidos([{ pagina: 1, fila: NaN, correo: "a@x.com" }]));
});

test("paresInvalidos: dos pares con la MISMA fila -> invalido (dos paginas, un destinatario)", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 5, correo: "a@x.com" },
    { pagina: 2, fila: 5, correo: "b@x.com" },
  ];
  assert.ok(paresInvalidos(pares));
});

test("paresInvalidos: dos pares con la MISMA pagina -> invalido (una pagina, dos destinatarios)", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 5, correo: "a@x.com" },
    { pagina: 1, fila: 6, correo: "b@x.com" },
  ];
  assert.ok(paresInvalidos(pares));
});

// ── GRAVE 2 (correccion vuelta 31, 2026-10-06): huella fail-closed ──────────────────────────────

test("huellaConfigurada: con HUELLA_LOTE_SECRET -> true", () => {
  assert.equal(huellaConfigurada({ HUELLA_LOTE_SECRET: "algo" }), true);
});

test("huellaConfigurada: sin HUELLA_LOTE_SECRET -> false", () => {
  assert.equal(huellaConfigurada({}), false);
});

test("huellaConfigurada: HUELLA_LOTE_SECRET vacio o solo espacios -> false", () => {
  assert.equal(huellaConfigurada({ HUELLA_LOTE_SECRET: "" }), false);
  assert.equal(huellaConfigurada({ HUELLA_LOTE_SECRET: "   " }), false);
});

test("validarSecretoYPares: sin secreto -> 503, no llega a mirar los pares", () => {
  const r = validarSecretoYPares(undefined, 2, []);
  assert.deepEqual(r, { ok: false, httpStatus: 503, error: "Configuración incompleta. Intenta más tarde." });
});

test("validarSecretoYPares: pares.length distinto de cantidad -> 400", () => {
  const pares: ParConfirmacion[] = [{ pagina: 1, fila: 1, correo: "a@x.com" }];
  const r = validarSecretoYPares(SECRETO, 2, pares);
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 400);
});

test("validarSecretoYPares: pares duplicados -> 400 con el mensaje de paresInvalidos", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 5, correo: "a@x.com" },
    { pagina: 2, fila: 5, correo: "b@x.com" },
  ];
  const r = validarSecretoYPares(SECRETO, 2, pares);
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 400);
});

test("validarSecretoYPares: secreto + pares validos que cubren cantidad -> ok", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 1, correo: "a@x.com" },
    { pagina: 2, fila: 2, correo: "b@x.com" },
  ];
  assert.deepEqual(validarSecretoYPares(SECRETO, 2, pares), { ok: true });
});

// ── Medio 3: un par que no esta en el lote -> rechazado (409 lo decide server.ts con esto) ──────

test("parConfirmado: un par que SI esta entre las huellas guardadas -> true", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  const huellas = huellasLote([par], SECRETO);
  assert.equal(parConfirmado(par, huellas, SECRETO), true);
});

test("parConfirmado: un par que NO esta en el lote -> false (409)", () => {
  const confirmado: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  const huellas = huellasLote([confirmado], SECRETO);
  const otro: ParConfirmacion = { pagina: 9, fila: 9, correo: "otro@correo.com" };
  assert.equal(parConfirmado(otro, huellas, SECRETO), false);
});

test("parConfirmado: sin huellas guardadas (null) -> false, nunca 'todo vale'", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  assert.equal(parConfirmado(par, null, SECRETO), false);
});

test("parConfirmado: mismo par pero con OTRO secreto -> false", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  const huellas = huellasLote([par], SECRETO);
  assert.equal(parConfirmado(par, huellas, "otro-secreto"), false);
});

// ── GRAVE 3 (correccion vuelta 33, 2026-10-06): normalizarCorreo delega en el sanitizador UNICO
// compartido (shared/correo.ts) — correos con caracteres invisibles o espacios internos deben
// normalizar IGUAL que un correo ya limpio, para que la huella calculada en /api/lote/iniciar
// coincida con la que /api/send-email recalcula sobre el mismo correo ya saneado por `cleanTo`. ──

test("normalizarCorreo: caracter de ancho cero (\\u200B) se quita, igual que un correo limpio", () => {
  assert.equal(normalizarCorreo("ana​@x.com"), "ana@x.com");
});

test("normalizarCorreo: espacio INTERNO se quita (no solo los extremos)", () => {
  assert.equal(normalizarCorreo("ana @x.com"), "ana@x.com");
});

test("normalizarCorreo: marca de direccion LRM (\\u200E) al final se quita", () => {
  assert.equal(normalizarCorreo("ana@x.com‎"), "ana@x.com");
});

test("normalizarCorreo: mayusculas + espacio al final -> igual que el correo limpio", () => {
  assert.equal(normalizarCorreo("Ana@X.com "), "ana@x.com");
});

test("normalizarCorreo: las 4 variantes de GRAVE 3 normalizan TODAS al mismo valor (coinciden entre si)", () => {
  const variantes = ["ana​@x.com", "ana @x.com", "ana@x.com‎", "Ana@X.com "];
  const normalizados = variantes.map(normalizarCorreo);
  assert.deepEqual(new Set(normalizados), new Set(["ana@x.com"]));
});

test("GRAVE 3: una huella calculada con un correo SUCIO coincide con la verificacion sobre el correo LIMPIO equivalente", () => {
  // Simula el bug exacto: /api/lote/iniciar recibe el correo tal como viene de la hoja (sucio);
  // /api/send-email recalcula con el correo ya saneado por cleanTo (limpio). Con el sanitizador
  // compartido, la huella debe coincidir en ambos sentidos.
  const parSucio: ParConfirmacion = { pagina: 1, fila: 2, correo: "Ana @X.com‎" };
  const huellas = huellasLote([parSucio], SECRETO);
  const parLimpio: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@x.com" };
  assert.equal(parConfirmado(parLimpio, huellas, SECRETO), true);
});

// ── decidirEnvioConHuella (correccion vuelta 33, 2026-10-06): decision COMPLETA de /api/send-email
// sobre la huella, extraida de server.ts como funcion PURA (dos `if` sueltos antes). ──────────────

const PAR_PRUEBA: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };

test("decidirEnvioConHuella: sin secreto -> 503, nunca llega a comparar la huella", () => {
  const r = decidirEnvioConHuella(PAR_PRUEBA, null, undefined);
  assert.deepEqual(r, { ok: false, httpStatus: 503, error: "Configuración incompleta. Intenta más tarde." });
});

test("decidirEnvioConHuella: secreto vacio/solo espacios -> 503", () => {
  const r = decidirEnvioConHuella(PAR_PRUEBA, null, "   ");
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 503);
});

test("decidirEnvioConHuella: con secreto pero la huella no coincide -> 409", () => {
  const huellas = huellasLote([{ pagina: 9, fila: 9, correo: "otro@x.com" }], SECRETO);
  const r = decidirEnvioConHuella(PAR_PRUEBA, huellas, SECRETO);
  assert.deepEqual(r, {
    ok: false,
    httpStatus: 409,
    error: "Este envío no coincide con la confirmación del lote. Vuelve a iniciar el envío masivo.",
  });
});

test("decidirEnvioConHuella: con secreto y huella que SI coincide -> ok", () => {
  const huellas = huellasLote([PAR_PRUEBA], SECRETO);
  assert.deepEqual(decidirEnvioConHuella(PAR_PRUEBA, huellas, SECRETO), { ok: true });
});

test("decidirEnvioConHuella: mutacion de control — sin huellas guardadas (null) -> 409, nunca 'todo vale'", () => {
  const r = decidirEnvioConHuella(PAR_PRUEBA, null, SECRETO);
  assert.equal(r.ok, false);
  assert.equal((r as any).httpStatus, 409);
});
