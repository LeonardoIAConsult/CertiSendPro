// M33 (corrige vuelta 27, 2026-10-05) — oraculo "ejecuta la verificacion del .gs en Node con un
// shim de Utilities": en vez de solo comparar un vector HMAC a mano, este archivo EJECUTA el
// codigo real de `docs/relay/avisos-relay.gs` (via `node:vm`, sin dependencias nuevas — ya esta
// en la stdlib) dentro de un sandbox que provee shims minimos de los globals de Apps Script que
// el relay usa (`Utilities`, `PropertiesService`, `CacheService`, `MailApp`, `Logger`,
// `ContentService`, `LockService`). `Utilities.computeHmacSha256Signature` del shim replica el
// comportamiento REAL de Apps Script (bytes CON SIGNO, -128..127) para que `hmacHex_` (que
// normaliza esos bytes a 0..255 antes de convertir a hex) se ejercite de verdad, no se bypasee.
//
// Esto prueba, de punta a punta, que una peticion firmada por `server/avisos.ts`
// (`cadenaCanonicaAviso` + `firmarHmac`, el lado TypeScript que firma) es aceptada por el `doPost`
// REAL del relay (el lado Apps Script que verifica) — no dos implementaciones que casualmente
// coinciden en una prueba unitaria aislada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHmac, randomUUID } from "node:crypto";
import { firmarHmac, cadenaCanonicaAviso } from "../server/avisos";

const RUTA_GS = path.join(process.cwd(), "docs", "relay", "avisos-relay.gs");
const CODIGO_GS = readFileSync(RUTA_GS, "utf8");

interface SandboxRelay {
  sandbox: any;
  correosEnviados: Array<{ to: string; subject: string; body: string; name?: string }>;
}

/** Crea un sandbox nuevo (cache de nonces vacia) y ejecuta avisos-relay.gs dentro de el. */
function construirSandbox(secreto: string | null): SandboxRelay {
  const cacheNonces = new Map<string, string>();
  const correosEnviados: SandboxRelay["correosEnviados"] = [];

  const Utilities = {
    // Replica el comportamiento REAL de Apps Script: bytes CON SIGNO (-128..127), no 0..255 como
    // da Node `Buffer` por defecto — es justo lo que `hmacHex_` normaliza (ver el .gs).
    computeHmacSha256Signature(cadena: string, secretoFirma: string): number[] {
      const buffer = createHmac("sha256", secretoFirma).update(cadena, "utf8").digest();
      return Array.from(buffer).map((b) => (b > 127 ? b - 256 : b));
    },
    getUuid(): string {
      return randomUUID();
    },
  };

  const PropertiesService = {
    getScriptProperties() {
      return { getProperty: (key: string) => (key === "AVISOS_RELAY_SECRET" ? secreto : null) };
    },
  };

  const CacheService = {
    getScriptCache() {
      return {
        get: (clave: string) => (cacheNonces.has(clave) ? cacheNonces.get(clave)! : null),
        put: (clave: string, valor: string, _ttlSegundos: number) => {
          cacheNonces.set(clave, valor);
        },
      };
    },
  };

  const MailApp = {
    sendEmail(opts: { to: string; subject: string; body: string; name?: string }) {
      correosEnviados.push(opts);
    },
  };

  const Logger = { log: (_linea: any) => {} };

  const ContentService = {
    MimeType: { JSON: "JSON" },
    createTextOutput(texto: string) {
      return { setMimeType() { return this; }, getContent: () => texto };
    },
  };

  const LockService = {
    getScriptLock() {
      return { waitLock: (_ms: number) => {}, releaseLock: () => {} };
    },
  };

  const sandbox: Record<string, any> = {
    Utilities, PropertiesService, CacheService, MailApp, Logger, ContentService, LockService,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO_GS, sandbox, { filename: "avisos-relay.gs" });
  return { sandbox, correosEnviados };
}

function cuerpoFirmadoReal(secreto: string, datos: { ts: number; nonce: string; para: string; asunto: string; texto: string }) {
  const firma = firmarHmac(cadenaCanonicaAviso(datos.ts, datos.nonce, datos.para, datos.asunto, datos.texto), secreto);
  return { ...datos, firma };
}

