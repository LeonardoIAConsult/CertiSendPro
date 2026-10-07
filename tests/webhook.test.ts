// Pruebas del webhook de Mercado Pago (Tarea 6, cobro real con planes, 2026-10-05). Inyectan un
// fetch falso de MP (via `obtenerPago`) y el doble de Firestore de tests/_fakeFirestore.ts para la
// activacion real del Paquete (nunca un mock que "simula el exito": se usa la MISMA funcion
// transaccional que produccion, sobre un almacen falso) — mismo patron que
// tests/registrarEnvio.test.ts. Cubre:
//   - aprobado y correcto -> activa 150, vence +1 mes, reservadosPaquete 0.
//   - mismo pago dos veces -> una sola activacion (idempotencia real, no un contador de llamadas).
//   - referencia de Faro -> ignorado con 200, nunca activa.
//   - monto distinto -> no activa.
//   - status pending/rejected -> no activa.
//   - cuerpo falsificado (approved) mientras MP dice rejected -> no activa (la query ignora el body).
//   - error 5xx de MP -> 500 (para que Mercado Pago reintente).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { procesarWebhookMP, registrarResultadoWebhook, type RespuestaPagoMP } from "../server/webhook";
import {
  activarPaqueteSiNoProcesado,
  _usarFirestoreParaPruebas,
  type Cuenta,
  type PreferenciaGuardada,
} from "../server/cuentas";
import { FirestoreFalso } from "./_fakeFirestore";

/** Respuesta OK de GET /v1/payments/{id} con los campos que lee el webhook. */
function pagoOk(datos: Partial<{
  status: string;
  status_detail: string;
  currency_id: string;
  transaction_amount: number;
  external_reference: string;
  date_approved: string;
}>): RespuestaPagoMP {
  const cuerpo = {
    status: "approved",
    currency_id: "COP",
    transaction_amount: 49102,
    external_reference: "CERTISEND|uid-1|paquete|49102|ref-1",
    date_approved: "2026-10-05T10:00:00.000-05:00",
    ...datos,
  };
  return { ok: true, status: 200, json: async () => cuerpo };
}

function pagoError(status: number): RespuestaPagoMP {
  return { ok: false, status, json: async () => ({}) };
}

/** Preferencia guardada por create-preference para uid-1/paquete/49102, salvo lo que se sobreescriba. */
function preferenciaBase(parcial: Partial<PreferenciaGuardada> = {}): PreferenciaGuardada {
  return {
    uid: "uid-1",
    plan: "paquete",
    cop: 49102,
    trm: 3273.49,
    fechaTrm: "2026-10-03",
    creado: Timestamp.now(),
    ...parcial,
  };
}

/**
 * M1 (correccion NO-GO vuelta 30, 2026-10-05): activa de verdad contra un FirestoreFalso (no un
 * mock) llamando al ENVOLTORIO REAL `activarPaqueteSiNoProcesado` (antes esta funcion llamaba
 * directo a `activarPaqueteSiNoProcesadoTx` y agregaba `uid` ella misma al armar los parametros —
 * las conexiones de produccion de verdad, el envoltorio que abre `db().collection().doc()` y
 * `db().runTransaction(...)`, nunca tenian su propia prueba). `_usarFirestoreParaPruebas` apunta
 * el `db()` interno de server/cuentas.ts a ESTE FirestoreFalso; el envoltorio real es el que
 * decide pasar `uid` a la transaccion, exactamente como en Cloud Run.
 */
function activarPaqueteConFake(db: FirestoreFalso) {
  _usarFirestoreParaPruebas(db);
  return activarPaqueteSiNoProcesado;
}

function obtenerPreferenciaConFake(db: FirestoreFalso, preferencias: Record<string, PreferenciaGuardada>) {
  // Simula `preferencias/{id}` ya sembrada: no hace falta pasar por runTransaction, es una lectura simple.
  for (const [id, datos] of Object.entries(preferencias)) {
    db.seed(`preferencias/${id}`, datos as unknown as Record<string, any>);
  }
  return async (id: string): Promise<PreferenciaGuardada | null> => {
    const data = db.leer(`preferencias/${id}`);
    return data ? (data as PreferenciaGuardada) : null;
  };
}

