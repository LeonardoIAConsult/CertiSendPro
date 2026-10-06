// Pruebas de `evaluarLimite` (Tarea 12, tope global anti-inundacion de create-preference,
// 2026-10-05). Funcion PURA con reloj inyectado: corren con node:test sin esperar minutos reales
// ni arrancar Express.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarLimite, type EstadoVentana } from "../server/limitador";

const VENTANA_MS = 60_000;
const MAX = 20;

test("evaluarLimite: primera peticion (sin estado previo) siempre se permite, n=1", () => {
  const r = evaluarLimite(null, 1_000, VENTANA_MS, MAX);
  assert.equal(r.permitido, true);
  assert.deepEqual(r.estado, { n: 1, desde: 1_000 });
});

test("evaluarLimite: 20 peticiones en la misma ventana se permiten todas (el tope es 20)", () => {
  let estado: EstadoVentana | null = null;
  const ahoraBase = 10_000;
  for (let i = 0; i < 20; i++) {
    const r = evaluarLimite(estado, ahoraBase + i, VENTANA_MS, MAX);
    assert.equal(r.permitido, true, `la peticion #${i + 1} deberia permitirse`);
    estado = r.estado;
  }
  assert.equal(estado!.n, 20);
});

test("evaluarLimite: la peticion 21 en el mismo minuto se rechaza (429)", () => {
  let estado: EstadoVentana | null = null;
  const ahoraBase = 50_000;
  for (let i = 0; i < 20; i++) {
    estado = evaluarLimite(estado, ahoraBase + i, VENTANA_MS, MAX).estado;
  }
  const r21 = evaluarLimite(estado, ahoraBase + 20, VENTANA_MS, MAX);
  assert.equal(r21.permitido, false, "la peticion 21 debe rechazarse");
  assert.ok((r21.retryAfterSegundos ?? 0) > 0, "debe sugerir un Retry-After positivo");
});

test("evaluarLimite: pasada la ventana, se abre una nueva y vuelve a permitir desde 1", () => {
  const ahoraBase = 100_000;
  let estado: EstadoVentana | null = { n: 20, desde: ahoraBase };
  // La ventana dura 60_000 ms: en ahoraBase + 60_001 ya paso.
  const r = evaluarLimite(estado, ahoraBase + VENTANA_MS + 1, VENTANA_MS, MAX);
  assert.equal(r.permitido, true);
  assert.deepEqual(r.estado, { n: 1, desde: ahoraBase + VENTANA_MS + 1 });
});

test("evaluarLimite: justo en el borde de la ventana (= ventanaMs) sigue contando en la MISMA ventana", () => {
  // `ahora - desde > ventanaMs` (estrictamente mayor): exactamente `ventanaMs` despues todavia
  // es la misma ventana, no una nueva.
  const estado: EstadoVentana = { n: 20, desde: 0 };
  const r = evaluarLimite(estado, VENTANA_MS, VENTANA_MS, MAX);
  assert.equal(r.permitido, false, "en el borde exacto sigue siendo la misma ventana (ya saturada)");
});

test("evaluarLimite: no muta el estado recibido (funcion pura)", () => {
  const estadoOriginal: EstadoVentana = { n: 5, desde: 0 };
  const copia = { ...estadoOriginal };
  evaluarLimite(estadoOriginal, 100, VENTANA_MS, MAX);
  assert.deepEqual(estadoOriginal, copia, "el estado de entrada no debe modificarse");
});
