// Pruebas del canal de correo transaccional (Tarea 5, cobro real con planes, 2026-10-05).
// Mismo patron que tests/trm.test.ts: node:test, sin red real, inyectando `fetchLike`/`relayUrl`/
// `relaySecret` en vez de depender de variables de entorno.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enviarCorreo,
  firmarHmac,
  cadenaCanonicaAviso,
  sumarDiasHabiles,
  formatearFechaBogotaDDMMAAAA,
  construirCorreoConfirmacionCompra,
  construirAvisoVentaLeonardo,
  construirAvisoReembolsoLeonardo,
  construirAvisoFalloWebhookLeonardo,
  type FetchLike,
} from "../server/avisos";

// ── firmarHmac: vector fijo, verificable a mano en Apps Script (docs/relay/avisos-relay.gs) ────
// `Utilities.computeHmacSha256Signature('hola\nmundo', 'secreto-de-prueba')` convertido a hex
// (ver el comentario en avisos-relay.gs, funcion `hmacHex_`) debe dar EXACTAMENTE este valor; si
// algun dia no coincide, alguno de los dos lados cambio el algoritmo de firma sin avisar al otro.

// Vector compartido con el relay (mismo comentario y mismo valor en docs/relay/avisos-relay.gs,
// funcion `runTestHmac()`): cuerpo="hola\nmundo", secreto="secreto-de-prueba" debe dar SIEMPRE
// este hex, calculado una vez con Node `crypto` (HMAC-SHA256 es un algoritmo estandar: Apps
// Script `Utilities.computeHmacSha256Signature` da el mismo resultado byte a byte para la misma
// entrada — verificable a mano en el editor de Apps Script sin desplegar nada).
const VECTOR_HMAC_ESPERADO = "428f5d862484fd2d8551971ae00ea7fb0c4e4624b7824d7ae594ba1ebd026cab";

test("firmarHmac: vector fijo compartido con docs/relay/avisos-relay.gs", () => {
  const firma = firmarHmac("hola\nmundo", "secreto-de-prueba");
  assert.equal(firma, VECTOR_HMAC_ESPERADO);
  assert.equal(firma.length, 64, "HMAC-SHA256 en hex son 64 caracteres");
  assert.match(firma, /^[0-9a-f]{64}$/);
});

test("firmarHmac: secretos distintos dan firmas distintas para el mismo cuerpo", () => {
  const a = firmarHmac("mismo cuerpo", "secreto-A");
  const b = firmarHmac("mismo cuerpo", "secreto-B");
  assert.notEqual(a, b);
});

test("firmarHmac: cuerpos distintos dan firmas distintas con el mismo secreto", () => {
  const a = firmarHmac("cuerpo-A", "mismo-secreto");
  const b = firmarHmac("cuerpo-B", "mismo-secreto");
  assert.notEqual(a, b);
});

test("cadenaCanonicaAviso: concatena ts/para/asunto/texto separados por salto de linea", () => {
  const c = cadenaCanonicaAviso(1700000000, "a@b.com", "Asunto", "Texto del correo");
  assert.equal(c, "1700000000\na@b.com\nAsunto\nTexto del correo");
});

// ── enviarCorreo: config faltante -> false, nunca lanza, nunca registra el secreto ─────────────

test("enviarCorreo: sin relayUrl/relaySecret -> false, console.warn, nunca llama a fetch", async () => {
  let fetchLlamado = false;
  const logs: string[] = [];
  const ok = await enviarCorreo(
    { para: "comprador@test.com", asunto: "Asunto", texto: "Texto" },
    {
      relayUrl: undefined,
      relaySecret: undefined,
      fetchLike: (async () => {
        fetchLlamado = true;
        return { ok: true, status: 200, text: async () => "" };
      }) as FetchLike,
      log: (l) => logs.push(l),
    }
  );
  assert.equal(ok, false);
  assert.equal(fetchLlamado, false);
  assert.ok(logs.some((l) => l.includes("comprador@test.com")));
});

test("enviarCorreo: config completa, relay responde 200 -> true, body firmado correctamente", async () => {
  let cuerpoRecibido: any = null;
  let urlRecibida = "";
  const fetchLike: FetchLike = async (url, init) => {
    urlRecibida = url;
    cuerpoRecibido = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => "ok" };
  };
  const ahoraFija = new Date("2026-10-05T10:00:00.000Z");
  const ok = await enviarCorreo(
    { para: "comprador@test.com", asunto: "Asunto", texto: "Texto" },
    { relayUrl: "https://relay.test/exec", relaySecret: "secreto-X", fetchLike, ahora: () => ahoraFija }
  );
  assert.equal(ok, true);
  assert.equal(urlRecibida, "https://relay.test/exec");
  assert.equal(cuerpoRecibido.para, "comprador@test.com");
  assert.equal(cuerpoRecibido.asunto, "Asunto");
  assert.equal(cuerpoRecibido.texto, "Texto");
  const tsEsperado = Math.floor(ahoraFija.getTime() / 1000);
  assert.equal(cuerpoRecibido.ts, tsEsperado);
  const firmaEsperada = firmarHmac(cadenaCanonicaAviso(tsEsperado, "comprador@test.com", "Asunto", "Texto"), "secreto-X");
  assert.equal(cuerpoRecibido.firma, firmaEsperada);
});

test("enviarCorreo: relay responde error (4xx/5xx) -> false, nunca lanza", async () => {
  const fetchLike: FetchLike = async () => ({ ok: false, status: 403, text: async () => "forbidden" });
  const ok = await enviarCorreo(
    { para: "x@test.com", asunto: "a", texto: "t" },
    { relayUrl: "https://relay.test/exec", relaySecret: "s", fetchLike }
  );
  assert.equal(ok, false);
});