const logsCapturados: string[] = [];
function logMudo(linea: string) {
  logsCapturados.push(linea);
}

/** Llamadas a `notificarActivacion`/`procesarReembolso`/`avisarPagoDoble` capturadas por el
 * ultimo `construirOpts` (reseteadas en cada llamada): las pruebas de Tareas 5/9/Medio 4 a nivel
 * de webhook (que inyectan un stub, no la composicion real de server/notificaciones.ts — esa se
 * prueba aparte en tests/notificaciones.test.ts) solo necesitan confirmar CUANTAS veces y con
 * que datos se llamo. */
export const llamadasNotificarActivacion: any[] = [];
export const llamadasProcesarReembolso: any[] = [];
export const llamadasAvisarPagoDoble: any[] = [];
export const llamadasActivarPorUso: any[] = [];
export const llamadasNotificarActivacionPorUso: any[] = [];

function construirOpts(overrides: Partial<{
  tipo: string;
  paymentId: string;
  obtenerPago: (id: string) => Promise<RespuestaPagoMP>;
  obtenerPreferencia: (id: string) => Promise<PreferenciaGuardada | null>;
  activarPaquete: (
    uid: string,
    paymentId: string,
    datos: { cop: number; trm: number; fecha: Timestamp; referenciaId: string; fechaTrm: string }
  ) => Promise<"activado" | "repetido" | "requiere_reembolso">;
  activarPorUso: (
    uid: string,
    paymentId: string,
    datos: { cantidad: number; cop: number; trm: number; fecha: Timestamp }
  ) => Promise<"activado" | "repetido">;
  notificarActivacion: (datos: any) => Promise<void>;
  notificarActivacionPorUso: (datos: any) => Promise<void>;
  procesarReembolso: (datos: any) => Promise<void>;
  avisarPagoDoble: (datos: any) => Promise<void>;
}>) {
  return {
    tipo: "payment",
    paymentId: "pago-1",
    obtenerPago: async () => pagoOk({}),
    obtenerPreferencia: async () => preferenciaBase(),
    activarPaquete: async () => "activado" as const,
    activarPorUso: async (...args: any[]) => {
      llamadasActivarPorUso.push(args);
      return "activado" as const;
    },
    timestampDesdeFecha: (fecha: Date) => Timestamp.fromDate(fecha),
    log: logMudo,
    notificarActivacion: async (datos: any) => {
      llamadasNotificarActivacion.push(datos);
    },
    notificarActivacionPorUso: async (datos: any) => {
      llamadasNotificarActivacionPorUso.push(datos);
    },
    procesarReembolso: async (datos: any) => {
      llamadasProcesarReembolso.push(datos);
    },
    avisarPagoDoble: async (datos: any) => {
      llamadasAvisarPagoDoble.push(datos);
    },
    ...overrides,
  };
}

// ── Caso feliz: aprobado y correcto -> activa 150, vence +1 mes, reservadosPaquete 0 ───────────

test("webhook: pago aprobado y correcto activa el Paquete (150 envios, vence +1 mes, reservadosPaquete 0)", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => pagoOk({}), obtenerPreferencia, activarPaquete })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(resultado.razon, "activado");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.plan, "paquete");
  assert.equal(cuenta.enviosRestantes, 150);
  assert.equal(cuenta.reservadosPaquete, 0);
  assert.ok(cuenta.ultimoPago);
  assert.equal(cuenta.ultimoPago!.id, "pago-1");
  assert.equal(cuenta.ultimoPago!.cop, 49102);

  // date_approved = 2026-10-05T10:00:00-05:00 -> +1 mes de calendario = 2026-11-05 (misma hora).
  const venceISO = cuenta.vence!.toDate().toISOString();
  assert.equal(venceISO.slice(0, 10), "2026-11-05");

  const pagoProcesado = db.leer("pagosProcesados/pago-1");
  assert.ok(pagoProcesado, "el pago debe quedar marcado como procesado");
  // M1 (correccion NO-GO vuelta 30): el ENVOLTORIO REAL `activarPaqueteSiNoProcesado` (no solo su
  // `...Tx`) es quien debe guardar el uid en `pagosProcesados/{id}` — esta prueba llama al
  // envoltorio real (ver `activarPaqueteConFake` arriba), asi que detecta si alguien quita `uid`
  // de ese envoltorio.
  assert.equal(pagoProcesado!.uid, "uid-1", "el envoltorio real debe guardar el uid del pago");
});

