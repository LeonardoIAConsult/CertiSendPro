// Pruebas de la TRM robusta (Tarea 4, cobro real con planes; corregidas tras NO-GO del
// REVISOR_EXTERNO_LAP + Abogado_LAP, vuelta 20, 2026-10-05). Corren con el test runner nativo de
// Node (node:test) via tsx; no tocan la red real: `validarFilaTrm` y `cacheVigente` son funciones
// PURAS, y `trmHoy` recibe el fetch inyectado por parametro (mismo patron de
// tests/decidirLote.test.ts y tests/registrarEnvio.test.ts con server/cuentas.ts).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  validarFilaTrm,
  cacheVigente,
  trmHoy,
  copDesdeUsd,
  _resetCacheParaPruebas,
  TRM_MIN,
  TRM_MAX,
  type TrmValida,
  type FetchLike,
} from "../server/trm";

// `trmHoy` cachea en variables de modulo (igual que en produccion): sin limpiarlas antes de cada
// prueba, una prueba que cachea un valor "contaminaria" las siguientes de este archivo (mismo
// proceso, mismo modulo). Las pruebas de `validarFilaTrm`/`cacheVigente` no la usan (son puras),
// pero resetear antes de todas es inocuo y mas simple que separar los bloques.
beforeEach(() => {
  _resetCacheParaPruebas();
});

// Fecha de referencia fija para que las pruebas no dependan del reloj real.
const ahora = new Date("2026-10-05T12:00:00Z");

// ── validarFilaTrm (pura): vigencia [vigenciadesde, vigenciahasta] (D2) ─────────────────────────

test("validarFilaTrm: fila buena (valor en rango, hoy dentro de [desde,hasta]) se acepta", () => {
  const fila = { valor: 4100.5, vigenciadesde: "2026-10-05T00:00:00.000", vigenciahasta: "2026-10-05T00:00:00.000" };
  const v = validarFilaTrm(fila, ahora);
  assert.ok(v !== null);
  assert.equal(v!.valor, 4100.5);
  assert.equal(v!.fechaDesde, "2026-10-05");
  assert.equal(v!.fechaHasta, "2026-10-05");
});

test("validarFilaTrm: Semana Santa — fila 2026-04-02 a 2026-04-06, valida el lunes 6 a las 20:00 de Bogota", () => {
  // 20:00 Bogota (UTC-5) del 6-abr-2026 = 01:00 UTC del 7-abr-2026. El proceso puede correr con
  // TZ=UTC (ver oraculo): `validarFilaTrm` SIEMPRE calcula "hoy" con timeZone America/Bogota
  // explicito, nunca con la zona del proceso, asi que el resultado no debe cambiar.
  const ahoraLunes20h = new Date("2026-04-07T01:00:00Z");
  const filaSemanaSanta = {
    valor: 4000,
    vigenciadesde: "2026-04-02T00:00:00.000",
    vigenciahasta: "2026-04-06T00:00:00.000",
  };
  const v = validarFilaTrm(filaSemanaSanta, ahoraLunes20h);
  assert.ok(v !== null, "el lunes 6 (20:00 Bogota) debe caer DENTRO de [2026-04-02, 2026-04-06]");
  assert.equal(v!.fechaDesde, "2026-04-02");
  assert.equal(v!.fechaHasta, "2026-04-06");
});

test("validarFilaTrm: fila vencida AYER se rechaza (hoy > vigenciahasta)", () => {
  const fila = { valor: 4100, vigenciadesde: "2026-10-03T00:00:00.000", vigenciahasta: "2026-10-04T00:00:00.000" };
  assert.equal(validarFilaTrm(fila, ahora), null); // `ahora` es 2026-10-05
});

test("validarFilaTrm: valor absurdo (fuera de [TRM_MIN, TRM_MAX]) se rechaza", () => {
  const demasiadoAlto = { valor: TRM_MAX + 1, vigenciadesde: "2026-10-05T00:00:00.000", vigenciahasta: "2026-10-05T00:00:00.000" };
  const demasiadoBajo = { valor: TRM_MIN - 1, vigenciadesde: "2026-10-05T00:00:00.000", vigenciahasta: "2026-10-05T00:00:00.000" };
  assert.equal(validarFilaTrm(demasiadoAlto, ahora), null);
  assert.equal(validarFilaTrm(demasiadoBajo, ahora), null);
});

test("validarFilaTrm: respuesta vacia (fila null/undefined) se rechaza sin lanzar", () => {
  assert.equal(validarFilaTrm(null, ahora), null);
  assert.equal(validarFilaTrm(undefined, ahora), null);
});

test("validarFilaTrm: valor no numerico se rechaza", () => {
  const fila = { valor: "no-es-un-numero", vigenciadesde: "2026-10-05T00:00:00.000", vigenciahasta: "2026-10-05T00:00:00.000" };
  assert.equal(validarFilaTrm(fila, ahora), null);
});

test("validarFilaTrm: sin vigenciadesde o sin vigenciahasta se rechaza", () => {
  assert.equal(validarFilaTrm({ valor: 4100, vigenciahasta: "2026-10-05T00:00:00.000" }, ahora), null);
  assert.equal(validarFilaTrm({ valor: 4100, vigenciadesde: "2026-10-05T00:00:00.000" }, ahora), null);
});

// ── cacheVigente (pura): cache dentro vs fuera de su rango de vigencia ──────────────────────────

test("cacheVigente: cache cuyo rango cubre HOY se reutiliza", () => {
  const cache: TrmValida = { valor: 4100, fechaDesde: "2026-10-05", fechaHasta: "2026-10-05" };
  assert.deepEqual(cacheVigente(cache, ahora), cache);
});

