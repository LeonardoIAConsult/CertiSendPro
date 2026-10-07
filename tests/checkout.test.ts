// Pruebas de la logica PURA del panel de checkout del Paquete (M30, cobro real con planes,
// corrige vuelta 24) y del panel de "Pago por uso" (Paso 16B, 2026-10-07). Mismo patron que
// tests/plan.test.ts: node:test, sin React ni red.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  puedePagar,
  interpretarRespuestaCobro,
  textoTerminos,
  textoRetracto,
  textoRetractoPorUso,
  esInitPointMercadoPagoValido,
  cantidadPorUsoValida,
  clampCantidadPorUso,
  calcularTotalPorUso,
  formatearFechaCortaDesdeISO,
  PORUSO_MINIMO,
  PORUSO_MAXIMO,
} from "../src/utils/checkout";
import { copDesdeUsd } from "../shared/precios";
import { copDesdeUsd as copDesdeUsdDelServidor } from "../server/trm";

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

test("esInitPointMercadoPagoValido: produccion mercadopago.com -> true", () => {
  assert.equal(esInitPointMercadoPagoValido("https://www.mercadopago.com/mco/checkout/v1/redirect"), true);
  assert.equal(esInitPointMercadoPagoValido("https://mercadopago.com/checkout/v1/redirect"), true);
});

test("esInitPointMercadoPagoValido: produccion con TLD de pais (mercadopago.com.co) -> true", () => {
  assert.equal(esInitPointMercadoPagoValido("https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=1"), true);
});

test("esInitPointMercadoPagoValido: sandbox (sandbox.mercadopago.com.co) -> true", () => {
  assert.equal(esInitPointMercadoPagoValido("https://sandbox.mercadopago.com.co/checkout/v1/redirect?pref_id=1"), true);
  assert.equal(esInitPointMercadoPagoValido("https://www.sandbox.mercadopago.com/checkout/v1/redirect"), true);
});

test("esInitPointMercadoPagoValido: dominio distinto -> false", () => {
  assert.equal(esInitPointMercadoPagoValido("https://mercadopago.com.otrositio.net/checkout"), false);
  assert.equal(esInitPointMercadoPagoValido("https://otrositio.net/mercadopago.com/checkout"), false);
  assert.equal(esInitPointMercadoPagoValido("https://notmercadopago.com/checkout"), false);
});

test("esInitPointMercadoPagoValido: protocolo distinto de https -> false", () => {
  assert.equal(esInitPointMercadoPagoValido("http://mercadopago.com/checkout"), false);
  assert.equal(esInitPointMercadoPagoValido("ftp://mercadopago.com/checkout"), false);
});

test("esInitPointMercadoPagoValido: entradas raras (vacio, undefined, no-string) -> false, nunca lanza", () => {
  assert.equal(esInitPointMercadoPagoValido(""), false);
  assert.equal(esInitPointMercadoPagoValido(undefined), false);
  assert.equal(esInitPointMercadoPagoValido(null), false);
  assert.equal(esInitPointMercadoPagoValido(12345), false);
});

// ── textoRetractoPorUso: idioma correcto, distinto del texto del Paquete ───────────────────────

test("textoRetractoPorUso: es/en nunca se mezclan, y es distinto del retracto del Paquete", () => {
  assert.match(textoRetractoPorUso("es"), /saldo se active de inmediato/);
  assert.match(textoRetractoPorUso("en"), /balance to be activated immediately/);
  assert.doesNotMatch(textoRetractoPorUso("en"), /retracto/);
  assert.notEqual(textoRetractoPorUso("es"), textoRetracto("es"));
  assert.notEqual(textoRetractoPorUso("en"), textoRetracto("en"));
});

// ── cantidadPorUsoValida (Paso 16B): mutacion del oraculo — 49 NUNCA debe aceptarse ────────────

test("cantidadPorUsoValida: 49 -> false (justo debajo del minimo)", () => {
  assert.equal(cantidadPorUsoValida(49), false);
});

test("cantidadPorUsoValida: 50 (el minimo exacto) -> true", () => {
  assert.equal(cantidadPorUsoValida(50), true);
});

test("cantidadPorUsoValida: 5000 (el maximo exacto) -> true", () => {
  assert.equal(cantidadPorUsoValida(5000), true);
});

test("cantidadPorUsoValida: 5001 -> false (justo arriba del maximo)", () => {
  assert.equal(cantidadPorUsoValida(5001), false);
});

