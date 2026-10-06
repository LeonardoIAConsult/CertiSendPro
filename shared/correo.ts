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
