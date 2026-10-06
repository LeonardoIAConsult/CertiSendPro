// Festivos oficiales de Colombia (M36(3), corrige vuelta 27, 2026-10-05): usados por
// `sumarDiasHabiles` (server/avisos.ts) para que la fecha límite de devolución del Paquete (5 días
// hábiles tras el pago, Términos sec. 8.4) nunca cuente un festivo como día hábil.
//
// NOTA (supuesto marcado, no corregido en silencio): la orden que pidió esto cita "Ley 18 de 1983"
// como la ley que traslada festivos al lunes. La ley real con ese efecto es la **Ley 51 de 1983**
// ("Ley Emiliani", por el senador Jorge Emiliani Román) — verificado contra las fuentes citadas
// abajo, que la mencionan explícitamente. Se implementa el calendario correcto (verificado contra
// 2026 y 2027 fecha por fecha, ver tests/festivosColombia.test.ts) dejando esta nota en vez de
// repetir la cita equivocada; alguien con autoridad legal (Abogado_LAP o Leonardo) debe confirmar
// antes de citar "Ley 18 de 1983" en cualquier documento publicado.
//
// Los 18 festivos/año:
//   - 6 FIJOS, nunca se trasladan: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
//   - 7 de fecha fija que SI se trasladan al lunes siguiente (o se quedan si ya caen en lunes):
//     6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov.
//   - 5 móviles ligados a la Pascua: Jueves Santo (Pascua-3, nunca se traslada), Viernes Santo
//     (Pascua-2, nunca se traslada), Ascensión (Pascua+43), Corpus Christi (Pascua+64) y Sagrado
//     Corazón (Pascua+71) — estos tres últimos YA caen en lunes sin necesitar traslado, porque la
//     Pascua es domingo y 43/64/71 son todos ≡ 1 (mod 7).
//
// Fuentes usadas para verificar el calendario calculado (consultadas 2026-10-05, no son el Diario
// Oficial pero son consistentes entre sí y con el cálculo de Pascua de Meeus):
//   - 2026: https://rulex.org/festivos (tabla completa de los 18 festivos, cita Ley 51 de 1983)
//   - 2027: https://calendariosnacionales.com/co/2027/festivos/ (tabla completa de los 18 festivos)
// Las 18 fechas de cada año se compararon una a una en tests/festivosColombia.test.ts.
//
// M38 (corrige vuelta 28, 2026-10-05) — festivo 19 desde 2026: Ley 2578 de 2026 (sancionada el
// 1-jun-2026) declara el 9 de julio, Nuestra Señora del Rosario de Chiquinquirá, festivo nacional,
// trasladable al lunes siguiente por la Ley Emiliani (igual que los 7 de FESTIVOS_TRASLADABLES_A_LUNES
// de arriba). Fuente: El Tiempo, "Para cuándo quedó definido el nuevo festivo en Colombia" —
// https://www.eltiempo.com/politica/gobierno/para-cuando-quedo-definido-el-nuevo-festivo-en-colombia-pilas-aplica-desde-julio-del-2026-todo-lo-que-debe-saber-de-ley-que-sanciono-el-gobierno-3562200
// Hay una demanda ante la Corte Constitucional contra esta ley (misma fuente), pero la ley SIGUE
// VIGENTE mientras la Corte no la tumbe — por eso se implementa ya, no se espera el fallo. Si la
// Corte la declara inconstitucional, hay que retirar este festivo (y, para los años ya transcurridos
// con la ley vigente, puede hacer falta una regla de transición — no hoy). Solo aplica desde 2026
// (la ley no tiene efecto retroactivo): `FESTIVO_CHIQUINQUIRA_DESDE_ANIO` abajo.

/** Domingo de Pascua (calendario gregoriano) por el algoritmo de Meeus/Jones/Butcher — el estándar
 * para calcular la fecha sin tablas. Devuelve mes (3=marzo, 4=abril) y día. Verificado: Pascua 2026
 * = 5 de abril, Pascua 2027 = 28 de marzo (ambas coinciden con las fuentes citadas arriba). */
function domingoDePascua(anio: number): { mes: number; dia: number } {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

/** Fecha de CALENDARIO (sin hora, sin zona horaria) representada en UTC puro: estos festivos son
 * fechas del calendario civil colombiano, no instantes — usar UTC evita cualquier corrimiento de
 * día por huso horario o DST al sumar/restar días. */
function fechaCalendario(anio: number, mes1a12: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes1a12 - 1, dia));
}