// ── Idempotencia: mismo pago dos veces -> una sola activacion ──────────────────────────────────

test("webhook: el mismo pago avisado dos veces activa una sola vez (idempotencia real)", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);
  const opts = construirOpts({ obtenerPago: async () => pagoOk({}), obtenerPreferencia, activarPaquete });

  const r1 = await procesarWebhookMP(opts);
  const r2 = await procesarWebhookMP(opts);

  assert.equal(r1.razon, "activado");
  assert.equal(r2.razon, "pago ya procesado (idempotencia)");
  assert.equal(r2.httpStatus, 200);

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.enviosRestantes, 150, "sigue en 150: la segunda llamada no vuelve a activar");
});

// ── Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06) ───────────────────
// El comprador genero y pago DOS preferencias (p. ej. abrio el checkout dos veces antes de que
// la primera se confirmara). pago-1 llega primero y activa normalmente; pago-2 (OTRA preferencia,
// mismo uid, aprobado por Mercado Pago) NUNCA debe pisar el Paquete vigente de pago-1.

test("webhook (Medio 4): segundo pago aprobado con un Paquete vigente de OTRO pago -> no activa, avisa a Leonardo, 200", async () => {
  llamadasAvisarPagoDoble.length = 0;
  llamadasNotificarActivacion.length = 0;
  const db = new FirestoreFalso();
  const activarPaquete = activarPaqueteConFake(db);

  // pago-1 activa de verdad (misma funcion de produccion).
  const obtenerPreferencia1 = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  await procesarWebhookMP(
    construirOpts({ paymentId: "pago-1", obtenerPago: async () => pagoOk({}), obtenerPreferencia: obtenerPreferencia1, activarPaquete })
  );
  const cuentaTrasPago1 = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuentaTrasPago1.ultimoPago!.id, "pago-1");
  assert.equal(cuentaTrasPago1.enviosRestantes, 150);
  llamadasNotificarActivacion.length = 0; // limpia el aviso LEGITIMO de pago-1 antes de revisar pago-2.

  // pago-2: OTRA preferencia (ref-2) del MISMO uid, aprobada por Mercado Pago.
  db.seed("preferencias/ref-2", preferenciaBase({ cop: 49102 }) as any);
  const resultado2 = await procesarWebhookMP(
    construirOpts({
      paymentId: "pago-2",
      obtenerPago: async () => pagoOk({ external_reference: "CERTISEND|uid-1|paquete|49102|ref-2" }),
      obtenerPreferencia: async (id) => (db.leer(`preferencias/${id}`) as any) ?? null,
      activarPaquete,
    })
  );

  assert.equal(resultado2.httpStatus, 200);
  assert.match(resultado2.razon, /pago doble/);

  // La cuenta queda EXACTAMENTE igual que tras pago-1: nada se piso.
  const cuentaDespues = db.leer("cuentas/uid-1") as Cuenta;
  assert.deepEqual(cuentaDespues, cuentaTrasPago1, "la cuenta no debe cambiar ni un campo");

  // pago-2 queda registrado (idempotencia futura) pero marcado para reembolso manual.
  const pago2 = db.leer("pagosProcesados/pago-2");
  assert.ok(pago2, "pago-2 debe quedar registrado para no reintentarlo");
  assert.equal(pago2!.requiereReembolso, true);
  assert.equal(pago2!.vence, null, "nunca se activo nada con este pago");

  // Se avisa a Leonardo exactamente 1 vez con los datos de pago-2 (no de pago-1).
  assert.equal(llamadasAvisarPagoDoble.length, 1);
  assert.equal(llamadasAvisarPagoDoble[0].paymentId, "pago-2");
  assert.equal(llamadasAvisarPagoDoble[0].uid, "uid-1");

  // Nunca se notifica al comprador una compra que no se activo.
  assert.equal(llamadasNotificarActivacion.length, 0);
});

