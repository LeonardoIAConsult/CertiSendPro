import { createHmac } from "node:crypto";

// H8 (decision de Leonardo 2026-10-24; hallazgo H6 de Abogado_LAP): los 15 envios gratis son por
// CORREO, no por `uid`. Si se contaran por uid, eliminar la cuenta y volver a crearla repondria los 15.
// Por eso el contador vive en `gratisPorCorreo/{huella}` y la clave es una HUELLA irreversible del
// correo: HMAC-SHA256 con un secreto del servidor. En Firestore NO queda el correo, solo la huella.

const DOMINIOS_GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * Forma canonica del correo para contar los gratis. Minusculas y sin espacios. En Gmail, los puntos del
 * usuario y el sufijo `+algo` no cambian de buzon (`A.B+x@gmail.com` == `ab@gmail.com`), asi que se
 * quitan y `googlemail.com` se trata como `gmail.com`; en otros dominios solo se normalizan mayusculas.
 */
export function normalizarCorreoParaGratis(correo: string): string {
  const limpio = String(correo).trim().toLowerCase();
  const arroba = limpio.lastIndexOf("@");
  if (arroba <= 0 || arroba === limpio.length - 1) return limpio;
  let usuario = limpio.slice(0, arroba);
  let dominio = limpio.slice(arroba + 1);
  if (DOMINIOS_GMAIL.has(dominio)) {
    dominio = "gmail.com";
    usuario = usuario.split("+")[0].replace(/\./g, "");
  }
  return `${usuario}@${dominio}`;
}

/**
 * Clave de `gratisPorCorreo/{huella}`. Sin correo (no deberia pasar con Google) se usa el uid como
 * ultimo recurso, con otro prefijo para que nunca colisione con la huella de un correo.
 */
export function huellaGratis(correo: string | undefined | null, uid: string, secreto: string): string {
  const base = correo && correo.includes("@") ? `correo:${normalizarCorreoParaGratis(correo)}` : `uid:${uid}`;
  return createHmac("sha256", secreto).update(`gratis-v1:${base}`).digest("hex");
}