function sumarDiasCalendario(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 24 * 3600_000);
}

function formatearYYYYMMDD(fecha: Date): string {
  const anio = fecha.getUTCFullYear();
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

/** Lunes siguiente a `fecha` — o la MISMA fecha, si ya es lunes (Ley 51 de 1983: un festivo que ya
 * cae en lunes no se mueve). `getUTCDay()`: 0=domingo … 6=sábado. La fórmula `(8 - diaSemana) % 7`
 * da 0 para lunes y el número correcto de días a sumar para cualquier otro día (verificada contra
 * las 7 fechas trasladables de 2026 y 2027, ver tests/festivosColombia.test.ts). */
function siguienteLunesOMismoDia(fecha: Date): Date {
  const diaSemana = fecha.getUTCDay();
  const diasParaAvanzar = (8 - diaSemana) % 7;
  return sumarDiasCalendario(fecha, diasParaAvanzar);
}

const FESTIVOS_FIJOS: Array<[number, number]> = [
  [1, 1], // Año Nuevo
  [5, 1], // Día del Trabajo
  [7, 20], // Día de la Independencia
  [8, 7], // Batalla de Boyacá
  [12, 8], // Inmaculada Concepción
  [12, 25], // Navidad
];

const FESTIVOS_TRASLADABLES_A_LUNES: Array<[number, number]> = [
  [1, 6], // Reyes Magos
  [3, 19], // San José
  [6, 29], // San Pedro y San Pablo
  [8, 15], // Asunción de la Virgen
  [10, 12], // Día de la Raza
  [11, 1], // Todos los Santos
  [11, 11], // Independencia de Cartagena
];

/** M38: Ley 2578 de 2026 solo aplica desde el año en que se sancionó (1-jun-2026); un "9 de julio"
 * de 2025 o antes nunca fue festivo. */
const FESTIVO_CHIQUINQUIRA_DESDE_ANIO = 2026;

/** Los festivos de Colombia de `anio` (18 hasta 2025; 19 desde 2026, M38), como texto
 * `yyyy-mm-dd`. Calculado, no una tabla fija a mano: válido para cualquier año, verificado contra
 * fuentes externas solo para 2026 y 2027 (ver cabecera del archivo y tests/festivosColombia.test.ts). */
export function festivosColombia(anio: number): Set<string> {
  const fechas: Date[] = [];

  for (const [mes, dia] of FESTIVOS_FIJOS) {
    fechas.push(fechaCalendario(anio, mes, dia));
  }
  const trasladables = [...FESTIVOS_TRASLADABLES_A_LUNES];
  if (anio >= FESTIVO_CHIQUINQUIRA_DESDE_ANIO) {
    trasladables.push([7, 9]); // M38: Nuestra Señora del Rosario de Chiquinquirá (Ley 2578 de 2026).
  }
  for (const [mes, dia] of trasladables) {
    fechas.push(siguienteLunesOMismoDia(fechaCalendario(anio, mes, dia)));
  }

  const pascua = domingoDePascua(anio);
  const domingoPascua = fechaCalendario(anio, pascua.mes, pascua.dia);
  fechas.push(sumarDiasCalendario(domingoPascua, -3)); // Jueves Santo
  fechas.push(sumarDiasCalendario(domingoPascua, -2)); // Viernes Santo
  fechas.push(sumarDiasCalendario(domingoPascua, 43)); // Ascensión del Señor (ya cae en lunes)
  fechas.push(sumarDiasCalendario(domingoPascua, 64)); // Corpus Christi (ya cae en lunes)
  fechas.push(sumarDiasCalendario(domingoPascua, 71)); // Sagrado Corazón de Jesús (ya cae en lunes)

  return new Set(fechas.map(formatearYYYYMMDD));
}

/** true si `fechaYYYYMMDD` (texto `yyyy-mm-dd`, el mismo formato que usa `server/trm.ts` para el
 * "hoy" de Bogotá) es un festivo colombiano. Recalcula el calendario completo del año de la fecha
 * cada vez: 18 fechas es barato de recalcular, y evita el riesgo de una caché que viva entre años. */
export function esFestivoColombia(fechaYYYYMMDD: string): boolean {
  const anio = Number(fechaYYYYMMDD.slice(0, 4));
  return festivosColombia(anio).has(fechaYYYYMMDD);
}

/** Expuesta solo para pruebas (verificación de la Pascua contra las fuentes citadas). */
export function _domingoDePascuaParaPruebas(anio: number): { mes: number; dia: number } {
  return domingoDePascua(anio);
}
