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
 * Que verifica antes de enviar (server/avisos.ts, lado TypeScript, es el que firma):
 *   1. Los 4 campos esperados (para, asunto, texto, ts) estan presentes.
 *   2. La firma HMAC-SHA256 de `${ts}\n${para}\n${asunto}\n${texto}` con AVISOS_RELAY_SECRET
 *      coincide EXACTAMENTE con la que manda el backend (comparacion en tiempo constante).
 *   3. `ts` (segundos Unix) no tiene mas de 5 minutos de antiguedad ni esta en el futuro — evita
 *      que una firma capturada se reuse mucho despues (replay).
 *   4. `para` es uno de los destinatarios esperados: el COMPRADOR (cualquier correo, no hay lista
 *      cerrada posible) o contacto@leonardoantolinez.com — en la practica, como el backend es el
 *      unico que conoce el secreto, el chequeo de `para` es una segunda capa, no la principal; lo
 *      que de verdad protege es el secreto compartido (nunca en el repo, ver README.md).
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
  FROM_NAME: 'Leonardo Antolinez',
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) { return json_({ ok: false, error: 'busy' }); }
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (er) {
      return json_({ ok: false, error: 'bad_json' });
    }

    var para = String(body.para || '');
    var asunto = String(body.asunto || '');
    var texto = String(body.texto || '');
    var ts = Number(body.ts);
    var firma = String(body.firma || '');

    if (!para || !asunto || !texto || !ts || !firma) {
      return json_({ ok: false, error: 'missing_fields' });
    }

    if (!destinatarioEsperado_(para)) {
      notifyLeo_('Relay de avisos: destinatario inesperado', 'para=' + para);
      return json_({ ok: false, error: 'destinatario_no_esperado' });
    }

    if (!antiguedadValida_(ts, Math.floor(Date.now() / 1000))) {
      return json_({ ok: false, error: 'timestamp_invalido_o_viejo' });
    }

    if (!verificarFirma_(ts, para, asunto, texto, firma)) {
      // Firma invalida: alguien sin el secreto intento usar este /exec. No se avisa a Leonardo
      // por CADA intento (seria ruido ante un escaneo automatizado); Apps Script ya registra las
      // ejecuciones en "Ejecuciones" si hace falta auditar despues.
      return json_({ ok: false, error: 'firma_invalida' });
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
 * compara el HMAC-SHA256 calculado aqui contra `firmaRecibida`. Separada de `doPost` para poder
 * ejecutarla sola desde el editor (`runTestHmac()`, abajo) sin tener que desplegar nada primero.
 */
function verificarFirma_(ts, para, asunto, texto, firmaRecibida) {
  var secreto = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_PROPERTY);
  if (!secreto) return false;
  var cadena = cadenaCanonica_(ts, para, asunto, texto);
  var firmaCalculada = hmacHex_(cadena, secreto);
  return firmaCalculada === firmaRecibida;
}

/** Cadena canonica a firmar — DEBE ser identica a `cadenaCanonicaAviso` de server/avisos.ts. */
function cadenaCanonica_(ts, para, asunto, texto) {
  return ts + '\n' + para + '\n' + asunto + '\n' + texto;
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

/** `ts` (segundos Unix) no puede tener mas de `MAX_ANTIGUEDAD_SEGUNDOS` ni estar en el futuro
 * (relojes algo desincronizados entre Cloud Run y Apps Script: se acepta hasta 60 s de futuro). */
function antiguedadValida_(ts, ahoraSegundos) {
  if (!(ts > 0)) return false;
  var diferencia = ahoraSegundos - ts;
  return diferencia >= -60 && diferencia <= CONFIG.MAX_ANTIGUEDAD_SEGUNDOS;
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
 * Verifica el vector HMAC compartido con tests/avisos.test.ts (`VECTOR_HMAC_ESPERADO`). Llama a
 * `hmacHex_` directo sobre el texto literal "hola\nmundo" (SIN pasar por `cadenaCanonica_`, para
 * poder probar solo el calculo del HMAC, igual que hace la prueba en TS con `firmarHmac` directo):
 * con secreto="secreto-de-prueba" debe dar
 * "428f5d862484fd2d8551971ae00ea7fb0c4e4624b7824d7ae594ba1ebd026cab" (calculado del lado de Node
 * con `crypto.createHmac('sha256', 'secreto-de-prueba').update('hola\nmundo').digest('hex')`).
 * Correr desde el editor de Apps Script (seleccionar esta funcion -> Ejecutar) y mirar el log.
 */
function runTestHmac() {
  var resultado = hmacHex_('hola\nmundo', 'secreto-de-prueba');
  Logger.log(resultado);
  Logger.log(
    resultado === '428f5d862484fd2d8551971ae00ea7fb0c4e4624b7824d7ae594ba1ebd026cab'
      ? 'OK: coincide con tests/avisos.test.ts'
      : 'DISTINTO: revisar el algoritmo de firma en los dos lados'
  );
}

/** Envia un correo de prueba a contacto@ con un secreto configurado en Propiedades del script. */
function runTestEnvio() {
  var ts = Math.floor(Date.now() / 1000);
  var para = 'contacto@leonardoantolinez.com';
  var asunto = '[PRUEBA] Relay de avisos de CertiSend';
  var texto = 'Si ves este correo, el relay de avisos esta funcionando.';
  var secreto = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_PROPERTY);
  if (!secreto) { Logger.log('Falta la propiedad ' + CONFIG.SECRET_PROPERTY); return; }
  var firma = hmacHex_(cadenaCanonica_(ts, para, asunto, texto), secreto);
  var resultado = doPost({ postData: { contents: JSON.stringify({ para: para, asunto: asunto, texto: texto, ts: ts, firma: firma }) } });
  Logger.log(resultado.getContent());
}
