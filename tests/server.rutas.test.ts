// Medio 5 (REVISOR_EXTERNO, 2026-10-06): este proyecto no importa `server.ts` en las pruebas
// (hacerlo dispara `startServer()` — side effect del propio modulo: `app.listen` real, servidor
// de Vite en modo middleware — ver el final del archivo). Por eso, al igual que
// `tests/relayGs.test.ts` para `docs/relay/avisos-relay.gs` (un archivo que tampoco se puede
// importar normal), esta prueba lee el CODIGO FUENTE de `server.ts` con `readFileSync` y verifica,
// con el texto real de cada bloque de ruta, que las piezas criticas de seguridad/legal siguen
// CABLEADAS donde deben estar — no que "existan en algun lado del archivo", sino que esten dentro
// del bloque de LA ruta que corresponde.
//
// Esto NO sustituye las pruebas de la logica extraida (tests/decisionesRuta.test.ts,
// tests/limitador.test.ts, etc., que ejercitan el comportamiento real con dependencias
// inyectadas) — las complementa: aquellas prueban que la FUNCION decide bien; esta prueba que el
// RESULTADO de la funcion se usa de verdad dentro de la ruta (nadie borro el `if` que lee
// `.ok === false` y responde con el `res.status` correcto, nadie volvio a dejar una ruta con el
// middleware de auth equivocado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const CODIGO = readFileSync(path.join(process.cwd(), "server.ts"), "utf8");

/** Devuelve el texto entre dos marcadores literales (el primero incluido, el segundo excluido).
 * Lanza si alguno no aparece — nunca produce un bloque vacio en silencio. */
function extraerBloque(inicio: string, fin: string): string {
  const i = CODIGO.indexOf(inicio);
  assert.notEqual(i, -1, `No se encontro el marcador de inicio: ${inicio}`);
  const j = CODIGO.indexOf(fin, i + inicio.length);
  assert.notEqual(j, -1, `No se encontro el marcador de fin: ${fin}`);
  return CODIGO.slice(i, j);
}

// ── Bloque del limitador de /api: debe usar el uid (no solo la IP) ─────────────────────────────
const bloqueLimitadorApi = extraerBloque(
  `app.use("/api", async (req, res, next) => {`,
  `app.use((_req, res, next) => {`
);

test("limitador de /api: la clave usa el uid verificado (identidad.uid), no solo la IP", () => {
  assert.match(
    bloqueLimitadorApi,
    /const clave = identidad \? `uid:\$\{identidad\.uid\}` : `ip:/,
    "la clave del limitador debe preferir `uid:${identidad.uid}` sobre la IP cuando hay un ID token valido"
  );
});

// ── /api/analyze-page: exigirAuth, nunca adjuntarAuthSiExiste ───────────────────────────────────
const bloqueAnalyzePage = extraerBloque(
  `app.post("/api/analyze-page",`,
  `app.post("/api/send-email",`
);

test("/api/analyze-page: usa exigirAuth (gasta la clave de Gemini, no puede quedar con login opcional)", () => {
  assert.match(bloqueAnalyzePage.slice(0, bloqueAnalyzePage.indexOf("\n")), /exigirAuth/);
});

test("/api/analyze-page: NUNCA adjuntarAuthSiExiste (ese middleware es para rutas sin costo por uso)", () => {
  assert.doesNotMatch(bloqueAnalyzePage.slice(0, bloqueAnalyzePage.indexOf("\n")), /adjuntarAuthSiExiste/);
});

// ── /api/send-email: el catch enmascara el correo antes de loguear ──────────────────────────────
const bloqueSendEmail = extraerBloque(
  `app.post("/api/send-email",`,
  `app.post("/api/mercadopago/create-preference",`
);

test("/api/send-email: el catch enmascara el correo del destinatario antes de loguearlo (enmascararCorreosEnTexto)", () => {
  assert.match(bloqueSendEmail, /console\.error\(\s*"Error sending email:",\s*error instanceof Error \? enmascararCorreosEnTexto\(error\.message\) : error/);
});

// ── /api/mercadopago/create-preference: decide Y USA el resultado de autorizacion/terminos ──────
const bloqueCreatePreference = extraerBloque(
  `app.post("/api/mercadopago/create-preference",`,
  `app.post("/api/mp/webhook",`
);

test("create-preference: decidirAutorizacionLoteRuta se llama Y su resultado decide la respuesta (res.status)", () => {
  assert.match(
    bloqueCreatePreference,
    /decisionAutorizacionCobro\.ok === false\)\s*\{\s*return res\.status\(decisionAutorizacionCobro\.httpStatus\)/
  );
});

test("create-preference: decidirAceptacionUsoRuta (Terminos, O2) se llama Y su resultado decide la respuesta (res.status)", () => {
  assert.match(
    bloqueCreatePreference,
    /decisionTerminosCobro\.ok === false\)\s*\{\s*return res\.status\(decisionTerminosCobro\.httpStatus\)/
  );
});

// ── /api/lote/iniciar: mismo gate, decide Y USA el resultado ────────────────────────────────────
const bloqueLoteIniciar = extraerBloque(
  `app.post("/api/lote/iniciar",`,
  `// Vite or Static Asset serving`
);

test("lote/iniciar: decidirAutorizacionLoteRuta se llama Y su resultado decide la respuesta (res.status)", () => {
  assert.match(
    bloqueLoteIniciar,
    /decisionAutorizacion\.ok === false\)\s*\{\s*return res\.status\(decisionAutorizacion\.httpStatus\)/
  );
});

test("lote/iniciar: decidirAceptacionUsoRuta (Terminos, O2) se llama Y su resultado decide la respuesta (res.status)", () => {
  assert.match(
    bloqueLoteIniciar,
    /decisionTerminos\.ok === false\)\s*\{\s*return res\.status\(decisionTerminos\.httpStatus\)/
  );
});

// ── Medio 4: /api/health expone `listo` = huella && proveedor ──────────────────────────────────
const bloqueHealth = extraerBloque(`app.get("/api/health",`, `app.get("/api/precios",`);

test("GET /api/health: `listo` es exactamente huella && proveedor (minimo para operar con pagos apagados)", () => {
  assert.match(bloqueHealth, /listo:\s*huella\s*&&\s*proveedor/);
});
