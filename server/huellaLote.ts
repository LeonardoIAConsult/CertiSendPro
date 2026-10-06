// Huella HMAC-SHA256 de la confirmacion de un lote (requisito A.3, Tarea 15, cobro real con
// planes, 2026-10-05). docs/legal/terminos-y-condiciones.md §13.3(c) exige guardar, por cada par
// pagina del PDF-fila de la hoja-correo del destinatario de un lote enviado, una huella que
// pruebe cuales pares se confirmaron SIN guardar la lista ni los correos en claro.
//
// Modulo PURO (sin firebase-admin, sin Express): testable con node:test, mismo patron que
// server/trm.ts y server/webhook.ts. `firmarHmac` de server/avisos.ts no se reutiliza para no
// tocar ese archivo (otro agente trabaja ahi en paralelo, vuelta 30) — se replica aqui el mismo
// algoritmo (HMAC-SHA256, utf8).
import { createHmac } from "crypto";

export interface ParConfirmacion {
  pagina: number;
  fila: number;
  correo: string;
}

/** Normaliza un correo (lowercase + trim) para que la misma persona con mayusculas/espacios
 * distintos produzca siempre la misma huella. */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

/** Cadena canonica de un par antes de firmar: `pagina|fila|correoNormalizado`. */
export function cadenaCanonicaPar(par: ParConfirmacion): string {
  return `${par.pagina}|${par.fila}|${normalizarCorreo(par.correo)}`;
}

/** Huella HMAC-SHA256 (hex) de un par, firmada con `secreto` (HUELLA_LOTE_SECRET). Determinista:
 * mismo par + mismo secreto -> siempre la misma huella; cambiar cualquier campo del par (o el
 * secreto) cambia la huella. */
export function huellaPar(par: ParConfirmacion, secreto: string): string {
  return createHmac("sha256", secreto).update(cadenaCanonicaPar(par), "utf8").digest("hex");
}

/** Huellas de TODOS los pares de un lote, en el mismo orden en que llegaron. */
export function huellasLote(pares: ParConfirmacion[], secreto: string): string[] {
  return pares.map((par) => huellaPar(par, secreto));
}