test("webhook (Medio 4): una segunda ENTREGA del mismo pago-2 (ya marcado requiere_reembolso) es 'repetido', nunca avisa dos veces", async () => {
  llamadasAvisarPagoDoble.length = 0;
  const db = new FirestoreFalso();
  const activarPaquete = activarPaqueteConFake(db);

  const obtenerPreferencia1 = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  await procesarWebhookMP(
    construirOpts({ paymentId: "pago-1", obtenerPago: async () => pagoOk({}), obtenerPreferencia: obtenerPreferencia1, activarPaquete })
  );

  db.seed("preferencias/ref-2", preferenciaBase({ cop: 49102 }) as any);
  const opts2 = construirOpts({
    paymentId: "pago-2",
    obtenerPago: async () => pagoOk({ external_reference: "CERTISEND|uid-1|paquete|49102|ref-2" }),
    obtenerPreferencia: async (id) => (db.leer(`preferencias/${id}`) as any) ?? null,
    activarPaquete,
  });

  const r1 = await procesarWebhookMP(opts2);
  const r2 = await procesarWebhookMP(opts2);

  assert.match(r1.razon, /pago doble/);
  assert.equal(r2.razon, "pago ya procesado (idempotencia)");
  assert.equal(r2.httpStatus, 200);
  assert.equal(llamadasAvisarPagoDoble.length, 1, "el aviso a Leonardo nunca se repite para el mismo pago-2");
});

// ── Pago de Faro (misma cuenta de MP) -> ignorado con 200 ───────────────────────────────────────

test("webhook: external_reference de Faro (no empieza con CERTISEND|) se ignora con 200, nunca activa", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, {});
  const activarPaquete = activarPaqueteConFake(db);
  let activarPaqueteLlamado = false;

  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({ external_reference: "FARO|algo|otra-cosa" }),
      obtenerPreferencia,
      activarPaquete: async (...args) => {
        activarPaqueteLlamado = true;
        return activarPaquete(...args);
      },
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(activarPaqueteLlamado, false, "un pago de Faro nunca debe intentar activar nada de CertiSend");
  assert.equal(db.leer("cuentas/uid-1"), undefined);
});

// ── Monto distinto -> no activa ──────────────────────────────────────────────────────────────

test("webhook: transaction_amount distinto del cop en external_reference no activa", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({
      // MP dice que de verdad se cobraron 1000, pero el external_reference (armado por nosotros
      // al crear la preferencia) decia 49102: no coinciden, no se activa nada.
      obtenerPago: async () => pagoOk({ transaction_amount: 1000 }),
      obtenerPreferencia,
      activarPaquete,
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(db.leer("cuentas/uid-1"), undefined, "sin coincidencia de monto, la cuenta no se toca");
});

// ── status pending / rejected -> no activa ───────────────────────────────────────────────────

for (const status of ["pending", "rejected", "in_process", "cancelled"]) {
  test(`webhook: status="${status}" (no approved) no activa`, async () => {
    const db = new FirestoreFalso();
    const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
    const activarPaquete = activarPaqueteConFake(db);

    const resultado = await procesarWebhookMP(
      construirOpts({ obtenerPago: async () => pagoOk({ status }), obtenerPreferencia, activarPaquete })
    );

    assert.equal(resultado.httpStatus, 200);
    assert.equal(db.leer("cuentas/uid-1"), undefined);
  });
}

// ── status_detail="partially_refunded" (vuelta 22): approved con reembolso parcial -> no activa ──
// Mercado Pago deja `status=approved` tras devolver PARTE del dinero (status_detail distingue el
// caso). Sin este chequeo, un pago parcialmente reembolsado activaria el Paquete completo igual.

test('webhook: status="approved" pero status_detail="partially_refunded" no activa', async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({ status: "approved", status_detail: "partially_refunded" }),
      obtenerPreferencia,
      activarPaquete,
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(db.leer("cuentas/uid-1"), undefined, "un reembolso parcial nunca debe activar el Paquete");
});

