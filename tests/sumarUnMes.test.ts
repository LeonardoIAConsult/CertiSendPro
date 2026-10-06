// Pruebas de `sumarUnMes` (vuelta 22: debe sumar el mes en el CALENDARIO DE BOGOTA, no en UTC, y
// si el dia de origen no existe en el mes destino, quedarse en el ULTIMO dia de ese mes — nunca
// desbordar al mes siguiente como hace `Date.setUTCMonth` con dias como 31). Corren con el test
// runner nativo de Node (node:test) via tsx, sin red ni Firestore; se exige correrlas con
// TZ=UTC para demostrar que el resultado NO depende de la zona del proceso (lee America/Bogota
// explicitamente via Intl, nunca la zona local del runtime).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumarUnMes } from "../server/cuentas";

/** Fecha/hora de Bogota (UTC-5 fijo) expresada como instante UTC real, para construir los casos
 * de la tabla sin tener que calcular el offset a mano en cada test. */
function bogota(anio: number, mes1a12: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(Date.UTC(anio, mes1a12 - 1, dia, hora + 5, minuto, 0));
}

/** Año/mes/dia/hora/minuto en el calendario de Bogota del resultado, para comparar contra la
 * tabla sin depender de la zona del proceso que corre la prueba (TZ=UTC en el oraculo). */
function enBogota(fecha: Date): { anio: number; mes: number; dia: number; hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { anio: n("year"), mes: n("month"), dia: n("day"), hora: n("hour"), minuto: n("minute") };
}

// ── Tabla del oraculo ────────────────────────────────────────────────────────────────────────

test("31-ene-2026 12:00 Bogota + 1 mes -> 28-feb-2026 12:00 Bogota (2026 no es bisiesto)", () => {
  const r = enBogota(sumarUnMes(bogota(2026, 1, 31, 12, 0)));
  assert.deepEqual(r, { anio: 2026, mes: 2, dia: 28, hora: 12, minuto: 0 });
});

test("31-ene-2026 21:30 Bogota + 1 mes -> 28-feb-2026 21:30 Bogota (hora tardia, cruza a 02:30 UTC del dia siguiente)", () => {
  // 21:30 Bogota del 31-ene es ya 02:30 UTC del 1-feb: si el calculo mirara el calendario UTC en
  // vez del de Bogota, partiria de "1-feb" y el resultado se correria un dia.
  const origen = bogota(2026, 1, 31, 21, 30);
  assert.equal(origen.toISOString().slice(0, 10), "2026-02-01", "el instante UTC ya es 1-feb (control del caso)");
  const r = enBogota(sumarUnMes(origen));
  assert.deepEqual(r, { anio: 2026, mes: 2, dia: 28, hora: 21, minuto: 30 });
});

test("30-ene-2026 + 1 mes -> 28-feb-2026 (clamp: febrero de 2026 no tiene 30)", () => {
  const r = enBogota(sumarUnMes(bogota(2026, 1, 30, 10, 0)));
  assert.deepEqual(r, { anio: 2026, mes: 2, dia: 28, hora: 10, minuto: 0 });
});

test("31-mar-2026 20:00 Bogota + 1 mes -> 30-abr-2026 20:00 Bogota (clamp: abril tiene 30 dias)", () => {
  const r = enBogota(sumarUnMes(bogota(2026, 3, 31, 20, 0)));
  assert.deepEqual(r, { anio: 2026, mes: 4, dia: 30, hora: 20, minuto: 0 });
});

test("31-ene-2028 + 1 mes -> 29-feb-2028 (año bisiesto: febrero SI tiene 29)", () => {
  assert.equal(2028 % 4, 0, "2028 es bisiesto (control del caso)");
  const r = enBogota(sumarUnMes(bogota(2028, 1, 31, 9, 0)));
  assert.deepEqual(r, { anio: 2028, mes: 2, dia: 29, hora: 9, minuto: 0 });
});

// ── Casos adicionales: diciembre cruza de año; un mes que SI tiene el mismo dia no se clampa ──

test("31-dic-2026 + 1 mes -> 31-ene-2027 (cruce de año, enero si tiene 31)", () => {
  const r = enBogota(sumarUnMes(bogota(2026, 12, 31, 8, 0)));
  assert.deepEqual(r, { anio: 2027, mes: 1, dia: 31, hora: 8, minuto: 0 });
});

test("15-jun-2026 + 1 mes -> 15-jul-2026 (dia que existe en ambos meses: sin clamp)", () => {
  const r = enBogota(sumarUnMes(bogota(2026, 6, 15, 14, 45)));
  assert.deepEqual(r, { anio: 2026, mes: 7, dia: 15, hora: 14, minuto: 45 });
});
