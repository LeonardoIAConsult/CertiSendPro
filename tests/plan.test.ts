// Pruebas de la logica PURA de la Tarea 10 (cobro real con planes, 2026-10-05): el texto del
// plan que ve el usuario y el estado del sondeo al volver de Mercado Pago. Corren con el test
// runner nativo de Node (node:test) via tsx; no tocan React ni red — src/utils/plan.ts no
// depende de nada externo, solo de la cuenta/fecha/parametro de la URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { translations } from "../src/utils/translations";
import {
  debeDetenerSondeo,
  decidirEstadoSondeo,
  ejecutarRevisionSondeo,
  formatearEstadoPlan,
  formatearFechaBogota,
  formatearMotivoRechazoLote,
  leerPagoParam,
  leerPaymentId,
  leerStatusMp,
  planActivo,
  LIMITE_SONDEO_MS,
  type CuentaInfo,
  type ResultadoFetchCuenta,
} from "../src/utils/plan";

const ahora = new Date("2026-10-05T12:00:00Z");

function cuenta(parcial: Partial<CuentaInfo>): CuentaInfo {
  return { plan: "gratis", enviosRestantes: 0, vence: null, renueva: false, ultimoPago: null, ...parcial };
}

// ── formatearEstadoPlan: Gratis, Paquete con fecha, Paquete vencido, Pro ────────────────────

test("Gratis: texto exacto del spec, sin nota", () => {
  const r = formatearEstadoPlan(cuenta({ plan: "gratis" }), "es", ahora);
  assert.equal(r.titulo, "Plan Gratis · hasta 15 certificados por lote");
  assert.equal(r.nota, undefined);
});

test("Paquete vigente con saldo: titulo con restantes+fecha y nota de los lotes <=15", () => {
  const vence = new Date(ahora.getTime() + 20 * 24 * 3600_000).toISOString(); // +20 dias
  const r = formatearEstadoPlan(cuenta({ plan: "paquete", enviosRestantes: 42, vence }), "es", ahora);
  assert.match(r.titulo, /^Paquete · te quedan 42 envíos · vencen el \d{2}\/\d{2}\/\d{4}$/);
  assert.equal(r.nota, "Los lotes de 15 certificados o menos no gastan tu saldo.");
});

test("Paquete con fecha: formatearFechaBogota da DD/MM/AAAA en zona Bogota", () => {
  // 2026-10-06T04:30:00Z = 2026-10-05 23:30 en Bogota (UTC-5): el DIA de Bogota, no el de UTC.
  const r = formatearFechaBogota("2026-10-06T04:30:00Z", true);
  assert.equal(r, "05/10/2026");
});

test("Paquete VENCIDO: se muestra como Gratis (mismo trato que decidirLote)", () => {
  const vence = new Date(ahora.getTime() - 24 * 3600_000).toISOString(); // -1 dia
  const r = formatearEstadoPlan(cuenta({ plan: "paquete", enviosRestantes: 50, vence }), "es", ahora);
  assert.equal(r.titulo, "Plan Gratis · hasta 15 certificados por lote");
  assert.equal(r.nota, undefined);
});

test("Paquete vigente pero SIN saldo (0 restantes): se muestra como Gratis", () => {
  const vence = new Date(ahora.getTime() + 10 * 24 * 3600_000).toISOString();
  const r = formatearEstadoPlan(cuenta({ plan: "paquete", enviosRestantes: 0, vence }), "es", ahora);
  assert.equal(r.titulo, "Plan Gratis · hasta 15 certificados por lote");
});

test("Pro: titulo con fecha corta (DD/MM, sin año)", () => {
  const vence = new Date(ahora.getTime() + 15 * 24 * 3600_000).toISOString();
  const r = formatearEstadoPlan(cuenta({ plan: "pro", vence }), "es", ahora);
  assert.match(r.titulo, /^Pro · envíos ilimitados · hasta \d{2}\/\d{2}$/);
});

test("Pro sin fecha de vencimiento: se trata como Gratis (igual que decidirLote en el servidor, NUNCA activo sin vence)", () => {
  const r = formatearEstadoPlan(cuenta({ plan: "pro", vence: null }), "es", ahora);
  assert.equal(r.titulo, "Plan Gratis · hasta 15 certificados por lote");
});

test("Paquete sin fecha de vencimiento: tambien se trata como Gratis", () => {
  const r = formatearEstadoPlan(cuenta({ plan: "paquete", enviosRestantes: 100, vence: null }), "es", ahora);
  assert.equal(r.titulo, "Plan Gratis · hasta 15 certificados por lote");
});

