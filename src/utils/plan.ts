// Logica PURA de la Tarea 10 (cobro real con planes, 2026-10-05): el texto del plan que ve el
// usuario y el estado del sondeo al volver de Mercado Pago. Separada de App.tsx para poder
// probarse con node:test sin React ni red — mismo patron que server/trm.ts y server/cuentas.ts.
import { translations, type Lang } from "./translations";

export type Plan = "gratis" | "paquete" | "pro";

/** Forma de lo que devuelve GET /api/cuenta (server.ts), lo unico que esta logica necesita. */
export interface CuentaInfo {
  plan: Plan;
  enviosRestantes: number;
  /** ISO 8601, o null (Gratis, o un plan sin fecha de vencimiento). */
  vence: string | null;
  renueva: boolean;
}

/**
 * DD/MM/AAAA (o DD/MM si `conAnio` es false) en la zona de Bogota, sin importar el idioma de la
 * UI: es una convencion de fecha unica del proyecto, no de localizacion (igual que `trmHoy` en
 * server/trm.ts, que tambien usa `Intl` con `America/Bogota` en vez de `Date` crudo). `en-CA`
 * nombra las partes (day/month/year) de forma estable sin importar el locale real.
 */
export function formatearFechaBogota(iso: string, conAnio: boolean): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const mapa: Record<string, string> = {};
  for (const p of partes) mapa[p.type] = p.value;
  return conAnio ? `${mapa.day}/${mapa.month}/${mapa.year}` : `${mapa.day}/${mapa.month}`;
}

export interface EstadoPlanTexto {
  titulo: string;
  /** Nota adicional (hoy solo el Paquete: los lotes <=15 no gastan saldo, R3-1). */
  nota?: string;
}

/**
 * UNICO criterio de vigencia de un plan de pago (Paquete o Pro), compartido por
 * `formatearEstadoPlan` y `planActivo` para que nunca puedan contradecirse entre si (eran dos
 * copias de esta misma cuenta en el REVISOR de la Tarea 10: una trataba un Paquete sin `vence`
 * como vencido/Gratis y la otra como activo para siempre). Es EXACTAMENTE el mismo criterio que
 * usa el servidor en `decidirLote` (server/cuentas.ts): vigente = tiene `vence` Y esa fecha
 * todavia no paso. Un plan de pago sin `vence` (dato incompleto o a medio camino de activarse)
 * NUNCA se trata como vigente — ver la nota de la Tarea 8 en cuentas.ts sobre por que esto
 * importa tambien para Pro, no solo para Paquete.
 */
function planVigente(cuenta: CuentaInfo, ahora: Date): boolean {
  return cuenta.vence !== null && new Date(cuenta.vence).getTime() > ahora.getTime();
}

/**
 * Texto del plan que ve el usuario (spec §5 "Usar la app segun el plan"). Un Paquete o Pro
 * vencido (o sin `vence`) se muestra igual que Gratis: mismo trato que `decidirLote` en
 * server/cuentas.ts, para que la app nunca prometa un plan que el servidor ya no reconoce.
 */
export function formatearEstadoPlan(
  cuenta: CuentaInfo,
  lang: Lang,
  ahora: Date = new Date()
): EstadoPlanTexto {
  const t = translations[lang];

  if (cuenta.plan === "pro") {
    if (!planVigente(cuenta, ahora)) return { titulo: t.miPlanGratis };
    return { titulo: t.miPlanPro.replace("{fecha}", formatearFechaBogota(cuenta.vence!, false)) };
  }

  if (cuenta.plan === "paquete") {
    if (planVigente(cuenta, ahora) && cuenta.enviosRestantes > 0) {
      return {
        titulo: t.miPlanPaquete
          .replace("{restantes}", String(cuenta.enviosRestantes))
          .replace("{fecha}", formatearFechaBogota(cuenta.vence!, true)),
        nota: t.miPlanPaqueteNota,
      };
    }
    return { titulo: t.miPlanGratis };
  }

  return { titulo: t.miPlanGratis };
}

