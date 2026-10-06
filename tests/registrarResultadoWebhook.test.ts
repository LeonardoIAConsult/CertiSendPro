// Pruebas de `registrarResultadoWebhook` (Tarea 5, requisito "vuelta 22" — aviso a Leonardo
// cuando el webhook falla 3 veces seguidas del mismo paymentId, con antirrepeticion). Funcion
// PURA (sin Map, sin tiempo real): server.ts guarda el estado devuelto en un
// `Map<paymentId, EstadoFallosWebhook>`, probado aqui simulando la secuencia a mano.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registrarResultadoWebhook, type EstadoFallosWebhook } from "../server/webhook";

test("registrarResultadoWebhook: 1er y 2do fallo (httpStatus>=500) -> nunca avisa (umbral=3)", () => {
  const r1 = registrarResultadoWebhook(undefined, 500);
  assert.equal(r1.estado.fallos, 1);
  assert.equal(r1.debeAvisar, false);

  const r2 = registrarResultadoWebhook(r1.estado, 500);
  assert.equal(r2.estado.fallos, 2);
  assert.equal(r2.debeAvisar, false);
});

test("registrarResultadoWebhook: el 3er fallo SEGUIDO -> debeAvisar=true, exactamente ahi", () => {
  let estado: EstadoFallosWebhook | undefined;
  ({ estado } = registrarResultadoWebhook(estado, 500));
  ({ estado } = registrarResultadoWebhook(estado, 500));
  const r3 = registrarResultadoWebhook(estado, 500);
  assert.equal(r3.estado.fallos, 3);
  assert.equal(r3.debeAvisar, true);
});

test("registrarResultadoWebhook: antirrepeticion — el 4to, 5to... fallo de la MISMA racha ya NO avisa otra vez", () => {
  let estado: EstadoFallosWebhook | undefined;
  for (let i = 0; i < 2; i++) ({ estado } = registrarResultadoWebhook(estado, 500));
  const r3 = registrarResultadoWebhook(estado, 500); // avisa aqui
  assert.equal(r3.debeAvisar, true);
  const r4 = registrarResultadoWebhook(r3.estado, 500);
  const r5 = registrarResultadoWebhook(r4.estado, 500);
  assert.equal(r4.debeAvisar, false);
  assert.equal(r5.debeAvisar, false);
  assert.equal(r4.estado.avisado, true);
  assert.equal(r5.estado.avisado, true);
});

test("registrarResultadoWebhook: un exito (httpStatus<500) resetea la racha a 0/avisado=false", () => {
  let estado: EstadoFallosWebhook | undefined;
  for (let i = 0; i < 3; i++) ({ estado } = registrarResultadoWebhook(estado, 500));
  assert.equal(estado!.fallos, 3);

  const exito = registrarResultadoWebhook(estado, 200);
  assert.equal(exito.estado.fallos, 0);
  assert.equal(exito.estado.avisado, false);
  assert.equal(exito.debeAvisar, false);
});

test("registrarResultadoWebhook: tras un reseteo por exito, una NUEVA racha de 3 fallos vuelve a avisar", () => {
  let estado: EstadoFallosWebhook | undefined;
  for (let i = 0; i < 3; i++) ({ estado } = registrarResultadoWebhook(estado, 500));
  ({ estado } = registrarResultadoWebhook(estado, 200)); // exito: resetea
  for (let i = 0; i < 2; i++) ({ estado } = registrarResultadoWebhook(estado, 500));
  const r3 = registrarResultadoWebhook(estado, 500);
  assert.equal(r3.estado.fallos, 3);
  assert.equal(r3.debeAvisar, true, "una racha NUEVA (tras exito) debe poder avisar de nuevo");
});

test("registrarResultadoWebhook: httpStatus 429/404 (no transitorio, <500) cuenta como exito para esta racha", () => {
  const r = registrarResultadoWebhook(undefined, 404);
  assert.equal(r.estado.fallos, 0);
  assert.equal(r.debeAvisar, false);
});
