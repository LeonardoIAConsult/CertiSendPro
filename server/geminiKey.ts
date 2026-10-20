// Backlog 20-oct-2026: el 5-oct se pegó el token de Mercado Pago en el secreto `gemini-api-key`
// y `/api/analyze-page` estuvo roto 15 dias sin que nadie lo viera. `/api/health` ahora informa
// `gemini` comprobando SOLO la FORMA de la llave (sin llamar a Google y sin revelar el valor):
// llaves de API de Google = "AIza" + 35 caracteres [0-9A-Za-z_-] (39 en total), y nunca igual al
// token de Mercado Pago. Se compara el valor crudo (sin trim) porque asi lo usa `/api/analyze-page`:
// un salto de linea pegado al final tambien la romperia. PURA — recibe el entorno por parametro.
const FORMA_LLAVE_GOOGLE = /^AIza[0-9A-Za-z_-]{35}$/;

export function geminiKeyConForma(env: Record<string, string | undefined> = process.env): boolean {
  const llave = env.GEMINI_API_KEY;
  if (!llave || !FORMA_LLAVE_GOOGLE.test(llave)) return false;
  return llave !== env.MERCADO_PAGO_ACCESS_TOKEN;
}
