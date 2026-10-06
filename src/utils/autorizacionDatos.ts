// Decision PURA de si hay que mostrar el modal de autorizacion de datos (Ley 1581), extraida de
// src/App.tsx (correccion vuelta 33, 2026-10-06, "carrera GET/POST de autorizacion al iniciar
// sesion"). Mismo patron que `ejecutarRevisionSondeo`/`decidirEstadoSondeo` en src/utils/plan.ts:
// sin React, sin DOM, probable con node:test.
//
// Bug que corrige: el `useEffect` que consulta `GET /api/autorizacion-datos` (para decidir si
// mostrar el modal) y el `POST /api/autorizacion-datos` que `handleLogin` dispara justo despues
// de un login exitoso (cuando la casilla ya se marco ANTES del boton "Entrar con Google", ver
// GRAVE 3(c)/(d) de la vuelta 31) podian correr casi al mismo tiempo: si el GET respondia
// `autorizado:false` (porque el POST todavia no habia terminado de guardar) y esa respuesta
// llegaba DESPUES de que el POST ya hubiera puesto `necesitaAutorizarDatos=false`, el GET la
// volvia a poner en `true` — el modal se reabria justo despues de que el usuario ya habia
// aceptado. La correccion: mientras un POST esta en vuelo, el resultado del GET se descarta por
// completo (el POST es quien va a decidir el estado final al terminar).
export type LecturaAutorizacion = { tipo: "ok"; autorizado: boolean } | { tipo: "error" };

/** `null` significa "no cambiar nada" (hay un POST en vuelo que ya decide este estado). Con
 * `postEnVuelo=false`: una lectura "ok" devuelve `!autorizado`; una lectura "error" (la peticion
 * no respondio 2xx, o lanzo) SIEMPRE devuelve `true` — nunca se asume "ya autorizo" ante una duda
 * (MENORES, misma regla que ya tenia el codigo original). */
export function decidirNecesitaAutorizar(lectura: LecturaAutorizacion, postEnVuelo: boolean): boolean | null {
  if (postEnVuelo) return null;
  if (lectura.tipo === "error") return true;
  return lectura.autorizado !== true;
}
