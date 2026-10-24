// H8 (decision de Leonardo 2026-10-24): 15 envios gratis DE POR VIDA por CORREO, tras la bandera
// GRATIS_UNA_VEZ. Sin la bandera, `decidirLote` se comporta exactamente como antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  decidirLote,
  crearLoteConConsumoGratis,
  conciliarGratisVencidos,
  obtenerGratisUsados,
  expiraEnGratis,
  gratisUsadosVigentes,
  RETENCION_GRATIS_MESES,
  liberarReservaTx,
  gratisUnaVezActivo,
  gratisUsadosDe,
  reponerConsumoGratis,
  _usarFirestoreParaPruebas,
  type Cuenta,
  type Lote,
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
const H = "huella-correo-1";

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

// ── Contador por HUELLA DE CORREO (`gratisPorCorreo/{huella}`) ───────────────────────────────

async function conDb(fn: (db: FirestoreFalso) => Promise<void>) {
  const db = new FirestoreFalso();
  _usarFirestoreParaPruebas(db);
  try {
    await fn(db);
  } finally {
    _usarFirestoreParaPruebas(null);
  }
}

test("crearLoteConConsumoGratis: crea el contador del correo, descuenta y deja el lote gratis con su huella", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u1", H, 10);
    assert.equal(r.ok, true);
    assert.equal(await obtenerGratisUsados(H), 10);
    if (r.ok === true) {
      const lote = (await db.doc(`lotes/${r.loteId}`).get()).data() as Lote;
      assert.equal(lote.planEfectivo, "gratis");
      assert.equal(lote.cantidad, 10);
      assert.equal(lote.uid, "u1");
      assert.equal(lote.gratisHuella, H);
    }
  }));

test("crearLoteConConsumoGratis: no deja pasar de 15 en total y NO crea lote ni descuenta al rechazar", () =>
  conDb(async () => {
    assert.equal((await crearLoteConConsumoGratis("u2", H, 10)).ok, true);
    const rechazado = await crearLoteConConsumoGratis("u2", H, 6); // 10 + 6 > 15
    assert.equal(rechazado.ok, false);
    if (rechazado.ok === false) assert.equal(rechazado.gratisRestantes, 5);
    assert.equal(await obtenerGratisUsados(H), 10);
    assert.equal((await crearLoteConConsumoGratis("u2", H, 5)).ok, true);
    assert.equal(await obtenerGratisUsados(H), 15);
    assert.equal((await crearLoteConConsumoGratis("u2", H, 1)).ok, false);
  }));

test("crearLoteConConsumoGratis: dos lotes a la vez NO superan el tope (la transaccion se reintenta)", () =>
  conDb(async () => {
    const [a, b] = await Promise.all([crearLoteConConsumoGratis("u3", H, 10), crearLoteConConsumoGratis("u3", H, 10)]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1); // solo uno entra: 10 + 10 > 15
    assert.equal(await obtenerGratisUsados(H), 10);
  }));

test("H6: eliminar la cuenta y volver a crearla (otro uid, mismo correo) NO repone los gratis", () =>
  conDb(async (db) => {
    await db.doc("cuentas/uid-viejo").set({ ...cuenta() });
    assert.equal((await crearLoteConConsumoGratis("uid-viejo", H, 12)).ok, true);
    // se "elimina" la cuenta: el contador por correo es otro documento y sobrevive
    await db.doc("cuentas/uid-viejo").set({}); // simula borrado/pisado de la cuenta
    // el mismo correo vuelve con un uid nuevo
    assert.equal(await obtenerGratisUsados(H), 12);
    const r = await crearLoteConConsumoGratis("uid-nuevo", H, 5);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.equal(r.gratisRestantes, 3);
  }));

test("H6: correos distintos tienen contadores independientes", () =>
  conDb(async () => {
    assert.equal((await crearLoteConConsumoGratis("u1", "huella-A", 15)).ok, true);
    assert.equal((await crearLoteConConsumoGratis("u2", "huella-B", 15)).ok, true);
    assert.equal(await obtenerGratisUsados("huella-A"), 15);
    assert.equal(await obtenerGratisUsados("huella-B"), 15);
  }));

test("reponerConsumoGratis: devuelve el cupo, nunca baja de 0 y no falla si no existe el contador", () =>
  conDb(async () => {
    await crearLoteConConsumoGratis("u5", H, 12);
    await reponerConsumoGratis(H, 5);
    assert.equal(await obtenerGratisUsados(H), 7);
    await reponerConsumoGratis(H, 100);
    assert.equal(await obtenerGratisUsados(H), 0);
    await reponerConsumoGratis("no-existe", 3);
    assert.equal(await obtenerGratisUsados("no-existe"), 0);
  }));

// ── H2: reposicion de gratis por fallas, al vencer el lote ────────────────────────────────────

/** Fuerza el vencimiento del lote y los contadores que dejo el envio (enviados/fallidos). */
async function simularLote(db: FirestoreFalso, loteId: string, datos: Partial<Lote>) {
  const ref = db.doc(`lotes/${loteId}`);
  const actual = (await ref.get()).data() as Lote;
  await ref.set({ ...actual, ...datos });
}

