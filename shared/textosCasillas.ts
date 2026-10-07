// Textos de las casillas del checkout del Paquete (T4 Terminos, T5 retracto), citados literal de
// `docs/legal/textos-checkout.md` v1.2 (Tarea 14, 2026-10-05). COMPARTIDO entre cliente y servidor
// (M31, corrige la vuelta 26): hasta ahora este texto vivia DUPLICADO en `server/cuentas.ts` (que
// importa firebase-admin, solo Node) y en `src/utils/checkout.ts` (que no puede importar ese
// modulo porque el bundle de Vite no empaqueta firebase-admin). Este archivo no importa NADA —
// ni firebase-admin ni React ni DOM — por eso lo pueden importar los dos lados: el server lo
// consume con un `import` relativo normal (Node/esbuild resuelven rutas relativas sin problema) y
// Vite lo empaqueta en el bundle del cliente como cualquier otro modulo TS sin dependencias.
//
// Nunca editar el texto en dos sitios: si cambia una version de los Terminos, se cambia AQUI y
// los dos lados quedan sincronizados automaticamente (antes habia que recordar tocar las dos
// copias — `tests/textosCasillas.test.ts` es la prueba que detecta si algun lado alguna vez vuelve
// a desviarse, p. ej. si alguien reintroduce una copia local en vez de importar de aqui).

/** Version vigente de los Terminos y Condiciones citada en la casilla T4. Bump a 1.4 (2026-10-07,
 * decision del Brain, Tarea 16A): plan Pago por uso + Pro desaparece — ver docs/legal/
 * terminos-y-condiciones.md v1.4 y src/legal/terminos.md. */
export const TERMINOS_VERSION = "1.4";

/** Idioma de la UI en el momento del cobro: el checkout acepta "es" o "en"; cualquier otro valor
 * (ausente, invalido) se trata como "es" — ver `normalizarIdioma`. */
export type Idioma = "es" | "en";

/** Normaliza cualquier valor que mande el navegador a un `Idioma` valido: solo "en" exacto da
 * ingles, cualquier otra cosa (ausente, "es", invalido) da español — nunca lanza. */
export function normalizarIdioma(valor: unknown): Idioma {
  return valor === "en" ? "en" : "es";
}

/** Texto EXACTO de la casilla T4 (`textos-checkout.md` v1.2) para un pago UNICO: sin la clausula
 * de renovacion. `montoCop` se formatea con puntos/comas de miles segun el idioma (regla R7 del
 * mismo documento). El texto debe ser el MISMO idioma que vio el usuario al marcar la casilla. */
export function textoCasillaTerminos(montoCop: number, idioma: Idioma = "es"): string {
  if (idioma === "en") {
    return (
      `I have read and accept the Terms and Conditions of Sale and Subscription (version ${TERMINOS_VERSION}) ` +
      `and the Privacy Policy. I understand I will pay COP $${montoCop.toLocaleString("en-US")} today.`
    );
  }
  return (
    `He leído y acepto los Términos y Condiciones de Venta y Suscripción (versión ${TERMINOS_VERSION}) ` +
    `y la Política de Privacidad. Entiendo que pagaré $${montoCop.toLocaleString("es-CO")} COP hoy.`
  );
}

/** Texto EXACTO de la casilla T5 (retracto, `textos-checkout.md` v1.3, ES). No depende del plan
 * ni del monto, siempre es el mismo. v1.3 quito "Puedo cancelar las renovaciones cuando quiera"
 * porque v1 no tiene nada que renovar (Tarea 7, modalidad "renovable", todavia no implementada). */
export const TEXTO_CASILLA_RETRACTO =
  "Quiero que el servicio empiece de inmediato al confirmarse mi pago. Sé que, por eso, no procede " +
  "el derecho de retracto de 5 días hábiles (Ley 1480 de 2011, artículo 47, numeral 1). Conservo " +
  "los reembolsos y la reversión del pago que la ley me reconoce y, si no hago ningún envío con " +
  "este Paquete, puedo pedir su devolución completa dentro de los 5 días hábiles siguientes al pago.";

/** Traduccion fiel de `TEXTO_CASILLA_RETRACTO` (T5 EN, `textos-checkout.md` v1.3). */
export const TEXTO_CASILLA_RETRACTO_EN =
  "I want the service to start immediately once my payment is confirmed. I understand that, for this " +
  "reason, the 5-business-day right of withdrawal does not apply (Colombian Law 1480 of 2011, article " +
  "47, item 1). I keep the refunds and payment reversal rights the law grants me, and, if I make no " +
  "sends with this Bundle, I can request a full refund within 5 business days after payment.";

/** Texto EXACTO de la casilla T5 en el idioma pedido. */
export function textoCasillaRetracto(idioma: Idioma = "es"): string {
  return idioma === "en" ? TEXTO_CASILLA_RETRACTO_EN : TEXTO_CASILLA_RETRACTO;
}

/**
 * Texto EXACTO de la autorizacion de tratamiento de datos al iniciar sesion (T11,
 * `docs/legal/textos-checkout.md` v1.3) — requerida ANTES de usar la cuenta (Ley 1581 de 2012,
 * requisito B.3). Compartido entre cliente y servidor (mismo motivo que el resto de este
 * archivo): la landing la muestra ANTES del boton de login, y `POST /api/autorizacion-datos`
 * reconstruye el MISMO texto en el servidor para guardarlo (nunca confia en un texto que mande
 * el navegador).
 *
 * El nombre legal del proveedor NUNCA se hardcodea en un archivo versionado (regla del Brain):
 * se recibe como parametro — `process.env.PROVEEDOR_NOMBRE` en el servidor (server/avisos.ts),
 * `import.meta.env.VITE_PROVEEDOR_NOMBRE` en el cliente — y, si falta o esta vacio, queda
 * "[dato pendiente]" (nunca se inventa).
 */
