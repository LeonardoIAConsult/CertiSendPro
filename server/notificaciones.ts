// Composicion de avisos (Tareas 5 y 9, cobro real con planes, 2026-10-05; M34/M35/M36 corrigen la
// vuelta 27): une el canal generico de correo (server/avisos.ts, HMAC + relay) con la lectura/
// escritura de Firestore (server/cuentas.ts) para dar las DOS funciones que `server/webhook.ts`
// necesita inyectadas:
//   - `notificarActivacionPaquete`: correo de confirmacion al comprador + aviso de venta a
//     Leonardo, exactamente una vez POR DESTINATARIO (M35), con el acuse BLOQUEADO si el texto
//     todavia tiene un dato pendiente (M36(2)).
//   - `avisarReembolsoPaquete`: revierte la cuenta a Gratis si el pago era el activo y avisa a
//     Leonardo, exactamente una vez por evento de reembolso/contracargo (Tarea 9); si la
//     REVERSION misma falla, se propaga (M34) para que el webhook responda 500.
//
// Las dependencias de Firestore y del envio de correo son PARAMETROS con un valor por defecto
// (las funciones reales de server/cuentas.ts y server/avisos.ts) — mismo motivo que
// server/trm.ts/server/webhook.ts inyectan `fetchLike`/`obtenerPago`: permite probar la
// idempotencia end-to-end con el doble de Firestore de tests/_fakeFirestore.ts y un `enviarCorreo`
// falso, sin tocar Firestore real (que en este entorno no tiene emulador disponible, igual que el
// resto de Tareas 2/3/6/14).
import {
  enviarCorreo as enviarCorreoReal,
  construirCorreoConfirmacionCompra,
  construirAvisoVentaLeonardo,
  construirAvisoReembolsoLeonardo,
  construirAvisoBloqueoProveedorLeonardo,
  tienePlaceholderPendiente,
  type DatosCorreo,
  type DatosConfirmacionCompra,
} from "./avisos";
import {
  reclamarEnvioCorreo as reclamarEnvioCorreoReal,
  marcarCorreoEnviado as marcarCorreoEnviadoReal,
  liberarReclamoCorreo as liberarReclamoCorreoReal,
  obtenerAceptacion as obtenerAceptacionReal,
  revertirPagoSiNoRevertido as revertirPagoSiNoRevertidoReal,
  obtenerEstadoCorreoComprador as obtenerEstadoCorreoCompradorReal,
  registrarIntentoAcuse as registrarIntentoAcuseReal,
  type DestinatarioCorreo,
  type Idioma,
  type ResultadoReversion,
} from "./cuentas";

/** Correo donde Leonardo recibe los avisos de venta/reembolso (Tarea 5/9) — el UNICO correo de
 * contacto del producto, igual que el resto del proyecto (checkout, plantilla de compra). */
export const CORREO_LEONARDO = "contacto@leonardoantolinez.com";

function enlaceTerminos(): string {
  const base = process.env.PUBLIC_BASE_URL || "https://certisendpro.online";
  return `${base}/terminos`;
}

export interface DatosNotificarActivacion {
  uid: string;
  paymentId: string;
  /** Id de `preferencias/{id}`/`aceptaciones/{id}` (el mismo, ver server/cobroPaquete.ts). */
  referenciaId: string;
  cop: number;
  trm: number;
  fechaTrm: string;
  fechaPago: Date;
  fechaVencimiento: Date;
}

