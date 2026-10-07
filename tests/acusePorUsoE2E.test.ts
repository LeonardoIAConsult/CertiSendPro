// Prueba de PUNTA A PUNTA del fix 2026-10-07: `activarPorUsoSiNoProcesadoTx` (server/cuentas.ts)
// no guardaba `referenciaId` ni `fechaTrm` en `pagosProcesados/{id}` (a diferencia del Paquete,
// que si los guarda desde M37) — si el acuse EN LINEA de una compra porUso fallaba, el barrido
// programado (`server/tareasFondo.ts` barrerTodosLosPagosPendientes) nunca podia reconstruir el
// correo: `reintentarAcusePorUsoPendiente` (server/notificaciones.ts) leia los dos campos como
// `null` y abandonaba con un `console.warn` ("sin referenciaId/fechaTrm guardados"), sin
// reintentar nunca.
//
// Este archivo encadena las CUATRO piezas reales (nunca un mock que "simula el exito"), con el
// doble de Firestore de tests/_fakeFirestore.ts:
//   1. activarPorUsoSiNoProcesado (envoltorio real) activa la compra — como hace el webhook.
//   2. El acuse EN LINEA se simula FALLIDO: nunca se llama a `notificarActivacionPorUso`, igual
//      que pasaria si el relay de correo estuviera caido en ese instante (server/webhook.ts lo
//      envuelve en un try/catch que nunca lanza).
//   3. El barrido programado (`barrerTodosLosPagosPendientes`) lee ese mismo pago y, por ser
//      `tipo:"porUso"`, lo reintenta con `reintentarAcusePorUsoPendiente` (nunca con la variante
//      de Paquete).
//   4. El correo se construye con los datos REALES reconstruidos desde `pagosProcesados` (nunca
//      un stub) y sale al comprador, sin el warn de "sin referenciaId".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  activarPorUsoSiNoProcesado,
  guardarAceptacion,
  obtenerAceptacion,
  obtenerEstadoCorreoComprador,
  reclamarEnvioCorreoTx,
  marcarCorreoEnviadoTx,
  liberarReclamoCorreoTx,
  _usarFirestoreParaPruebas,
} from "../server/cuentas";
import { reintentarAcusePorUsoPendiente, type ReintentarAcusePorUsoDeps } from "../server/notificaciones";
import { construirCorreoConfirmacionCompraPorUso, type DatosCorreo } from "../server/avisos";
import { barrerTodosLosPagosPendientes, type DepsBarridoCompleto } from "../server/tareasFondo";
import { FirestoreFalso } from "./_fakeFirestore";

/** Captura console.warn durante `fn` y lo restaura siempre, incluso si `fn` lanza. */
async function capturarConsoleWarn(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const original = console.warn;
  console.warn = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return logs;
}