// Regresion (hallazgo de /code-review sobre el primer commit de esta tarea): formatearEstadoPlan
// y planActivo usaban DOS copias distintas del criterio de vigencia y se contradecian para un
// Paquete/Pro sin `vence` (una decia Gratis, la otra decia activo para siempre). Ahora comparten
// el mismo `planVigenteConSaldo` interno; esta prueba fija que nunca puedan volver a divergir.
test("formatearEstadoPlan y planActivo SIEMPRE coinciden en si un plan de pago sin `vence` esta vigente", () => {
  for (const plan of ["paquete", "pro"] as const) {
    const c = cuenta({ plan, enviosRestantes: 100, vence: null });
    const mostradoComoGratis = formatearEstadoPlan(c, "es", ahora).titulo === "Plan Gratis · hasta 15 certificados por lote";
    const activo = planActivo(c, ahora);
    assert.equal(mostradoComoGratis, !activo, `plan=${plan}: formatearEstadoPlan y planActivo deben coincidir`);
    assert.equal(activo, false, `plan=${plan} sin vence nunca debe ser "activo" (mismo criterio que decidirLote)`);
  }
});

// G6 (NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10): planActivo NO miraba el saldo del
// Paquete y por eso contradecia a formatearEstadoPlan (y a decidirLote en el servidor) cuando el
// saldo llegaba a 0 con el plan todavia vigente por fecha. Ahora las dos funciones comparten el
// mismo criterio `planVigenteConSaldo`.
test("G6: Paquete vigente por fecha pero con saldo 0 -> planActivo false, mismo texto Gratis que formatearEstadoPlan", () => {
  const vence = new Date(ahora.getTime() + 10 * 24 * 3600_000).toISOString();
  const c = cuenta({ plan: "paquete", enviosRestantes: 0, vence });
  assert.equal(planActivo(c, ahora), false);
  assert.equal(formatearEstadoPlan(c, "es", ahora).titulo, "Plan Gratis · hasta 15 certificados por lote");
});

test("EN: Gratis traducido", () => {
  const r = formatearEstadoPlan(cuenta({ plan: "gratis" }), "en", ahora);
  assert.equal(r.titulo, "Free plan · up to 15 certificates per batch");
});

// ── formatearMotivoRechazoLote: motivo + opciones (dividir el lote o ver planes) ────────────

test("limite_gratis: mensaje claro + opciones, en español", () => {
  const msg = formatearMotivoRechazoLote("limite_gratis", undefined, 16, "es");
  assert.match(msg, /Gratis permite hasta 15/);
  assert.match(msg, /dividir el lote/);
  assert.match(msg, /planes/);
});

// B27: batchLimitFree ofrecia "pasar a Paquete o Pro" (Pro todavia no se vende). El texto nuevo
// ya no promete un plan inexistente.
test("limite_gratis: ya NO ofrece pasar a Paquete o Pro (Pro todavia no se vende)", () => {
  const msg = formatearMotivoRechazoLote("limite_gratis", undefined, 16, "es");
  assert.doesNotMatch(msg, /pasa(r)? a Paquete o Pro/i);
  assert.doesNotMatch(msg, /upgrade to the Bundle or Pro/i);
});

test('saldo_insuficiente: "tienes 40, el lote es de 60" (spec, texto exacto de los numeros)', () => {
  const msg = formatearMotivoRechazoLote("saldo_insuficiente", 40, 60, "es");
  assert.match(msg, /Tienes 40 envíos y el lote es de 60\./);
  assert.match(msg, /dividir el lote/);
});

// ── decidirEstadoSondeo: confirmando / activo / revision / rechazado ────────────────────────
// G7/G8 (NO-GO del REVISOR_EXTERNO_LAP sobre el commit 1cdb8e7, vuelta 25, 2026-10-05): el viejo
// "ultimoPagoIdInicial" (capturado de un `ref` sincronizado un render DESPUES de `setCuenta`)
// corria dos carreras distintas — G7: en el PRIMER tick, el ref podia seguir en `null` aunque
// `fetchCuenta` ya hubiera resuelto; G8: si el webhook de Mercado Pago llegaba ANTES de esa
// primera lectura, el "inicial" capturado YA era el nuevo id y "activo" nunca se alcanzaba. Ahora
// se compara contra `paymentId`, el dato FIJO que trae la URL (nunca cambia durante el sondeo):
// no hace falta ninguna "linea base" en tiempo de ejecucion.

