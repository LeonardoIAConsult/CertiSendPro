// Cableado de rutas (correccion vuelta 33, 2026-10-06): la decision del send-email (huella ->
// 409, sin secreto -> 503) y la decision de autorizacion por version en /api/lote/iniciar se
// extrajeron a funciones PURAS con dependencias inyectadas (`decidirEnvioConHuella` en
// server/huellaLote.ts, `decidirAutorizacionLote` en server/cuentas.ts) — probadas por su cuenta
// en tests/huellaLote.test.ts y tests/autorizacionDatos.test.ts.
//
// Esta prueba cubre lo que esas dos pruebas NO pueden cubrir por si solas: que la RUTA de verdad
// (server.ts) delega en esas funciones en vez de reimplementar la logica inline. server.ts
// importa `firebase-admin`/`vite` y arranca un servidor real al importarse (`startServer()` al
// final del modulo) — no se puede importar aqui sin montar Express/Firestore reales (mismo
// patron ya aceptado en este proyecto para "M1" de tests/tareasFondo.test.ts: "nada prueba que la
// LINEA siga presente DENTRO de server.ts" se acepto como limite declarado). En vez de eso, se lee
// el CODIGO FUENTE de server.ts como texto y se confirma que las dos rutas llaman literalmente a
// las funciones ya probadas — si alguien quita esa llamada (mutacion pedida por la orden: "si se
// quita la llamada en la ruta, debe caer una prueba"), esta prueba cae.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FUENTE_SERVER = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");

test("server.ts importa decidirEnvioConHuella desde server/huellaLote", () => {
  assert.match(FUENTE_SERVER, /import\s*\{[^}]*\bdecidirEnvioConHuella\b[^}]*\}\s*from\s*"\.\/server\/huellaLote"/);
});

test("server.ts: la ruta /api/send-email llama a decidirEnvioConHuella (no reimplementa la decision inline)", () => {
  const idx = FUENTE_SERVER.indexOf('app.post("/api/send-email"');
  assert.ok(idx >= 0, "no se encontro la ruta /api/send-email en server.ts");
  const bloque = FUENTE_SERVER.slice(idx, idx + 6000);
  assert.match(bloque, /decidirEnvioConHuella\(/, "la ruta /api/send-email ya no llama a decidirEnvioConHuella");
});

test("server.ts importa decidirAutorizacionLote desde server/cuentas", () => {
  assert.match(FUENTE_SERVER, /import\s*\{[^}]*\bdecidirAutorizacionLote\b[^}]*\}\s*from\s*"\.\/server\/cuentas"/);
});

test("server.ts: la ruta /api/lote/iniciar llama a decidirAutorizacionLote (no reimplementa la comparacion de version inline)", () => {
  const idx = FUENTE_SERVER.indexOf('app.post("/api/lote/iniciar"');
  assert.ok(idx >= 0, "no se encontro la ruta /api/lote/iniciar en server.ts");
  const bloque = FUENTE_SERVER.slice(idx, idx + 6000);
  assert.match(bloque, /decidirAutorizacionLote\(/, "la ruta /api/lote/iniciar ya no llama a decidirAutorizacionLote");
});

test("server.ts importa decidirRegistroAutorizacion desde server/cuentas", () => {
  assert.match(FUENTE_SERVER, /import\s*\{[^}]*\bdecidirRegistroAutorizacion\b[^}]*\}\s*from\s*"\.\/server\/cuentas"/);
});

test("server.ts: la ruta POST /api/autorizacion-datos llama a decidirRegistroAutorizacion", () => {
  const idx = FUENTE_SERVER.indexOf('app.post("/api/autorizacion-datos"');
  assert.ok(idx >= 0, "no se encontro la ruta POST /api/autorizacion-datos en server.ts");
  const bloque = FUENTE_SERVER.slice(idx, idx + 3000);
  assert.match(bloque, /decidirRegistroAutorizacion\(/, "la ruta POST /api/autorizacion-datos ya no llama a decidirRegistroAutorizacion");
});
