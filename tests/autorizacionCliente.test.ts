// Pruebas de src/utils/autorizacionDatos.ts (MENORES, correccion vuelta 33, 2026-10-06): "carrera
// GET/POST de autorizacion al iniciar sesion". node:test puro, sin React/DOM — mismo patron que
// tests/plan.test.ts (`decidirEstadoSondeo`/`ejecutarRevisionSondeo`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirNecesitaAutorizar, puedeEntrarConGoogle, type LecturaAutorizacion } from "../src/utils/autorizacionDatos";

test("decidirNecesitaAutorizar: con un POST en vuelo, SIEMPRE null (no toca el estado) sin importar la lectura", () => {
  assert.equal(decidirNecesitaAutorizar({ tipo: "ok", autorizado: true }, true), null);
  assert.equal(decidirNecesitaAutorizar({ tipo: "ok", autorizado: false }, true), null);
  assert.equal(decidirNecesitaAutorizar({ tipo: "error" }, true), null);
});

test("decidirNecesitaAutorizar: sin POST en vuelo, lectura ok autorizado=true -> false (no hace falta el modal)", () => {
  const lectura: LecturaAutorizacion = { tipo: "ok", autorizado: true };
  assert.equal(decidirNecesitaAutorizar(lectura, false), false);
});

test("decidirNecesitaAutorizar: sin POST en vuelo, lectura ok autorizado=false -> true (abre el modal)", () => {
  const lectura: LecturaAutorizacion = { tipo: "ok", autorizado: false };
  assert.equal(decidirNecesitaAutorizar(lectura, false), true);
});

test("decidirNecesitaAutorizar: sin POST en vuelo, lectura 'error' -> true (MENORES: nunca se asume autorizado ante una duda)", () => {
  const lectura: LecturaAutorizacion = { tipo: "error" };
  assert.equal(decidirNecesitaAutorizar(lectura, false), true);
});

test("decidirNecesitaAutorizar: reproduce el bug original — GET 'no autorizado' llegando DESPUES del POST exitoso se descarta", () => {
  // Secuencia real: el POST marca el ref en true -> termina con exito (pondria false) -> el GET,
  // que arranco casi al mismo tiempo y todavia no sabia que el POST ya habia guardado, responde
  // con la lectura VIEJA (autorizado:false). Mientras el ref siga en true cuando esa respuesta
  // llega, decidirNecesitaAutorizar debe descartarla (null), nunca reabrir el modal.
  const lecturaViejaDelGet: LecturaAutorizacion = { tipo: "ok", autorizado: false };
  assert.equal(decidirNecesitaAutorizar(lecturaViejaDelGet, true), null);
});

// ── puedeEntrarConGoogle (O2, Dictamen Abogado_LAP ronda 5, 2026-10-06): oraculo "login
// habilitado con una sola casilla" — las DOS casillas (autorizacion de datos T11 + aceptacion de
// los Terminos) deben estar marcadas para poder entrar con Google. ──────────────────────────────

test("puedeEntrarConGoogle: las DOS casillas marcadas -> true", () => {
  assert.equal(puedeEntrarConGoogle(true, true), true);
});

test("puedeEntrarConGoogle: solo autorizacion de datos marcada -> false (NUNCA basta una sola)", () => {
  assert.equal(puedeEntrarConGoogle(true, false), false);
});

test("puedeEntrarConGoogle: solo aceptacion de Terminos marcada -> false (NUNCA basta una sola)", () => {
  assert.equal(puedeEntrarConGoogle(false, true), false);
});

test("puedeEntrarConGoogle: ninguna marcada -> false", () => {
  assert.equal(puedeEntrarConGoogle(false, false), false);
});
