// Limitador de tasa en memoria, PURO y generico (Tarea 12, cobro real con planes, 2026-10-05).
// Separado de server.ts (mismo patron que trm.ts/cuentas.ts/webhook.ts) para poder probarlo con
// node:test sin arrancar Express ni esperar minutos reales de verdad: recibe el reloj (`ahora`)
// por parametro, nunca llama a Date.now() por su cuenta.
//
// Se usa para el tope GLOBAL de /api/mercadopago/create-preference (independiente de la IP y del
// uid, que ya filtran en otras capas): cuenta TODAS las peticiones juntas, sin importar quien las
// manda. Solo tiene sentido si Cloud Run corre con max-instances=1 (una sola instancia = un solo
// contador en memoria); con varias instancias cada una tendria su propio contador y el tope
// dejaria de ser global de verdad — eso requeriria un contador compartido (Firestore/Redis), que
// queda fuera de esta v1.

export interface EstadoVentana {
  n: number;
  desde: number;
}

export interface ResultadoLimite {
  permitido: boolean;
  /** Estado a guardar para la siguiente llamada (esta funcion es PURA: no muta nada). */
  estado: EstadoVentana;
  /** Solo si `permitido` es false: segundos sugeridos para el encabezado `Retry-After`. */
  retryAfterSegundos?: number;
}

/**
 * Ventana deslizante simple de tamano fijo: si ya paso `ventanaMs` desde que se abrio la ventana
 * de `estado`, se abre una nueva (cuenta 1); si no, se suma una peticion mas a la ventana actual
 * y se rechaza en cuanto el total supera `maxPorVentana` (la peticion numero `maxPorVentana + 1`
 * es la primera rechazada, las anteriores — incluida la `maxPorVentana` — se permiten).
 */
export function evaluarLimite(
  estado: EstadoVentana | null,
  ahora: number,
  ventanaMs: number,
  maxPorVentana: number
): ResultadoLimite {
  if (!estado || ahora - estado.desde > ventanaMs) {
    return { permitido: true, estado: { n: 1, desde: ahora } };
  }
  const n = estado.n + 1;
  if (n > maxPorVentana) {
    return {
      permitido: false,
      estado: { n, desde: estado.desde },
      retryAfterSegundos: Math.max(1, Math.ceil((ventanaMs - (ahora - estado.desde)) / 1000)),
    };
  }
  return { permitido: true, estado: { n, desde: estado.desde } };
}
