// COP desde USD, compartido entre servidor y cliente (Paso 16B, cobro real con planes,
// 2026-10-07). Hasta ahora `copDesdeUsd` vivia SOLO en server/trm.ts (import de firebase-admin en
// la cadena de ese archivo via server/cuentas.ts... en realidad server/trm.ts no importa nada de
// Node especifico, pero SI es un modulo de `server/`, y el patron de este repo — igual que
// `shared/textosCasillas.ts` con los textos de las casillas — es que lo que el CLIENTE necesita
// mostrar vive en `shared/`, nunca duplicado a mano en los dos lados). El panel de pago de "Pago
// por uso" (src/utils/checkout.ts) necesita mostrar el MISMO total en COP que despues va a cobrar
// el servidor (server/cobroPaquete.ts `crearCobroPorUso`, server.ts `/api/precios`): una copia
// aparte en el cliente podria desviarse en silencio (redondeo distinto, formula distinta) y
// mostrar un numero que el servidor nunca va a cobrar de verdad.
//
// Esta funcion no importa NADA (ni firebase-admin ni React ni DOM): server/trm.ts la reexporta
// (import relativo normal, Node/esbuild lo resuelven sin problema) y Vite la empaqueta en el
// bundle del cliente como cualquier otro modulo TS sin dependencias — mismo patron exacto que
// shared/textosCasillas.ts.
//
// Nunca duplicar esta formula en un tercer sitio: `tests/checkout.test.ts` prueba que el cliente
// (src/utils/checkout.ts `calcularTotalPorUso`) y el servidor (server/trm.ts, reexportado de aqui)
// den EXACTAMENTE el mismo COP para la misma cantidad/TRM.
export function copDesdeUsd(usd: number, trmValor: number): number {
  return Math.round(usd * trmValor);
}