test("enviarCorreo: el relay falla (fetch rechaza / timeout) -> false, nunca lanza", async () => {
  const fetchLike: FetchLike = async () => {
    throw new Error("network timeout");
  };
  const ok = await enviarCorreo(
    { para: "x@test.com", asunto: "a", texto: "t" },
    { relayUrl: "https://relay.test/exec", relaySecret: "s", fetchLike }
  );
  assert.equal(ok, false);
});

test("enviarCorreo: nunca registra el secreto ni el cuerpo completo del correo en los logs", async () => {
  const logs: string[] = [];
  const fetchLike: FetchLike = async () => ({ ok: false, status: 500, text: async () => "" });
  await enviarCorreo(
    { para: "x@test.com", asunto: "Asunto secreto del cliente", texto: "Contenido privado del correo, nunca en logs" },
    { relayUrl: "https://relay.test/exec", relaySecret: "el-secreto-nunca-debe-aparecer", fetchLike, log: (l) => logs.push(l) }
  );
  for (const l of logs) {
    assert.ok(!l.includes("el-secreto-nunca-debe-aparecer"), "el secreto nunca debe aparecer en un log");
    assert.ok(!l.includes("Contenido privado"), "el cuerpo completo del correo nunca debe aparecer en un log");
  }
});

// ── sumarDiasHabiles ─────────────────────────────────────────────────────────────────────────

test("sumarDiasHabiles: 5 dias habiles desde un lunes cae en el lunes siguiente (salta el fin de semana)", () => {
  // 2026-10-05 es lunes (Bogota).
  const lunes = new Date("2026-10-05T15:00:00.000Z");
  const resultado = sumarDiasHabiles(lunes, 5);
  assert.equal(formatearFechaBogotaDDMMAAAA(resultado), "12/10/2026");
});

test("sumarDiasHabiles: 1 dia habil desde un viernes cae en lunes (nunca sabado/domingo)", () => {
  // 2026-10-02 es viernes (Bogota).
  const viernes = new Date("2026-10-02T15:00:00.000Z");
  const resultado = sumarDiasHabiles(viernes, 1);
  assert.equal(formatearFechaBogotaDDMMAAAA(resultado), "05/10/2026");
});

// ── Render de correos: contienen los campos pedidos, nunca mezclan idioma ──────────────────────

test("construirCorreoConfirmacionCompra (es): incluye plan, COP, TRM+fecha, vigencia, devolucion y enlace a terminos", () => {
  const { asunto, texto } = construirCorreoConfirmacionCompra({
    paraEmail: "comprador@test.com",
    idioma: "es",
    cop: 49102,
    trm: 3273.49,
    fechaTrm: "2026-10-03",
    fechaPago: new Date("2026-10-05T15:00:00.000Z"),
    fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
    refMp: "123456789",
    enlaceTerminos: "https://certisendpro.online/terminos",
  });
  assert.match(asunto, /Paquete/);
  assert.match(asunto, /49\.102/);
  assert.match(texto, /49\.102 COP/);
  assert.match(texto, /3273\.49/);
  assert.match(texto, /2026-10-03/);
  assert.match(texto, /05\/11\/2026/); // vigencia
  assert.match(texto, /devolución/i);
  assert.match(texto, /123456789/);
  assert.match(texto, /https:\/\/certisendpro\.online\/terminos/);
  assert.doesNotMatch(texto, /Hello,/);
});

test("construirCorreoConfirmacionCompra (en): mismo contenido, en ingles, nunca mezclado con es", () => {
  const { texto } = construirCorreoConfirmacionCompra({
    paraEmail: "buyer@test.com",
    idioma: "en",
    cop: 49102,
    trm: 3273.49,
    fechaTrm: "2026-10-03",
    fechaPago: new Date("2026-10-05T15:00:00.000Z"),
    fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
    refMp: "123456789",
    enlaceTerminos: "https://certisendpro.online/terminos",
  });
  assert.match(texto, /Hello,/);
  assert.match(texto, /refund/i);
  assert.doesNotMatch(texto, /Hola:/);
  assert.doesNotMatch(texto, /devolución/i);
});

test("construirAvisoVentaLeonardo: incluye plan, monto, uid y paymentId (sin datos de tarjeta)", () => {
  const { texto } = construirAvisoVentaLeonardo({ uid: "uid-1", paymentId: "pago-1", cop: 49102, plan: "paquete" });
  assert.match(texto, /uid-1/);
  assert.match(texto, /pago-1/);
  assert.match(texto, /49\.102/);
  assert.doesNotMatch(texto, /tarjeta|card|cvv/i);
});

test("construirAvisoReembolsoLeonardo: distingue contracargo de reembolso y si se revirtio la cuenta", () => {
  const revertido = construirAvisoReembolsoLeonardo({ uid: "u", paymentId: "p", status: "charged_back", cuentaRevertida: true });
  assert.match(revertido.asunto, /Contracargo/);
  assert.match(revertido.texto, /revirtió/);

  const noActivo = construirAvisoReembolsoLeonardo({ uid: "u", paymentId: "p", status: "refunded", cuentaRevertida: false });
  assert.match(noActivo.asunto, /Reembolso/);
  assert.match(noActivo.texto, /NO se tocó/);
});

test("construirAvisoFalloWebhookLeonardo: incluye el paymentId y el numero de fallos", () => {
  const { texto } = construirAvisoFalloWebhookLeonardo({ paymentId: "pago-9", fallosConsecutivos: 3 });
  assert.match(texto, /pago-9/);
  assert.match(texto, /3 fallos/);
});