const lecturaOk = (c: CuentaInfo): ResultadoFetchCuenta => ({ tipo: "ok", cuenta: c });
const SIN_SESION: ResultadoFetchCuenta = { tipo: "sin-sesion" };
const ERROR_LECTURA: ResultadoFetchCuenta = { tipo: "error" };

test("sin parametro pago: no hay nada que sondear (null)", () => {
  const estado = decidirEstadoSondeo({
    pago: null,
    paymentId: null,
    statusMp: null,
    lectura: ERROR_LECTURA,
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, null);
});

test('pago=error (back_urls.failure): "rechazado" de inmediato, sin importar la cuenta ni sondear exito', () => {
  const estado = decidirEstadoSondeo({
    pago: "error",
    paymentId: "pago-1",
    statusMp: null,
    lectura: lecturaOk(
      cuenta({
        plan: "paquete",
        enviosRestantes: 150,
        vence: new Date(ahora.getTime() + 1000).toISOString(),
        ultimoPago: { id: "pago-1", fecha: ahora.toISOString() },
      })
    ),
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, "rechazado");
});

// ORACULO (oraculo del encargo, escenario 4): Mercado Pago puede reportar `status=rejected` o
// `status=failure` en la URL sin importar CUAL back_url trajo de vuelta (p. ej. `pago=ok` con
// `auto_return` pero `status=rejected`) — eso tambien es "ningun cobro", no "activo".
test('statusMp="rejected" fuerza "rechazado" aunque pago="ok" y la cuenta ya tenga un Paquete vigente', () => {
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: "rejected",
    lectura: lecturaOk(
      cuenta({
        plan: "paquete",
        enviosRestantes: 150,
        vence: new Date(ahora.getTime() + 1000).toISOString(),
        ultimoPago: { id: "pago-1", fecha: ahora.toISOString() },
      })
    ),
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, "rechazado");
});

test('statusMp="failure" tambien fuerza "rechazado"', () => {
  const estado = decidirEstadoSondeo({
    pago: "pendiente",
    paymentId: null,
    statusMp: "failure",
    lectura: ERROR_LECTURA,
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, "rechazado");
});

// G6 punto 4 (texto exacto del mensaje de "rechazado", para los dos idiomas): un pago rechazado
// nunca sondea exito, y el mensaje que ve el usuario dice claramente que no hubo cobro.
test('pago rechazado: el texto es "No se realizó ningún cobro." (ES) / "No charge was made." (EN)', () => {
  assert.equal(
    decidirEstadoSondeo({
      pago: "error",
      paymentId: null,
      statusMp: null,
      lectura: ERROR_LECTURA,
      authReady: true,
      msTranscurridos: 0,
    }),
    "rechazado"
  );
  assert.equal(translations.es.pagoRechazado, "No se realizó ningún cobro.");
  assert.equal(translations.en.pagoRechazado, "No charge was made.");
});

test("pago=ok SIN datos todavia (lectura con error transitorio): sigue confirmando, NUNCA exito directo por la URL", () => {
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    lectura: ERROR_LECTURA,
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, "confirmando");
});

test("pago=ok con la cuenta todavia en Gratis: confirmando (no exito)", () => {
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    lectura: lecturaOk(cuenta({ plan: "gratis" })),
    authReady: true,
    msTranscurridos: 1000,
  });
  assert.equal(estado, "confirmando");
});

// ORACULO escenario 1: pago anterior (la cuenta YA tiene un `ultimoPago` de una compra vieja, y
// hasta un plan vigente) + `pago=pendiente` SIN `payment_id` en la URL -> JAMAS "activo", sin
// importar cuanto tiempo pase ni que tan vigente este el plan (si Mercado Pago no mando el id en
// la URL, no hay con que comparar).
test("ORACULO 1: pago=pendiente sin payment_id en la URL -> nunca activo, aunque la cuenta ya tenga un plan vigente de antes", () => {
  const cuentaConPlanViejo = cuenta({
    plan: "paquete",
    enviosRestantes: 150,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-de-una-compra-anterior", fecha: ahora.toISOString() },
  });
  const antesDelLimite = decidirEstadoSondeo({
    pago: "pendiente",
    paymentId: null,
    statusMp: null,
    lectura: lecturaOk(cuentaConPlanViejo),
    authReady: true,
    msTranscurridos: LIMITE_SONDEO_MS - 1,
    ahora,
  });
  assert.equal(antesDelLimite, "confirmando");

  const enElLimite = decidirEstadoSondeo({
    pago: "pendiente",
    paymentId: null,
    statusMp: null,
    lectura: lecturaOk(cuentaConPlanViejo),
    authReady: true,
    msTranscurridos: LIMITE_SONDEO_MS,
    ahora,
  });
  assert.equal(enElLimite, "revision", "sin payment_id, se agota a revision, NUNCA a activo");
});