export interface NotificarActivacionDeps {
  /** `ahora` (M37, corrige vuelta 28): opcional — para fijar la hora del reclamo en pruebas y
   * para que `reintentarAcusePendiente` pueda reclamar "acuse20h" con la misma hora que usa para
   * decidir si ya pasaron 20 horas. Sin el, usa la hora real del servidor (igual que antes). */
  reclamarEnvioCorreo(paymentId: string, destinatario: DestinatarioCorreo, ahora?: Date): Promise<boolean>;
  marcarCorreoEnviado(paymentId: string, destinatario: DestinatarioCorreo): Promise<void>;
  liberarReclamoCorreo(paymentId: string, destinatario: DestinatarioCorreo): Promise<void>;
  obtenerAceptacion(id: string): Promise<{ email: string | null; idioma: Idioma } | null>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
  /** Compone el correo de confirmacion al comprador — inyectable (por defecto,
   * `construirCorreoConfirmacionCompra` real) para poder probar el reclamo transaccional (M35) y
   * el bloqueo por dato pendiente (M36(2)) por separado, sin que uno dependa del contenido real
   * del otro. */
  construirCorreoComprador(datos: DatosConfirmacionCompra): { asunto: string; texto: string };
}

const depsNotificarActivacionReales: NotificarActivacionDeps = {
  reclamarEnvioCorreo: reclamarEnvioCorreoReal,
  marcarCorreoEnviado: marcarCorreoEnviadoReal,
  liberarReclamoCorreo: liberarReclamoCorreoReal,
  obtenerAceptacion: obtenerAceptacionReal,
  enviarCorreo: enviarCorreoReal,
  construirCorreoComprador: construirCorreoConfirmacionCompra,
};

/**
 * M35 (corrige vuelta 27): reclama el envio a `destinatario` de forma TRANSACCIONAL ANTES de
 * mandar nada (`reclamarEnvioCorreo`, ver server/cuentas.ts `reclamarEnvioCorreoTx`). Si otra
 * entrega (casi simultanea, o una anterior) ya se quedo con este destinatario, no hace nada — por
 * eso dos avisos casi simultaneos del mismo pago producen UN solo correo por destinatario. Si el
 * envio falla, LIBERA el reclamo (vuelve a `null`) para que una entrega futura pueda reintentar
 * SOLO este destinatario, sin reenviar al otro.
 */
async function intentarEnviarUnDestinatario(
  paymentId: string,
  deps: NotificarActivacionDeps,
  destinatario: DestinatarioCorreo,
  correo: DatosCorreo
): Promise<void> {
  const reclamado = await deps.reclamarEnvioCorreo(paymentId, destinatario);
  if (!reclamado) return; // ya reclamado o ya enviado por otra entrega.

  const ok = await deps.enviarCorreo(correo);
  await cerrarReclamoConReintento(paymentId, deps, destinatario, ok);
}

/**
 * Hallazgo de `/code-review` sobre el commit de M33-M36 (vuelta 27): `enviarCorreo` nunca lanza
 * (siempre resuelve `boolean`, ver server/avisos.ts), pero la escritura que CIERRA el reclamo
 * (`marcarCorreoEnviado`/`liberarReclamoCorreo`) SI puede fallar (Firestore sin red justo en ese
 * instante) — y si eso pasa, el campo queda en `"reclamado"` para siempre: `reclamarEnvioCorreoTx`
 * trata cualquier valor truthy como "ya tomado" (server/cuentas.ts), asi que ninguna entrega
 * futura del mismo `paymentId` reintentaria ESE destinatario.
 *
 * Mitigacion MINIMA (deliberada: NO es una reconciliacion completa con TTL/cron, que seria una
 * tarea aparte y el propio `/code-review` la califico de "no bloqueante" para el lanzamiento): un
 * reintento INMEDIATO de la MISMA operacion (nunca cambia de `marcarCorreoEnviado` a
 * `liberarReclamoCorreo` o viceversa — eso arriesgaria un reenvio duplicado si el correo YA se
 * mando). Si el reintento TAMBIEN falla, se deja un log con un marcador fijo y grepable
 * (`RECLAMO_SIN_SALIDA`) para resolverlo a mano en Firestore — mismo patron ya aceptado en este
 * proyecto para la devolucion manual de la Tarea 9.
 */
