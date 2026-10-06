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
  /** M39: charset con el que se llamo `Utilities.computeHmacSha256Signature` en cada invocacion
   * (en orden). El .gs real SIEMPRE debe pasar `Utilities.Charset.UTF_8` (3er argumento) — sin
   * esto, un charset implicito podria dar una firma distinta para texto con tildes/ñ (ver el
   * comentario de `hmacHex_` en docs/relay/avisos-relay.gs). */
  charsetsUsados: Array<string | undefined>;
  /** M-3(b): shim de `PropertiesService` del script — expuesto para que las pruebas de
   * deduplicacion/limpieza de `idEnvio` puedan sembrar o inspeccionar entradas directamente, sin
   * depender solo de `doPost`. */
  propiedadesScript: Map<string, string>;
}

/** Crea un sandbox nuevo (cache de nonces vacia) y ejecuta avisos-relay.gs dentro de el. */
function construirSandbox(secreto: string | null): SandboxRelay {
  const cacheNonces = new Map<string, string>();
  const correosEnviados: SandboxRelay["correosEnviados"] = [];
  const charsetsUsados: SandboxRelay["charsetsUsados"] = [];

  const Utilities = {
    // M39: el .gs real referencia `Utilities.Charset.UTF_8` como 3er argumento de
    // `computeHmacSha256Signature` — sin esta propiedad en el shim, ejecutar el .gs real lanzaria
    // "Cannot read properties of undefined" en cuanto `hmacHex_` se llamara.
    Charset: { UTF_8: "UTF-8" },
    // Replica el comportamiento REAL de Apps Script: bytes CON SIGNO (-128..127), no 0..255 como
    // da Node `Buffer` por defecto — es justo lo que `hmacHex_` normaliza (ver el .gs). El 3er
    // argumento (`charset`) se REGISTRA (M39, `charsetsUsados`) para poder probar que el .gs real
    // lo manda explicito; Node ya interpreta un string JS como UTF-8 con `.update(cadena,"utf8")`
    // sin importar ese argumento, asi que no cambia el resultado — lo que prueba es que el .gs
    // SIGUE pasandolo, no que cambie el calculo.
    computeHmacSha256Signature(cadena: string, secretoFirma: string, charset?: string): number[] {
      charsetsUsados.push(charset);
      const buffer = createHmac("sha256", secretoFirma).update(cadena, "utf8").digest();
      return Array.from(buffer).map((b) => (b > 127 ? b - 256 : b));
    },
    getUuid(): string {
      return randomUUID();
    },
  };

  // M-3(b): shim CON ESTADO de `PropertiesService.getScriptProperties()` — a diferencia del
  // shim original (solo `getProperty` para el secreto), ahora tambien soporta `setProperty`/
  // `deleteProperty`/`getProperties`, que `idEnvioYaProcesado_`/`marcarIdEnvioProcesado_`/
  // `limpiarEnviosViejos_` (docs/relay/avisos-relay.gs) usan de verdad.
  const propiedadesScript = new Map<string, string>();
  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty: (key: string) =>
          key === "AVISOS_RELAY_SECRET" ? secreto : propiedadesScript.has(key) ? propiedadesScript.get(key)! : null,
        setProperty: (key: string, value: string) => {
          propiedadesScript.set(key, value);
        },
        deleteProperty: (key: string) => {
          propiedadesScript.delete(key);
        },
        getProperties: () => {
          const copia: Record<string, string> = {};
          for (const [clave, valor] of propiedadesScript) copia[clave] = valor;
          return copia;
        },
      };
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
  return { sandbox, correosEnviados, charsetsUsados, propiedadesScript };
}

/** `idEnvio` es OPCIONAL — por defecto "" (mismo default que `server/avisos.ts`, sin id
 * idempotente que deduplicar). */
function cuerpoFirmadoReal(
  secreto: string,
  datos: { ts: number; nonce: string; idEnvio?: string; para: string; asunto: string; texto: string }
) {
  const idEnvio = datos.idEnvio ?? "";
  const firma = firmarHmac(cadenaCanonicaAviso(datos.ts, datos.nonce, idEnvio, datos.para, datos.asunto, datos.texto), secreto);
  return { ...datos, idEnvio, firma };
}

function doPost(sandbox: any, cuerpo: Record<string, any>): { ok: boolean; error?: string } {
  const resultado = sandbox.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(resultado.getContent());
}

const SECRETO = "secreto-compartido-de-prueba";

// ── Vector HMAC fijo (M33): coincide con runTestHmac() del .gs ────────────────────────────────