// ORACULO escenario 2 (G8, la carrera con el webhook): el webhook de Mercado Pago ya activo el
// Paquete ANTES de la primera lectura de /api/cuenta — la PRIMERA llamada a decidirEstadoSondeo
// (msTranscurridos=0) ya debe dar "activo" si el `ultimoPago.id` que trae esa primera lectura
// coincide con el `payment_id` de la URL. No hace falta una segunda vuelta ni ninguna "linea base".
test('ORACULO 2 (G8): el webhook ya activo el Paquete ANTES de la primera lectura -> "activo" en el primer tick (msTranscurridos=0)', () => {
  const cuentaYaActivadaPorElWebhook = cuenta({
    plan: "paquete",
    enviosRestantes: 150,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-123", fecha: ahora.toISOString() },
  });
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-123", // viene de la URL (back_urls.success con auto_return)
    statusMp: "approved",
    lectura: lecturaOk(cuentaYaActivadaPorElWebhook),
    authReady: true,
    msTranscurridos: 0, // PRIMER tick: nunca hubo una vuelta anterior
    ahora,
  });
  assert.equal(estado, "activo");
});

// ORACULO escenario 3: el `ultimoPago.id` de la cuenta NO coincide con el `payment_id` de la URL
// (p. ej. el usuario tiene un Paquete vigente de OTRO pago, y esta visita trae un `payment_id`
// distinto que todavia no se proceso) -> nunca "activo".
test("ORACULO 3: payment_id de la URL distinto del ultimoPago.id de la cuenta -> NO activo", () => {
  const cuentaConOtroPago = cuenta({
    plan: "paquete",
    enviosRestantes: 150,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-viejo-ya-activado", fecha: ahora.toISOString() },
  });
  const estado = decidirEstadoSondeo({
    pago: "pendiente",
    paymentId: "pago-nuevo-todavia-sin-procesar",
    statusMp: null,
    lectura: lecturaOk(cuentaConOtroPago),
    authReady: true,
    msTranscurridos: 5000,
    ahora,
  });
  assert.equal(estado, "confirmando");
});

// El payment_id SI coincide, pero el plan quedo sin saldo (p. ej. alguna inconsistencia) -> no
// basta con que el pago coincida, tambien tiene que estar activo de verdad (planActivo).
test("payment_id coincide pero el Paquete quedo sin saldo -> NO activo", () => {
  const cuentaSinSaldo = cuenta({
    plan: "paquete",
    enviosRestantes: 0,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-nuevo", fecha: ahora.toISOString() },
  });
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-nuevo",
    statusMp: null,
    lectura: lecturaOk(cuentaSinSaldo),
    authReady: true,
    msTranscurridos: 5000,
    ahora,
  });
  assert.equal(estado, "confirmando");
});

test("pago=pendiente sin ninguna lectura exitosa todavia: sondeo que se agota a los 2 minutos -> revision", () => {
  const antesDelLimite = decidirEstadoSondeo({
    pago: "pendiente",
    paymentId: "pago-1",
    statusMp: null,
    lectura: ERROR_LECTURA,
    authReady: true,
    msTranscurridos: LIMITE_SONDEO_MS - 1,
  });
  assert.equal(antesDelLimite, "confirmando");

  const enElLimite = decidirEstadoSondeo({
    pago: "pendiente",
    paymentId: "pago-1",
    statusMp: null,
    lectura: ERROR_LECTURA,
    authReady: true,
    msTranscurridos: LIMITE_SONDEO_MS,
  });
  assert.equal(enElLimite, "revision");
});

// ── decidirEstadoSondeo: B28 (sin sesion de Firebase; no antes de la primera respuesta de
//    onAuthStateChanged) ──────────────────────────────────────────────────────────────────────

