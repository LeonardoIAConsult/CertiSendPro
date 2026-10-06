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
  construirAvisoBloqueoProveedorLeonardo,
  construirAvisoReversionComprador,
  tienePlaceholderPendiente,
  proveedorConfigurado,
  relayConfigurado,
  PROVEEDOR_NOMBRE,
  PROVEEDOR_TELEFONO,
  PROVEEDOR_CORREO,
  type FetchLike,
} from "../server/avisos";

// ── firmarHmac: vector fijo, verificable a mano en Apps Script (docs/relay/avisos-relay.gs) ────
// Primitiva de bajo nivel (sin pasar por `cadenaCanonicaAviso`): dado el mismo texto y secreto,
// siempre el mismo HMAC-SHA256 en hex. No cambia con M33 (el algoritmo de firma no cambio, solo
// el CONTENIDO de la cadena que se firma — ver el vector de `cadenaCanonicaAviso` mas abajo, que
// SI es el que se comparte con `runTestHmac()` del relay).
const VECTOR_HMAC_ESPERADO = "428f5d862484fd2d8551971ae00ea7fb0c4e4624b7824d7ae594ba1ebd026cab";

test("firmarHmac: vector fijo compartido con docs/relay/avisos-relay.gs", () => {
  const firma = firmarHmac("hola\nmundo", "secreto-de-prueba");
  assert.equal(firma, VECTOR_HMAC_ESPERADO);
  assert.equal(firma.length, 64, "HMAC-SHA256 en hex son 64 caracteres");
  assert.match(firma, /^[0-9a-f]{64}$/);
});

// ── M33: vector de la cadena canonica COMPLETA (con nonce) — el que verifica `runTestHmac()` del
// relay (docs/relay/avisos-relay.gs) y tests/relayGs.test.ts ejecutando el .gs real en Node.
// M-3(b) (corrige vuelta 34): la cadena ahora incluye `idEnvio` entre `nonce` y `para` — este
// vector usa `idEnvio=""` (sin id idempotente), por lo que el valor esperado CAMBIO frente al que
// probaba M33. ───────────────────────────────────────────────────────────────────────────────

const VECTOR_HMAC_CANONICA_ESPERADO = "c1422dd09b070935232f1194678b1d8aa0abddb9a4fb41bcb788129ea41c5b14";

test("cadenaCanonicaAviso + firmarHmac (M33, con nonce; M-3(b), con idEnvio): vector fijo compartido con runTestHmac() del relay", () => {
  const cadena = cadenaCanonicaAviso(1700000000, "nonce-de-prueba", "", "a@b.com", "Asunto", "Texto del correo");
  const firma = firmarHmac(cadena, "secreto-de-prueba");
  assert.equal(firma, VECTOR_HMAC_CANONICA_ESPERADO);
});

