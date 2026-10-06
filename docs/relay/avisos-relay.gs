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
 * M-3(b) (corrige vuelta 34 del REVISOR_EXTERNO, 2026-10-06): deduplicacion por `idEnvio`
 * (`${paymentId}:${destinatario}`, opcional, dentro del cuerpo firmado) en `PropertiesService`
 * (7 dias, nunca `CacheService` — caduca). Si `server/avisos.ts` reintenta el MISMO correo logico
 * porque el relay tardo mas que su timeout (20s) pero SI habia terminado de enviarlo, este relay
 * responde OK sin mandarlo dos veces. Distinto del nonce (punto 2): el nonce es aleatorio en CADA
 * llamada (incluido un reintento) y solo protege una ventana corta de minutos; `idEnvio` es
 * estable para el mismo correo logico y protege una ventana de dias.
 *
 * Que verifica antes de enviar (server/avisos.ts, lado TypeScript, es el que firma):
 *   1. Los 5 campos obligatorios (para, asunto, texto, ts, nonce) y la firma estan presentes
 *      (`idEnvio` es el 6o campo del cuerpo, pero es OPCIONAL: cadena vacia es un valor valido).
 *   2. El timestamp (`ts`, segundos Unix) no tiene mas de 5 minutos de antiguedad ni esta en el
 *      futuro (hasta 60 s de margen por reloj desincronizado).
 *   3. La firma HMAC-SHA256 de `${ts}\n${nonce}\n${idEnvio}\n${para}\n${asunto}\n${texto}` con
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
 *   6. `idEnvio` (si viene, M-3(b)) no se ha marcado como ya procesado en los ultimos 7 dias
 *      (`PropertiesService`) — ver arriba.
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
  // M-3(b) (corrige vuelta 34 del REVISOR_EXTERNO): ventana de deduplicacion de `idEnvio`, en
  // segundos (7 dias) — mucho mas larga que NONCE_TTL_SEGUNDOS a proposito: el nonce protege
  // contra REPETIR una peticion capturada (ventana corta, minutos); `idEnvio` protege contra
  // REENVIAR el mismo correo logico tras un timeout del lado de Node mientras este script seguia
  // procesando (ventana larga, dias — un barrido corre cada 30 min, asi que varias horas de
  // reintentos del mismo pago deben seguir deduplicando).
  ENVIO_TTL_SEGUNDOS: 7 * 24 * 3600,
  ENVIO_PREFIJO: 'envio_',
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
    // M-3(b): id idempotente opcional — cadena vacia ('') si el llamador no lo manda (no todos
    // los avisos lo mandan hoy, ver server/avisos.ts); nunca entra en el chequeo de "campos
    // faltantes" de abajo porque una cadena vacia es un valor VALIDO para este campo.
    var idEnvio = String(body.idEnvio || '');
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
    if (!verificarFirma_(ts, nonce, idEnvio, para, asunto, texto, firma)) {
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

    // M-3(b): si este MISMO correo logico (`idEnvio`) ya se mando antes, responder OK sin volver
    // a mandarlo — este es exactamente el caso que esto previene: Node abortó la llamada anterior
    // por timeout (`enviarCorreo`, server/avisos.ts) creyendo que fallo, pero este script SI habia
    // terminado de mandar el correo original antes de que el cliente se desconectara. El chequeo
    // va DESPUES de `destinatarioEsperado_` (nunca marcar un `idEnvio` como procesado si la
    // peticion ni siquiera iba a mandarse) y, al estar todo `doPost` bajo `LockService` (arriba),
    // no hay carrera entre dos ejecuciones casi simultaneas para el mismo `idEnvio`.
    if (idEnvioYaProcesado_(idEnvio)) {
      return json_({ ok: true, yaEnviado: true });
    }

    MailApp.sendEmail({
      to: para,
      subject: asunto,
      body: texto,
      name: CONFIG.FROM_NAME,
    });
    marcarIdEnvioProcesado_(idEnvio);

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
function verificarFirma_(ts, nonce, idEnvio, para, asunto, texto, firmaRecibida) {
  var secreto = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_PROPERTY);
  if (!secreto) return false;
  var cadena = cadenaCanonica_(ts, nonce, idEnvio, para, asunto, texto);
  var firmaCalculada = hmacHex_(cadena, secreto);
  return igualesEnTiempoConstante_(firmaCalculada, firmaRecibida);
}

