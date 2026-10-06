// Logica de creacion del cobro del Paquete (Tarea 14, cobro real con planes, 2026-10-05).
// Separada de server.ts (mismo patron que server/webhook.ts, server/trm.ts y server/cuentas.ts)
// para poder probar con node:test, sin red ni Firestore real ni arrancar Express, que:
//   - sin `aceptaTerminos`/`aceptaRetracto` en `true` -> 400 claro y NUNCA se guarda preferencia,
//     NUNCA se guarda aceptacion, NUNCA se llama a Mercado Pago;
//   - con las dos casillas -> la aceptacion queda guardada y ENLAZADA a la preferencia (mismo id)
//     ANTES de llamar a Mercado Pago — nunca despues, nunca en paralelo sin esperar el `await`.
//
// Quien llama a esta funcion (server.ts) ya resolvio antes: que `PAGOS_ACTIVOS` este encendido,
// que el plan pedido sea "paquete" y que exista el access token de Mercado Pago — esos tres no
// necesitan Firestore ni fetch inyectado para probarse, por eso se quedan en la ruta HTTP.
import type { Idioma, Modalidad, Plan } from "./cuentas";
import { TERMINOS_VERSION, normalizarIdioma, textoCasillaRetracto, textoCasillaTerminos } from "./cuentas";

export interface TrmDelDia {
  valor: number;
  fechaDesde: string;
}

