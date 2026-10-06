// Pruebas de la logica PURA del panel de checkout del Paquete (M30, cobro real con planes,
// corrige vuelta 24). Mismo patron que tests/plan.test.ts: node:test, sin React ni red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { puedePagar, interpretarRespuestaCobro, textoTerminos, textoRetracto } from "../src/utils/checkout";

// ── puedePagar: oraculo #3 — "Pagar" NUNCA se habilita con una sola casilla ─────────────────────

test("puedePagar: las dos casillas marcadas -> true", () => {
  assert.equal(puedePagar(true, true), true);
});

test("puedePagar: solo Terminos marcada -> false", () => {
  assert.equal(puedePagar(true, false), false);
});

test("puedePagar: solo retracto marcada -> false", () => {
  assert.equal(puedePagar(false, true), false);
});

test("puedePagar: ninguna marcada -> false", () => {
  assert.equal(puedePagar(false, false), false);
});

// ── interpretarRespuestaCobro ───────────────────────────────────────────────────────────────────

test("interpretarRespuestaCobro: 200 con initPoint -> ok, redirigir", () => {
  const r = interpretarRespuestaCobro(200, { initPoint: "https://mp.test/init" });
  assert.deepEqual(r, { tipo: "ok", initPoint: "https://mp.test/init" });
});

test("interpretarRespuestaCobro: 409 con copNuevo -> precio_cambio", () => {
  const r = interpretarRespuestaCobro(409, { error: "El precio cambió; revisa el nuevo monto", copNuevo: 61845 });
  assert.deepEqual(r, { tipo: "precio_cambio", copNuevo: 61845 });
});

test("interpretarRespuestaCobro: 400/500/503 -> error con el mensaje del servidor", () => {
  const r = interpretarRespuestaCobro(503, { error: "No podemos calcular el precio de hoy; intenta más tarde." });
  assert.deepEqual(r, { tipo: "error", mensaje: "No podemos calcular el precio de hoy; intenta más tarde." });
});

test("interpretarRespuestaCobro: 200 sin initPoint (respuesta rara) -> error, nunca redirige a undefined", () => {
  const r = interpretarRespuestaCobro(200, {});
  assert.equal(r.tipo, "error");
});

test("interpretarRespuestaCobro: 409 sin copNuevo numerico -> error (nunca un precio_cambio inventado)", () => {
  const r = interpretarRespuestaCobro(409, { error: "algo raro" });
  assert.equal(r.tipo, "error");
});

// ── textos: idioma correcto, nunca mezclados ────────────────────────────────────────────────────

test("textoTerminos: es incluye el monto formateado con puntos de miles", () => {
  const t = textoTerminos(61845, "es");
  assert.match(t, /61\.845/);
  assert.match(t, /He leído y acepto/);
});

test("textoTerminos: en incluye el monto formateado con comas de miles, texto en ingles", () => {
  const t = textoTerminos(61845, "en");
  assert.match(t, /61,845/);
  assert.match(t, /I have read and accept/);
  assert.doesNotMatch(t, /He leído/);
});

test("textoRetracto: es/en nunca se mezclan", () => {
  assert.match(textoRetracto("es"), /derecho de retracto/);
  assert.match(textoRetracto("en"), /right of withdrawal/);
  assert.doesNotMatch(textoRetracto("en"), /retracto/);
});