test("cadenaCanonicaAviso + firmarHmac: con idEnvio NO vacio, la firma cambia (es parte de lo firmado)", () => {
  const cadena = cadenaCanonicaAviso(1700000000, "nonce-de-prueba", "pago-1:comprador", "a@b.com", "Asunto", "Texto del correo");
  const firma = firmarHmac(cadena, "secreto-de-prueba");
  assert.equal(firma, "513573d306f7729dc045b022687414043bbdd20da254b16c003e4795514374c5");
  assert.notEqual(firma, VECTOR_HMAC_CANONICA_ESPERADO);
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

test("cadenaCanonicaAviso: concatena ts/nonce/idEnvio/para/asunto/texto separados por salto de linea", () => {
  const c = cadenaCanonicaAviso(1700000000, "nonce-1", "pago-1:comprador", "a@b.com", "Asunto", "Texto del correo");
  assert.equal(c, "1700000000\nnonce-1\npago-1:comprador\na@b.com\nAsunto\nTexto del correo");
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

test("enviarCorreo: config completa, relay responde 200 -> true, body firmado correctamente (incluye nonce)", async () => {
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
    {
      relayUrl: "https://relay.test/exec",
      relaySecret: "secreto-X",
      fetchLike,
      ahora: () => ahoraFija,
      generarNonce: () => "nonce-fijo-de-prueba",
    }
  );
  assert.equal(ok, true);
  assert.equal(urlRecibida, "https://relay.test/exec");
  assert.equal(cuerpoRecibido.para, "comprador@test.com");
  assert.equal(cuerpoRecibido.asunto, "Asunto");
  assert.equal(cuerpoRecibido.texto, "Texto");
  assert.equal(cuerpoRecibido.nonce, "nonce-fijo-de-prueba");
  assert.equal(cuerpoRecibido.idEnvio, "", "sin idEnvio en DatosCorreo, el cuerpo manda cadena vacia (nunca undefined)");
  const tsEsperado = Math.floor(ahoraFija.getTime() / 1000);
  assert.equal(cuerpoRecibido.ts, tsEsperado);
  const firmaEsperada = firmarHmac(
    cadenaCanonicaAviso(tsEsperado, "nonce-fijo-de-prueba", "", "comprador@test.com", "Asunto", "Texto"),
    "secreto-X"
  );
  assert.equal(cuerpoRecibido.firma, firmaEsperada);
});

test("enviarCorreo: con idEnvio en DatosCorreo, se incluye en el cuerpo y en la firma (M-3(b))", async () => {
  let cuerpoRecibido: any = null;
  const fetchLike: FetchLike = async (_url, init) => {
    cuerpoRecibido = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => "ok" };
  };
  const ahoraFija = new Date("2026-10-05T10:00:00.000Z");
  await enviarCorreo(
    { para: "comprador@test.com", asunto: "Asunto", texto: "Texto", idEnvio: "pago-1:comprador" },
    { relayUrl: "https://relay.test/exec", relaySecret: "secreto-X", fetchLike, ahora: () => ahoraFija, generarNonce: () => "nonce-fijo-de-prueba" }
  );
  assert.equal(cuerpoRecibido.idEnvio, "pago-1:comprador");
  const tsEsperado = Math.floor(ahoraFija.getTime() / 1000);
  const firmaEsperada = firmarHmac(
    cadenaCanonicaAviso(tsEsperado, "nonce-fijo-de-prueba", "pago-1:comprador", "comprador@test.com", "Asunto", "Texto"),
    "secreto-X"
  );
  assert.equal(cuerpoRecibido.firma, firmaEsperada);
});

test("enviarCorreo: sin generarNonce inyectado, genera un nonce real distinto en cada llamada", async () => {
  const nonces: string[] = [];
  const fetchLike: FetchLike = async (_url, init) => {
    nonces.push(JSON.parse(init.body).nonce);
    return { ok: true, status: 200, text: async () => "ok" };
  };
  await enviarCorreo({ para: "x@test.com", asunto: "a", texto: "t" }, { relayUrl: "https://relay.test/exec", relaySecret: "s", fetchLike });
  await enviarCorreo({ para: "x@test.com", asunto: "a", texto: "t" }, { relayUrl: "https://relay.test/exec", relaySecret: "s", fetchLike });
  assert.equal(nonces.length, 2);
  assert.notEqual(nonces[0], nonces[1]);
  assert.ok(nonces[0] && nonces[1]);
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

test("sumarDiasHabiles: 5 dias habiles desde un lunes salta el fin de semana Y el festivo que cae en medio (M36(3))", () => {
  // 2026-10-05 es lunes (Bogota). Antes de M36(3) (solo fin de semana) el resultado era 12-oct;
  // pero 12-oct-2026 es "Dia de la Raza" (festivo trasladable, YA cae en lunes ese año — ver
  // server/festivosColombia.ts/tests/festivosColombia.test.ts), asi que el 5to dia habil real cae
  // un dia despues: mar6, mie7, jue8, vie9 (4 dias) -> sab10/dom11 (fin de semana) -> lun12
  // (FESTIVO, no cuenta) -> mar13 (5to dia habil).
  const lunes = new Date("2026-10-05T15:00:00.000Z");
  const resultado = sumarDiasHabiles(lunes, 5);
  assert.equal(formatearFechaBogotaDDMMAAAA(resultado), "13/10/2026");
});

test("sumarDiasHabiles: 1 dia habil desde un viernes cae en lunes (nunca sabado/domingo)", () => {
  // 2026-10-02 es viernes (Bogota).
  const viernes = new Date("2026-10-02T15:00:00.000Z");
  const resultado = sumarDiasHabiles(viernes, 1);
  assert.equal(formatearFechaBogotaDDMMAAAA(resultado), "05/10/2026");
});

// ── M36(3): sumarDiasHabiles ahora excluye festivos colombianos (antes solo fin de semana) ─────
// Oraculo explicito: "días hábiles cruzando un puente festivo". 2026-04-01 (miercoles) + 1 dia
// habil deberia caer en 02-abril (jueves) SI solo se miraran sabado/domingo — pero 2-abril es
// Jueves Santo y 3-abril es Viernes Santo (festivos moviles ligados a la Pascua 2026 = 5-abril,
// ver server/festivosColombia.ts y tests/festivosColombia.test.ts), asi que el dia habil real cae
// DESPUES del puente completo (jueves+viernes santos+sabado+domingo) = lunes 6 de abril.

test("sumarDiasHabiles: 1 dia habil cruzando el puente de Semana Santa 2026 salta Jueves y Viernes Santo + el fin de semana", () => {
  const miercoles1deAbril = new Date("2026-04-01T15:00:00.000Z");
  const resultado = sumarDiasHabiles(miercoles1deAbril, 1);
  assert.equal(formatearFechaBogotaDDMMAAAA(resultado), "06/04/2026", "debe saltar jue 2, vie 3 (festivos), sab 4 y dom 5 (fin de semana)");
});

test("sumarDiasHabiles: un festivo FIJO entre semana (25 dic, Navidad) tambien se excluye", () => {
  // 2026-12-24 es jueves (Bogota); 25-dic (Navidad, festivo fijo) no cuenta como habil.
  const jueves24dic = new Date("2026-12-24T15:00:00.000Z");
  const resultado = sumarDiasHabiles(jueves24dic, 1);
  assert.equal(formatearFechaBogotaDDMMAAAA(resultado), "28/12/2026", "salta Navidad (vie 25), sabado 26 y domingo 27 -> lunes 28");
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
  const revertido = construirAvisoReembolsoLeonardo({
    uid: "u", paymentId: "p", status: "charged_back", cuentaRevertida: true,
    correoComprador: "comprador@test.com", avisoCompradorEnviado: true,
  });
  assert.match(revertido.asunto, /Contracargo/);
  assert.match(revertido.texto, /revirtió/);

  const noActivo = construirAvisoReembolsoLeonardo({
    uid: "u", paymentId: "p", status: "refunded", cuentaRevertida: false,
    correoComprador: null, avisoCompradorEnviado: false,
  });
  assert.match(noActivo.asunto, /Reembolso/);
  assert.match(noActivo.texto, /NO se tocó/);
});

// ── Medio 1 (vuelta 35): aviso de reembolso a Leonardo incluye el correo del comprador y si ya ──
// se le avisó o si todavía falta escribirle a mano (Terminos sec. 9.2).
test("construirAvisoReembolsoLeonardo: incluye el correo del comprador y si YA se le avisó", () => {
  const yaAvisado = construirAvisoReembolsoLeonardo({
    uid: "u", paymentId: "p", status: "refunded", cuentaRevertida: true,
    correoComprador: "comprador@test.com", avisoCompradorEnviado: true,
  });
  assert.match(yaAvisado.texto, /comprador@test\.com/);
  assert.match(yaAvisado.texto, /YA fue notificado/);
});

test("construirAvisoReembolsoLeonardo: sin correo del comprador, dice que falta escribirle a mano", () => {
  const sinCorreo = construirAvisoReembolsoLeonardo({
    uid: "u", paymentId: "p", status: "refunded", cuentaRevertida: false,
    correoComprador: null, avisoCompradorEnviado: false,
  });
  assert.match(sinCorreo.texto, /todavía NO fue notificado/);
  assert.match(sinCorreo.texto, /escríbele/);
});

// ── Medio 1 (vuelta 35): aviso de reversion al COMPRADOR (Terminos sec. 9.2) ────────────────────
test("construirAvisoReversionComprador: ES cumple §9.2 con 'te lo informamos al correo de tu cuenta'", () => {
  const { asunto, texto } = construirAvisoReversionComprador({ idioma: "es", paymentId: "pago-1" });
  assert.match(asunto, /pago-1/);
  assert.match(texto, /te lo informamos al correo de tu cuenta/i);
  assert.match(texto, /sección 9\.2/);
});

test("construirAvisoReversionComprador: EN tiene su propio texto (no una copia del ES)", () => {
  const { texto } = construirAvisoReversionComprador({ idioma: "en", paymentId: "pago-1" });
  assert.match(texto, /we inform you at your account/i);
  assert.doesNotMatch(texto, /te lo informamos/i);
});

// ── Medio 2 (vuelta 35): proveedorConfigurado/relayConfigurado para GET /api/health ─────────────
test("proveedorConfigurado: false si el nombre esta vacio o es el marcador [PENDIENTE]", () => {
  assert.equal(proveedorConfigurado(""), false);
  assert.equal(proveedorConfigurado("[PENDIENTE]"), false);
  assert.equal(proveedorConfigurado("  [PENDIENTE]  "), false);
});

test("proveedorConfigurado: true con un nombre real", () => {
  assert.equal(proveedorConfigurado("Leonardo Antolinez"), true);
});

test("relayConfigurado: false si falta cualquiera de las dos variables", () => {
  assert.equal(relayConfigurado({}), false);
  assert.equal(relayConfigurado({ AVISOS_RELAY_URL: "https://x" }), false);
  assert.equal(relayConfigurado({ AVISOS_RELAY_SECRET: "s" }), false);
  assert.equal(relayConfigurado({ AVISOS_RELAY_URL: "  ", AVISOS_RELAY_SECRET: "s" }), false);
});

test("relayConfigurado: true con las dos variables presentes, SIN revelar sus valores en el resultado", () => {
  const resultado = relayConfigurado({ AVISOS_RELAY_URL: "https://x", AVISOS_RELAY_SECRET: "s" });
  assert.equal(resultado, true);
  assert.equal(typeof resultado, "boolean");
});

test("construirAvisoFalloWebhookLeonardo: incluye el paymentId y el numero de fallos", () => {
  const { texto } = construirAvisoFalloWebhookLeonardo({ paymentId: "pago-9", fallosConsecutivos: 3 });
  assert.match(texto, /pago-9/);
  assert.match(texto, /3 fallos/);
});

// ── M36(1): pie del acuse con la identidad completa del proveedor (PROVEEDOR_*) ────────────────

test("construirCorreoConfirmacionCompra: el pie incluye nombre, documento, direccion, telefono y correo del proveedor", () => {
  const { texto } = construirCorreoConfirmacionCompra({
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
  assert.match(texto, new RegExp(PROVEEDOR_NOMBRE.replace(/\./g, "\\.")));
  assert.match(texto, /Documento:/);
  assert.match(texto, /Dirección:/);
  assert.match(texto, new RegExp(PROVEEDOR_TELEFONO.replace(/[+()]/g, "\\$&")));
  assert.match(texto, new RegExp(PROVEEDOR_CORREO.replace(/\./g, "\\.")));
});

// ── M36(2): nunca se envia el acuse con un dato pendiente; se detecta en ES y EN ───────────────

test("tienePlaceholderPendiente: detecta '[PENDIENTE' (ES) y '[PENDING' (EN), nunca un falso positivo", () => {
  assert.equal(tienePlaceholderPendiente("Documento: [PENDIENTE]"), true);
  assert.equal(tienePlaceholderPendiente("Tax ID: [PENDING]"), true);
  assert.equal(tienePlaceholderPendiente("Texto normal sin nada pendiente"), false);
});

test("construirCorreoConfirmacionCompra: HOY (documento/direccion sin confirmar) el acuse SIEMPRE trae un placeholder pendiente", () => {
  // Mientras PROVEEDOR_DOCUMENTO/PROVEEDOR_DIRECCION sigan en \"[PENDIENTE]\" (server/avisos.ts),
  // el texto compuesto SIEMPRE debe disparar el bloqueo de M36(2) — si este test empieza a fallar
  // es porque alguien ya completo esos datos, lo cual es BUENO pero debe reflejarse aqui.
  const es = construirCorreoConfirmacionCompra({
    paraEmail: "comprador@test.com", idioma: "es", cop: 1000, trm: 1, fechaTrm: "2026-10-03",
    fechaPago: new Date("2026-10-05T15:00:00.000Z"), fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
    refMp: "1", enlaceTerminos: "https://x.test/terminos",
  });
  const en = construirCorreoConfirmacionCompra({
    paraEmail: "buyer@test.com", idioma: "en", cop: 1000, trm: 1, fechaTrm: "2026-10-03",
    fechaPago: new Date("2026-10-05T15:00:00.000Z"), fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
    refMp: "1", enlaceTerminos: "https://x.test/terminos",
  });
  assert.equal(tienePlaceholderPendiente(es.texto), true, "mientras documento/direccion esten pendientes, bloquea en ES");
  assert.equal(tienePlaceholderPendiente(en.texto), true, "el correo EN tiene su propio placeholder ([PENDING]) y tambien debe bloquear");
});

test("construirAvisoBloqueoProveedorLeonardo: incluye el paymentId y el uid, nunca pide reembolsar", () => {
  const { asunto, texto } = construirAvisoBloqueoProveedorLeonardo({ uid: "uid-1", paymentId: "pago-1" });
  assert.match(asunto, /BLOQUEADO/);
  assert.match(texto, /pago-1/);
  assert.match(texto, /uid-1/);
  assert.match(texto, /YA está activado/);
  assert.doesNotMatch(texto, /reembols/i);
});
