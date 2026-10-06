// Logica PURA del panel de checkout del Paquete (M30, cobro real con planes, corrige vuelta 24).
// Separada de LandingPage.tsx para poder probarse con node:test sin React, mismo patron que
// src/utils/plan.ts y server/trm.ts. El panel vive en LandingPage.tsx (no en App.tsx): el Paquete
// se puede comprar con solo el ID token de Firebase (exigirAuth en el servidor), sin el access
// token de Gmail que decide `needsAuth` en App.tsx — ver su comentario en App.tsx sobre G5.
import {
  TERMINOS_VERSION,
  textoCasillaTerminos,
  textoCasillaRetracto,
} from "../../shared/textosCasillas";

/** Version de los Terminos y Condiciones citada en la casilla T4 (`docs/legal/textos-checkout.md`
 * v1.2). Re-exportada por compatibilidad: lo que antes era una constante duplicada a mano con
 * `TERMINOS_VERSION` de server/cuentas.ts ahora viene de la MISMA fuente que el servidor,
 * `shared/textosCasillas.ts` (M31, corrige vuelta 26 — ver `tests/textosCasillas.test.ts`). */
export { TERMINOS_VERSION };

/** "Pagar" solo se habilita con las DOS casillas marcadas (T4 Terminos, T5 retracto) — R1 de
 * `textos-checkout.md`: el silencio no vale, hace falta aceptacion expresa de cada una. */
export function puedePagar(aceptaTerminos: boolean, aceptaRetracto: boolean): boolean {
  return aceptaTerminos === true && aceptaRetracto === true;
}

/** Texto de la casilla T4 en el idioma pedido, con el monto ya formateado (regla R7: puntos/comas
 * de miles). Delegado a `shared/textosCasillas.ts` (M31): antes esta funcion tenia el texto
 * copiado a mano por separado del servidor; ahora los dos leen de la misma fuente, asi que ya no
 * pueden desviarse en silencio. Nombre conservado (`textoTerminos`, no `textoCasillaTerminos`)
 * para no tocar a quien ya la importa (LandingPage.tsx, tests/checkout.test.ts). */
export function textoTerminos(montoCop: number, idioma: "es" | "en"): string {
  return textoCasillaTerminos(montoCop, idioma);
}

/** Texto de la casilla T5 (retracto) en el idioma pedido. Delegado a `shared/textosCasillas.ts`
 * (M31), misma razon que `textoTerminos` arriba. */
export function textoRetracto(idioma: "es" | "en"): string {
  return textoCasillaRetracto(idioma);
}

// ── Validacion del dominio de `initPoint` antes de redirigir (Bajo, cobro real con planes,
// 2026-10-05) ────────────────────────────────────────────────────────────────────────────────
// `create-preference` devuelve `init_point` tal como lo manda Mercado Pago (server/cobroPaquete.ts
// solo reenvia `data.init_point`); el servidor NUNCA lo valida. Si alguien comprometiera la
// respuesta en transito, o un bug/cambio de API devolviera cualquier otra URL, LandingPage.tsx
// haria `window.location.href = <lo que sea>` sin ninguna comprobacion — un open-redirect de
// pantalla completa (el navegador entero navega a esa URL, no un link). Esta funcion es la unica
// puerta antes de esa redireccion: PURA (no toca `window`, no hace fetch), para poder probarla
// con node:test.
//
// Acepta produccion (`mercadopago.com` o `mercadopago.com.<tld>`, con o sin `www.`) y el entorno
// sandbox que usa el mismo patron con el subdominio `sandbox.` (Checkout Pro en modo prueba
// devuelve `sandbox_init_point` bajo `sandbox.mercadopago.com.<tld>`). Cualquier otro origen
// (dominio distinto, protocolo distinto de https, o un valor que no es ni siquiera una URL) es
// invalido.
const INIT_POINT_MP_REGEX = /^https:\/\/(www\.)?(sandbox\.)?mercadopago\.com(\.[a-z]{2})?\//i;

/** true si `url` es una URL de Mercado Pago (produccion o sandbox) a la que es seguro redirigir
 * con `window.location.href`. Nunca lanza con una entrada rara (undefined, no-string, vacio). */
export function esInitPointMercadoPagoValido(url: unknown): boolean {
  return typeof url === "string" && INIT_POINT_MP_REGEX.test(url);
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