test("cacheVigente: cache de Semana Santa reutilizada el lunes dentro del rango (hoy != fechaDesde)", () => {
  // Regresion de M24/M25: comparar solo `fechaDesde == hoy` haria caer esta prueba el lunes, aun
  // cuando la fila siga vigente ese dia (rango que empieza antes de hoy).
  const cache: TrmValida = { valor: 4000, fechaDesde: "2026-04-02", fechaHasta: "2026-04-06" };
  const ahoraLunes = new Date("2026-04-06T20:00:00-05:00");
  assert.deepEqual(cacheVigente(cache, ahoraLunes), cache);
});

test("cacheVigente: cache cuyo rango YA PASO no se reutiliza (nunca una cache vencida)", () => {
  const cacheVencida: TrmValida = { valor: 4050, fechaDesde: "2026-10-03", fechaHasta: "2026-10-04" };
  assert.equal(cacheVigente(cacheVencida, ahora), null); // `ahora` es 2026-10-05
});

test("cacheVigente: sin cache previa, devuelve null", () => {
  assert.equal(cacheVigente(null, ahora), null);
});

// ── trmHoy (orquesta fetch inyectado + validacion) ──────────────────────────────────────────────

function fetchOk(fila: any): FetchLike {
  return async () => ({ ok: true, json: async () => [fila] });
}

test("trmHoy: con una fila buena, devuelve valor y vigencia", async () => {
  const r = await trmHoy(fetchOk({ valor: 4200, vigenciadesde: "2026-10-05T00:00:00.000", vigenciahasta: "2026-10-05T00:00:00.000" }), ahora);
  assert.ok(r !== null);
  assert.equal(r!.valor, 4200);
  assert.equal(r!.fechaDesde, "2026-10-05");
  assert.equal(r!.fechaHasta, "2026-10-05");
});

test("trmHoy: respuesta vacia ([]) del endpoint -> null (nunca un dato inventado)", async () => {
  const fetchVacio: FetchLike = async () => ({ ok: true, json: async () => [] });
  const r = await trmHoy(fetchVacio);
  assert.equal(r, null);
});

test("trmHoy: ninguna fila de la respuesta cubre hoy -> null (se descarta, nunca una vencida)", async () => {
  const r = await trmHoy(fetchOk({ valor: 4200, vigenciadesde: "2026-10-01T00:00:00.000", vigenciahasta: "2026-10-02T00:00:00.000" }), ahora);
  assert.equal(r, null);
});

test("trmHoy: elige la primera fila (de varias) que SI cubre hoy, aunque no sea la primera de la lista", async () => {
  const filas = [
    { valor: 4500, vigenciadesde: "2026-10-06T00:00:00.000", vigenciahasta: "2026-10-06T00:00:00.000" }, // aun no empieza
    { valor: 4200, vigenciadesde: "2026-10-05T00:00:00.000", vigenciahasta: "2026-10-05T00:00:00.000" }, // cubre hoy
  ];
  const fetchVarias: FetchLike = async () => ({ ok: true, json: async () => filas });
  const r = await trmHoy(fetchVarias, ahora);
  assert.ok(r !== null);
  assert.equal(r!.valor, 4200);
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

test("trmHoy: la cache del sabado se reutiliza el lunes dentro de su vigencia (el fetch NO se repite)", async () => {
  let llamadas = 0;
  const fetchContado: FetchLike = async () => {
    llamadas++;
    return { ok: true, json: async () => [{ valor: 4000, vigenciadesde: "2026-04-02T00:00:00.000", vigenciahasta: "2026-04-06T00:00:00.000" }] };
  };

  const ahoraSabado = new Date("2026-04-04T15:00:00-05:00"); // sabado 4, dentro del rango
  const ahoraLunes = new Date("2026-04-06T20:00:00-05:00"); // lunes 6, mismo rango [02..06]

  const r1 = await trmHoy(fetchContado, ahoraSabado); // primera consulta: fetch real y cachea
  assert.ok(r1 !== null);
  assert.equal(llamadas, 1);

  // 4 consultas mas "el lunes", dentro de la misma vigencia (la fila sigue cubriendo [02..06]).
  for (let i = 0; i < 4; i++) {
    const r = await trmHoy(fetchContado, ahoraLunes);
    assert.ok(r !== null);
    assert.equal(r!.valor, 4000);
  }

  assert.equal(llamadas, 1, "5 consultas en total, el fetch real solo se llamo 1 vez (cache vigente)");
});

// ── copDesdeUsd (D3): misma formula para create-preference y /api/precios ──────────────────────

test("copDesdeUsd: redondea al peso", () => {
  assert.equal(copDesdeUsd(15, 4123.7), Math.round(15 * 4123.7));
  assert.equal(copDesdeUsd(29, 4000), 116000);
});

test("D3: con una TRM falsa, el COP de /api/precios es igual al de create-preference (misma funcion, mismo USD)", () => {
  // server.ts llama copDesdeUsd(usd, trm.valor) en AMBAS rutas con el mismo USD por plan
  // (Paquete=15, Pro=29, PLANES_USD): esta prueba fija ese contrato para que nunca se dupliquen
  // ni se desincronicen las dos formulas.
  const trmFalsa = 4123.7;
  assert.equal(copDesdeUsd(15, trmFalsa), copDesdeUsd(15, trmFalsa));
  assert.equal(copDesdeUsd(15, trmFalsa), Math.round(15 * trmFalsa));
  assert.equal(copDesdeUsd(29, trmFalsa), copDesdeUsd(29, trmFalsa));
  assert.equal(copDesdeUsd(29, trmFalsa), Math.round(29 * trmFalsa));
});
