// Pruebas de la logica PURA de la Tarea 10 (cobro real con planes, 2026-10-05): el texto del
// plan que ve el usuario y el estado del sondeo al volver de Mercado Pago. Corren con el test
// runner nativo de Node (node:test) via tsx; no tocan React ni red — src/utils/plan.ts no
// depende de nada externo, solo de la cuenta/fecha/parametro de la URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { translations } from "../src/utils/translations";
import {
  decidirEstadoSondeo,
  formatearEstadoPlan,
  formatearFechaBogota,
  formatearMotivoRechazoLote,
  leerPagoParam,
  planActivo,
  LIMITE_SONDEO_MS,
  type CuentaInfo,
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

test("sin parametro pago: no hay nada que sondear (null)", () => {
  const estado = decidirEstadoSondeo({ pago: null, cuenta: null, ultimoPagoIdInicial: null, msTranscurridos: 0 });
  assert.equal(estado, null);
});

test('pago=error (pago rechazado por Mercado Pago, back_urls.failure): "rechazado" de inmediato, sin importar la cuenta ni sondear exito', () => {
  const estado = decidirEstadoSondeo({
    pago: "error",
    cuenta: cuenta({
      plan: "paquete",
      enviosRestantes: 150,
      vence: new Date(ahora.getTime() + 1000).toISOString(),
      ultimoPago: { id: "pago-1", fecha: ahora.toISOString() },
    }),
    ultimoPagoIdInicial: "pago-1",
    msTranscurridos: 0,
  });
  assert.equal(estado, "rechazado");
});

// G6 punto 4 (texto exacto del mensaje de "rechazado", para los dos idiomas): un pago rechazado
// nunca sondea exito, y el mensaje que ve el usuario dice claramente que no hubo cobro.
test('pago rechazado: el texto es "No se realizó ningún cobro." (ES) / "No charge was made." (EN)', () => {
  assert.equal(decidirEstadoSondeo({ pago: "error", cuenta: null, ultimoPagoIdInicial: null, msTranscurridos: 0 }), "rechazado");
  assert.equal(translations.es.pagoRechazado, "No se realizó ningún cobro.");
  assert.equal(translations.en.pagoRechazado, "No charge was made.");
});

test("pago=ok SIN plan activo todavia: sigue confirmando, NUNCA exito directo por la URL", () => {
  const estado = decidirEstadoSondeo({ pago: "ok", cuenta: null, ultimoPagoIdInicial: null, msTranscurridos: 0 });
  assert.equal(estado, "confirmando");
});

test("pago=ok con la cuenta todavia en Gratis: confirmando (no exito)", () => {
  const estado = decidirEstadoSondeo({
    pago: "ok",
    cuenta: cuenta({ plan: "gratis" }),
    ultimoPagoIdInicial: null,
    msTranscurridos: 1000,
  });
  assert.equal(estado, "confirmando");
});

test("pago=ok y el servidor YA dice que el Paquete esta activo CON un pago nuevo (ultimoPago.id cambio): activo", () => {
  const activaCuenta = cuenta({
    plan: "paquete",
    enviosRestantes: 150,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-nuevo", fecha: ahora.toISOString() },
  });
  const estado = decidirEstadoSondeo({
    pago: "ok",
    cuenta: activaCuenta,
    ultimoPagoIdInicial: null, // la cuenta no habia pagado nada antes de este sondeo
    msTranscurridos: 10_000,
    ahora,
  });
  assert.equal(estado, "activo");
});

// G6 (NO-GO del REVISOR_EXTERNO_LAP): antes "activo" salia con CUALQUIER plan vigente, aunque el
// pago de ESTA visita no hubiera llegado todavia (p. ej. el usuario ya tenia un Paquete de una
// compra anterior y esta en medio de una renovacion que todavia no confirma MP).
test("G6: Paquete vigente con 40 envios pero el pago PENDIENTE no cambio ultimoPago.id -> NO activo, pasa a revision a los 2 min", () => {
  const cuentaSinPagoNuevo = cuenta({
    plan: "paquete",
    enviosRestantes: 40,
    vence: new Date(ahora.getTime() + 20 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-viejo", fecha: ahora.toISOString() },
  });

  const antesDelLimite = decidirEstadoSondeo({
    pago: "pendiente",
    cuenta: cuentaSinPagoNuevo,
    ultimoPagoIdInicial: "pago-viejo", // mismo id: el pago de esta visita NO ha llegado
    msTranscurridos: LIMITE_SONDEO_MS - 1,
    ahora,
  });
  assert.equal(antesDelLimite, "confirmando");

  const enElLimite = decidirEstadoSondeo({
    pago: "pendiente",
    cuenta: cuentaSinPagoNuevo,
    ultimoPagoIdInicial: "pago-viejo",
    msTranscurridos: LIMITE_SONDEO_MS,
    ahora,
  });
  assert.equal(enElLimite, "revision");
});

// G6: el pago SI cambio (ultimoPago.id distinto del inicial) y el plan queda vigente con saldo.
test("G6: ultimoPago.id cambio y hay saldo -> activo", () => {
  const cuentaConPagoNuevo = cuenta({
    plan: "paquete",
    enviosRestantes: 150,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-nuevo", fecha: ahora.toISOString() },
  });
  const estado = decidirEstadoSondeo({
    pago: "pendiente",
    cuenta: cuentaConPagoNuevo,
    ultimoPagoIdInicial: "pago-viejo",
    msTranscurridos: 5000,
    ahora,
  });
  assert.equal(estado, "activo");
});

// G6: el pago cambio PERO el plan quedo sin saldo (p. ej. Paquete renovado con 0 por alguna
// inconsistencia) -> no basta con que el pago sea nuevo, tambien tiene que estar activo de
// verdad (planActivo, el mismo criterio que formatearEstadoPlan).
test("G6: ultimoPago.id cambio pero el Paquete quedo sin saldo -> NO activo", () => {
  const cuentaSinSaldo = cuenta({
    plan: "paquete",
    enviosRestantes: 0,
    vence: new Date(ahora.getTime() + 30 * 24 * 3600_000).toISOString(),
    ultimoPago: { id: "pago-nuevo", fecha: ahora.toISOString() },
  });
  const estado = decidirEstadoSondeo({
    pago: "ok",
    cuenta: cuentaSinSaldo,
    ultimoPagoIdInicial: "pago-viejo",
    msTranscurridos: 5000,
    ahora,
  });
  assert.equal(estado, "confirmando");
});

test("pago=pendiente sin ningun pago registrado todavia: sondeo que se agota a los 2 minutos sin plan activo -> revision", () => {
  const antesDelLimite = decidirEstadoSondeo({
    pago: "pendiente",
    cuenta: null,
    ultimoPagoIdInicial: null,
    msTranscurridos: LIMITE_SONDEO_MS - 1,
  });
  assert.equal(antesDelLimite, "confirmando");

  const enElLimite = decidirEstadoSondeo({
    pago: "pendiente",
    cuenta: null,
    ultimoPagoIdInicial: null,
    msTranscurridos: LIMITE_SONDEO_MS,
  });
  assert.equal(enElLimite, "revision");
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