test("E2E porUso: acuse en linea fallido se reconstruye con referenciaId/fechaTrm y el barrido lo reintenta, sin el warn 'sin referenciaId'", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);

  // `aceptaciones/ref-1` existe ANTES de llamar a Mercado Pago (igual que server/cobroPaquete.ts
  // `crearCobroPorUso` hace en produccion).
  await guardarAceptacion("ref-1", {
    uid: "uid-1",
    email: "comprador@test.com",
    versionTerminos: "1.4",
    plan: "porUso",
    modalidad: "unico",
    idioma: "es",
    cop: 7500,
    trm: 3900,
    preferenciaId: "ref-1",
    textoCasilla: "Acepto los Términos.",
    textoRetracto: "Quiero que mi saldo se active de inmediato.",
  });

  // ── 1. Activacion (igual que el webhook EN LINEA, server/webhook.ts) ──────────────────────────
  const resultadoActivacion = await activarPorUsoSiNoProcesado("uid-1", "pago-1", {
    cantidad: 50,
    cop: 7500,
    trm: 3900,
    fecha: Timestamp.fromDate(new Date("2026-10-06T15:00:00.000Z")),
    referenciaId: "ref-1",
    fechaTrm: "2026-10-06",
  });
  assert.equal(resultadoActivacion, "activado");

  // El fix: el pago SI guarda referenciaId/fechaTrm (antes del fix, los dos quedaban ausentes).
  const pagoGuardado = db.leer("pagosProcesados/pago-1");
  assert.equal(pagoGuardado?.referenciaId, "ref-1");
  assert.equal(pagoGuardado?.fechaTrm, "2026-10-06");
  assert.equal(pagoGuardado?.tipo, "porUso");

  // ── 2. El acuse EN LINEA falla: nunca se llama a notificarActivacionPorUso (relay caido). El
  // acuse queda pendiente — correoComprador sigue null/ausente. ──────────────────────────────────
  assert.equal(pagoGuardado?.correoComprador ?? null, null, "el acuse en linea todavia no salio");

  // ── 3. Barrido programado, 2h despues (Cloud Scheduler) ───────────────────────────────────────
  const correosEnviados: DatosCorreo[] = [];
  // Datos RECIBIDOS por el constructor del correo (la prueba de que la reconstruccion trajo los
  // valores reales guardados en `pagosProcesados`, no un stub generico). `construirCorreoComprador`
  // real (`construirCorreoConfirmacionCompraPorUso`) incluye el pie del proveedor
  // (PROVEEDOR_NOMBRE/DOC/DIR/TEL), que en este entorno de pruebas (sin esas env vars) queda en
  // "[PENDIENTE]" y bloquearia el correo por `tienePlaceholderPendiente` — mismo motivo por el que
  // tests/reintentoAcuse.test.ts y tests/notificacionesPorUso.test.ts usan un builder LIMPIO en vez
  // del real; aqui se captura ademas lo que el builder recibio, para probar la reconstruccion.
  let datosRecibidosPorElBuilder: Parameters<typeof construirCorreoConfirmacionCompraPorUso>[0] | null = null;
  const pagoRef = db.doc("pagosProcesados/pago-1");
  const depsReintento: ReintentarAcusePorUsoDeps = {
    reclamarEnvioCorreo: (_pid, destinatario, ahora) =>
      db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, destinatario, ahora)),
    marcarCorreoEnviado: (_pid, destinatario, reclamadoEn) =>
      db.runTransaction((tx) => marcarCorreoEnviadoTx(tx, pagoRef, destinatario, reclamadoEn)),
    liberarReclamoCorreo: (_pid, destinatario, reclamadoEn) =>
      db.runTransaction((tx) => liberarReclamoCorreoTx(tx, pagoRef, destinatario, reclamadoEn)),
    obtenerAceptacion,
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    construirCorreoComprador: (datos) => {
      datosRecibidosPorElBuilder = datos;
      return { asunto: "Confirmación de tu compra", texto: "Texto de prueba sin ningún dato pendiente." };
    },
    obtenerEstadoCorreoComprador,
  };

  const ahoraBarrido = new Date("2026-10-06T17:00:00.000Z"); // 2h despues del pago: <20h, reintenta.
  let paqueteLlamado = false;
  const deps: DepsBarridoCompleto = {
    obtenerPagina: async () => ({
      docs: [{ id: "pago-1", data: db.leer("pagosProcesados/pago-1")! }],
      cursorSiguiente: null,
    }),
    reintentarPaquete: async () => {
      paqueteLlamado = true; // un pago porUso NUNCA debe caer en la variante de Paquete.
    },
    reintentarPorUso: (datos) => reintentarAcusePorUsoPendiente(datos, ahoraBarrido, depsReintento),
  };

  let resultadoBarrido: Awaited<ReturnType<typeof barrerTodosLosPagosPendientes>>;
  const warns = await capturarConsoleWarn(async () => {
    resultadoBarrido = await barrerTodosLosPagosPendientes(deps);
  });

  assert.equal(paqueteLlamado, false, "nunca debe enrutar un pago porUso a la variante de Paquete");
  assert.equal(resultadoBarrido!.reintentados, 1);

  // ── 4. El correo se construye SIN el warn de "sin referenciaId" y SI llega al comprador ────────
  assert.ok(
    !warns.some((l) => l.includes("sin referenciaId")),
    `no debe quedar el warn de "sin referenciaId": ${JSON.stringify(warns)}`
  );

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1, "el acuse SI debe reconstruirse y salir al comprador tras el barrido");

  // La reconstruccion trajo los valores REALES guardados en pagosProcesados (cantidad/cop/trm/
  // fechaTrm/refMp) — no un dato inventado ni ausente.
  assert.ok(datosRecibidosPorElBuilder, "el builder del correo SI debe haberse llamado");
  assert.equal(datosRecibidosPorElBuilder!.paraEmail, "comprador@test.com");
  assert.equal(datosRecibidosPorElBuilder!.cantidad, 50);
  assert.equal(datosRecibidosPorElBuilder!.cop, 7500);
  assert.equal(datosRecibidosPorElBuilder!.trm, 3900);
  assert.equal(datosRecibidosPorElBuilder!.fechaTrm, "2026-10-06");
  assert.equal(datosRecibidosPorElBuilder!.refMp, "pago-1");

  const pagoFinal = db.leer("pagosProcesados/pago-1");
  assert.equal(pagoFinal?.correoComprador, "enviado");
});
