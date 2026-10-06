/**
 * CertiSend Pro — Relay de avisos transaccionales
 * ------------------------------------------------------------------
 * Tarea 5 (cobro real con planes, 2026-10-05). Mismo patron que el relay de licencias de Faro
 * (Brain_Master_Business/TOOLS/faro-licencias-backend/Code.gs): Apps Script desplegado como App
 * Web en la cuenta contacto@leonardoantolinez.com, que manda correos con MailApp. A diferencia de
 * Faro (que CONFIRMA pagos contra la API de la pasarela), este relay no confirma nada por su
 * cuenta: solo reenvia correos que YA decidio enviar el backend de CertiSend (Cloud Run), server
 * a servidor, firmados con HMAC-SHA256 para que nadie mas pueda usar este /exec para mandar correo
 * en nombre de contacto@.
 *
 * M33 (corrige vuelta 27, 2026-10-05) — tres cambios sobre la version anterior:
 *   1. Orden de verificacion: la firma (+ antiguedad) se comprueba PRIMERO, antes de mirar quien
 *      es el destinatario. Ante cualquier peticion que NO pase esa verificacion (firma invalida,
 *      timestamp vencido/futuro, o nonce repetido — ver 2), se responde un error GENERICO y NUNCA
 *      se llama a `notifyLeo_` ni se envia ningun correo. Antes, una peticion con un destinatario
 *      "inesperado" avisaba a Leonardo ANTES de verificar la firma: cualquiera (sin el secreto)
 *      podia hacer que el relay mandara avisos a contacto@ con solo variar el campo `para`, sin
 *      necesitar una firma valida.
 *   2. Nonce anti-repeticion: el backend manda un `nonce` aleatorio DENTRO del cuerpo firmado
 *      (ver `server/avisos.ts`, funcion `cadenaCanonicaAviso`). Este relay guarda en
 *      `CacheService` cada nonce que ya vio, durante 10 minutos — una peticion con firma VALIDA
 *      pero un nonce ya usado (alguien capturo una peticion real y la reenvio) se rechaza igual
 *      que una firma invalida, sin avisar a Leonardo (es el mismo tipo de evento: una peticion que
 *      no debe procesarse, no una anomalia administrativa).
 *   3. Comparacion de la firma en TIEMPO CONSTANTE (bucle XOR sobre los bytes de los dos hex),
 *      para no filtrar por timing cuanto de la firma esperada coincide con la recibida.
 *
 * Que verifica antes de enviar (server/avisos.ts, lado TypeScript, es el que firma):
 *   1. Los 5 campos esperados (para, asunto, texto, ts, nonce) y la firma estan presentes.
 *   2. El timestamp (`ts`, segundos Unix) no tiene mas de 5 minutos de antiguedad ni esta en el
 *      futuro (hasta 60 s de margen por reloj desincronizado).
 *   3. La firma HMAC-SHA256 de `${ts}\n${nonce}\n${para}\n${asunto}\n${texto}` con
 *      AVISOS_RELAY_SECRET coincide EXACTAMENTE con la que manda el backend — comparada en tiempo
 *      constante.
 *   4. El `nonce` no se ha visto en los ultimos 10 minutos (CacheService).
 *   5. `para` es uno de los destinatarios esperados: el COMPRADOR (cualquier correo, no hay lista
 *      cerrada posible) o contacto@leonardoantolinez.com — en la practica, como el backend es el
 *      unico que conoce el secreto, este chequeo es una segunda capa, no la principal; lo que de
 *      verdad protege es el secreto compartido (nunca en el repo, ver README.md). Por eso corre
 *      DESPUES de la firma: si llega hasta aqui, la peticion YA esta autenticada, y un
 *      destinatario inesperado es senal de un bug propio (vale la pena avisar a Leonardo), no de
 *      un ataque.
 *
 * DESPLIEGUE (cuenta contacto@leonardoantolinez.com) — ver docs/relay/README.md para el paso a
 * paso completo. Este archivo NO se despliega automaticamente: Leonardo o el Brain lo pegan a
 * mano en el editor de Apps Script cuando decidan activar el relay.
 * ------------------------------------------------------------------
 */

