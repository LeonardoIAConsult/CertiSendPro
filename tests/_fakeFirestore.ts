// Doble de Firestore para probar las funciones TRANSACCIONALES de server/cuentas.ts sin tocar
// la base de datos real (corregido tras el NO-GO del REVISOR_EXTERNO_LAP, vuelta 18, Tarea 3).
// No es un archivo de pruebas (no termina en .test.ts): es un helper que importan las pruebas.
//
// Reproduce DOS reglas reales de Firestore, porque el bug G3 y el M19 dependen de ellas:
//
// 1) Una transaccion NO puede hacer tx.get() despues de tx.update()/tx.set(): el SDK real lanza
//    "Firestore transactions require all reads to be executed before all writes." Este doble
//    lanza el mismo texto en la misma situacion, para que la prueba de G3 sea real (y la
//    mutacion — invertir el orden get/update — la haga fallar).
//
// 2) Una transaccion es OPTIMISTA: si, entre que esta transaccion LEYO un documento y el momento
//    en que intenta confirmar, OTRA transaccion ya confirmo una escritura sobre ese mismo
//    documento, Firestore reintenta esta transaccion desde cero con el estado nuevo. Sin esto,
//    la prueba de concurrencia (M19) no demostraria nada: con un doble "ingenuo" que aplica cada
//    escritura tal cual llega, 5 reservas en paralelo podrian pisarse entre si y aceptarse las 5
//    aunque el cupo del lote sea 3.

export interface DocRefFalso {
  path: string;
}

interface DocGuardado {
  version: number;
  data: Record<string, any> | undefined;
}

/** Mismo mensaje que lanza el SDK real de Firestore en esta situacion (ver punto 1 arriba). */
export const MENSAJE_LECTURAS_DESPUES_DE_ESCRITURAS =
  "9 FAILED_PRECONDITION: Firestore transactions require all reads to be executed before all writes.";

class TransaccionFalsa {
  private escribioAlgo = false;
  private lecturas = new Map<string, number>(); // path -> version leida en ESTE intento
  private escrituras: Array<{ ref: DocRefFalso; data: Record<string, any> }> = [];

  constructor(private almacen: Map<string, DocGuardado>) {}

  async get(ref: DocRefFalso) {
    if (this.escribioAlgo) {
      throw new Error(MENSAJE_LECTURAS_DESPUES_DE_ESCRITURAS);
    }
    const guardado = this.almacen.get(ref.path);
    this.lecturas.set(ref.path, guardado ? guardado.version : 0);
    const data = guardado?.data;
    return { exists: data !== undefined, data: () => data };
  }

  update(ref: DocRefFalso, data: Record<string, any>) {
    this.escribioAlgo = true;
    this.escrituras.push({ ref, data });
  }

  set(ref: DocRefFalso, data: Record<string, any>) {
    this.escribioAlgo = true;
    // `set` reemplaza el documento entero; se marca con `__set` para que `aplicar()` no mezcle
    // con los datos viejos como hace `update`.
    this.escrituras.push({ ref, data: { ...data, __set: true } });
  }

  /** true si algun documento leido en este intento cambio de version desde que se leyo. */
  hayConflicto(): boolean {
    for (const [path, versionLeida] of this.lecturas) {
      const actual = this.almacen.get(path);
      const versionActual = actual ? actual.version : 0;
      if (versionActual !== versionLeida) return true;
    }
    return false;
  }

  aplicar() {
    for (const { ref, data } of this.escrituras) {
      const actual = this.almacen.get(ref.path);
      const esSet = (data as any).__set === true;
      const { __set, ...datosLimpios } = data as any;
      const base = esSet ? {} : actual?.data ?? {};
      this.almacen.set(ref.path, { version: (actual?.version ?? 0) + 1, data: { ...base, ...datosLimpios } });
    }
  }
}

export class FirestoreFalso {
  private almacen = new Map<string, DocGuardado>();

  doc(path: string): DocRefFalso {
    return { path };
  }

  /**
   * M1 (correccion NO-GO vuelta 30, 2026-10-05): minimo necesario para probar los ENVOLTORIOS
   * REALES de server/cuentas.ts (p. ej. `activarPaqueteSiNoProcesado`, no solo su `...Tx`) contra
   * este doble, via `_usarFirestoreParaPruebas`. Esos envoltorios solo hacen
   * `db().collection(nombre).doc(id)` y `db().runTransaction(...)` — nunca `.where()`/`.get()`
   * fuera de una transaccion — por eso esto NO intenta imitar consultas de Firestore.
   */
  collection(nombre: string): { doc(id: string): DocRefFalso } {
    return { doc: (id: string) => this.doc(`${nombre}/${id}`) };
  }

  /** Siembra un documento con datos iniciales, fuera de cualquier transaccion. */
  seed(path: string, data: Record<string, any>) {
    this.almacen.set(path, { version: 1, data: { ...data } });
  }

  leer(path: string): Record<string, any> | undefined {
    return this.almacen.get(path)?.data;
  }

  /**
   * Igual que el SDK real: reintenta la funcion de transaccion desde cero ante un conflicto de
   * version (ver punto 2 de la cabecera). Si la funcion LANZA un error de aplicacion (no un
   * conflicto), esa excepcion sube tal cual, sin reintentar — tambien igual que Firestore real.
   */
  async runTransaction<T>(fn: (tx: TransaccionFalsa) => Promise<T>): Promise<T> {
    for (;;) {
      const tx = new TransaccionFalsa(this.almacen);
      const resultado = await fn(tx);
      if (tx.hayConflicto()) continue;
      tx.aplicar();
      return resultado;
    }
  }
}
