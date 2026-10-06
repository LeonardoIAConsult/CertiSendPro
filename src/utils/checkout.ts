// Logica PURA del panel de checkout del Paquete (M30, cobro real con planes, corrige vuelta 24).
// Separada de LandingPage.tsx para poder probarse con node:test sin React, mismo patron que
// src/utils/plan.ts y server/trm.ts. El panel vive en LandingPage.tsx (no en App.tsx): el Paquete
// se puede comprar con solo el ID token de Firebase (exigirAuth en el servidor), sin el access
// token de Gmail que decide `needsAuth` en App.tsx — ver su comentario en App.tsx sobre G5.

/** Version de los Terminos y Condiciones citada en la casilla T4 (`docs/legal/textos-checkout.md`
 * v1.2). DUPLICADA de `TERMINOS_VERSION` en server/cuentas.ts a proposito: ese modulo usa
 * firebase-admin (solo Node), asi que el bundle del cliente (Vite) no puede importarlo. Si se
 * publica una version nueva de los Terminos, actualizar las DOS constantes. */
export const TERMINOS_VERSION = "1.2";

/** "Pagar" solo se habilita con las DOS casillas marcadas (T4 Terminos, T5 retracto) — R1 de
 * `textos-checkout.md`: el silencio no vale, hace falta aceptacion expresa de cada una. */
export function puedePagar(aceptaTerminos: boolean, aceptaRetracto: boolean): boolean {
  return aceptaTerminos === true && aceptaRetracto === true;
}

/** Texto de la casilla T4 en el idioma pedido, con el monto ya formateado (regla R7: puntos/comas
 * de miles). Debe coincidir con `textoCasillaTerminos` de server/cuentas.ts (duplicado por la
 * misma razon que `TERMINOS_VERSION`, arriba) — si uno cambia, cambia el otro. */
export function textoTerminos(montoCop: number, idioma: "es" | "en"): string {
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

/** Texto de la casilla T5 (retracto) en el idioma pedido — literal de `textos-checkout.md` v1.2,
 * EN es la traduccion de cortesia que el mismo documento ya trae (no hubo que traducir a mano). */
export function textoRetracto(idioma: "es" | "en"): string {
  if (idioma === "en") {
    return (
      "I want the service to start immediately once my payment is confirmed. I understand that, for " +
      "this reason, the 5-business-day right of withdrawal does not apply (Colombian Law 1480 of 2011, " +
      "article 47, item 1). I can cancel renewals at any time, I keep the refunds and payment reversal " +
      "rights the law grants me, and, for a Bundle with no sends used, I can request a full refund " +
      "within 5 business days after payment."
    );
  }
  return (
    "Quiero que el servicio empiece de inmediato al confirmarse mi pago. Sé que, por eso, no procede " +
    "el derecho de retracto de 5 días hábiles (Ley 1480 de 2011, artículo 47, numeral 1). Puedo " +
    "cancelar las renovaciones cuando quiera, conservo los reembolsos y la reversión del pago que la " +
    "ley me reconoce y, si es un Paquete y no hago ningún envío con él, puedo pedir su devolución " +
    "completa dentro de los 5 días hábiles siguientes al pago."
  );
}

/** Forma minima de lo que devuelve POST /api/mercadopago/create-preference que esta logica
 * necesita (el resto del body se ignora). */
export type CuerpoRespuestaCobro = {
  initPoint?: string;
  copNuevo?: number;
  error?: string;
};

export type ResultadoCrearCobro =
  | { tipo: "ok"; initPoint: string }
  | { tipo: "precio_cambio"; copNuevo: number }
  | { tipo: "error"; mensaje: string };

/**
 * Traduce la respuesta HTTP cruda de create-preference a lo que el panel debe hacer (M28/M30):
 * 200 con `initPoint` -> redirigir a Mercado Pago; 409 -> el precio cambio, mostrar `copNuevo` y
 * pedir volver a marcar las casillas (R8 de textos-checkout.md); cualquier otra cosa -> error.
 * Funcion PURA: no hace `fetch` ni toca `window`, para poder probarla con node:test.
 */
export function interpretarRespuestaCobro(httpStatus: number, body: CuerpoRespuestaCobro): ResultadoCrearCobro {
  if (httpStatus === 200 && typeof body?.initPoint === "string" && body.initPoint) {
    return { tipo: "ok", initPoint: body.initPoint };
  }
  if (httpStatus === 409 && Number.isFinite(body?.copNuevo)) {
    return { tipo: "precio_cambio", copNuevo: Number(body.copNuevo) };
  }
  return { tipo: "error", mensaje: body?.error || "No se pudo iniciar el pago con Mercado Pago." };
}