/** Cadena canonica a firmar — DEBE ser identica a `cadenaCanonicaAviso` de server/avisos.ts
 * (M33: incluye `nonce` entre `ts` y `para`; M-3(b) agrega `idEnvio` entre `nonce` y `para`). */
function cadenaCanonica_(ts, nonce, idEnvio, para, asunto, texto) {
  return ts + '\n' + nonce + '\n' + idEnvio + '\n' + para + '\n' + asunto + '\n' + texto;
}

/**
 * M-3(b) (corrige vuelta 34 del REVISOR_EXTERNO): true si `idEnvio` ya se marco como procesado
 * (un correo logico igual YA se mando). Cadena vacia (sin `idEnvio`) NUNCA deduplica — siempre
 * `false` — para no cambiar el comportamiento de avisos que todavia no lo mandan.
 *
 * Usa `PropertiesService` (NUNCA `CacheService`, que ya usa `nonceNuevo_` arriba): el cache de
 * Apps Script caduca segun su TTL pero tambien puede perderse antes por presion de cuota; las
 * propiedades del script son persistentes de verdad, necesarias para una ventana de 7 dias.
 */
function idEnvioYaProcesado_(idEnvio) {
  if (!idEnvio) return false;
  var props = PropertiesService.getScriptProperties();
  return !!props.getProperty(CONFIG.ENVIO_PREFIJO + idEnvio);
}

/** Marca `idEnvio` como procesado (fecha = ahora, segundos Unix) y de paso limpia las entradas
 * vencidas (limpieza simple: se ejecuta en cada envio nuevo, no en un cron aparte — el volumen de
 * correos de este relay es bajo, un recorrido de `getProperties()` en cada envio es sobrado). */
function marcarIdEnvioProcesado_(idEnvio) {
  if (!idEnvio) return;
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CONFIG.ENVIO_PREFIJO + idEnvio, String(Math.floor(Date.now() / 1000)));
  limpiarEnviosViejos_(props);
}

/** Borra toda propiedad `envio_*` con mas de `CONFIG.ENVIO_TTL_SEGUNDOS` (7 dias). */
function limpiarEnviosViejos_(props) {
  var ahora = Math.floor(Date.now() / 1000);
  var todas = props.getProperties();
  for (var clave in todas) {
    if (clave.indexOf(CONFIG.ENVIO_PREFIJO) !== 0) continue;
    var marcadoEn = Number(todas[clave]);
    if (!marcadoEn || ahora - marcadoEn > CONFIG.ENVIO_TTL_SEGUNDOS) {
      props.deleteProperty(clave);
    }
  }
}

/** HMAC-SHA256 de `cadena` con `secreto`, en hexadecimal minuscula (mismo formato que el `.digest
 * ('hex')` de Node en server/avisos.ts: `Utilities.computeHmacSha256Signature` devuelve un
 * arreglo de bytes CON SIGNO (-128..127); hay que normalizar cada byte a 0..255 antes de pasarlo
 * a hex, o los bytes negativos saldrian mal).
 *
 * M39 (corrige vuelta 28, 2026-10-05): se pasa `Utilities.Charset.UTF_8` EXPLICITO como 3er
 * argumento. Sin el, Apps Script decide el charset por su cuenta para convertir `cadena` a bytes
 * antes de firmar — con texto que solo tiene ASCII (como los vectores viejos de M33) nunca se
 * notaba la diferencia, pero `asunto`/`texto` reales SIEMPRE llevan tildes/ñ (nombres de clientes,
 * "Confirmación de tu compra..."), y un charset implicito distinto de UTF-8 en cualquiera de los
 * dos lados (este .gs firma aqui tambien al *verificar*; `server/avisos.ts` firma con
 * `createHmac(...).update(cuerpo, "utf8")`, siempre UTF-8) haria que la firma calculada aqui NUNCA
 * coincidiera con la que mando el backend para un correo con texto en español — y el relay
 * rechazaria TODOS los avisos reales como "solicitud_invalida", silenciosamente (ver
 * `runTestHmac()` abajo, que ahora prueba exactamente este caso con un vector con tildes/ñ). */