test('B28: sin sesion (lectura "sin-sesion") pero authReady=false (onAuthStateChanged todavia no respondio) -> "confirmando", NUNCA "sin_sesion" sobre una duda', () => {
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    lectura: SIN_SESION,
    authReady: false,
    msTranscurridos: 0,
  });
  assert.equal(estado, "confirmando");
});

test('B28: sin sesion Y authReady=true (onAuthStateChanged YA respondio que no hay sesion) -> "sin_sesion"', () => {
  const estado = decidirEstadoSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    lectura: SIN_SESION,
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, "sin_sesion");
});

// ── debeDetenerSondeo (B29): "sin_sesion" tambien deja de sondear a los 2 minutos ───────────

test('debeDetenerSondeo: "activo"/"revision"/"rechazado" siempre detienen el sondeo, en cualquier momento', () => {
  for (const estado of ["activo", "revision", "rechazado"] as const) {
    assert.equal(debeDetenerSondeo(estado, 0), true);
    assert.equal(debeDetenerSondeo(estado, 999_999), true);
  }
});

test('debeDetenerSondeo: "confirmando" NUNCA detiene el sondeo (sigue reintentando)', () => {
  assert.equal(debeDetenerSondeo("confirmando", 0), false);
  assert.equal(debeDetenerSondeo("confirmando", LIMITE_SONDEO_MS), false);
  assert.equal(debeDetenerSondeo("confirmando", 999_999), false);
});

test('B29: "sin_sesion" NO detiene el sondeo antes de LIMITE_SONDEO_MS, pero SI al llegar a el', () => {
  assert.equal(debeDetenerSondeo("sin_sesion", LIMITE_SONDEO_MS - 1), false);
  assert.equal(debeDetenerSondeo("sin_sesion", LIMITE_SONDEO_MS), true);
});

// ── ejecutarRevisionSondeo: una vuelta completa (lee + decide + decide si detenerse) ────────
// Esta es la pieza que reemplaza una prueba de render del componente real: no hay jsdom ni
// @testing-library instalados en este proyecto (solo node:test, sin DOM) y anadir uno nuevo solo
// para esta prueba violaria la escalera YAGNI (la logica que de verdad importa — la secuencia
// async leer-cuenta -> decidir -> decidir si detenerse, que es justo donde vivian G7/G8 — queda
// cubierta exactamente igual sin necesidad de montar React). `leerCuenta` aqui hace exactamente
// lo que hace `fetchCuenta` en App.tsx: una promesa que resuelve con un `ResultadoFetchCuenta`.

test("ejecutarRevisionSondeo: webhook adelantado (G8) con un leerCuenta falso -> activo, detener=true, en la PRIMERA llamada", async () => {
  const cuentaYaActiva = cuenta({
    plan: "paquete",
    enviosRestantes: 150,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-999", fecha: ahora.toISOString() },
  });
  let llamadas = 0;
  const { estado, detener } = await ejecutarRevisionSondeo({
    pago: "ok",
    paymentId: "pago-999",
    statusMp: "approved",
    leerCuenta: async () => {
      llamadas++;
      return lecturaOk(cuentaYaActiva);
    },
    authReady: true,
    msTranscurridos: 0,
    ahora,
  });
  assert.equal(llamadas, 1, "debe llamar a leerCuenta exactamente una vez por vuelta");
  assert.equal(estado, "activo");
  assert.equal(detener, true);
});

test("ejecutarRevisionSondeo: sin payment_id en la URL, aunque leerCuenta devuelva un plan vigente -> nunca activo, no detiene antes del limite", async () => {
  const cuentaVigente = cuenta({
    plan: "pro",
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
  });
  const { estado, detener } = await ejecutarRevisionSondeo({
    pago: "pendiente",
    paymentId: null,
    statusMp: null,
    leerCuenta: async () => lecturaOk(cuentaVigente),
    authReady: true,
    msTranscurridos: 1000,
    ahora,
  });
  assert.equal(estado, "confirmando");
  assert.equal(detener, false);
});

test("ejecutarRevisionSondeo: statusMp=rejected -> rechazado, detener=true, sin necesidad de leer la cuenta otra vez para saberlo", async () => {
  const { estado, detener } = await ejecutarRevisionSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: "rejected",
    leerCuenta: async () => lecturaOk(cuenta({ plan: "gratis" })),
    authReady: true,
    msTranscurridos: 0,
  });
  assert.equal(estado, "rechazado");
  assert.equal(detener, true);
});

