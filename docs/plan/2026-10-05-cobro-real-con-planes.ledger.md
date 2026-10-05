# Ledger — Cobro real con planes

(una línea `complete` por tarea al cerrarla)
complete Tarea 0 — destinos del dictamen escritos en el plan y spec v2 (2026-10-05)
complete Tarea 1 — middleware de ID token de Firebase en server.ts (exigirAuth en /api/send-email y /api/mercadopago/create-preference; adjuntarAuthSiExiste en split-pdf/get-page-pdf/analyze-page/canva-export-design); src/firebaseAuth.ts expone getIdToken(); src/App.tsx manda Authorization: Bearer en sus 5 llamadas a /api; firebase-admin agregado como dependencia (2026-10-05)
complete Tarea 2 — server/firebaseAdmin.ts (app compartida) + server/cuentas.ts (obtenerCuenta, marcarProcesado transaccional) sobre la base de datos nombrada; firestore.rules deniega todo acceso de clientes a cuentas/ y pagosProcesados/; firebase.json con el bloque firestore apuntando a esa base (sin desplegar); GET /api/cuenta protegido (2026-10-05)
