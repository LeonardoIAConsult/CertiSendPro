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

/** Version vigente de los Terminos y Condiciones citada en la casilla T4. */
export const TERMINOS_VERSION = "1.3";

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