test("M33/M-3(b) (shim Node): el vector HMAC del .gs (cadenaCanonica_ + hmacHex_) coincide con el de server/avisos.ts", () => {
  const { sandbox } = construirSandbox(SECRETO);
  const cadena = sandbox.cadenaCanonica_(1700000000, "nonce-de-prueba", "", "a@b.com", "Asunto", "Texto del correo");
  const hashGs = sandbox.hmacHex_(cadena, "secreto-de-prueba");
  const hashTs = firmarHmac(
    cadenaCanonicaAviso(1700000000, "nonce-de-prueba", "", "a@b.com", "Asunto", "Texto del correo"),
    "secreto-de-prueba"
  );
  assert.equal(hashGs, "c1422dd09b070935232f1194678b1d8aa0abddb9a4fb41bcb788129ea41c5b14");
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

// ── M39 (corrige vuelta 28, 2026-10-05): charset explicito del HMAC con un vector con tildes/ñ ───

// M-3(b) (corrige vuelta 34): `idEnvio=""` — este vector es el mismo que escribe `runTestHmac()`
// en avisos-relay.gs (sin id idempotente), por eso el valor esperado CAMBIO frente al de M39.
const VECTOR_M39 = {
  ts: 1700000000,
  nonce: "nonce-de-prueba",
  idEnvio: "",
  para: "a@b.com",
  asunto: "Asunto",
  texto: "Confirmación de compra — Año ñandú ×2",
};
const HASH_M39_ESPERADO = "1ff82e5298abc6f06614acdfff0755685d1e04448e46a6249b5510fc6f552731";

test("M39: hmacHex_ del .gs pasa Utilities.Charset.UTF_8 EXPLICITO a computeHmacSha256Signature", () => {
  const { sandbox, charsetsUsados } = construirSandbox(SECRETO);
  sandbox.hmacHex_(
    sandbox.cadenaCanonica_(VECTOR_M39.ts, VECTOR_M39.nonce, VECTOR_M39.idEnvio, VECTOR_M39.para, VECTOR_M39.asunto, VECTOR_M39.texto),
    "secreto-de-prueba"
  );
  assert.deepEqual(charsetsUsados, ["UTF-8"], "hmacHex_ debe mandar Utilities.Charset.UTF_8 como 3er argumento");
});

test("M39 (runTestHmac): el vector con tildes y ñ ('Confirmación de compra — Año ñandú ×2') da el valor fijado en avisos-relay.gs", () => {
  const { sandbox } = construirSandbox(SECRETO);
  const cadena = sandbox.cadenaCanonica_(VECTOR_M39.ts, VECTOR_M39.nonce, VECTOR_M39.idEnvio, VECTOR_M39.para, VECTOR_M39.asunto, VECTOR_M39.texto);
  const hashGs = sandbox.hmacHex_(cadena, "secreto-de-prueba");

  assert.equal(hashGs, HASH_M39_ESPERADO, "debe coincidir con el valor escrito en runTestHmac() de avisos-relay.gs");

  // Mismo valor del lado TypeScript (server/avisos.ts), con la MISMA cadena canonica — por eso una
  // peticion firmada por el backend real (texto con tildes/ñ) la acepta este .gs real.
  const hashTs = firmarHmac(
    cadenaCanonicaAviso(VECTOR_M39.ts, VECTOR_M39.nonce, VECTOR_M39.idEnvio, VECTOR_M39.para, VECTOR_M39.asunto, VECTOR_M39.texto),
    "secreto-de-prueba"
  );
  assert.equal(hashGs, hashTs, "el .gs (con charset UTF-8 explicito) y server/avisos.ts deben calcular EXACTAMENTE el mismo HMAC para texto con tildes/ñ");
});

test("M39: una peticion firmada por server/avisos.ts con asunto/texto en español (tildes/ñ) es aceptada por el doPost real del .gs", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const cuerpo = cuerpoFirmadoReal(SECRETO, {
    ts: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
    para: "comprador@test.com",
    asunto: "Confirmación de tu compra en CertiSend Pro — Paquete — $49.102 COP",
    texto: "Hola:\n\nRecibimos y confirmamos tu pago. Año ñandú ×2 — café, señal, corazón.",
  });

  const respuesta = doPost(sandbox, cuerpo);

  assert.equal(respuesta.ok, true);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].subject, "Confirmación de tu compra en CertiSend Pro — Paquete — $49.102 COP");
  assert.equal(correosEnviados[0].body, "Hola:\n\nRecibimos y confirmamos tu pago. Año ñandú ×2 — café, señal, corazón.");
});

// ── M-3(b) (corrige vuelta 34 del REVISOR_EXTERNO): deduplicacion por idEnvio en PropertiesService
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Caso real que esto previene: `enviarCorreo` (server/avisos.ts) aborta por timeout y el barrido
// reintenta el MISMO correo logico mas tarde — otra peticion, con `ts`/`nonce` NUEVOS (asi que el
// anti-replay del nonce no la detiene), pero el MISMO `idEnvio` porque es el mismo
// `paymentId:destinatario`. Sin esta deduplicacion, el comprador recibiria el acuse dos veces.