test("conciliar: repone los fallidos NO reintentados al vencer; no repone los que el usuario no envio", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u6", H, 10);
    assert.equal(r.ok, true);
    if (r.ok !== true) return;
    // 10 autorizados: 6 enviados, 3 fallaron (Gmail) y no se reintentaron, 1 nunca se intento
    await simularLote(db, r.loteId, { enviados: 6, fallidos: 3, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u6", H, ahora), 3);
    assert.equal(await obtenerGratisUsados(H), 7); // 10 - 3 repuestos
    const lote = (await db.doc(`lotes/${r.loteId}`).get()).data() as Lote;
    assert.equal(lote.gratisConciliado, true);
    assert.equal(lote.gratisRepuestos, 3);
  }));

test("conciliar: un fallo que luego se reintento con exito NO se repone (enviados + fallidos > cantidad)", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u7", H, 5);
    if (r.ok !== true) return assert.fail("lote");
    // 5 autorizados, 2 fallaron pero se reintentaron y todo salio: enviados = 5
    await simularLote(db, r.loteId, { enviados: 5, fallidos: 2, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u7", H, ahora), 0);
    assert.equal(await obtenerGratisUsados(H), 5);
  }));

test("conciliar: nunca repone mas que lo no enviado (min(fallidos, cantidad - enviados))", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u8", H, 6);
    if (r.ok !== true) return assert.fail("lote");
    await simularLote(db, r.loteId, { enviados: 4, fallidos: 5, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u8", H, ahora), 2); // solo 6 - 4 = 2 quedaron sin enviar
    assert.equal(await obtenerGratisUsados(H), 4);
  }));

test("conciliar: es idempotente (una segunda corrida no repone otra vez)", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u9", H, 8);
    if (r.ok !== true) return assert.fail("lote");
    await simularLote(db, r.loteId, { enviados: 5, fallidos: 3, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u9", H, ahora), 3);
    assert.equal(await conciliarGratisVencidos("u9", H, ahora), 0);
    assert.equal(await obtenerGratisUsados(H), 5);
  }));

