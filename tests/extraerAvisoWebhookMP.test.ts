// Pruebas de la extraccion PURA del aviso de Mercado Pago (vuelta 22: sacada de la ruta HTTP
// de server.ts a `extraerAvisoWebhookMP` en server/webhook.ts para poder probarla con node:test
// sin Express). Corren con el test runner nativo de Node via tsx; no tocan red ni Firestore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerAvisoWebhookMP, procesarWebhookMP, type RespuestaPagoMP } from "../server/webhook";
import { Timestamp } from "firebase-admin/firestore";

test('extraerAvisoWebhookMP: "?type=payment&data.id=N" -> tipo="payment", paymentId="N"', () => {
  const r = extraerAvisoWebhookMP({ query: { type: "payment", "data.id": "N" }, body: {} });
  assert.deepEqual(r, { tipo: "payment", paymentId: "N" });
});

test('extraerAvisoWebhookMP: "?topic=payment&id=N" (IPN viejo) -> tipo="payment", paymentId="N"', () => {
  const r = extraerAvisoWebhookMP({ query: { topic: "payment", id: "N" }, body: {} });
  assert.deepEqual(r, { tipo: "payment", paymentId: "N" });
});

test('extraerAvisoWebhookMP: "topic=merchant_order" -> tipo="merchant_order", sin id', () => {
  const r = extraerAvisoWebhookMP({ query: { topic: "merchant_order" }, body: {} });
  assert.equal(r.tipo, "merchant_order");
  assert.equal(r.paymentId, "");
});

test("extraerAvisoWebhookMP: tipo=merchant_order, llevado a procesarWebhookMP, se ignora con 200 sin consultar a Mercado Pago", async () => {
  const { tipo, paymentId } = extraerAvisoWebhookMP({ query: { topic: "merchant_order" }, body: {} });
  let obtenerPagoLlamado = false;
  const resultado = await procesarWebhookMP({
    tipo,
    paymentId,
    obtenerPago: async (): Promise<RespuestaPagoMP> => {
      obtenerPagoLlamado = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
    obtenerPreferencia: async () => null,
    activarPaquete: async () => "activado",
    timestampDesdeFecha: (f: Date) => Timestamp.fromDate(f),
    log: () => {},
  });
  assert.equal(resultado.httpStatus, 200);
  assert.equal(obtenerPagoLlamado, false, "merchant_order nunca debe consultar la API de pagos");
});

test("extraerAvisoWebhookMP: cuerpo v2 sin query, con id de notificacion DISTINTO de data.id -> usa data.id", () => {
  const r = extraerAvisoWebhookMP({
    query: {},
    body: { type: "payment", data: { id: "ABC-pago-real" }, id: "NOTIF-999-distinto" },
  });
  assert.deepEqual(r, { tipo: "payment", paymentId: "ABC-pago-real" });
});

test("extraerAvisoWebhookMP: query vacio y body vacio -> tipo y paymentId vacios, nunca lanza", () => {
  const r = extraerAvisoWebhookMP({ query: {}, body: {} });
  assert.deepEqual(r, { tipo: "", paymentId: "" });
});

test("extraerAvisoWebhookMP: query['data.id'] manda incluso si el body tambien trae id (prioridad query > body)", () => {
  const r = extraerAvisoWebhookMP({
    query: { type: "payment", "data.id": "DE-LA-QUERY" },
    body: { data: { id: "DEL-BODY" } },
  });
  assert.equal(r.paymentId, "DE-LA-QUERY");
});
