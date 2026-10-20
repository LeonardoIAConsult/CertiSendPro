// Backlog 20-oct-2026: `/api/health` informa `gemini` por la FORMA de GEMINI_API_KEY.
// Caso real que motiva la prueba: el 5-oct el token de Mercado Pago quedo guardado en el secreto
// de Gemini. Valores ficticios, ninguno es una llave real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { geminiKeyConForma } from "../server/geminiKey";

const LLAVE_FICTICIA = "AIza" + "x".repeat(35); // 39 caracteres
const TOKEN_MP_FICTICIO = "APP_USR-1234567890123456-100500-abcdef0123456789abcdef0123456789-123456789";

test("gemini: llave con forma de Google (AIza + 39 caracteres) => true", () => {
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: LLAVE_FICTICIA, MERCADO_PAGO_ACCESS_TOKEN: TOKEN_MP_FICTICIO }), true);
});

test("gemini: caso 5-oct, el token de MP pegado en el secreto de Gemini => false", () => {
  assert.equal(
    geminiKeyConForma({ GEMINI_API_KEY: TOKEN_MP_FICTICIO, MERCADO_PAGO_ACCESS_TOKEN: TOKEN_MP_FICTICIO }),
    false
  );
});

test("gemini: igual al token de MP aunque tenga forma de llave => false", () => {
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: LLAVE_FICTICIA, MERCADO_PAGO_ACCESS_TOKEN: LLAVE_FICTICIA }), false);
});

test("gemini: ausente, vacia, largo distinto, prefijo distinto o salto de linea final => false", () => {
  assert.equal(geminiKeyConForma({}), false);
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: "" }), false);
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: LLAVE_FICTICIA.slice(0, 38) }), false);
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: LLAVE_FICTICIA + "x" }), false);
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: "BIza" + "x".repeat(35) }), false);
  assert.equal(geminiKeyConForma({ GEMINI_API_KEY: LLAVE_FICTICIA + "\n" }), false);
});

test("GET /api/health expone `gemini` desde geminiKeyConForma (sin el valor de la llave)", () => {
  const fuente = readFileSync(path.join(import.meta.dirname, "..", "server.ts"), "utf8");
  const inicio = fuente.indexOf(`app.get("/api/health",`);
  const fin = fuente.indexOf(`app.get("/api/precios",`);
  const bloque = fuente.slice(inicio, fin);
  assert.match(bloque, /gemini:\s*geminiKeyConForma\(\)/);
  assert.doesNotMatch(bloque, /GEMINI_API_KEY/);
});