/**
 * Texto EXACTO de la segunda casilla, previa al boton "Entrar con Google" (O2, Dictamen
 * Abogado_LAP ronda 5, 2026-10-06, Alto): acepta los Terminos y Condiciones TAMBIEN para un
 * usuario del plan Gratis, que nunca pasa por el checkout del Paquete (T4/T5, que solo se ven al
 * comprar). Sin esta casilla, un usuario Gratis nunca acepta la secc. 12 (responsable de los
 * datos de sus destinatarios, contrato de transmision) ni la secc. 13.3 (revision obligatoria
 * antes de enviar) — esas condiciones generales no le son oponibles (Ley 1480 art. 37).
 *
 * A diferencia de `textoAutorizacionDatos`, este texto NO interpola el nombre del proveedor (solo
 * cita la version de los Terminos), asi que no hace falta un parametro de proveedor ni la
 * verificacion de coincidencia que tiene `decidirRegistroAutorizacion` (server/cuentas.ts).
 * Se guarda junto con la autorizacion de datos, en su PROPIA coleccion (`aceptacionesUso/{uid}`,
 * ver server/cuentas.ts): versionTerminos, texto EXACTO, idioma y fecha del servidor. Si
 * `TERMINOS_VERSION` cambia, se vuelve a pedir, igual que la autorizacion de datos.
 */
export function textoAceptacionTerminosUso(idioma: Idioma = "es"): string {
  if (idioma === "en") {
    return (
      `I accept the Terms and Conditions (version ${TERMINOS_VERSION}), including the conditions on my ` +
      `recipients' data (section 12) and the mandatory review before sending (section 13.3).`
    );
  }
  return (
    `Acepto los Términos y Condiciones (versión ${TERMINOS_VERSION}), incluidas las condiciones sobre los ` +
    `datos de mis destinatarios (sección 12) y la revisión obligatoria antes de enviar (sección 13.3).`
  );
}

// ── Casilla de retracto para Pago por uso (Tarea 16A-2, decision del Brain 2026-10-06) ──────────
// Aprobado por Abogado_LAP 2026-10-07 (decisión (a) de Leonardo) — VERIFICACION-v1.4: mismo
// criterio legal que TEXTO_CASILLA_RETRACTO del Paquete (Ley 1480 de 2011, articulo 47, numeral
// 1), adaptado a que Pago por uso no "empieza un servicio" sino que ACTIVA un saldo de inmediato,
// y que la devolucion completa aplica por COMPRA (no por el saldo acumulado total, que puede
// incluir compras anteriores ya usadas): si no se ha usado ningun envio de ESA compra en
// particular, procede la devolucion completa de ESE pago dentro de los 5 dias habiles siguientes.
export const TEXTO_CASILLA_RETRACTO_POR_USO =
  "Quiero que mi saldo se active de inmediato al confirmarse mi pago. Sé que, por eso, no procede " +
  "el derecho de retracto de 5 días hábiles (Ley 1480 de 2011, artículo 47, numeral 1). Conservo " +
  "los reembolsos y la reversión del pago que la ley me reconoce y, si no he usado ningún envío de " +
  "esta compra, puedo pedir su devolución completa dentro de los 5 días hábiles siguientes al pago.";

/** Traduccion fiel de `TEXTO_CASILLA_RETRACTO_POR_USO`. */
export const TEXTO_CASILLA_RETRACTO_POR_USO_EN =
  "I want my balance to be activated immediately once my payment is confirmed. I understand that, " +
  "for this reason, the 5-business-day right of withdrawal does not apply (Colombian Law 1480 of " +
  "2011, article 47, item 1). I keep the refunds and payment reversal rights the law grants me, " +
  "and, if I have made no sends from this purchase, I can request a full refund within 5 business " +
  "days after payment.";

/** Texto EXACTO de la casilla de retracto de Pago por uso en el idioma pedido. */
export function textoCasillaRetractoPorUso(idioma: Idioma = "es"): string {
  return idioma === "en" ? TEXTO_CASILLA_RETRACTO_POR_USO_EN : TEXTO_CASILLA_RETRACTO_POR_USO;
}

/** Version vigente de la autorizacion de tratamiento de datos (T11). Bump a 2.4 (2026-10-07,
 * decision del Brain): la Politica de Privacidad paso a v2.4 (Legal_LAP, src/legal/privacidad.md
 * y docs/legal/politica-de-privacidad.md) — tabla de planes con Pago por uso, Pro retirado.
 * Movida aqui (antes vivia como una constante local en server.ts) para que su version quede en
 * el mismo lugar que `TERMINOS_VERSION`, nunca duplicada. */
export const AUTORIZACION_DATOS_VERSION = "2.4";

export function textoAutorizacionDatos(idioma: Idioma, nombreProveedor: string | null | undefined): string {
  const nombre = nombreProveedor && nombreProveedor.trim() ? nombreProveedor.trim() : "[dato pendiente]";
  if (idioma === "en") {
    return (
      `I authorize ${nombre} (CertiSend Pro) to process my personal data for the purposes described in ` +
      `the Privacy Policy, including its transfer to providers outside Colombia (Google, Mercado Pago ` +
      `and, if I use it, Canva).`
    );
  }
  return (
    `Autorizo a ${nombre} (CertiSend Pro) a tratar mis datos personales para las finalidades de la ` +
    `Política de Privacidad, incluida su transferencia a proveedores fuera de Colombia (Google, ` +
    `Mercado Pago y, si la uso, Canva).`
  );
}