function hmacHex_(cadena, secreto) {
  var bytes = Utilities.computeHmacSha256Signature(cadena, secreto, Utilities.Charset.UTF_8);
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
 * M39 (corrige vuelta 28, 2026-10-05): el vector de prueba lleva tildes Y ñ en el `texto`
 * ("Confirmación de compra — Año ñandú ×2") — el vector viejo de M33 era ASCII puro y por eso
 * NUNCA habria detectado un charset implicito distinto de UTF-8 en `hmacHex_` (ver el comentario
 * de esa funcion arriba).
 *
 * M-3(b) (corrige vuelta 34 del REVISOR_EXTERNO): la cadena canonica ahora lleva `idEnvio` entre
 * `nonce` y `para` — este vector usa `idEnvio=''` (sin id idempotente), por eso el valor esperado
 * CAMBIO frente al que probaba M39. Con ts=1700000000, nonce="nonce-de-prueba", idEnvio="",
 * para="a@b.com", asunto="Asunto", texto="Confirmación de compra — Año ñandú ×2",
 * secreto="secreto-de-prueba", debe dar EXACTAMENTE
 * "1ff82e5298abc6f06614acdfff0755685d1e04448e46a6249b5510fc6f552731" (calculado del lado de Node
 * con `crypto.createHmac('sha256','secreto-de-prueba').update(cadena,'utf8').digest('hex')`,
 * misma cadena canonica de abajo) — EXACTAMENTE el mismo valor que prueba tests/relayGs.test.ts
 * ejecutando este .gs real dentro de un sandbox de Node.
 *
 * ESTE ES EL PASO OBLIGATORIO ANTES DE CONFIGURAR AVISOS_RELAY_URL (ver docs/relay/README.md):
 * correr `runTestHmac` en el editor REAL de Apps Script (nunca solo en el sandbox de Node) y
 * confirmar "OK" en el log — eso prueba que ESTE despliegue en particular calcula el HMAC igual
 * que server/avisos.ts para texto con tildes/ñ, antes de que un correo real dependa de ello.
 */
function runTestHmac() {
  var cadena = cadenaCanonica_(1700000000, 'nonce-de-prueba', '', 'a@b.com', 'Asunto', 'Confirmación de compra — Año ñandú ×2');
  var resultado = hmacHex_(cadena, 'secreto-de-prueba');
  Logger.log(resultado);
  Logger.log(
    resultado === '1ff82e5298abc6f06614acdfff0755685d1e04448e46a6249b5510fc6f552731'
      ? 'OK: coincide con tests/avisos.test.ts y tests/relayGs.test.ts'
      : 'DISTINTO: revisar el algoritmo de firma/la cadena canonica/el charset en los dos lados'
  );
}

/** Envia un correo de prueba a contacto@ con un secreto configurado en Propiedades del script. */
function runTestEnvio() {
  var ts = Math.floor(Date.now() / 1000);
  var nonce = Utilities.getUuid();
  var idEnvio = ''; // prueba manual: sin id idempotente, igual que antes de M-3(b).
  var para = 'contacto@leonardoantolinez.com';
  var asunto = '[PRUEBA] Relay de avisos de CertiSend';
  var texto = 'Si ves este correo, el relay de avisos esta funcionando.';
  var secreto = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_PROPERTY);
  if (!secreto) { Logger.log('Falta la propiedad ' + CONFIG.SECRET_PROPERTY); return; }
  var firma = hmacHex_(cadenaCanonica_(ts, nonce, idEnvio, para, asunto, texto), secreto);
  var resultado = doPost({ postData: { contents: JSON.stringify({ para: para, asunto: asunto, texto: texto, ts: ts, nonce: nonce, idEnvio: idEnvio, firma: firma }) } });
  Logger.log(resultado.getContent());
}