test("cantidadPorUsoValida: decimales/NaN -> false, nunca lanza", () => {
  assert.equal(cantidadPorUsoValida(50.5), false);
  assert.equal(cantidadPorUsoValida(NaN), false);
});

test("cantidadPorUsoValida: respeta limites custom (minimo/maximo distintos de las constantes)", () => {
  assert.equal(cantidadPorUsoValida(10, 5, 20), true);
  assert.equal(cantidadPorUsoValida(21, 5, 20), false);
});

// ── clampCantidadPorUso: botones +/-10 y el input nunca dejan la cantidad fuera de rango ──────

test("clampCantidadPorUso: por debajo del minimo -> el minimo", () => {
  assert.equal(clampCantidadPorUso(10), PORUSO_MINIMO);
  assert.equal(clampCantidadPorUso(-5), PORUSO_MINIMO);
});

test("clampCantidadPorUso: por encima del maximo -> el maximo", () => {
  assert.equal(clampCantidadPorUso(9999), PORUSO_MAXIMO);
});

test("clampCantidadPorUso: dentro de rango, redondea al entero mas cercano", () => {
  assert.equal(clampCantidadPorUso(137.4), 137);
  assert.equal(clampCantidadPorUso(137.6), 138);
});

test("clampCantidadPorUso: NaN/no finito -> el minimo, nunca NaN propagado", () => {
  assert.equal(clampCantidadPorUso(NaN), PORUSO_MINIMO);
  assert.equal(clampCantidadPorUso(Infinity), PORUSO_MINIMO);
});

// ── calcularTotalPorUso: cantidad 50 -> total correcto; paridad cliente<->servidor ─────────────
// Paso 16B, punto 2 del encargo: "cantidad 49 -> inválido, 50 -> total correcto, paridad del COP".
// El COP SIEMPRE sale de `copDesdeUsd(usdUnidad * cantidad, trm)` (shared/precios.ts, la MISMA
// funcion que usa el servidor via server/trm.ts) — mutacion del oraculo: calcular con el unitario
// YA redondeado multiplicado por N debe caer esta prueba (ver la de abajo, "nunca el unitario...").

test("calcularTotalPorUso: cantidad=50, TRM=4123 -> COP = copDesdeUsd(0.15*50, 4123), USD=7.50", () => {
  const r = calcularTotalPorUso(50, 4123);
  assert.equal(r.cop, copDesdeUsd(0.15 * 50, 4123));
  assert.equal(r.usd, 7.5);
});

test("calcularTotalPorUso: NUNCA el unitario ya redondeado multiplicado por N (el oraculo exige esto)", () => {
  // TRM elegida a mano para que las dos formulas DEN DISTINTO (si dieran igual la prueba no
  // probaria nada): copDesdeUsd(0.15, trm)*137 vs copDesdeUsd(0.15*137, trm).
  const trm = 4123.37;
  const cantidad = 137;
  const copUnitarioRedondeadoPorN = copDesdeUsd(0.15, trm) * cantidad;
  const copTotalCorrecto = copDesdeUsd(0.15 * cantidad, trm);
  assert.notEqual(copUnitarioRedondeadoPorN, copTotalCorrecto, "la TRM elegida debe hacer que las dos formulas difieran");
  const r = calcularTotalPorUso(cantidad, trm);
  assert.equal(r.cop, copTotalCorrecto);
  assert.notEqual(r.cop, copUnitarioRedondeadoPorN);
});

for (const cantidad of [50, 137, 5000]) {
  test(`paridad cliente<->servidor: cantidad=${cantidad}, TRM=4123.7 -> mismo COP en los dos lados`, () => {
    const trm = 4123.7;
    const copCliente = calcularTotalPorUso(cantidad, trm).cop;
    const copServidor = copDesdeUsdDelServidor(0.15 * cantidad, trm);
    assert.equal(copCliente, copServidor);
    // Y los dos pasan por la MISMA funcion compartida (shared/precios.ts) — nunca una copia.
    assert.equal(copCliente, copDesdeUsd(0.15 * cantidad, trm));
  });
}

// ── formatearFechaCortaDesdeISO: "yyyy-mm-dd" -> "DD/MM", sin pasar por Date/zona horaria ─────

test("formatearFechaCortaDesdeISO: 2026-10-07 -> 07/10", () => {
  assert.equal(formatearFechaCortaDesdeISO("2026-10-07"), "07/10");
});

test("formatearFechaCortaDesdeISO: 2026-01-31 -> 31/01 (dia y mes con cero a la izquierda)", () => {
  assert.equal(formatearFechaCortaDesdeISO("2026-01-31"), "31/01");
});