/** Forma minima de la respuesta de POST /checkout/preferences que necesita este modulo. */
export interface RespuestaCrearPreferenciaMP {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export interface CrearCobroPaqueteOpts {
  uid: string;
  /** Correo del token verificado (`req.email`, NUNCA uno que mande el body del navegador). */
  email: string | null;
  /** Lo que mando el navegador en el body (`req.body.aceptaTerminos`/`.aceptaRetracto`): se
   * valida aqui, no antes, para que la prueba "sin casilla -> no se crea nada" sea real. */
  aceptaTerminos: unknown;
  aceptaRetracto: unknown;
  /** El monto en COP que el navegador mostraba cuando el usuario marco las casillas (M28, corrige
   * vuelta 24). Se compara contra el COP recalculado AQUI con la TRM de este momento: si no
   * coincide (cambio la TRM, o cruzo la medianoche), no se crea nada — ver mas abajo. */
  copMostrado: unknown;
  /** Idioma en el que el usuario vio el checkout (M28): normalizado con `normalizarIdioma`. */
  idioma: unknown;
  /** Modalidad elegida. Hoy esta ruta solo sabe activar "unico" (Tarea 7 agrega "renovable" al
   * webhook); cualquier otro valor se rechaza con 400 antes de tocar Firestore o Mercado Pago. */
  modalidad: unknown;
  /** Requisito B.2 (Tarea 15, decision del Brain 2026-10-06): true si la cuenta YA tiene un
   * Paquete vigente con saldo > 0 (ver `tienePaqueteVigenteConSaldo` en server/cuentas.ts).
   * Inyectado para poder probar esta funcion con node:test sin Firestore, mismo patron que el
   * resto de dependencias de esta interfaz. */
  tienePaqueteVigente(): Promise<boolean>;
  obtenerTrm(): Promise<TrmDelDia | null>;
  copDesdeUsd(usd: number, trmValor: number): number;
  usdPaquete: number;
  /** Genera el id aleatorio de la preferencia/aceptacion (en produccion, `randomUUID`). */
  generarId(): string;
  guardarPreferencia(
    id: string,
    datos: { uid: string; plan: Plan; cop: number; trm: number; fechaTrm: string }
  ): Promise<void>;
  guardarAceptacion(
    id: string,
    datos: {
      uid: string;
      email: string | null;
      versionTerminos: string;
      plan: Plan;
      modalidad: Modalidad;
      idioma: Idioma;
      cop: number;
      trm: number;
      preferenciaId: string;
      textoCasilla: string;
      textoRetracto: string;
    }
  ): Promise<void>;
  crearPreferenciaMP(payload: {
    cop: number;
    externalReference: string;
  }): Promise<RespuestaCrearPreferenciaMP>;
  /** Log minimo para errores de Mercado Pago (nunca se manda al navegador el detalle). */
  log(linea: string): void;
}

export type ResultadoCrearCobroPaquete =
  | {
      httpStatus: 200;
      body: { success: true; initPoint: string; cop: number; usd: number; trm: number; fechaTrm: string };
    }
  | { httpStatus: 409; body: { error: string; copNuevo: number } }
  | { httpStatus: number; body: { error: string } };

export async function crearCobroPaquete(opts: CrearCobroPaqueteOpts): Promise<ResultadoCrearCobroPaquete> {
  // Tarea 14: sin las DOS casillas marcadas, no se crea preferencia, no se guarda aceptacion y
  // nunca se llama a Mercado Pago. `!== true` rechaza tambien `undefined`/`"true"`/cualquier cosa
  // que no sea el booleano `true` exacto.
  if (opts.aceptaTerminos !== true || opts.aceptaRetracto !== true) {
    return {
      httpStatus: 400,
      body: {
        error:
          "Debes marcar las casillas de los Términos y Condiciones y de inicio inmediato del servicio (sin derecho de retracto) antes de pagar.",
      },
    };
  }

  // Hoy no existe nada que active una renovacion (Tarea 7 pendiente): rechazar ANTES de calcular
  // precio o tocar Firestore, en vez de crear un cobro "unico" para una modalidad que el usuario
  // no pidio.
  const modalidad: Modalidad = opts.modalidad === "renovable" ? "renovable" : "unico";
  if (modalidad !== "unico") {
    return { httpStatus: 400, body: { error: "Esa modalidad todavía no está disponible. Elige pago único." } };
  }
  const idioma = normalizarIdioma(opts.idioma);

  // B.2 (Tarea 15, decision del Brain 2026-10-06): no se permite recomprar con un Paquete vigente
  // que todavia tenga saldo. Va ANTES de calcular TRM/cop para no tocar Firestore (preferencia,
  // aceptacion) ni Mercado Pago cuando ya esta bloqueado.
  if (await opts.tienePaqueteVigente()) {
    return {
      httpStatus: 409,
      body: { error: "Ya tienes un Paquete vigente. Agótalo o espera a que venza antes de comprar otro." },
    };
  }

  const trm = await opts.obtenerTrm();
  if (!trm) {
    return { httpStatus: 503, body: { error: "No podemos calcular el precio de hoy; intenta más tarde." } };
  }

  const cop = opts.copDesdeUsd(opts.usdPaquete, trm.valor);

  // M28 (corrige vuelta 24): el servidor manda sobre el precio, nunca el navegador — pero si lo
  // que el navegador MOSTRABA ya no coincide con lo que se cobraria ahora (cambio la TRM, paso la
  // medianoche, el checkout quedo abierto varios minutos), no se crea preferencia ni aceptacion ni
  // se llama a Mercado Pago: se devuelve el monto nuevo para que el usuario lo revise y vuelva a
  // marcar las casillas (R8 de textos-checkout.md v1.2).
  const copMostradoNum = Number(opts.copMostrado);
  if (!Number.isFinite(copMostradoNum) || copMostradoNum !== cop) {
    return { httpStatus: 409, body: { error: "El precio cambió; revisa el nuevo monto", copNuevo: cop } };
  }

  const referenciaId = opts.generarId();
  const externalReference = `CERTISEND|${opts.uid}|paquete|${cop}|${referenciaId}`;

  // El orden de estos dos `await` (y que ambos terminen ANTES de llamar a Mercado Pago, mas
  // abajo) es la prueba de la Tarea 14: nunca se dispara el pago sin que la preferencia y su
  // aceptacion ya existan guardadas, enlazadas por el mismo id.
  await opts.guardarPreferencia(referenciaId, {
    uid: opts.uid,
    plan: "paquete",
    cop,
    trm: trm.valor,
    fechaTrm: trm.fechaDesde,
  });
  await opts.guardarAceptacion(referenciaId, {
    uid: opts.uid,
    email: opts.email,
    versionTerminos: TERMINOS_VERSION,
    plan: "paquete",
    modalidad,
    idioma,
    cop,
    trm: trm.valor,
    preferenciaId: referenciaId,
    textoCasilla: textoCasillaTerminos(cop, idioma),
    textoRetracto: textoCasillaRetracto(idioma),
  });

  const respuestaMP = await opts.crearPreferenciaMP({ cop, externalReference });
  if (!respuestaMP.ok) {
    const cuerpo = await respuestaMP.json().catch(() => ({}));
    opts.log(`[MERCADO PAGO] error al crear preferencia (status=${respuestaMP.status}): ${JSON.stringify(cuerpo)}`);
    return { httpStatus: 500, body: { error: "No se pudo iniciar el pago con Mercado Pago." } };
  }

  const data = await respuestaMP.json();
  return {
    httpStatus: 200,
    body: { success: true, initPoint: data.init_point, cop, usd: opts.usdPaquete, trm: trm.valor, fechaTrm: trm.fechaDesde },
  };
}
