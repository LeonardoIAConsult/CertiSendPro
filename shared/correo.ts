// Sanitizador UNICO de direcciones de correo (GRAVE 3, correccion vuelta 33, 2026-10-06).
// COMPARTIDO entre cliente y servidor — mismo patron que shared/textosCasillas.ts: sin
// dependencias, para que Vite lo empaquete en el bundle del cliente y esbuild/tsx lo resuelvan
// igual en el servidor.
//
// Antes de esta correccion existian DOS normalizaciones de correo independientes y mas laxas una
// que la otra:
//   - `server/huellaLote.ts` (`normalizarCorreo`, usada al calcular la huella HMAC en
//     `/api/lote/iniciar`) solo hacia `.trim().toLowerCase()`.
//   - `server.ts` (`cleanTo`, usada al enviar de verdad en `/api/send-email`) ademas quitaba
//     caracteres Unicode invisibles (ancho cero, marcas de direccion) y TODO espacio interno.
// Un correo de la hoja de Google Sheets con un caracter invisible o un espacio interno (copiado
// de un PDF, de un Excel, de un campo con autocompletado) producia una huella calculada sobre el
// valor SUCIO en `/api/lote/iniciar` y una huella de verificacion calculada sobre el valor LIMPIO
// en `/api/send-email`: nunca coincidian, as; el envio quedaba en 409 permanente sin que nada lo
// pudiera reintentar. La correccion es tener un UNICO sanitizador y usarlo en los TRES sitios que
// antes podian divergir: `normalizarCorreo` (huellaLote.ts), `cleanTo` (server.ts) y el cliente al
// construir los `pares` que manda a `/api/lote/iniciar` (src/App.tsx).
export function sanitizarCorreo(correo: string): string {
  return correo
    // Caracteres Unicode invisibles: espacios de ancho cero, BOM, marcas de direccion
    // izquierda/derecha, embeddings/overrides de direccion.
    .replace(/[​-‍﻿‎‏‪-‮]/g, "")
    // Cualquier espacio en blanco, interno o en los extremos (no solo `trim()`): un espacio
    // pegado en medio del correo nunca es parte de una direccion valida.
    .replace(/\s+/g, "")
    .toLowerCase();
}

// ── Enmascarado para logs (Sentinel/security-review sobre ad80fd6, hallazgo Bajo) ──────────────
// La Politica de Privacidad (seccion 3, "Registros tecnicos") declara que los logs del servidor
// "pueden conservar durante 30 dias una direccion de correo que haya provocado un error de
// envio" — pero eso debe seguir siendo la EXCEPCION declarada, no la norma: cuanto menos aparezca
// un correo completo en Cloud Logging, mas fuerte es esa promesa. Estas dos funciones NUNCA dejan
// un caracter "@" en el resultado (oraculo: "ningun '@' del destinatario en los logs").

/** Enmascara UN correo para un log: primer caracter del usuario + "***", dominio sin tocar, unidos
 * con " en " (nunca con "@"). Formato invalido (sin "@", o "@" al inicio) -> "***" generico. */
export function enmascararCorreo(correo: string): string {
  const limpio = sanitizarCorreo(correo);
  const idx = limpio.indexOf("@");
  if (idx <= 0) return "***";
  const usuario = limpio.slice(0, idx);
  const dominio = limpio.slice(idx + 1);
  return `${usuario[0]}*** en ${dominio || "***"}`;
}

const PATRON_CORREO_GLOBAL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Enmascara CUALQUIER correo que aparezca dentro de un texto libre (p. ej. el mensaje de error
 * de Gmail que `server.ts` compone en `/api/send-email` y que terminaba en `console.error`, con
 * el destinatario en claro). Usada SOLO al loguear — el mensaje que se le devuelve al propio
 * usuario (que ya conoce el correo: lo escribio el en su hoja) nunca pasa por aqui. */
export function enmascararCorreosEnTexto(texto: string): string {
  return texto.replace(PATRON_CORREO_GLOBAL, (correo) => enmascararCorreo(correo));
}