test('webhook: status="approved" con status_detail distinto de "partially_refunded" SI activa (no se rompe el caso normal)', async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({ status: "approved", status_detail: "accredited" }),
      obtenerPreferencia,
      activarPaquete,
    })
  );

  assert.equal(resultado.razon, "activado");
  assert.ok(db.leer("cuentas/uid-1"));
});

// ── Cuerpo falsificado (dice approved) mientras MP dice rejected -> no activa ────────────────
// El webhook NUNCA lee status del body/query de la peticion entrante: siempre vuelve a consultar
// GET /v1/payments/{id}. Esta prueba simula exactamente eso: lo que "llega" (via `tipo`/`paymentId`,
// los unicos datos que la ruta HTTP saca del cuerpo) no importa; lo unico que decide es la
// respuesta de `obtenerPago`, que aqui devuelve "rejected" sin importar lo que diga el aviso.

test("webhook: cuerpo falsificado diciendo approved, pero MP (via obtenerPago) dice rejected -> no activa", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  // El "aviso" (tipo/paymentId) es igual que siempre: la unica fuente de verdad sobre el status
  // es `obtenerPago`, que aqui devuelve rejected -- simulando que el cuerpo del POST, si se hubiera
  // leido, habria mentido diciendo "approved".
  const resultado = await procesarWebhookMP(
    construirOpts({
      tipo: "payment",
      paymentId: "pago-1",
      obtenerPago: async () => pagoOk({ status: "rejected" }),
      obtenerPreferencia,
      activarPaquete,
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(db.leer("cuentas/uid-1"), undefined, "el status real (rejected) manda, no uno falsificado");
});

// ── Error 5xx de MP -> 500 (para que Mercado Pago reintente) ────────────────────────────────

test("webhook: error 5xx de Mercado Pago al consultar el pago -> 500", async () => {
  const resultado = await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => pagoError(503) })
  );
  assert.equal(resultado.httpStatus, 500);
});

test("webhook: error 4xx (pago no encontrado) -> 200, no es transitorio", async () => {
  const resultado = await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => pagoError(404) })
  );
  assert.equal(resultado.httpStatus, 200);
});

test("webhook: red caida (obtenerPago rechaza) -> 500", async () => {
  const resultado = await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => { throw new Error("red caida"); } })
  );
  assert.equal(resultado.httpStatus, 500);
});

// ── tipo distinto de "payment" (p.ej. merchant_order) -> 200, nunca llama a obtenerPago ────────

test('webhook: tipo distinto de "payment" se ignora con 200 sin consultar a Mercado Pago', async () => {
  let obtenerPagoLlamado = false;
  const resultado = await procesarWebhookMP(
    construirOpts({
      tipo: "merchant_order",
      obtenerPago: async () => {
        obtenerPagoLlamado = true;
        return pagoOk({});
      },
    })
  );
  assert.equal(resultado.httpStatus, 200);
  assert.equal(obtenerPagoLlamado, false);
});

// ── plan "pro" en el external_reference -> 200, no activa (Tarea 8 pendiente) ──────────────────

test('webhook: plan "pro" en el external_reference no activa (Tarea 8 pendiente)', async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, {});
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({ external_reference: "CERTISEND|uid-1|pro|94931|ref-pro" }),
      obtenerPreferencia,
      activarPaquete,
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(db.leer("cuentas/uid-1"), undefined);
});

// ── La preferencia guardada no coincide (cop distinto o no existe) -> no activa ────────────────

test("webhook: la preferencia guardada no coincide en cop -> no activa (defensa extra sobre el external_reference)", async () => {
  const db = new FirestoreFalso();
  // La preferencia real guardada al crear el cobro dice 49102, pero el external_reference (que
  // viaja por la red) dice 1 -- simula una referencia manipulada.
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase({ cop: 49102 }) });
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () =>
        pagoOk({ external_reference: "CERTISEND|uid-1|paquete|1|ref-1", transaction_amount: 1 }),
      obtenerPreferencia,
      activarPaquete,
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(db.leer("cuentas/uid-1"), undefined);
});