var CONFIG = {
  // Secreto compartido con AVISOS_RELAY_SECRET (Cloud Run / Secret Manager). Se guarda en
  // "Propiedades del script" (Apps Script -> Configuracion del proyecto -> Propiedades del
  // script), NUNCA en este archivo ni en el repo.
  SECRET_PROPERTY: 'AVISOS_RELAY_SECRET',
  // Antigüedad maxima aceptada del timestamp firmado, en segundos (5 min, igual que pide la
  // Tarea 5).
  MAX_ANTIGUEDAD_SEGUNDOS: 5 * 60,
  // Ventana anti-repeticion del nonce, en segundos (M33: 10 minutos exactos).
  NONCE_TTL_SEGUNDOS: 10 * 60,
  FROM_NAME: 'Leonardo Antolinez',
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) { return json_({ ok: false, error: 'busy' }); }
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (er) {
      return json_({ ok: false, error: 'solicitud_invalida' });
    }

    var para = String(body.para || '');
    var asunto = String(body.asunto || '');
    var texto = String(body.texto || '');
    var ts = Number(body.ts);
    var nonce = String(body.nonce || '');
    var firma = String(body.firma || '');

    if (!para || !asunto || !texto || !ts || !nonce || !firma) {
      // M33: respuesta GENERICA, nunca se avisa a Leonardo por campos faltantes (podria ser
      // cualquiera, con o sin el secreto, probando el endpoint).
      return json_({ ok: false, error: 'solicitud_invalida' });
    }

    // M33 (orden nuevo): firma + antiguedad PRIMERO, antes de mirar el destinatario o el nonce.
    // Cualquier fallo en este bloque es una respuesta GENERICA, sin notifyLeo_ y sin enviar nada
    // — ni una peticion sin firma valida, ni una con el timestamp vencido, deben distinguirse en
    // la respuesta (eso ayudaria a un atacante a afinar sus intentos).
    if (!antiguedadValida_(ts, Math.floor(Date.now() / 1000))) {
      return json_({ ok: false, error: 'solicitud_invalida' });
    }
    if (!verificarFirma_(ts, nonce, para, asunto, texto, firma)) {
      return json_({ ok: false, error: 'solicitud_invalida' });
    }

    // M33: anti-repeticion. Solo se comprueba DESPUES de que la firma ya es valida (si no, un
    // atacante sin secreto podria agotar la cuota de CacheService mandando nonces al azar). Una
    // firma valida con un nonce ya usado es, igual que una firma invalida, una peticion que no se
    // procesa — tampoco avisa a Leonardo.
    if (!nonceNuevo_(nonce)) {
      return json_({ ok: false, error: 'solicitud_invalida' });
    }

    // A partir de aqui la peticion YA esta autenticada (firma valida, vigente, nonce no repetido):
    // un destinatario inesperado en este punto es una anomalia propia (un bug en el backend que
    // firmo algo que no debia), no un ataque — por eso SI vale la pena avisar a Leonardo.
    if (!destinatarioEsperado_(para)) {
      notifyLeo_('Relay de avisos: destinatario inesperado', 'para=' + para);
      return json_({ ok: false, error: 'destinatario_no_esperado' });
    }

    MailApp.sendEmail({
      to: para,
      subject: asunto,
      body: texto,
      name: CONFIG.FROM_NAME,
    });

    return json_({ ok: true });
  } catch (err) {
    notifyLeo_('ERROR relay de avisos', String(err && err.stack || err));
    return json_({ ok: false, error: 'error_interno' });
  } finally {
    try { lock.releaseLock(); } catch (er) {}
  }
}

/* ========================= VERIFICACION (funciones PURAS, testeables a mano) ========================= */

/**
 * Reconstruye la MISMA cadena canonica que firma server/avisos.ts (`cadenaCanonicaAviso`) y
 * compara el HMAC-SHA256 calculado aqui contra `firmaRecibida` EN TIEMPO CONSTANTE (M33). Separada
 * de `doPost` para poder ejecutarla sola desde el editor (`runTestHmac()`, abajo) sin tener que
 * desplegar nada primero.
 */
function verificarFirma_(ts, nonce, para, asunto, texto, firmaRecibida) {
  var secreto = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_PROPERTY);
  if (!secreto) return false;
  var cadena = cadenaCanonica_(ts, nonce, para, asunto, texto);
  var firmaCalculada = hmacHex_(cadena, secreto);
  return igualesEnTiempoConstante_(firmaCalculada, firmaRecibida);
}

/** Cadena canonica a firmar — DEBE ser identica a `cadenaCanonicaAviso` de server/avisos.ts
 * (M33: ahora incluye `nonce` entre `ts` y `para`). */
function cadenaCanonica_(ts, nonce, para, asunto, texto) {
  return ts + '\n' + nonce + '\n' + para + '\n' + asunto + '\n' + texto;
}

/** HMAC-SHA256 de `cadena` con `secreto`, en hexadecimal minuscula (mismo formato que el `.digest
 * ('hex')` de Node en server/avisos.ts: `Utilities.computeHmacSha256Signature` devuelve un
 * arreglo de bytes CON SIGNO (-128..127); hay que normalizar cada byte a 0..255 antes de pasarlo
 * a hex, o los bytes negativos saldrian mal). */
function hmacHex_(cadena, secreto) {
  var bytes = Utilities.computeHmacSha256Signature(cadena, secreto);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    hex += (h.length === 1 ? '0' + h : h);
  }
  return hex;
}

/**
 * M33: compara dos strings EN TIEMPO CONSTANTE (bucle XOR sobre cada byte/caracter, sin cortar
 * temprano) — evita que el tiempo de respuesta filtre cuantos caracteres iniciales de la firma
 * coinciden. La longitud se compara primero (la longitud de un hash HMAC-SHA256 en hex SIEMPRE es
 * 64; no es un dato secreto, revelarla por timing no ayuda a un atacante a falsificar la firma).
 */
