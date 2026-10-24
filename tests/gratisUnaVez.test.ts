// H8 (decision de Leonardo 2026-10-24): 15 envios gratis DE POR VIDA por cuenta, tras la bandera
// GRATIS_UNA_VEZ. Sin la bandera, `decidirLote` se comporta exactamente como antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  decidirLote,
  crearLoteConConsumoGratis,
  gratisUnaVezActivo,
  gratisUsadosDe,
  reponerConsumoGratis,
  _usarFirestoreParaPruebas,
  type Cuenta,
} from "../server/cuentas";
import { FirestoreFalso } from "./_fakeFirestore";

const ahora = new Date("2026-10-24T12:00:00Z");
const futuro = Timestamp.fromMillis(ahora.getTime() + 30 * 24 * 3600_000);

function cuenta(parcial: Partial<Cuenta> = {}): Cuenta {
  return {
    plan: "gratis",
    enviosRestantes: 0,
    vence: null,
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    saldoPorUso: 0,
    reservadosPorUso: 0,
    ultimoPago: null,
    actualizado: Timestamp.fromDate(ahora),
    ...parcial,
  };
}

const ON = { gratisUnaVez: true };

test("gratisUnaVezActivo: solo con GRATIS_UNA_VEZ=1", () => {
  assert.equal(gratisUnaVezActivo({ GRATIS_UNA_VEZ: "1" }), true);
  for (const v of [undefined, "", "0", "true", "si"]) assert.equal(gratisUnaVezActivo({ GRATIS_UNA_VEZ: v }), false);
});

test("sin la bandera: un lote de 15 o menos sigue siendo gratis siempre (comportamiento de antes)", () => {
  const d = decidirLote(cuenta({ gratisUsados: 15 }), 10, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "gratis");
  assert.equal(d.consumoGratis, undefined);
  assert.equal(d.gratisRestantes, undefined);
});

test("con la bandera: cuenta nueva (sin gratisUsados) tiene los 15 completos", () => {
  const d = decidirLote(cuenta(), 15, ahora, ON);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "gratis");
  assert.equal(d.consumoGratis, 15);
  assert.equal(d.gratisRestantes, 15);
});

test("con la bandera: se descuentan; con 5 restantes entra un lote de 5 pero no uno de 6", () => {
  const c = cuenta({ gratisUsados: 10 });
  const ok = decidirLote(c, 5, ahora, ON);
  assert.equal(ok.permitido, true);
  assert.equal(ok.consumoGratis, 5);
  const no = decidirLote(c, 6, ahora, ON);
  assert.equal(no.permitido, false);
  assert.equal(no.motivo, "saldo_insuficiente");
  assert.equal(no.gratisRestantes, 5);
});

test("con la bandera y gratis agotados: un lote de 1 sin saldo se rechaza (hay que comprar)", () => {
  const d = decidirLote(cuenta({ gratisUsados: 15 }), 1, ahora, ON);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
  assert.equal(d.gratisRestantes, 0);
});

test("con la bandera y gratis agotados: un lote chico se cobra del saldo pagado (ya no es gratis)", () => {
  const d = decidirLote(cuenta({ gratisUsados: 15, saldoPorUso: 50 }), 10, ahora, ON);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "porUso");
  assert.deepEqual(d.consumo, { paquete: 0, porUso: 10 });
  assert.equal(d.consumoGratis, undefined);
});

test("con la bandera: un lote que no cabe en los gratis restantes se cobra COMPLETO del saldo y no toca los gratis", () => {
  const c = cuenta({ gratisUsados: 10, plan: "paquete", vence: futuro, enviosRestantes: 150 });
  const d = decidirLote(c, 8, ahora, ON); // 5 gratis restantes < 8
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "paquete");
  assert.deepEqual(d.consumo, { paquete: 8, porUso: 0 });
  assert.equal(d.consumoGratis, undefined);
  assert.equal(d.gratisRestantes, 5);
});

test("con la bandera: un lote de mas de 15 sin saldo sigue rechazado (igual que antes)", () => {
  const d = decidirLote(cuenta(), 16, ahora, ON);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
});

