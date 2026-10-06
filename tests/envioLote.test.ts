// Medio 6 (REVISOR_EXTERNO, 2026-10-06): pausa minima entre envios reales de un lote, para no
// chocar con el limitador de /api por uid (30/min por defecto, server.ts). Logica PURA, sin
// React ni temporizadores reales — mismo patron que tests/plan.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pausaAntesDelEnvioMs, PAUSA_ENTRE_ENVIOS_MS } from "../src/utils/envioLote";

test("pausaAntesDelEnvioMs: el PRIMER envio real (0 previos) nunca espera", () => {
  assert.equal(pausaAntesDelEnvioMs(0), 0);
});

test("pausaAntesDelEnvioMs: desde el segundo envio real en adelante, espera PAUSA_ENTRE_ENVIOS_MS", () => {
  assert.equal(pausaAntesDelEnvioMs(1), PAUSA_ENTRE_ENVIOS_MS);
  assert.equal(pausaAntesDelEnvioMs(2), PAUSA_ENTRE_ENVIOS_MS);
  assert.equal(pausaAntesDelEnvioMs(149), PAUSA_ENTRE_ENVIOS_MS);
});

// Oraculo: la pausa (2200ms) debe quedar POR ENCIMA del piso que exige el limitador por uid de
// /api (30/min por defecto -> 1 cada 2000ms exactos); si alguien la bajara a 2000ms o menos,
// quedaria pegada al borde exacto de la ventana y un lote grande seguiria chocando con 429 por
// jitter de reloj. Mutacion: bajar PAUSA_ENTRE_ENVIOS_MS a 2000 o menos hace caer esta prueba.
test("PAUSA_ENTRE_ENVIOS_MS: queda por encima del piso de 2000ms (60000ms / 30 por minuto)", () => {
  assert.ok(PAUSA_ENTRE_ENVIOS_MS > 2000, `PAUSA_ENTRE_ENVIOS_MS (${PAUSA_ENTRE_ENVIOS_MS}) debe ser > 2000ms`);
});