function doPost(sandbox: any, cuerpo: Record<string, any>): { ok: boolean; error?: string } {
  const resultado = sandbox.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(resultado.getContent());
}

const SECRETO = "secreto-compartido-de-prueba";

// ── Vector HMAC fijo (M33): coincide con runTestHmac() del .gs ────────────────────────────────

test("M33 (shim Node): el vector HMAC del .gs (cadenaCanonica_ + hmacHex_) coincide con el de server/avisos.ts", () => {
  const { sandbox } = construirSandbox(SECRETO);
  const cadena = sandbox.cadenaCanonica_(1700000000, "nonce-de-prueba", "a@b.com", "Asunto", "Texto del correo");
  const hashGs = sandbox.hmacHex_(cadena, "secreto-de-prueba");
  const hashTs = firmarHmac(
    cadenaCanonicaAviso(1700000000, "nonce-de-prueba", "a@b.com", "Asunto", "Texto del correo"),
    "secreto-de-prueba"
  );
  assert.equal(hashGs, "20f0e9b0af94d0e8d7dd20cc2b7199663ef20eadfc8ea3c2c1055f8ead6341a1");
  assert.equal(hashGs, hashTs, "el .gs y server/avisos.ts deben calcular EXACTAMENTE el mismo HMAC para la misma entrada");
});

// ── Integracion de punta a punta: una peticion firmada por TypeScript la acepta el .gs real ────

test("M33 (shim Node): una peticion firmada por server/avisos.ts es aceptada por el doPost real del .gs", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "comprador@test.com",
    asunto: "Confirmación de tu compra",
    texto: "Texto del correo de prueba",
  });

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.ok, true);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].to, "comprador@test.com");
  assert.equal(correosEnviados[0].body, "Texto del correo de prueba");
});

// ── M33 (1): firma invalida -> generico, NUNCA notifyLeo_, NUNCA se envia nada ──────────────────

test("M33: firma incorrecta -> solicitud_invalida, MailApp nunca se llama (ni el correo real ni notifyLeo_)", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "comprador@test.com",
    asunto: "Asunto",
    texto: "Texto",
  });
  cuerpo.firma = cuerpo.firma.slice(0, -1) + (cuerpo.firma.endsWith("0") ? "1" : "0"); // corrompe 1 caracter

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.ok, false);
  assert.equal(respuesta.error, "solicitud_invalida");
  assert.equal(correosEnviados.length, 0, "ni el correo real ni un aviso a Leonardo deben salir ante firma invalida");
});

test("M33: secreto no configurado en el relay -> toda firma es invalida, solicitud_invalida, nunca se envia", () => {
  const { sandbox, correosEnviados } = construirSandbox(null); // CONFIG.SECRET_PROPERTY ausente
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "comprador@test.com",
    asunto: "Asunto",
    texto: "Texto",
  });

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.error, "solicitud_invalida");
  assert.equal(correosEnviados.length, 0);
});

test("M33: campos faltantes (sin nonce) -> solicitud_invalida, nunca se evalua la firma", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const respuesta = doPost(sandbox, { para: "x@test.com", asunto: "a", texto: "t", ts: Math.floor(Date.now() / 1000), firma: "loquesea" });
  assert.equal(respuesta.error, "solicitud_invalida");
  assert.equal(correosEnviados.length, 0);
});

// ── M33 (antigüedad): timestamp vencido (>5 min) -> solicitud_invalida ─────────────────────────

test("M33: timestamp con mas de 5 minutos de antiguedad -> solicitud_invalida, nunca se envia", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const tsViejo = Math.floor(Date.now() / 1000) - 6 * 60; // 6 minutos
  const cuerpo = cuerpoFirmadoReal(SECRETO, { ts: tsViejo, nonce: randomUUID(), para: "comprador@test.com", asunto: "Asunto", texto: "Texto" });

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.error, "solicitud_invalida");
  assert.equal(correosEnviados.length, 0);
});