function igualesEnTiempoConstante_(a, b) {
  if (a.length !== b.length) return false;
  var diferencia = 0;
  for (var i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

/** `ts` (segundos Unix) no puede tener mas de `MAX_ANTIGUEDAD_SEGUNDOS` ni estar en el futuro
 * (relojes algo desincronizados entre Cloud Run y Apps Script: se acepta hasta 60 s de futuro). */
function antiguedadValida_(ts, ahoraSegundos) {
  if (!(ts > 0)) return false;
  var diferencia = ahoraSegundos - ts;
  return diferencia >= -60 && diferencia <= CONFIG.MAX_ANTIGUEDAD_SEGUNDOS;
}

/**
 * M33: true si `nonce` NO se ha visto en los ultimos `NONCE_TTL_SEGUNDOS` (10 minutos) — y, en ese
 * caso, lo guarda para que la PROXIMA vez que llegue (dentro de esa ventana) de `false`. Usa
 * `CacheService.getScriptCache()` (compartida por todas las ejecuciones del script, a diferencia
 * de `getUserCache()`): el reenvio podria llegar desde Cloud Run con cualquier identidad de
 * ejecucion de Apps Script.
 */
function nonceNuevo_(nonce) {
  var cache = CacheService.getScriptCache();
  var clave = 'nonce_' + nonce;
  if (cache.get(clave)) return false;
  cache.put(clave, '1', CONFIG.NONCE_TTL_SEGUNDOS);
  return true;
}

/** Solo el comprador (cualquier correo con forma de correo) o contacto@ — segunda capa de
 * defensa, no la principal (la principal es el secreto HMAC). */
function destinatarioEsperado_(para) {
  if (para === 'contacto@leonardoantolinez.com') return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para);
}

function notifyLeo_(subject, bodyText) {
  try {
    MailApp.sendEmail({ to: 'contacto@leonardoantolinez.com', subject: '[CertiSend Relay] ' + subject, body: String(bodyText) });
  } catch (e) {}
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================= PRUEBAS MANUALES (editor de Apps Script) ========================= */
// Sin guión bajo final a propósito (convención: Apps Script oculta del selector "Ejecutar" las
// funciones que terminan en "_", igual que en Code.gs de Faro).

/**
 * M33: verifica el vector HMAC compartido con tests/avisos.test.ts (`VECTOR_HMAC_ESPERADO`),
 * ahora sobre la cadena canonica COMPLETA (con nonce) — antes este vector llamaba a `hmacHex_`
 * directo sobre un texto literal sin pasar por `cadenaCanonica_`, lo que nunca ejercitaba el
 * agregado del nonce. Con ts=1700000000, nonce="nonce-de-prueba", para="a@b.com",
 * asunto="Asunto", texto="Texto del correo", secreto="secreto-de-prueba", debe dar EXACTAMENTE
 * "20f0e9b0af94d0e8d7dd20cc2b7199663ef20eadfc8ea3c2c1055f8ead6341a1" (calculado del lado de Node
 * con `crypto.createHmac('sha256', 'secreto-de-prueba').update(cadena).digest('hex')`, cadena =
 * "1700000000\nnonce-de-prueba\na@b.com\nAsunto\nTexto del correo"). Correr desde el editor de
 * Apps Script (seleccionar esta funcion -> Ejecutar) y mirar el log.
 */
function runTestHmac() {
  var cadena = cadenaCanonica_(1700000000, 'nonce-de-prueba', 'a@b.com', 'Asunto', 'Texto del correo');
  var resultado = hmacHex_(cadena, 'secreto-de-prueba');
  Logger.log(resultado);
  Logger.log(
    resultado === '20f0e9b0af94d0e8d7dd20cc2b7199663ef20eadfc8ea3c2c1055f8ead6341a1'
      ? 'OK: coincide con tests/avisos.test.ts'
      : 'DISTINTO: revisar el algoritmo de firma/la cadena canonica en los dos lados'
  );
}

/** Envia un correo de prueba a contacto@ con un secreto configurado en Propiedades del script. */
function runTestEnvio() {
  var ts = Math.floor(Date.now() / 1000);
  var nonce = Utilities.getUuid();
  var para = 'contacto@leonardoantolinez.com';
  var asunto = '[PRUEBA] Relay de avisos de CertiSend';
  var texto = 'Si ves este correo, el relay de avisos esta funcionando.';
  var secreto = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_PROPERTY);
  if (!secreto) { Logger.log('Falta la propiedad ' + CONFIG.SECRET_PROPERTY); return; }
  var firma = hmacHex_(cadenaCanonica_(ts, nonce, para, asunto, texto), secreto);
  var resultado = doPost({ postData: { contents: JSON.stringify({ para: para, asunto: asunto, texto: texto, ts: ts, nonce: nonce, firma: firma }) } });
  Logger.log(resultado.getContent());
}