async function cerrarReclamoConReintento(
  paymentId: string,
  deps: NotificarActivacionDeps,
  destinatario: DestinatarioCorreo,
  envioOk: boolean
): Promise<void> {
  const cerrarReclamo = () =>
    envioOk
      ? deps.marcarCorreoEnviado(paymentId, destinatario)
      : deps.liberarReclamoCorreo(paymentId, destinatario);
  try {
    await cerrarReclamo();
  } catch (error: any) {
    console.error(
      `[NOTIFICACIONES] fallo al cerrar el reclamo de correo (reintentando una vez). paymentId=${paymentId} destinatario=${destinatario}:`,
      error?.message || error
    );
    try {
      await cerrarReclamo();
    } catch (error2: any) {
      console.error(
        `[NOTIFICACIONES] RECLAMO_SIN_SALIDA: el reclamo de "${destinatario}" para paymentId=${paymentId} quedo en "reclamado" tras 2 fallos seguidos de Firestore. ` +
          `Resolver a mano en pagosProcesados/${paymentId}: debe quedar en ${envioOk ? '"enviado" (el correo SI se mando)' : "null (para que una entrega futura reintente)"}.`,
        error2?.message || error2
      );
    }
  }
}

/**
 * Tarea 5: envia el correo de confirmacion de compra al comprador + el aviso de venta a Leonardo.
 * Nunca lanza: cualquier fallo (relay caido, Firestore sin red) queda en un log y la funcion
 * resuelve igual — el llamador (`procesarWebhookMP`) ya la envuelve en su propio try/catch como
 * defensa en profundidad, pero esta funcion no depende de eso para ser segura.
 *
 * Los DOS destinatarios se reclaman/envian de forma INDEPENDIENTE (M35): si falla el de Leonardo,
 * el del comprador (si ya salio) nunca se reenvia, y viceversa — cada uno tiene su propio campo en
 * `pagosProcesados/{paymentId}` (ver server/cuentas.ts).
 *
 * M36(2): si el correo del comprador, ya compuesto, todavia contiene un dato marcado como
 * pendiente (el pie del proveedor, o cualquier otro placeholder — ver `tienePlaceholderPendiente`
 * en server/avisos.ts), NUNCA se manda al comprador: se registra el bloqueo (log) y se avisa a
 * Leonardo UNA SOLA VEZ por pago (mismo mecanismo de reclamo, destinatario "bloqueoProveedor").
 */