test("M-3(b): el MISMO idEnvio en dos peticiones (nonce/ts distintos, como un reintento real) -> 1 solo correo; la segunda responde ok sin reenviar", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const datosBase = { para: "comprador@test.com", asunto: "Asunto", texto: "Texto", idEnvio: "pago-1:comprador" };
  const c1 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), ...datosBase });
  const c2 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000) + 5, nonce: randomUUID(), ...datosBase });

  const r1 = doPost(sandbox, c1);
  const r2 = doPost(sandbox, c2);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true, "la segunda NO es un error: es un reintento legitimo del mismo correo");
  assert.equal((r2 as any).yaEnviado, true, "la segunda debe indicar que ya se habia enviado");
  assert.equal(correosEnviados.length, 1, "exactamente 1 correo real, aunque idEnvio llegue dos veces con nonce distinto");
});

test("M-3(b): idEnvio DISTINTO (mismo para/asunto/texto) -> las DOS se mandan (no es el mismo correo logico)", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const datosBase = { para: "comprador@test.com", asunto: "Asunto", texto: "Texto" };
  const c1 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), idEnvio: "pago-1:comprador", ...datosBase });
  const c2 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), idEnvio: "pago-2:comprador", ...datosBase });

  const r1 = doPost(sandbox, c1);
  const r2 = doPost(sandbox, c2);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(correosEnviados.length, 2);
});

test("M-3(b): idEnvio vacio ('', compatibilidad) NUNCA deduplica — dos peticiones distintas sin idEnvio se mandan las DOS", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const datosBase = { para: "comprador@test.com", asunto: "Asunto", texto: "Texto", idEnvio: "" };
  const c1 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), ...datosBase });
  const c2 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), ...datosBase });

  const r1 = doPost(sandbox, c1);
  const r2 = doPost(sandbox, c2);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(correosEnviados.length, 2, "sin idEnvio, el comportamiento es el de antes de M-3(b): nunca deduplica");
});

test("M-3(b): un idEnvio solo se marca como procesado DESPUES de un destinatario_no_esperado (un intento rechazado no bloquea el reintento correcto)", () => {
  const { sandbox, correosEnviados } = construirSandbox(SECRETO);
  const idEnvio = "pago-1:comprador";
  const c1 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000), nonce: randomUUID(), idEnvio, para: "esto-no-es-un-correo", asunto: "Asunto", texto: "Texto" });
  const r1 = doPost(sandbox, c1);
  assert.equal(r1.error, "destinatario_no_esperado");
  assert.equal(correosEnviados.length, 1, "el rechazo SI manda el aviso de 'destinatario inesperado' a Leonardo (notifyLeo_)");

  // Un segundo intento, con el MISMO idEnvio pero un destinatario valido esta vez, SI debe mandarse
  // — el primer intento nunca llego a marcar el idEnvio porque nunca llego a MailApp.sendEmail (el
  // envio REAL, no el aviso de notifyLeo_).
  const c2 = cuerpoFirmadoReal(SECRETO, { ts: Math.floor(Date.now() / 1000) + 1, nonce: randomUUID(), idEnvio, para: "comprador@test.com", asunto: "Asunto", texto: "Texto" });
  const r2 = doPost(sandbox, c2);
  assert.equal(r2.ok, true);
  assert.equal(correosEnviados.length, 2, "1 aviso de destinatario inesperado + 1 correo real al comprador (no deduplicado por el intento rechazado)");
  assert.equal(correosEnviados[1].to, "comprador@test.com");
});

test("M-3(b): limpieza simple — una entrada idEnvio de mas de 7 dias se borra al marcar un envio nuevo", () => {
  const { sandbox, propiedadesScript } = construirSandbox(SECRETO);
  const hace8Dias = Math.floor(Date.now() / 1000) - 8 * 24 * 3600;
  propiedadesScript.set("envio_pago-viejo:comprador", String(hace8Dias));

  sandbox.marcarIdEnvioProcesado_("pago-nuevo:comprador");

  assert.equal(propiedadesScript.has("envio_pago-viejo:comprador"), false, "la entrada vieja (>7 dias) debe limpiarse");
  assert.equal(propiedadesScript.has("envio_pago-nuevo:comprador"), true, "la entrada nueva SI debe quedar");
});

test("M-3(b): una entrada idEnvio de MENOS de 7 dias NO se borra al marcar un envio nuevo", () => {
  const { sandbox, propiedadesScript } = construirSandbox(SECRETO);
  const hace1Dia = Math.floor(Date.now() / 1000) - 1 * 24 * 3600;
  propiedadesScript.set("envio_pago-reciente:comprador", String(hace1Dia));

  sandbox.marcarIdEnvioProcesado_("pago-nuevo:comprador");

  assert.equal(propiedadesScript.has("envio_pago-reciente:comprador"), true, "una entrada de 1 dia no debe borrarse (el TTL es 7 dias)");
});
