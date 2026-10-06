// Medio 6 (REVISOR_EXTERNO, 2026-10-06): el limitador global por uid de /api (server.ts,
// `app.use("/api", ...)`, 30 peticiones/minuto por defecto) cubre TODAS las rutas, incluida
// /api/send-email. El bucle de envio de un lote (src/App.tsx, `handleSendEmails`) llamaba a esa
// ruta en bucle cerrado, sin ninguna pausa: un Paquete de 150 envios agota el cupo de 30/min
// mucho antes de terminar y el resto del lote recibe 429 ("Demasiadas peticiones").
//
// Logica PURA (sin React, probada con node:test, mismo patron que src/utils/plan.ts): decide
// cuanto esperar ANTES de cada llamada de red del bucle, segun cuantos envios REALES (los que
// llegaron a llamar a /api/send-email, nunca los saltados por no tener `matchedRecipient`) ya se
// hicieron. El primero nunca espera; desde el segundo en adelante espera `PAUSA_ENTRE_ENVIOS_MS`
// — un poco mas que 60000/30=2000ms para no pegarse al borde exacto de la ventana del limitador.
export const PAUSA_ENTRE_ENVIOS_MS = 2200;

export function pausaAntesDelEnvioMs(enviosRealizadosAntes: number): number {
  return enviosRealizadosAntes > 0 ? PAUSA_ENTRE_ENVIOS_MS : 0;
}