test("crearLoteConConsumoGratis: crea la cuenta si no existe, descuenta y deja el lote gratis", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  const r = await crearLoteConConsumoGratis("u1", 10);
  assert.equal(r.ok, true);
  const cu = (await db.doc("cuentas/u1").get()).data() as Cuenta;
  assert.equal(cu.gratisUsados, 10);
  assert.equal(cu.plan, "gratis");
  if (r.ok === true) {
    const lote = (await db.doc(`lotes/${r.loteId}`).get()).data() as any;
    assert.equal(lote.planEfectivo, "gratis");
    assert.equal(lote.cantidad, 10);
    assert.equal(lote.uid, "u1");
  }
  _usarFirestoreParaPruebas(null);
});

test("crearLoteConConsumoGratis: no deja pasar de 15 en total y NO crea lote ni descuenta al rechazar", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  assert.equal((await crearLoteConConsumoGratis("u2", 10)).ok, true);
  const rechazado = await crearLoteConConsumoGratis("u2", 6); // 10 + 6 > 15
  assert.equal(rechazado.ok, false);
  if (rechazado.ok === false) assert.equal(rechazado.gratisRestantes, 5);
  assert.equal(((await db.doc("cuentas/u2").get()).data() as Cuenta).gratisUsados, 10);
  assert.equal((await crearLoteConConsumoGratis("u2", 5)).ok, true);
  assert.equal(((await db.doc("cuentas/u2").get()).data() as Cuenta).gratisUsados, 15);
  assert.equal((await crearLoteConConsumoGratis("u2", 1)).ok, false);
  _usarFirestoreParaPruebas(null);
});

test("crearLoteConConsumoGratis: dos lotes a la vez NO superan el tope (la transaccion se reintenta)", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  const [a, b] = await Promise.all([crearLoteConConsumoGratis("u3", 10), crearLoteConConsumoGratis("u3", 10)]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1); // solo uno entra: 10 + 10 > 15
  assert.equal(((await db.doc("cuentas/u3").get()).data() as Cuenta).gratisUsados, 10);
  _usarFirestoreParaPruebas(null);
});

test("crearLoteConConsumoGratis: una cuenta de pago existente conserva sus datos y suma gratisUsados", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  await db.doc("cuentas/u4").set({ ...cuenta({ plan: "porUso", saldoPorUso: 70 }) });
  const r = await crearLoteConConsumoGratis("u4", 7);
  assert.equal(r.ok, true);
  const cu = (await db.doc("cuentas/u4").get()).data() as Cuenta;
  assert.equal(cu.gratisUsados, 7);
  assert.equal(cu.saldoPorUso, 70); // update, no set: no pisa el saldo comprado
  _usarFirestoreParaPruebas(null);
});

test("gratisUsadosDe: negativo, NaN, string raro o null no regalan cupo; un string numerico cuenta", () => {
  assert.equal(gratisUsadosDe(-5), 0);
  assert.equal(gratisUsadosDe(NaN), 0);
  assert.equal(gratisUsadosDe(null), 0);
  assert.equal(gratisUsadosDe(undefined), 0);
  assert.equal(gratisUsadosDe("abc"), 0);
  assert.equal(gratisUsadosDe("5"), 5);
  assert.equal(gratisUsadosDe(7.9), 7);
  assert.equal(gratisUsadosDe(15), 15);
});

test("decidirLote con la bandera: gratisUsados negativo o string no da mas de 15 ni concatena", () => {
  assert.equal(decidirLote(cuenta({ gratisUsados: -100 }), 16, ahora, ON).permitido, false);
  assert.equal(decidirLote(cuenta({ gratisUsados: -100 }), 15, ahora, ON).gratisRestantes, 15);
  assert.equal(decidirLote(cuenta({ gratisUsados: "5" as unknown as number }), 11, ahora, ON).permitido, false); // restan 10
});

test("reponerConsumoGratis: devuelve el cupo, nunca baja de 0 y no pisa el saldo comprado", async () => {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  await db.doc("cuentas/u5").set({ ...cuenta({ plan: "porUso", saldoPorUso: 40, gratisUsados: 12 }) });
  await reponerConsumoGratis("u5", 5);
  let cu = (await db.doc("cuentas/u5").get()).data() as Cuenta;
  assert.equal(cu.gratisUsados, 7);
  assert.equal(cu.saldoPorUso, 40);
  await reponerConsumoGratis("u5", 100);
  cu = (await db.doc("cuentas/u5").get()).data() as Cuenta;
  assert.equal(cu.gratisUsados, 0);
  await reponerConsumoGratis("no-existe", 3); // sin cuenta: no falla ni crea nada
  assert.equal((await db.doc("cuentas/no-existe").get()).data(), undefined);
  _usarFirestoreParaPruebas(null);
});