test("conciliar: NO toca un lote que aun no vencio ni lotes de otra huella", () =>
  conDb(async (db) => {
    const propio = await crearLoteConConsumoGratis("u10", H, 6);
    const ajeno = await crearLoteConConsumoGratis("u10", "otra-huella", 6);
    if (propio.ok !== true || ajeno.ok !== true) return assert.fail("lotes");
    await simularLote(db, propio.loteId, { enviados: 2, fallidos: 4 }); // sigue vigente (expira en 2 h)
    await simularLote(db, ajeno.loteId, { enviados: 0, fallidos: 6, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u10", H, ahora), 0);
    assert.equal(await obtenerGratisUsados(H), 6);
    assert.equal(await obtenerGratisUsados("otra-huella"), 6);
    // una vez vencido el propio (se fuerza su vencimiento), si repone
    await simularLote(db, propio.loteId, { expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u10", H, ahora), 4);
    assert.equal(await obtenerGratisUsados(H), 2);
  }));

test("conciliar: un lote sin fallidos no repone nada pero queda conciliado", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u11", H, 4);
    if (r.ok !== true) return assert.fail("lote");
    await simularLote(db, r.loteId, { enviados: 4, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u11", H, ahora), 0);
    assert.equal(((await db.doc(`lotes/${r.loteId}`).get()).data() as Lote).gratisConciliado, true);
    assert.equal(await obtenerGratisUsados(H), 4);
  }));

test("liberarReservaTx: por defecto NO cuenta fallo (errores de validacion del cliente); con contarFallo si, solo en lotes gratis", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u12", H, 5);
    if (r.ok !== true) return assert.fail("lote");
    await simularLote(db, r.loteId, { reservados: 3 });
    const loteRef = db.doc(`lotes/${r.loteId}`);
    const cuentaRef = db.doc("cuentas/u12");
    // liberacion "de validacion": libera el cupo pero NO suma fallido (no se puede inflar a voluntad)
    await db.runTransaction((tx) => liberarReservaTx(tx as any, loteRef, cuentaRef));
    let lote = (await loteRef.get()).data() as Lote;
    assert.equal(lote.reservados, 2);
    assert.equal(lote.fallidos, undefined);
    // liberacion por fallo real de Gmail/servidor: si cuenta
    await db.runTransaction((tx) => liberarReservaTx(tx as any, loteRef, cuentaRef, true));
    lote = (await loteRef.get()).data() as Lote;
    assert.equal(lote.reservados, 1);
    assert.equal(lote.fallidos, 1);
    // lote pagado: aun con contarFallo no se agrega `fallidos`
    await db.doc("lotes/pagado").set({ ...(lote as any), planEfectivo: "porUso", reservados: 1, reservadosPorUso: 1, fallidos: undefined });
    await db.doc("cuentas/u13").set({ ...cuenta({ saldoPorUso: 10, reservadosPorUso: 1 }) });
    await db.runTransaction((tx) => liberarReservaTx(tx as any, db.doc("lotes/pagado"), db.doc("cuentas/u13"), true));
    assert.equal(((await db.doc("lotes/pagado").get()).data() as Lote).fallidos, undefined);
  }));

test("conciliar: solo mira lotes GRATIS del uid (la consulta filtra por planEfectivo)", () =>
  conDb(async (db) => {
    const r = await crearLoteConConsumoGratis("u14", H, 5);
    if (r.ok !== true) return assert.fail("lote");
    await simularLote(db, r.loteId, { enviados: 1, fallidos: 4, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    // un lote pagado vencido del mismo uid, con la misma huella por error de datos: no debe conciliarse
    await db.doc("lotes/pagado2").set({ uid: "u14", planEfectivo: "porUso", gratisHuella: H, fallidos: 9, enviados: 0, cantidad: 9, expira: Timestamp.fromMillis(ahora.getTime() - 1000) });
    assert.equal(await conciliarGratisVencidos("u14", H, ahora), 4);
    assert.equal(((await db.doc("lotes/pagado2").get()).data() as Lote).gratisConciliado, undefined);
  }));

// ── Retencion de 24 meses de la huella (Politica 2.5, secc. 7) ───────────────────────────────

test("expiraEnGratis: 24 meses despues de la autorizacion", () => {
  assert.equal(RETENCION_GRATIS_MESES, 24);
  const t = Timestamp.fromDate(new Date("2026-10-24T12:00:00Z"));
  assert.equal(expiraEnGratis(t).toDate().toISOString(), "2028-10-24T12:00:00.000Z");
});

test("gratisUsadosVigentes: sin documento o con retencion vencida cuenta 0; vigente cuenta", () => {
  const ahoraMs = Date.UTC(2026, 9, 24);
  assert.equal(gratisUsadosVigentes(undefined, ahoraMs), 0);
  assert.equal(gratisUsadosVigentes({ usados: 9, expiraEn: Timestamp.fromMillis(ahoraMs + 1000) }, ahoraMs), 9);
  assert.equal(gratisUsadosVigentes({ usados: 9, expiraEn: Timestamp.fromMillis(ahoraMs) }, ahoraMs), 0); // justo al vencer
  assert.equal(gratisUsadosVigentes({ usados: 9, expiraEn: Timestamp.fromMillis(ahoraMs - 1) }, ahoraMs), 0);
  assert.equal(gratisUsadosVigentes({ usados: 9 }, ahoraMs), 9); // sin expiraEn (dato previo): sigue contando
  assert.equal(gratisUsadosVigentes({ usados: -3, expiraEn: Timestamp.fromMillis(ahoraMs + 1000) }, ahoraMs), 0); // saneado
});

test("crearLoteConConsumoGratis: escribe expiraEn a ~24 meses y la renueva en cada autorizacion", () =>
  conDb(async (db) => {
    assert.equal((await crearLoteConConsumoGratis("u20", H, 5)).ok, true);
    const d1 = (await db.doc(`gratisPorCorreo/${H}`).get()).data() as any;
    const meses = (d1.expiraEn.toMillis() - Date.now()) / (30.4 * 24 * 3600_000);
    assert.ok(meses > 23.5 && meses < 24.5, `expiraEn a ${meses} meses`);
    // se fuerza un expiraEn mas corto y una segunda autorizacion lo renueva a 24 meses
    await db.doc(`gratisPorCorreo/${H}`).set({ ...d1, expiraEn: Timestamp.fromMillis(Date.now() + 1000) });
    assert.equal((await crearLoteConConsumoGratis("u20", H, 3)).ok, true);
    const d2 = (await db.doc(`gratisPorCorreo/${H}`).get()).data() as any;
    assert.equal(d2.usados, 8);
    assert.ok(d2.expiraEn.toMillis() - Date.now() > 23 * 30 * 24 * 3600_000);
  }));

test("retencion vencida: el correo vuelve a empezar con 15 (aunque Firestore aun no haya borrado el documento)", () =>
  conDb(async (db) => {
    await db.doc(`gratisPorCorreo/${H}`).set({ usados: 15, actualizado: Timestamp.fromMillis(0), expiraEn: Timestamp.fromMillis(Date.now() - 1000) });
    assert.equal(await obtenerGratisUsados(H), 0);
    const r = await crearLoteConConsumoGratis("u21", H, 10);
    assert.equal(r.ok, true);
    assert.equal(await obtenerGratisUsados(H), 10); // no 25: parte de cero
    assert.ok(((await db.doc(`gratisPorCorreo/${H}`).get()).data() as any).expiraEn.toMillis() > Date.now());
  }));

test("reponerConsumoGratis y conciliar: sobre un contador vencido no reponen nada", () =>
  conDb(async (db) => {
    await db.doc(`gratisPorCorreo/${H}`).set({ usados: 9, actualizado: Timestamp.fromMillis(0), expiraEn: Timestamp.fromMillis(Date.now() - 1000) });
    await reponerConsumoGratis(H, 5);
    assert.equal(((await db.doc(`gratisPorCorreo/${H}`).get()).data() as any).usados, 9); // intacto (no se toca un vencido)
  }));
