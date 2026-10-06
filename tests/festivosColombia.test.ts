// M36(3) (corrige vuelta 27, 2026-10-05): calendario de festivos de Colombia (server/festivosColombia.ts),
// usado por `sumarDiasHabiles` (server/avisos.ts).
//
// Fuentes citadas (consultadas 2026-10-05, via WebSearch/WebFetch):
//   - 2026: https://rulex.org/festivos — tabla completa de los 18 festivos de 2026, cita la Ley 51
//     de 1983 ("Ley Emiliani") como fuente. (Nota: la orden que pidio esta tarea cita "Ley 18 de
//     1983"; la ley real que traslada festivos al lunes es la Ley 51 de 1983 — ver la nota en
//     server/festivosColombia.ts. No se corrige en silencio: se marca aqui para que Leonardo/
//     Abogado_LAP lo confirmen antes de citarla en un documento legal publicado.)
//   - 2027: https://calendariosnacionales.com/co/2027/festivos/ — tabla completa de los 18
//     festivos de 2027.
// Ninguna de las dos es el Diario Oficial directamente, pero son consistentes entre si y con el
// calculo independiente de la Pascua (algoritmo de Meeus/Jones/Butcher) hecho en
// server/festivosColombia.ts — las 18 fechas de cada año se verificaron una a una contra la fuente
// citada antes de escribir este archivo. Si no se puede verificar contra el Diario Oficial o una
// circular de la Funcion Publica, se deja dicho aqui (marcado, no inventado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { festivosColombia, esFestivoColombia, _domingoDePascuaParaPruebas } from "../server/festivosColombia";

// ── Pascua (Meeus/Jones/Butcher): verificada contra las fuentes citadas arriba ──────────────────

test("domingoDePascua: 2026 = 5 de abril (rulex.org/festivos)", () => {
  assert.deepEqual(_domingoDePascuaParaPruebas(2026), { mes: 4, dia: 5 });
});

test("domingoDePascua: 2027 = 28 de marzo (calendariosnacionales.com/co/2027/festivos)", () => {
  assert.deepEqual(_domingoDePascuaParaPruebas(2027), { mes: 3, dia: 28 });
});

// ── 2026: al menos 8 fechas verificadas contra rulex.org/festivos ──────────────────────────────

test("festivosColombia(2026): coincide fecha por fecha con rulex.org/festivos + M38 (19 festivos, Chiquinquirá desde 2026)", () => {
  const festivos2026 = festivosColombia(2026);
  const esperados2026 = [
    "2026-01-01", // Año Nuevo (fijo)
    "2026-01-12", // Reyes Magos (6-ene, trasladado: martes -> lunes siguiente)
    "2026-03-23", // San José (19-mar, trasladado: jueves -> lunes siguiente)
    "2026-04-02", // Jueves Santo (Pascua-3, nunca se traslada)
    "2026-04-03", // Viernes Santo (Pascua-2, nunca se traslada)
    "2026-05-01", // Día del Trabajo (fijo)
    "2026-05-18", // Ascensión del Señor (Pascua+43, ya cae en lunes)
    "2026-06-08", // Corpus Christi (Pascua+64, ya cae en lunes)
    "2026-06-15", // Sagrado Corazón (Pascua+71, ya cae en lunes)
    "2026-06-29", // San Pedro y San Pablo (29-jun, YA es lunes en 2026: no se traslada)
    "2026-07-13", // M38: Nuestra Señora del Rosario de Chiquinquirá (9-jul, jueves -> lunes siguiente)
    "2026-07-20", // Independencia (fijo, nunca se traslada aunque no caiga en lunes)
    "2026-08-07", // Batalla de Boyacá (fijo)
    "2026-08-17", // Asunción de la Virgen (15-ago, trasladado: sábado -> lunes siguiente)
    "2026-10-12", // Día de la Raza (12-oct, YA es lunes en 2026: no se traslada)
    "2026-11-02", // Todos los Santos (1-nov, trasladado: domingo -> lunes siguiente)
    "2026-11-16", // Independencia de Cartagena (11-nov, trasladado: miércoles -> lunes siguiente)
    "2026-12-08", // Inmaculada Concepción (fijo)
    "2026-12-25", // Navidad (fijo)
  ];
  assert.equal(esperados2026.length, 19, "el propio test debe listar los 19 festivos, para no verificar de menos");
  for (const fecha of esperados2026) {
    assert.ok(festivos2026.has(fecha), `${fecha} debe ser festivo en 2026`);
  }
  assert.equal(festivos2026.size, 19, "no deben colisionar dos festivos en la misma fecha de 2026");
});

// ── 2027: al menos 8 fechas verificadas contra calendariosnacionales.com/co/2027/festivos ──────