// ── M34: el 500 de una reversion fallida CUENTA para el aviso de "3 fallos seguidos" a Leonardo ──
// (server.ts `avisarSiFallaRepetido` guarda el httpStatus devuelto por procesarWebhookMP en
// `registrarResultadoWebhook`, la misma funcion pura probada en tests/registrarResultadoWebhook.test.ts;
// esta prueba encadena las dos piezas para demostrar la integracion completa: 3 reversiones
// fallidas seguidas del MISMO paymentId SI deben disparar `debeAvisar`).

test("webhook (M34): 3 reversiones fallidas seguidas del mismo paymentId alcanzan el umbral de aviso a Leonardo", async () => {
  let estado: ReturnType<typeof registrarResultadoWebhook>["estado"] | undefined;
  let debeAvisarFinal = false;
  for (let intento = 1; intento <= 3; intento++) {
    const resultado = await procesarWebhookMP(
      construirOpts({
        obtenerPago: async () => pagoOk({ status: "refunded" }),
        procesarReembolso: async () => {
          throw new Error("Firestore sin red");
        },
      })
    );
    assert.equal(resultado.httpStatus, 500, `intento ${intento} debe responder 500`);
    const r = registrarResultadoWebhook(estado, resultado.httpStatus);
    estado = r.estado;
    debeAvisarFinal = r.debeAvisar;
  }
  assert.equal(estado?.fallos, 3);
  assert.equal(debeAvisarFinal, true, "el 3er fallo SEGUIDO debe disparar el aviso a Leonardo");
});

test("webhook: id de pago inventado (sin preferencia guardada) -> no activa", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, {}); // nunca se sembro "ref-1"
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => pagoOk({}), obtenerPreferencia, activarPaquete })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(db.leer("cuentas/uid-1"), undefined);
});

// ── Log minimo (paymentId, uid, status) ──────────────────────────────────────────────────────

test("webhook: el log incluye paymentId/uid/status y nunca datos del pagador", async () => {
  logsCapturados.length = 0;
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => pagoOk({}), obtenerPreferencia, activarPaquete })
  );

  const lineaConDatos = logsCapturados.find((l) => l.includes("pago-1") && l.includes("uid-1"));
  assert.ok(lineaConDatos, "debe haber una linea de log con el paymentId y el uid");
  assert.ok(lineaConDatos!.includes("approved"));
  for (const l of logsCapturados) {
    assert.ok(!/@|payer|email|tarjeta|card/i.test(l), "el log nunca debe incluir datos del pagador");
  }
});

// ── Tarea 5 (2026-10-05): notificarActivacion se llama tras una activacion (fresca o repetida) ──

test("webhook: notificarActivacion se llama DESPUES de que activarPaquete ya resolvio (nunca antes de la transaccion de activacion)", async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const orden: string[] = [];
  const activarPaqueteReal = activarPaqueteConFake(db);

  await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({}),
      obtenerPreferencia,
      activarPaquete: async (...args) => {
        orden.push("activarPaquete");
        return activarPaqueteReal(...args);
      },
      notificarActivacion: async () => {
        orden.push("notificarActivacion");
      },
    })
  );

  assert.deepEqual(orden, ["activarPaquete", "notificarActivacion"]);
});

test("webhook: tras activar (fresco), se llama notificarActivacion exactamente 1 vez con los datos del pago", async () => {
  llamadasNotificarActivacion.length = 0;
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  await procesarWebhookMP(construirOpts({ obtenerPago: async () => pagoOk({}), obtenerPreferencia, activarPaquete }));

  assert.equal(llamadasNotificarActivacion.length, 1);
  assert.equal(llamadasNotificarActivacion[0].uid, "uid-1");
  assert.equal(llamadasNotificarActivacion[0].paymentId, "pago-1");
  assert.equal(llamadasNotificarActivacion[0].referenciaId, "ref-1");
  assert.equal(llamadasNotificarActivacion[0].cop, 49102);
});