// ── M33 (2): nonce anti-repeticion — la MISMA peticion firmada dos veces -> la segunda rechazada ──

test("M33: la MISMA peticion firmada (mismo nonce) enviada dos veces -> la segunda se rechaza (replay), sin notifyLeo_", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "comprador@test.com",
    asunto: "Asunto",
    texto: "Texto",
  });

  const r1 = doPost(sandbox, cuerpo);
  const r2 = doPost(sandbox, cuerpo); // exactamente el mismo cuerpo, mismo nonce — un replay

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "solicitud_invalida");
  assert.equal(correosEnviados.length, 1, "solo el primer intento debe mandar el correo; el replay no manda nada");
});

test("M33: dos peticiones firmadas con NONCES DISTINTOS (aunque mismo para/asunto/texto) se procesan las DOS", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const datosBase = { para: "comprador@test.com", asunto: "Asunto", texto: "Texto" };
  const c1 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), ...datosBase });
  const c2 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), ...datosBase });

  const r1 = doPost(sandbox, c1);
  const r2 = doPost(sandbox, c2);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(correosEnviados.length, 2);
});

// ── M33 (orden nuevo): destinatario inesperado CON firma valida -> SI avisa a Leonardo ─────────
// Unico caso donde notifyLeo_ SI debe llamarse: la peticion ya esta autenticada (firma+antiguedad+
// nonce validos), asi que un destinatario raro es un bug propio, no un ataque.

test("M33: destinatario invalido CON firma valida -> destinatario_no_esperado y SI avisa a Leonardo (unico caso que notifica)", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "esto-no-es-un-correo",
    asunto: "Asunto",
    texto: "Texto",
  });

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.ok, false);
  assert.equal(respuesta.error, "destinatario_no_esperado");
  assert.equal(correosEnviados.length, 1, "el UNICO correo que sale es el aviso a Leonardo, nunca el correo real");
  assert.equal(correosEnviados[0].to, "contacto@leonardoantolinez.com");
  assert.match(correosEnviados[0].subject, /destinatario inesperado/);
});

// ── El bug original que arregla M33: firma invalida Y destinatario inesperado A LA VEZ ─────────
// Antes de M33, `destinatarioEsperado_` se comprobaba ANTES de la firma: una peticion SIN firma
// valida pero con un `para` "raro" ya disparaba `notifyLeo_`. Esta prueba junta las dos
// condiciones a la vez para demostrar que, con el orden nuevo, la firma invalida gana SIEMPRE —
// nunca se llega a mirar el destinatario, y nunca se avisa a Leonardo.

test("M33 (el bug original): firma invalida CON destinatario inesperado -> solicitud_invalida, NUNCA notifyLeo_ (la firma se mira primero)", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "esto-no-es-un-correo", // destinatario inesperado
    asunto: "Asunto",
    texto: "Texto",
  });
  cuerpo.firma = "firma-completamente-inventada-sin-el-secreto"; // firma invalida

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.error, "solicitud_invalida", "la firma invalida debe ganar, no 'destinatario_no_esperado'");
  assert.equal(correosEnviados.length, 0, "ni el correo real ni notifyLeo_ deben salir");
});

// ── Comparacion en tiempo constante (M33): sigue siendo correcta, no solo "rapida" ─────────────

test("M33: igualesEnTiempoConstante_ del .gs es una comparacion EXACTA (no solo longitud ni prefijo)", () => {
  const { sandbox } = construirSandbox(SECRETO);
  assert.equal(sandbox.igualesEnTiempoConstante_("abc123", "abc123"), true);
  assert.equal(sandbox.igualesEnTiempoConstante_("abc123", "abc124"), false, "un solo caracter distinto al final debe fallar");
  assert.equal(sandbox.igualesEnTiempoConstante_("abc123", "abc1234"), false, "longitudes distintas nunca son iguales");
  assert.equal(sandbox.igualesEnTiempoConstante_("xbc123", "abc123"), false, "un caracter distinto al INICIO tambien debe fallar (nunca corta temprano)");
});
