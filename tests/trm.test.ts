// Pruebas de la TRM robusta (Tarea 4, cobro real con planes, 2026-10-05). Corren con el test
// runner nativo de Node (node:test) via tsx; no tocan la red real: `validarFilaTrm` y
// `cacheVigente` son funciones PURAS, y `trmHoy` recibe el fetch inyectado por parametro (mismo
// patron de tests/decidirLote.test.ts y tests/registrarEnvio.test.ts con server/cuentas.ts).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  validarFilaTrm,
  cacheVigente,
  trmHoy,
  _resetCacheParaPruebas,
  TRM_MIN,
  TRM_MAX,
  type TrmValida,
  type FetchLike,
} from "../server/trm";

// `trmHoy` cachea en una variable de modulo (igual que en produccion): sin limpiarla antes de
// cada prueba, una prueba que cachea un valor "contaminaria" las siguientes de este archivo
// (mismo proceso, mismo modulo). Las pruebas de `validarFilaTrm`/`cacheVigente` no la usan (son
// puras), pero resetear antes de todas es inocuo y mas simple que separar los bloques.
beforeEach(() => {
  _resetCacheParaPruebas();
});

// Fecha de referencia fija para que las pruebas no dependan del reloj real.
const ahora = new Date("2026-10-05T12:00:00Z");

// ── validarFilaTrm (pura) ────────────────────────────────────────────────────────────────────

test("validarFilaTrm: fila buena (valor en rango, vigencia de hoy) se acepta", () => {
  const fila = { valor: 4100.5, vigenciadesde: "2026-10-05T00:00:00.000" };
  const v = validarFilaTrm(fila, ahora);
  assert.ok(v !== null);
  assert.equal(v!.valor, 4100.5);
  assert.equal(v!.fecha, "2026-10-05");
});

test("validarFilaTrm: fila de hace 6 dias se rechaza (mas de 5 dias de antiguedad)", () => {
  const fila = { valor: 4100, vigenciadesde: "2026-09-29T00:00:00.000" }; // 6 dias antes de `ahora`
  assert.equal(validarFilaTrm(fila, ahora), null);
});

test("validarFilaTrm: fila de hace exactamente 5 dias se acepta (limite inclusive)", () => {
  const fila = { valor: 4100, vigenciadesde: "2026-09-30T12:00:00.000" }; // exacto 5 dias antes
  assert.ok(validarFilaTrm(fila, ahora) !== null);
});

test("validarFilaTrm: valor absurdo (fuera de [TRM_MIN, TRM_MAX]) se rechaza", () => {
  const demasiadoAlto = { valor: TRM_MAX + 1, vigenciadesde: "2026-10-05T00:00:00.000" };
  const demasiadoBajo = { valor: TRM_MIN - 1, vigenciadesde: "2026-10-05T00:00:00.000" };
  assert.equal(validarFilaTrm(demasiadoAlto, ahora), null);
  assert.equal(validarFilaTrm(demasiadoBajo, ahora), null);
});

test("validarFilaTrm: respuesta vacia (fila null/undefined) se rechaza sin lanzar", () => {
  assert.equal(validarFilaTrm(null, ahora), null);
  assert.equal(validarFilaTrm(undefined, ahora), null);
});

test("validarFilaTrm: valor no numerico se rechaza", () => {
  const fila = { valor: "no-es-un-numero", vigenciadesde: "2026-10-05T00:00:00.000" };
  assert.equal(validarFilaTrm(fila, ahora), null);
});

test("validarFilaTrm: sin vigenciadesde se rechaza", () => {
  const fila = { valor: 4100 };
  assert.equal(validarFilaTrm(fila, ahora), null);
});

// ── cacheVigente (pura): cache del mismo dia de vigencia vs cache de ayer ───────────────────────

test("cacheVigente: cache con fecha de HOY se reutiliza", () => {
  const cache: TrmValida = { valor: 4100, fecha: "2026-10-05" };
  assert.deepEqual(cacheVigente(cache, ahora), cache);
});

test("cacheVigente: cache con fecha de AYER no se reutiliza (nunca una cache vencida)", () => {
  const cacheDeAyer: TrmValida = { valor: 4050, fecha: "2026-10-04" };
  assert.equal(cacheVigente(cacheDeAyer, ahora), null);
});

test("cacheVigente: sin cache previa, devuelve null", () => {
  assert.equal(cacheVigente(null, ahora), null);
});

// ── trmHoy (orquesta fetch inyectado + validacion) ──────────────────────────────────────────────

function fetchOk(fila: any): FetchLike {
  return async () => ({ ok: true, json: async () => [fila] });
}

test("trmHoy: con una fila buena, devuelve valor y fecha", async () => {
  const r = await trmHoy(fetchOk({ valor: 4200, vigenciadesde: "2026-10-05T00:00:00.000" }));
  assert.ok(r !== null);
  assert.equal(r!.valor, 4200);
  assert.equal(r!.fecha, "2026-10-05");
});

test("trmHoy: respuesta vacia ([]) del endpoint -> null (nunca un dato inventado)", async () => {
  const fetchVacio: FetchLike = async () => ({ ok: true, json: async () => [] });
  const r = await trmHoy(fetchVacio);
  assert.equal(r, null);
});

test("trmHoy: respuesta con fila de hace 6 dias -> null (se descarta por antigua)", async () => {
  const r = await trmHoy(fetchOk({ valor: 4200, vigenciadesde: "2026-09-29T00:00:00.000" }));
  assert.equal(r, null);
});

test("trmHoy: timeout simulado (fetch que lanza AbortError, como el fetch real cuando se aborta) -> null, nunca lanza", async () => {
  const fetchQueExpira: FetchLike = async () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const r = await trmHoy(fetchQueExpira);
  assert.equal(r, null);
});

test("trmHoy: fetch que rechaza (red caida) -> null, nunca lanza", async () => {
  const fetchQueFalla: FetchLike = async () => {
    throw new Error("network error");
  };
  const r = await trmHoy(fetchQueFalla);
  assert.equal(r, null);
});
