// App compartida de firebase-admin (Tarea 1, 2026-10-05).
// Un solo punto de inicializacion para que server.ts (verificar el ID token) y
// server/cuentas.ts (Firestore) usen SIEMPRE la misma app, sin importar el orden en
// que los modulos se importen entre si.
import { initializeApp, applicationDefault, getApps, type App } from "firebase-admin/app";

// Proyecto de Firebase de CertiSend (comparte cuenta de Google Cloud con Faro).
const FIREBASE_PROJECT_ID = "clever-spirit-436820-t7";

let appInstance: App | null = null;

export function obtenerFirebaseApp(): App {
  if (appInstance) return appInstance;
  const existentes = getApps();
  if (existentes.length > 0) {
    appInstance = existentes[0];
    return appInstance;
  }
  // En Cloud Run, applicationDefault() usa las credenciales por defecto del servicio
  // (metadata server), sin secretos en el repo. En local sin credenciales, esto NO falla
  // aqui: el fallo (si lo hay) ocurre al verificar un token o leer Firestore, y ese llamador
  // es quien decide el 401/503 — nunca se cae en 500 silencioso.
  appInstance = initializeApp({
    credential: applicationDefault(),
    projectId: FIREBASE_PROJECT_ID,
  });
  return appInstance;
}