test("webhook: tambien se llama notificarActivacion en una entrega REPETIDA del mismo pago (deja que la propia funcion decida si ya se noto)", async () => {
  llamadasNotificarActivacion.length = 0;
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);
  const opts = construirOpts({ obtenerPago: async () => pagoOk({}), obtenerPreferencia, activarPaquete });

  await procesarWebhookMP(opts);
  await procesarWebhookMP(opts);

  assert.equal(llamadasNotificarActivacion.length, 2, "se llama las 2 veces; la idempotencia de NO mandar 2 correos vive en notificarActivacion, no aqui");
});

test('webhook: si notificarActivacion LANZA, el webhook responde 200 igual (oraculo "el relay falla -> sigue respondiendo 200")', async () => {
  const db = new FirestoreFalso();
  const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
  const activarPaquete = activarPaqueteConFake(db);

  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({}),
      obtenerPreferencia,
      activarPaquete,
      notificarActivacion: async () => {
        throw new Error("el relay de avisos esta caido");
      },
    })
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(resultado.razon, "activado");
  const cuenta = db.leer("cuentas/uid-1");
  assert.ok(cuenta, "la activacion debe quedar aunque el aviso falle");
});

test("webhook: tipo distinto de payment NUNCA llama a notificarActivacion ni a procesarReembolso", async () => {
  llamadasNotificarActivacion.length = 0;
  llamadasProcesarReembolso.length = 0;
  await procesarWebhookMP(construirOpts({ tipo: "merchant_order" }));
  assert.equal(llamadasNotificarActivacion.length, 0);
  assert.equal(llamadasProcesarReembolso.length, 0);
});

// ── Tarea 9 (2026-10-05): refunded/charged_back -> procesarReembolso, nunca activarPaquete ─────

for (const status of ["refunded", "charged_back"]) {
  test(`webhook: status="${status}" llama a procesarReembolso con uid/paymentId/status y NUNCA a activarPaquete`, async () => {
    llamadasProcesarReembolso.length = 0;
    const db = new FirestoreFalso();
    const obtenerPreferencia = obtenerPreferenciaConFake(db, { "ref-1": preferenciaBase() });
    let activarPaqueteLlamado = false;

    const resultado = await procesarWebhookMP(
      construirOpts({
        obtenerPago: async () => pagoOk({ status }),
        obtenerPreferencia,
        activarPaquete: async () => {
          activarPaqueteLlamado = true;
          return "activado" as const;
        },
      })
    );

    assert.equal(resultado.httpStatus, 200);
    assert.equal(activarPaqueteLlamado, false, `un pago "${status}" nunca debe intentar activar nada`);
    assert.equal(llamadasProcesarReembolso.length, 1);
    assert.deepEqual(llamadasProcesarReembolso[0], { uid: "uid-1", paymentId: "pago-1", status, referenciaId: "ref-1", plan: "paquete" });
  });
}

test('webhook: status_detail="charged_back" (sin status top-level) tambien dispara procesarReembolso', async () => {
  llamadasProcesarReembolso.length = 0;
  const resultado = await procesarWebhookMP(
    construirOpts({ obtenerPago: async () => pagoOk({ status: "", status_detail: "charged_back" }) })
  );
  assert.equal(resultado.httpStatus, 200);
  assert.equal(llamadasProcesarReembolso.length, 1);
});

test("webhook: un reembolso de un plan que no es paquete (pro, Tarea 8) no llama a procesarReembolso (se ignora antes)", async () => {
  llamadasProcesarReembolso.length = 0;
  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({ status: "refunded", external_reference: "CERTISEND|uid-1|pro|94931|ref-pro" }),
    })
  );
  assert.equal(resultado.httpStatus, 200);
  assert.equal(llamadasProcesarReembolso.length, 0);
});

test('webhook (M34, corrige vuelta 27): si procesarReembolso LANZA, el webhook responde 500 (la reversion es idempotente, que Mercado Pago reintente)', async () => {
  const resultado = await procesarWebhookMP(
    construirOpts({
      obtenerPago: async () => pagoOk({ status: "refunded" }),
      procesarReembolso: async () => {
        throw new Error("fallo inesperado");
      },
    })
  );
  assert.equal(resultado.httpStatus, 500);
});