export type MotivoRechazoLote = "limite_gratis" | "saldo_insuficiente";

/**
 * Mensaje en lenguaje claro cuando el servidor rechaza un lote antes de enviar nada (spec §5):
 * el motivo exacto ("tienes 40, el lote es de 60" para saldo_insuficiente) mas las opciones
 * (dividir el lote o ver los planes).
 */
export function formatearMotivoRechazoLote(
  motivo: MotivoRechazoLote | undefined,
  enviosRestantes: number | undefined,
  cantidadLote: number,
  lang: Lang
): string {
  const t = translations[lang];
  const motivoTexto =
    motivo === "saldo_insuficiente"
      ? t.batchLimitSaldo
          .replace("{restantes}", String(enviosRestantes ?? 0))
          .replace("{lote}", String(cantidadLote))
      : t.batchLimitFree;
  return `${motivoTexto} ${t.batchLimitOpciones}`;
}

// ── Volver de Mercado Pago (Tarea 10) ───────────────────────────────────────────────────────
// El exito NUNCA lo decide la URL: `pago=ok`/`pago=pendiente` solo arrancan el sondeo contra
// /api/cuenta; "activo" solo sale de lo que el SERVIDOR responda en ese sondeo.

export type PagoParam = "ok" | "pendiente" | "error" | null;

/** Lee `?pago=` de un query string crudo (p. ej. `location.search`). Cualquier valor distinto de
 * los tres que manda `back_urls` en server.ts (ok/error/pendiente) se trata como "no hay pago". */
export function leerPagoParam(search: string): PagoParam {
  const valor = new URLSearchParams(search).get("pago");
  if (valor === "ok" || valor === "pendiente" || valor === "error") return valor;
  return null;
}

export type EstadoSondeoPago = "confirmando" | "activo" | "revision" | "rechazado";

export const LIMITE_SONDEO_MS = 2 * 60 * 1000;
export const INTERVALO_SONDEO_MS = 5000;

/** Si el plan de `cuenta` esta activo AHORA MISMO (ni Gratis, ni vencido/sin `vence`) — mismo
 * criterio `planVigente` que usa `formatearEstadoPlan`, a proposito (ver su comentario). */
export function planActivo(cuenta: CuentaInfo | null, ahora: Date = new Date()): boolean {
  if (!cuenta || cuenta.plan === "gratis") return false;
  return planVigente(cuenta, ahora);
}

/**
 * Decide que estado mostrar al volver de Mercado Pago, dado el parametro de la URL, la ULTIMA
 * respuesta conocida de /api/cuenta y cuanto tiempo lleva sondeando. Pura: no hace fetch ni usa
 * temporizadores (eso vive en App.tsx); recibe el tiempo transcurrido como numero para poder
 * probarla sin esperar reloj real.
 *
 * - `pago=error` -> "rechazado" de inmediato (Mercado Pago ya dijo que no se cobro nada).
 * - `pago=ok` o `pago=pendiente` -> el exito SOLO sale de `planActivo(cuenta)` (la respuesta real
 *   del servidor), nunca de que la URL diga "ok": si todavia no hay plan activo y no han pasado
 *   `LIMITE_SONDEO_MS`, sigue "confirmando"; agotado el plazo sin plan activo, "revision".
 * - sin parametro `pago` -> `null` (no hay nada que mostrar).
 */
export function decidirEstadoSondeo(params: {
  pago: PagoParam;
  cuenta: CuentaInfo | null;
  msTranscurridos: number;
  ahora?: Date;
}): EstadoSondeoPago | null {
  const { pago, cuenta, msTranscurridos, ahora } = params;
  if (!pago) return null;
  if (pago === "error") return "rechazado";
  if (planActivo(cuenta, ahora)) return "activo";
  if (msTranscurridos >= LIMITE_SONDEO_MS) return "revision";
  return "confirmando";
}