test('ejecutarRevisionSondeo: B28/B29 encadenados — sin sesion y authReady=false da "confirmando" sin detener; authReady=true da "sin_sesion" sin detener antes del limite, y detiene al llegar a el', async () => {
  const sinAuthReady = await ejecutarRevisionSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    leerCuenta: async () => SIN_SESION,
    authReady: false,
    msTranscurridos: 0,
  });
  assert.equal(sinAuthReady.estado, "confirmando");
  assert.equal(sinAuthReady.detener, false);

  const conAuthReadyAntesDelLimite = await ejecutarRevisionSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    leerCuenta: async () => SIN_SESION,
    authReady: true,
    msTranscurridos: LIMITE_SONDEO_MS - 1,
  });
  assert.equal(conAuthReadyAntesDelLimite.estado, "sin_sesion");
  assert.equal(conAuthReadyAntesDelLimite.detener, false);

  const conAuthReadyEnElLimite = await ejecutarRevisionSondeo({
    pago: "ok",
    paymentId: "pago-1",
    statusMp: null,
    leerCuenta: async () => SIN_SESION,
    authReady: true,
    msTranscurridos: LIMITE_SONDEO_MS,
  });
  assert.equal(conAuthReadyEnElLimite.estado, "sin_sesion");
  assert.equal(conAuthReadyEnElLimite.detener, true);
});

// ── leerPaymentId / leerStatusMp ─────────────────────────────────────────────────────────────

test("leerPaymentId: lee payment_id (Checkout Pro)", () => {
  assert.equal(leerPaymentId("?pago=ok&payment_id=12345&status=approved"), "12345");
});

test("leerPaymentId: sin payment_id, usa collection_id (flujos viejos)", () => {
  assert.equal(leerPaymentId("?pago=ok&collection_id=999"), "999");
});

test("leerPaymentId: payment_id tiene prioridad sobre collection_id si vienen los dos", () => {
  assert.equal(leerPaymentId("?payment_id=AAA&collection_id=BBB"), "AAA");
});

test("leerPaymentId: sin ninguno de los dos -> null", () => {
  assert.equal(leerPaymentId("?pago=ok"), null);
  assert.equal(leerPaymentId(""), null);
});

test("leerStatusMp: lee status, o collection_status si falta status", () => {
  assert.equal(leerStatusMp("?status=rejected"), "rejected");
  assert.equal(leerStatusMp("?collection_status=approved"), "approved");
  assert.equal(leerStatusMp(""), null);
});

// ── planActivo y leerPagoParam (piezas que usa decidirEstadoSondeo) ─────────────────────────

test("planActivo: Gratis nunca esta activo", () => {
  assert.equal(planActivo(cuenta({ plan: "gratis" }), ahora), false);
});

test("planActivo: Paquete con vence en el futuro Y saldo esta activo", () => {
  const vence = new Date(ahora.getTime() + 1000).toISOString();
  assert.equal(planActivo(cuenta({ plan: "paquete", vence, enviosRestantes: 1 }), ahora), true);
});

test("planActivo: Paquete con vence en el pasado NO esta activo", () => {
  const vence = new Date(ahora.getTime() - 1000).toISOString();
  assert.equal(planActivo(cuenta({ plan: "paquete", vence, enviosRestantes: 1 }), ahora), false);
});

// G6: este es el caso exacto que encontro el REVISOR — Paquete vigente por FECHA pero con saldo
// en 0 ya NO cuenta como activo (antes si, porque planActivo no miraba enviosRestantes).
test("G6: planActivo: Paquete con vence en el futuro pero SIN saldo (0) NO esta activo", () => {
  const vence = new Date(ahora.getTime() + 1000).toISOString();
  assert.equal(planActivo(cuenta({ plan: "paquete", vence, enviosRestantes: 0 }), ahora), false);
});

test("planActivo: Pro con vence en el futuro esta activo (no necesita saldo)", () => {
  const vence = new Date(ahora.getTime() + 1000).toISOString();
  assert.equal(planActivo(cuenta({ plan: "pro", vence, enviosRestantes: 0 }), ahora), true);
});

test("leerPagoParam: lee ok/pendiente/error y descarta cualquier otro valor", () => {
  assert.equal(leerPagoParam("?pago=ok"), "ok");
  assert.equal(leerPagoParam("?pago=pendiente"), "pendiente");
  assert.equal(leerPagoParam("?pago=error"), "error");
  assert.equal(leerPagoParam("?pago=exito"), null);
  assert.equal(leerPagoParam(""), null);
});