export async function notificarActivacionPaquete(
  datos: DatosNotificarActivacion,
  deps: NotificarActivacionDeps = depsNotificarActivacionReales
): Promise<void> {
  try {
    const aceptacion = await deps.obtenerAceptacion(datos.referenciaId);

    if (aceptacion?.email) {
      const correoComprador = deps.construirCorreoComprador({
        paraEmail: aceptacion.email,
        idioma: aceptacion.idioma,
        cop: datos.cop,
        trm: datos.trm,
        fechaTrm: datos.fechaTrm,
        fechaPago: datos.fechaPago,
        fechaVencimiento: datos.fechaVencimiento,
        refMp: datos.paymentId,
        enlaceTerminos: enlaceTerminos(),
      });

      if (tienePlaceholderPendiente(correoComprador.texto)) {
        console.error(
          `[NOTIFICACIONES] acuse de compra BLOQUEADO (dato pendiente en el correo). paymentId=${datos.paymentId}`
        );
        const avisoBloqueo = construirAvisoBloqueoProveedorLeonardo({ uid: datos.uid, paymentId: datos.paymentId });
        await intentarEnviarUnDestinatario(datos.paymentId, deps, "bloqueoProveedor", {
          para: CORREO_LEONARDO,
          ...avisoBloqueo,
        });
      } else {
        await intentarEnviarUnDestinatario(datos.paymentId, deps, "comprador", {
          para: aceptacion.email,
          ...correoComprador,
        });
      }
    } else {
      console.warn(`[NOTIFICACIONES] sin correo de comprador para paymentId=${datos.paymentId} (aceptacion ausente o sin email).`);
    }

    const avisoVenta = construirAvisoVentaLeonardo({
      uid: datos.uid,
      paymentId: datos.paymentId,
      cop: datos.cop,
      plan: "paquete",
    });
    await intentarEnviarUnDestinatario(datos.paymentId, deps, "leonardo", { para: CORREO_LEONARDO, ...avisoVenta });
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo al notificar la activacion. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

export interface AvisarReembolsoDeps {
  revertirPago(paymentId: string, uid: string): Promise<ResultadoReversion>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
}

const depsAvisarReembolsoReales: AvisarReembolsoDeps = {
  revertirPago: revertirPagoSiNoRevertidoReal,
  enviarCorreo: enviarCorreoReal,
};

/**
 * Tarea 9: ante un reembolso/contracargo, revierte la cuenta a Gratis SI el pago era el activo
 * (ver `revertirPagoSiNoRevertido`, idempotente por su cuenta) y avisa a Leonardo — en los DOS
 * casos (activo o no), salvo que el evento ya se hubiera procesado antes o el pago nunca fuera
 * nuestro.
 *
 * M34 (corrige vuelta 27): a diferencia de `notificarActivacionPaquete` (que traga CUALQUIER
 * error, porque el pago ya quedo activado y no hay nada que reintentar sin riesgo), aqui un fallo
 * de `revertirPago` (Firestore sin red, por ejemplo) se DEJA PROPAGAR a proposito: `revertirPago`
 * es idempotente (gate en `revertido`, server/cuentas.ts), asi que es seguro que
 * `server/webhook.ts` responda 500 y Mercado Pago reintente el aviso completo, en vez de tragar el
 * error y arriesgarse a que una cuenta que debia revertirse se quede en Paquete/Pro. El aviso a
 * Leonardo (una vez que la reversion YA tuvo exito) si es best-effort: nunca debe tumbar una
 * reversion que ya se aplico.
 */
export async function avisarReembolsoPaquete(
  datos: { uid: string; paymentId: string; status: string },
  deps: AvisarReembolsoDeps = depsAvisarReembolsoReales
): Promise<void> {
  const resultado = await deps.revertirPago(datos.paymentId, datos.uid);
  if (resultado === "ya_procesado" || resultado === "ignorado") return;

  const { asunto, texto } = construirAvisoReembolsoLeonardo({
    uid: datos.uid,
    paymentId: datos.paymentId,
    status: datos.status,
    cuentaRevertida: resultado === "revertido",
  });
  try {
    await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
  } catch (error: any) {
    // El aviso a Leonardo es best-effort: la reversion (lo que de verdad importa) YA tuvo exito.
    console.error(`[NOTIFICACIONES] fallo al avisar el reembolso a Leonardo (la reversión SÍ quedó). paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

// ── M37 (corrige vuelta 28, "reclamo atascado y sin reintento", 2026-10-05) ─────────────────────
// Reintento del acuse de compra, sin Cloud Scheduler (su API no esta habilitada en este proyecto):
// dos disparadores en server.ts llaman a `reintentarAcusePendiente` por cada pago candidato que
// encuentran (GET /api/cuenta, por uid; el barrido del webhook, de cualquier uid) — ver
// server/cuentas.ts `listarPagosPendientesDeAcuse`/`listarPagosParaBarridoGlobal`.
//
// Reconstruye los MISMOS datos que uso la entrega original del webhook a partir de lo que
// `activarPaqueteSiNoProcesadoTx` ya guardo en `pagosProcesados/{paymentId}` (M37) y vuelve a
// llamar a `notificarActivacionPaquete` — que YA es idempotente POR DESTINATARIO (M35): si
// Leonardo ya tiene su correo, no se reenvia; si el comprador ya lo tiene, tampoco. Nunca vuelve a
// consultar Mercado Pago ni toca el saldo/plan del usuario — el pago YA esta activado, esto es
// solo el correo.

/** La ley exige el acuse a mas tardar el dia siguiente al pago (docs/legal/plantilla-confirmacion-
 * compra.md). 20h (no 24h) da margen para que el reintento automatico lo resuelva solo antes de
 * escalar a una persona, sin acercarse tanto al plazo legal que el aviso llegue demasiado tarde
 * para que Leonardo pueda hacer algo con el. */
const VEINTE_HORAS_MS = 20 * 3600_000;

function construirAvisoAcuse20hLeonardo(datos: { uid: string; paymentId: string }): {
  asunto: string;
  texto: string;
} {
  return {
    asunto: `[CertiSend] Acuse de compra SIN ENVIAR 20 horas despues del pago`,
    texto:
      `El acuse de compra del pago ${datos.paymentId} (uid ${datos.uid}) todavia no se ha enviado ` +
      `al comprador 20 horas despues del pago. La ley exige enviarlo a mas tardar el dia siguiente ` +
      `al pago (docs/legal/plantilla-confirmacion-compra.md). El reintento automatico (GET /api/cuenta ` +
      `del usuario, o el barrido del webhook) ya lo intento sin exito — revisa AVISOS_RELAY_URL/` +
      `AVISOS_RELAY_SECRET y los logs de Cloud Run, y si hace falta manda el acuse a mano. ` +
      `Este aviso no se repite para este pago.`,
  };
}

export interface DatosReintentoAcusePendiente {
  paymentId: string;
  uid: string;
  /** `null` si el pago se activo antes de M37 (sin estos datos guardados): en ese caso no hay con
   * que reconstruir el aviso de forma segura y no se reintenta nada automaticamente. */
  referenciaId: string | null;
  cop: number;
  trm: number;
  fechaTrm: string | null;
  /** Fecha DEL PAGO (nunca de cuando se detecto el pendiente). */
  fecha: Date;
  /** Fecha de vencimiento del Paquete activado por ESTE pago. */
  vence: Date;
  /** G3 (correccion NO-GO vuelta 30): true si Mercado Pago reembolso/contracargo este pago.
   * Opcional (`?? false`) para no romper llamadas existentes que todavia no lo reconstruyen;
   * `datosReintentoDesdePago` (server/tareasFondo.ts) SIEMPRE lo manda en produccion. */
  revertido?: boolean;
}

export interface ReintentarAcuseDeps extends NotificarActivacionDeps {
  obtenerEstadoCorreoComprador(paymentId: string): Promise<string | null>;
  /** M2 (correccion NO-GO vuelta 30): registra un intento mas de reintento del acuse (incrementa
   * `intentosAcuse`, guarda `ultimoIntentoAcuseEn`); al llegar a `MAX_INTENTOS_ACUSE` marca
   * `estadoAcuse="agotado"` en vez de contar un intento nuevo. Ver server/cuentas.ts
   * `registrarIntentoAcuseTx`. */
  registrarIntentoAcuse(paymentId: string, ahora: Date): Promise<{ intentos: number; agotado: boolean }>;
}

const depsReintentarAcuseReales: ReintentarAcuseDeps = {
  ...depsNotificarActivacionReales,
  obtenerEstadoCorreoComprador: obtenerEstadoCorreoCompradorReal,
  registrarIntentoAcuse: registrarIntentoAcuseReal,
};

/** M2 (correccion NO-GO vuelta 30, 2026-10-05): log con marcador FIJO y grepable para que una
 * alerta de Cloud Logging lo capture (el Brain la configura, ver docs/ops.md) — se emite cuando
 * `registrarIntentoAcuse` agota el tope de intentos (`MAX_INTENTOS_ACUSE`) y el acuse de compra
 * sigue sin salir. `console.error` (nunca `console.log`): es una condicion que requiere atencion
 * humana, no informativa. */
function logAlertaAcuseAtrasado(datos: { paymentId: string; uid: string; fecha: Date }, ahora: Date): void {
  const horas = Math.round((ahora.getTime() - datos.fecha.getTime()) / 3600_000);
  console.error("ALERTA_ACUSE_ATRASADO", { paymentId: datos.paymentId, uid: datos.uid, horas });
}

/**
 * M37: reintenta el acuse de UN pago que todavia no tiene `correoComprador="enviado"`. Nunca
 * lanza (defensa en profundidad: la llama server.ts en segundo plano, sin bloquear ninguna
 * respuesta HTTP). Tras reintentar, si han pasado 20h o mas desde el pago Y el acuse SIGUE sin
 * salir, avisa a Leonardo UNA sola vez (mismo mecanismo de reclamo que los demas destinatarios de
 * correo, destinatario "acuse20h" — ver server/cuentas.ts).
 *
 * G3 (correccion NO-GO vuelta 30): defensa en profundidad — un pago `revertido` NUNCA reintenta
 * (el comprador ya no tiene nada que confirmar). En la practica, quien selecciona los candidatos
 * (`seleccionarPagosParaBarrido`/`listarPagosPendientesDeAcuse`, server/cuentas.ts) ya filtra esto
 * antes de llegar aqui; este chequeo es la segunda capa, por si algun llamador futuro se salta esa
 * seleccion.
 *
 * M2 (correccion NO-GO vuelta 30): antes de intentar el envio, registra un intento mas
 * (`registrarIntentoAcuse`). Si eso agota el tope (`MAX_INTENTOS_ACUSE`), NO se intenta el envio
 * esta vez — se emite `ALERTA_ACUSE_ATRASADO` (log con marcador fijo) y se retorna.
 */
export async function reintentarAcusePendiente(
  datos: DatosReintentoAcusePendiente,
  ahora: Date = new Date(),
  deps: ReintentarAcuseDeps = depsReintentarAcuseReales
): Promise<void> {
  try {
    if (datos.revertido === true) {
      console.warn(`[NOTIFICACIONES] G3: pago ${datos.paymentId} revertido; no se reintenta el acuse.`);
      return;
    }

    if (!datos.referenciaId || !datos.fechaTrm) {
      // Pago de antes de M37 (activado sin estos datos) o con datos incompletos: no hay con que
      // reconstruir el correo con seguridad. Queda igual que antes — atendible a mano, sin
      // reintento automatico (mismo patron ya aceptado en este proyecto para otros "pendiente").
      console.warn(`[NOTIFICACIONES] M37: pago ${datos.paymentId} sin referenciaId/fechaTrm guardados; no se puede reintentar el acuse automaticamente.`);
      return;
    }

    const { agotado } = await deps.registrarIntentoAcuse(datos.paymentId, ahora);
    if (agotado) {
      logAlertaAcuseAtrasado(datos, ahora);
      return; // M2: tope de intentos agotado — no se vuelve a intentar automaticamente.
    }

    await notificarActivacionPaquete(
      {
        uid: datos.uid,
        paymentId: datos.paymentId,
        referenciaId: datos.referenciaId,
        cop: datos.cop,
        trm: datos.trm,
        fechaTrm: datos.fechaTrm,
        fechaPago: datos.fecha,
        fechaVencimiento: datos.vence,
      },
      deps
    );

    if (ahora.getTime() - datos.fecha.getTime() < VEINTE_HORAS_MS) return;

    // Se relee el estado DESPUES del reintento de arriba (pudo acabar de enviarse justo ahora).
    const estadoActual = await deps.obtenerEstadoCorreoComprador(datos.paymentId);
    if (estadoActual === "enviado") return;

    const reclamado = await deps.reclamarEnvioCorreo(datos.paymentId, "acuse20h", ahora);
    if (!reclamado) return; // ya se aviso antes por esta misma racha, o alguien lo esta avisando ahora.

    const { asunto, texto } = construirAvisoAcuse20hLeonardo({ uid: datos.uid, paymentId: datos.paymentId });
    const ok = await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
    if (ok) await deps.marcarCorreoEnviado(datos.paymentId, "acuse20h");
    else await deps.liberarReclamoCorreo(datos.paymentId, "acuse20h");
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo el reintento del acuse pendiente. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}
