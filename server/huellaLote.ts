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
import { sanitizarCorreo } from "../shared/correo";

export interface ParConfirmacion {
  pagina: number;
  fila: number;
  correo: string;
}

/** GRAVE 3 (correccion vuelta 33, 2026-10-06): delega en el sanitizador UNICO compartido
 * (`shared/correo.ts`) para que la huella calculada aqui (al confirmar el lote en
 * `/api/lote/iniciar`) use EXACTAMENTE la misma normalizacion que `cleanTo` en `server.ts` (al
 * enviar de verdad en `/api/send-email`) — antes esta funcion solo hacia `.trim().toLowerCase()`,
 * sin quitar caracteres invisibles ni espacios internos, y esa diferencia producia un 409
 * permanente con correos que los traian. Se mantiene el nombre/firma para no tocar a sus
 * llamadores (`cadenaCanonicaPar` en este archivo). */
export function normalizarCorreo(correo: string): string {
  return sanitizarCorreo(correo);
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

// ── Integridad de los pares de un lote (Medio 3, correccion vuelta 31, 2026-10-06) ──────────────
// `/api/lote/iniciar` exige `pares.length === cantidad` (comprobado por el llamador, que conoce
// `cantidad`) y, ademas, que ningun par este vacio ni duplicado: dos pares con la misma `fila`
// significarian que un destinatario quedo asignado a DOS paginas, y dos con la misma `pagina` que
// una pagina quedo asignada a DOS destinatarios — ninguno de los dos puede corresponder a una
// asignacion real uno-a-uno (ver `src/utils/matching.ts` `assignRecipientsOneToOne`). PURA.
export function paresInvalidos(pares: ParConfirmacion[]): string | null {
  if (pares.length === 0) {
    return "El lote no tiene certificados para confirmar.";
  }
  const filasVistas = new Set<number>();
  const paginasVistas = new Set<number>();
  for (const par of pares) {
    if (!Number.isFinite(par.pagina) || !Number.isFinite(par.fila)) {
      return "Hay un certificado con datos incompletos (página o fila inválida).";
    }
    if (!par.correo || !par.correo.trim()) {
      return "Hay un certificado sin correo de destinatario.";
    }
    if (filasVistas.has(par.fila)) {
      return "Dos certificados quedaron asignados a la misma fila del destinatario.";
    }
    if (paginasVistas.has(par.pagina)) {
      return "La misma página de certificado aparece dos veces en el lote.";
    }
    filasVistas.add(par.fila);
    paginasVistas.add(par.pagina);
  }
  return null;
}

/** GRAVE 2 (correccion vuelta 31, 2026-10-06): si `HUELLA_LOTE_SECRET` esta configurado, SIN
 * revelar su valor. La usan `GET /api/health` (lo reporta como booleano) y, indirectamente, las
 * dos rutas que fallan cerrado si falta (`/api/lote/iniciar`, `/api/send-email`). PURA sobre un
 * mapa de variables de entorno (por defecto `process.env`), para poder probarla con node:test
 * sin mutar el entorno real del proceso. */
export function huellaConfigurada(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.HUELLA_LOTE_SECRET && env.HUELLA_LOTE_SECRET.trim());
}

/** GRAVE 2 + Medio 3 (correccion vuelta 31): valida, ANTES de tocar Firestore, que
 * `/api/lote/iniciar` puede autorizar el lote: el secreto debe existir (503, falla cerrado) y
 * `pares` debe cubrir EXACTAMENTE `cantidad` sin vacios ni duplicados (`paresInvalidos`, arriba).
 * PURA — no sabe nada de Express ni de Firestore, solo de los datos ya extraidos del body. */
export function validarSecretoYPares(
  secreto: string | undefined,
  cantidad: number,
  pares: ParConfirmacion[]
): { ok: true } | { ok: false; httpStatus: number; error: string } {
  if (!secreto || !secreto.trim()) {
    return { ok: false, httpStatus: 503, error: "Configuración incompleta. Intenta más tarde." };
  }
  if (pares.length !== cantidad) {
    return {
      ok: false,
      httpStatus: 400,
      error: "La lista de certificados a confirmar no coincide con la cantidad del lote.",
    };
  }
  const error = paresInvalidos(pares);
  if (error) return { ok: false, httpStatus: 400, error };
  return { ok: true };
}

/** Medio 3 (correccion vuelta 31): true si el par (pagina/fila/correo) que `/api/send-email` esta
 * a punto de enviar coincide con una de las huellas que `/api/lote/iniciar` guardo en
 * `lotes/{id}.confirmacion.huellas` al confirmar ese lote. `huellasGuardadas=null` (lote sin
 * confirmacion, no deberia pasar desde GRAVE 2) se trata como "ningun par coincide" — nunca como
 * "todo vale". PURA: no toca Firestore, solo compara. */
export function parConfirmado(par: ParConfirmacion, huellasGuardadas: string[] | null, secreto: string): boolean {
  if (!huellasGuardadas) return false;
  return huellasGuardadas.includes(huellaPar(par, secreto));
}

/** Decision COMPLETA de `/api/send-email` sobre la huella (correccion vuelta 33, 2026-10-06):
 * antes vivia repartida en dos `if` sueltos dentro de la ruta de `server.ts` (503 sin secreto,
 * 409 sin coincidencia) — se extrae aqui como funcion PURA con dependencias inyectadas
 * (`secreto`/`huellasGuardadas`, nunca lee `process.env` ni Firestore) para poder probar el
 * contrato exacto (que status/mensaje corresponde a cada caso) sin montar Express, y para que
 * `server.ts` quede como un unico punto de llamada en vez de reimplementar la logica. */
export function decidirEnvioConHuella(
  par: ParConfirmacion,
  huellasGuardadas: string[] | null,
  secreto: string | undefined
): { ok: true } | { ok: false; httpStatus: 503 | 409; error: string } {
  if (!secreto || !secreto.trim()) {
    return { ok: false, httpStatus: 503, error: "Configuración incompleta. Intenta más tarde." };
  }
  if (!parConfirmado(par, huellasGuardadas, secreto)) {
    return {
      ok: false,
      httpStatus: 409,
      error: "Este envío no coincide con la confirmación del lote. Vuelve a iniciar el envío masivo.",
    };
  }
  return { ok: true };
}