test("festivosColombia(2027): coincide fecha por fecha con calendariosnacionales.com/co/2027/festivos + M38 (19 festivos)", () => {
  const festivos2027 = festivosColombia(2027);
  const esperados2027 = [
    "2027-01-01", // Año Nuevo (fijo)
    "2027-01-11", // Reyes Magos (6-ene, trasladado: miércoles -> lunes siguiente)
    "2027-03-22", // San José (19-mar, trasladado: viernes -> lunes siguiente)
    "2027-03-25", // Jueves Santo (Pascua-3)
    "2027-03-26", // Viernes Santo (Pascua-2)
    "2027-05-01", // Día del Trabajo (fijo, cae sábado: igual se celebra ese día, no se traslada)
    "2027-05-10", // Ascensión del Señor (Pascua+43)
    "2027-05-31", // Corpus Christi (Pascua+64)
    "2027-06-07", // Sagrado Corazón (Pascua+71)
    "2027-07-05", // San Pedro y San Pablo (29-jun, trasladado: martes -> lunes siguiente)
    "2027-07-12", // M38: Nuestra Señora del Rosario de Chiquinquirá (9-jul, viernes -> lunes siguiente)
    "2027-07-20", // Independencia (fijo)
    "2027-08-07", // Batalla de Boyacá (fijo)
    "2027-08-16", // Asunción de la Virgen (15-ago, trasladado: domingo -> lunes siguiente)
    "2027-10-18", // Día de la Raza (12-oct, trasladado: martes -> lunes siguiente)
    "2027-11-01", // Todos los Santos (1-nov, YA es lunes en 2027: no se traslada)
    "2027-11-15", // Independencia de Cartagena (11-nov, trasladado: jueves -> lunes siguiente)
    "2027-12-08", // Inmaculada Concepción (fijo)
    "2027-12-25", // Navidad (fijo)
  ];
  assert.equal(esperados2027.length, 19, "19 festivos en 2027 (oraculo M38): el propio test debe listarlos todos, para no verificar de menos");
  for (const fecha of esperados2027) {
    assert.ok(festivos2027.has(fecha), `${fecha} debe ser festivo en 2027`);
  }
  assert.equal(festivos2027.size, 19, "19 festivos en 2027 (oraculo M38): no deben colisionar dos festivos en la misma fecha");
});

// ── M38 (corrige vuelta 28, 2026-10-05): Ley 2578 de 2026 — Chiquinquirá (9-jul) trasladable al
// lunes siguiente, SOLO desde 2026 ──────────────────────────────────────────────────────────────

test("M38: 13-jul-2026, 12-jul-2027 y 10-jul-2028 son festivos (9-jul trasladado al lunes siguiente)", () => {
  assert.equal(esFestivoColombia("2026-07-13"), true, "2026: 9-jul es jueves -> lunes 13-jul");
  assert.equal(esFestivoColombia("2027-07-12"), true, "2027: 9-jul es viernes -> lunes 12-jul");
  assert.equal(esFestivoColombia("2028-07-10"), true, "2028: 9-jul es domingo -> lunes 10-jul");
  // El 9 de julio en si (jueves/viernes/domingo segun el año) NUNCA es el festivo: se traslada.
  assert.equal(esFestivoColombia("2026-07-09"), false);
  assert.equal(esFestivoColombia("2027-07-09"), false);
});

test("M38: antes de 2026 el 9 de julio (ni su lunes trasladado) no es festivo — la ley no es retroactiva", () => {
  assert.equal(esFestivoColombia("2025-07-09"), false);
  // 9-jul-2025 es miercoles -> si se aplicara el traslado habria dado 14-jul-2025; tampoco debe serlo.
  assert.equal(esFestivoColombia("2025-07-14"), false);
  // No se compara el tamaño total de 2025 contra 18: por una coincidencia AJENA a M38 (29-jun-2025,
  // domingo, se traslada al mismo lunes 30-jun que ya ocupa el Sagrado Corazón de ese año),
  // festivosColombia(2025) ya daba 17 fechas unicas ANTES de este cambio — fuera del alcance de
  // M38 (que solo agrega Chiquinquirá desde 2026), se deja documentado, no se corrige en silencio.
  assert.equal(festivosColombia(2026).size - festivosColombia(2025).size >= 1, true, "2026 debe tener al menos 1 festivo mas que 2025 (Chiquinquirá)");
});

test("M38: 19 festivos en 2027 (18 de siempre + Chiquinquirá)", () => {
  assert.equal(festivosColombia(2027).size, 19);
});

// ── esFestivoColombia: helper de consulta puntual, usado por sumarDiasHabiles ──────────────────

test("esFestivoColombia: reconoce festivos de ambos años y rechaza una fecha cualquiera", () => {
  assert.equal(esFestivoColombia("2026-12-25"), true);
  assert.equal(esFestivoColombia("2027-07-20"), true);
  assert.equal(esFestivoColombia("2026-10-06"), false, "un martes cualquiera sin festivo no debe marcarse");
});

// ── Mutacion (documentada, no comiteada): quitar los festivos de sumarDiasHabiles (volver a solo
// fin de semana) hace caer la prueba de Semana Santa de tests/avisos.test.ts (verificado a mano
// comentando la linea `const esFestivo = ...` de server/avisos.ts y forzando `esFestivo = false`;
// la prueba "1 dia habil cruzando el puente de Semana Santa 2026" paso de esperar 06/04/2026 a dar
// 02/04/2026 — restaurado de inmediato).
