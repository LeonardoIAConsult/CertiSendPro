import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { PDFDocument } from "pdf-lib";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { obtenerFirebaseApp } from "./server/firebaseAdmin";
import { enmascararCorreosEnTexto } from "./shared/correo";
import {
  obtenerCuenta,
  decidirLote,
  crearLote,
  reservarEnvio,
  confirmarEnvioExitoso,
  liberarReserva,
  guardarPreferencia,
  obtenerPreferencia,
  activarPaqueteSiNoProcesado,
  guardarAceptacion,
  tienePaqueteVigenteConSaldo,
  guardarAutorizacionDatos,
  obtenerAutorizacionDatos,
  guardarAceptacionUso,
  obtenerAceptacionUso,
  guardarConfirmacionLote,
  obtenerHuellasLote,
  normalizarIdioma,
  textoAutorizacionDatos,
  textoAceptacionTerminosUso,
  decidirRegistroAutorizacion,
  TERMINOS_VERSION,
} from "./server/cuentas";
import {
  huellasLote,
  huellaConfigurada,
  validarSecretoYPares,
  type ParConfirmacion,
} from "./server/huellaLote";
import { decidirEnvioSendEmail, decidirAutorizacionLoteRuta, decidirAceptacionUsoRuta, decidirAccesoSesionPdf } from "./server/decisionesRuta";
import { trmHoy, copDesdeUsd } from "./server/trm";
import { procesarWebhookMP, extraerAvisoWebhookMP, registrarResultadoWebhook, type EstadoFallosWebhook } from "./server/webhook";
import { crearCobroPaquete } from "./server/cobroPaquete";
import { evaluarLimite, type EstadoVentana } from "./server/limitador";
import {
  enviarCorreo,
  construirAvisoFalloWebhookLeonardo,
  PROVEEDOR_NOMBRE,
  proveedorConfigurado,
  relayConfigurado,
} from "./server/avisos";
import {
  notificarActivacionPaquete,
  avisarReembolsoPaquete,
  avisarPagoDobleRequiereReembolso,
  CORREO_LEONARDO,
  depsNotificarActivacionReales,
  depsAvisarReembolsoReales,
  depsAvisarPagoDobleReales,
} from "./server/notificaciones";
import { registrarRutasTareas, verificarRutaTareasRegistrada } from "./server/tareasFondo";

const app = express();
// Cloud Run inyecta PORT; en local sigue siendo 3000.
const PORT = Number(process.env.PORT || 3000);
// Detras de Firebase Hosting + Cloud Run hay 2 proxies de Google. Sin esto req.ip es la IP
// del proxy y TODOS los usuarios comparten el mismo cupo del limite por minuto. Con `true`
// se tomaria la IP mas a la izquierda de X-Forwarded-For, que el cliente puede falsificar.
app.set("trust proxy", 2);

// Setup JSON and body parsing with standard limits for PDF processing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ── Blindaje de la API (2026-09-16) ──────────────────────────────────────────
// Hoy este servidor solo corre en local: Firebase Hosting sirve unicamente el
// estatico de dist/, asi que /api/* no esta expuesto a internet. Pero el dia que
// se despliegue el backend, /api/analyze-page queda abierto gastando la clave de
// Gemini del SERVIDOR con PDF de hasta 50 MB por peticion — es decir, un tercero
// controlando la factura. Esto se pone AHORA, mientras no cuesta nada, en vez de
// el dia del despliegue, que es cuando se olvida.
// Sin dependencias nuevas a proposito: menos superficie y nada que auditar.

// Solo se aceptan navegadores de origenes conocidos. Las llamadas sin cabecera
// Origin (curl, el propio front servido desde este mismo servidor) pasan igual.
const ORIGENES_OK = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173").split(",").map(o => o.trim());
app.use((req, res, next) => {
  const origen = req.headers.origin;
  if (origen) {
    if (!ORIGENES_OK.includes(origen)) {
      return res.status(403).json({ error: "Origen no permitido" });
    }
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Limite de peticiones por IP (o por uid, ver abajo) y minuto, en memoria. No pretende ser un
// WAF: es el tope que evita que alguien queme la cuota de Gemini o de Mercado Pago en bucle.
// Se limpia solo para no crecer sin fin.
const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = Number(process.env.RATE_LIMIT_PER_MIN || 30);
const visitas = new Map<string, { n: number; desde: number }>();
// Verify v2 (ad80fd6, hallazgo "rate limit"): `trust proxy` es un numero FIJO de saltos
// (2: Firebase Hosting -> Cloud Run), pero una peticion que entra DIRECTO por la URL de Cloud Run
// (*.run.app, salta Hosting — ya documentado mas abajo en `limitarCobroGlobal`) solo tiene el
// salto real del Google Front End de Cloud Run: con `trust proxy=2` fijo, Express toma como "IP
// real" una entrada de X-Forwarded-For que en ESE camino el cliente puede escribir el mismo
// (falsificando cuantas entradas quiera), esquivando el limite con solo rotar esa cabecera. No se
// puede fijar un numero de saltos correcto para los DOS caminos a la vez sin acceso a la
// infraestructura real para confirmarlo (guardarraíl: sin `gcloud` de escritura) — la defensa que
// SI es correcta sin depender de ningun salto: si la peticion trae un ID token de Firebase VALIDO
// (verificado aqui, con criptografia, nunca con una cabecera que el cliente controla), se usa el
// uid como clave del limitador en vez de la IP. Un uid no se puede falsificar rotando cabeceras.
app.use("/api", async (req, res, next) => {
  const identidad = await verificarIdToken(req);
  const clave = identidad ? `uid:${identidad.uid}` : `ip:${req.ip || req.socket.remoteAddress || "desconocida"}`;
  const ahora = Date.now();
  const v = visitas.get(clave);
  if (!v || ahora - v.desde > VENTANA_MS) {
    visitas.set(clave, { n: 1, desde: ahora });
  } else if (++v.n > MAX_POR_VENTANA) {
    res.setHeader("Retry-After", Math.ceil((VENTANA_MS - (ahora - v.desde)) / 1000));
    return res.status(429).json({ error: "Demasiadas peticiones. Espera un momento." });
  }
  if (visitas.size > 5000) {
    for (const [k, val] of visitas) if (ahora - val.desde > VENTANA_MS) visitas.delete(k);
  }
  next();
});

// Cabeceras basicas: nada de esto rompe una API JSON y cierra clases enteras de abuso.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Identidad del usuario en el servidor (Tarea 1, 2026-10-05) ───────────────────────────────
// El navegador manda el ID token de Firebase del usuario logueado (no el access token de
// Google para Gmail/Sheets, que es otro) como "Authorization: Bearer <idToken>". Se verifica
// aqui con firebase-admin (credenciales por defecto de Cloud Run) y de ahi sale el `uid` en el
// que confia el resto del servidor — nunca un uid que mande el propio navegador en el body.
declare global {
  namespace Express {
    interface Request {
      uid?: string;
      email?: string | null;
    }
  }
}

async function verificarIdToken(req: express.Request, comprobarRevocado = false): Promise<{ uid: string; email: string | null } | null> {
  const encabezado = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/.exec(encabezado);
  if (!match) return null;
  try {
    // En rutas de cobro/envio se comprueba ademas que el token no este revocado (cuenta
    // deshabilitada o sesion cerrada), no solo que no haya caducado.
    const decoded = await getAuth(obtenerFirebaseApp()).verifyIdToken(match[1], comprobarRevocado);
    return { uid: decoded.uid, email: decoded.email || null };
  } catch (error) {
    // Token ausente, falso, expirado, o sin red/credenciales para verificarlo: en todos los
    // casos es "no autenticado", nunca un error 500. El detalle va solo al log del servidor.
    console.warn("[AUTH] ID token invalido o no verificable:", (error as any)?.message || error);
    return null;
  }
}

// Rutas de cobro y de envio: sin un token valido, 401. El uid nunca llega por el body.
const exigirAuth: express.RequestHandler = async (req, res, next) => {
  const identidad = await verificarIdToken(req, true);
  if (!identidad) {
    return res.status(401).json({ error: "Se requiere iniciar sesion para usar esta funcion." });
  }
  req.uid = identidad.uid;
  req.email = identidad.email;
  next();
};

// Rutas que hoy funcionan sin exigir login (no romper el flujo actual de dividir/analizar
// PDF): si llega un token valido se adjunta el uid; si no, se sigue igual sin bloquear.
const adjuntarAuthSiExiste: express.RequestHandler = async (req, _res, next) => {
  const identidad = await verificarIdToken(req);
  if (identidad) {
    req.uid = identidad.uid;
    req.email = identidad.email;
  }
  next();
};
// ─────────────────────────────────────────────────────────────────────────────

interface PdfCacheEntry {
  buffer: Buffer;
  pageCount: number;
  timestamp: number;
  extractedPages: Map<number, string>;
  /** Sentinel/security-review (ad80fd6, hallazgo previo al diff): dueño de la sesion — el uid que
   * la creo via POST /api/split-pdf, o `null` si se creo sin sesion de Firebase (Modo Invitado,
   * que SI sube PDFs reales aunque simule la hoja de calculo y el escaneo con IA). `null` preserva
   * el comportamiento de siempre para sesiones anonimas (accesibles por quien tenga el id);
   * con un `uid` real, SOLO ese uid puede volver a leer la sesion. */
  uid: string | null;
}
const pdfCache = new Map<string, PdfCacheEntry>();

/** Sentinel/security-review (ad80fd6): mismo error para "la sesion no existe" y "la sesion es de
 * otro uid" — nunca revela cual de los dos casos es (evita que alguien use la respuesta para
 * confirmar que un sessionId ajeno existe de verdad). Las rutas que llaman a `getPageBase64`
 * atrapan esta clase especificamente para responder 404 (nunca 500). */
class SesionPdfInaccesible extends Error {}

// Clean up expired sessions (older than 2 hours) to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pdfCache.entries()) {
    if (now - entry.timestamp > 2 * 60 * 60 * 1000) {
      pdfCache.delete(key);
      console.log(`[Cache Evict] Evicted expired PDF session: ${key}`);
    }
  }
}, 10 * 60 * 1000); // every 10 minutes

async function getPageBase64(sessionId: string, pageIndex: number, requesterUid: string | null): Promise<string> {
  const cached = pdfCache.get(sessionId);
  // Sentinel/security-review (ad80fd6): decision extraida (`decidirAccesoSesionPdf`,
  // server/decisionesRuta.ts, PURA) — sin entrada -> no existe/expiro; con entrada pero de OTRO
  // uid -> inaccesible. Los dos casos dan el MISMO error (nunca se distingue cual es, ver
  // `SesionPdfInaccesible`).
  if (!decidirAccesoSesionPdf(cached ? cached.uid : undefined, requesterUid)) {
    throw new SesionPdfInaccesible("La sesión del PDF ha expirado o no existe en el servidor. Por favor, selecciona y carga de nuevo tu archivo PDF.");
  }

  // Check if already extracted
  if (cached.extractedPages.has(pageIndex)) {
    return cached.extractedPages.get(pageIndex)!;
  }

  // Extract page
  const pdfDoc = await PDFDocument.load(cached.buffer);
  if (pageIndex < 1 || pageIndex > cached.pageCount) {
    throw new Error(`Índice de página fuera de rango (${pageIndex} de ${cached.pageCount})`);
  }

  const singlePageDoc = await PDFDocument.create();
  const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pageIndex - 1]);
  singlePageDoc.addPage(copiedPage);
  const pdfBytes = await singlePageDoc.save();
  const base64Str = Buffer.from(pdfBytes).toString("base64");

  // Save in cache
  cached.extractedPages.set(pageIndex, base64Str);
  return base64Str;
}

// ── Tope POR USUARIO de /api/analyze-page (Sentinel/security-review sobre ad80fd6, hallazgo
// previo al diff) ────────────────────────────────────────────────────────────────────────────
// Antes la ruta corria con `adjuntarAuthSiExiste` (login opcional): sin sesion, el unico freno
// era el limitador global por IP (30/min, mas arriba) — insuficiente para una clave de Gemini de
// pago (basta con rotar de IP). Ahora exige `exigirAuth` y, ademas, un tope propio por uid, mismo
// patron que `limitarCobroPorUid` mas abajo (`evaluarLimite`, server/limitador.ts). El limite es
// mas alto que el de cobros porque un lote real analiza una pagina POR CERTIFICADO.
const VENTANA_ANALISIS_UID_MS = 60_000;
const MAX_ANALISIS_POR_UID_VENTANA = Number(process.env.RATE_LIMIT_ANALYZE_UID_PER_MIN || 60);
const estadosAnalisisPorUid = new Map<string, EstadoVentana>();
const limitarAnalisisPorUid: express.RequestHandler = (req, res, next) => {
  const uid = req.uid!; // exigirAuth ya corrio antes en la cadena de middlewares: siempre hay uid.
  const ahora = Date.now();
  const r = evaluarLimite(estadosAnalisisPorUid.get(uid) ?? null, ahora, VENTANA_ANALISIS_UID_MS, MAX_ANALISIS_POR_UID_VENTANA);
  estadosAnalisisPorUid.set(uid, r.estado);
  if (estadosAnalisisPorUid.size > 5000) {
    for (const [k, val] of estadosAnalisisPorUid) if (ahora - val.desde > VENTANA_ANALISIS_UID_MS) estadosAnalisisPorUid.delete(k);
  }
  if (!r.permitido) {
    res.setHeader("Retry-After", r.retryAfterSegundos!);
    return res.status(429).json({ error: "Demasiados análisis de IA en este momento. Intenta de nuevo en un minuto." });
  }
  next();
};

// Endpoint to split multi-page PDF (Metadata only / Register Session)
app.post("/api/split-pdf", adjuntarAuthSiExiste, async (req, res) => {
  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) {
      return res.status(400).json({ error: "No PDF data provided" });
    }

    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    // Load original PDF using pdf-lib just to get page count and validate
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();

    // Sentinel/security-review (ad80fd6, hallazgo previo al diff): `Math.random()` NO es
    // criptograficamente seguro — un sessionId generado asi se puede predecir/fuerza-bruta con
    // suficientes intentos. `crypto.randomUUID()` (ya importado arriba para otros ids del
    // servidor) es impredecible.
    const sessionId = "pdf_" + randomUUID();

    // Cache the root PDF buffer. `uid` (adjuntarAuthSiExiste: puede ser undefined si no hay
    // sesion de Firebase, p. ej. Modo Invitado) queda como dueño de la sesion.
    pdfCache.set(sessionId, {
      buffer: pdfBuffer,
      pageCount,
      timestamp: Date.now(),
      extractedPages: new Map(),
      uid: req.uid ?? null,
    });

    console.log(`[PDF Caching] Registered session ${sessionId} with ${pageCount} pages, size: ${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

    // Return pages list metadata without base64 to allow on-demand loading
    const pagesMeta = Array.from({ length: pageCount }, (_, i) => ({
      index: i + 1,
      base64: "" // empty initially, will be loaded on-demand
    }));

    res.json({ sessionId, pages: pagesMeta });
  } catch (error: any) {
    console.error("Error splitting PDF:", error);
    res.status(500).json({ error: error.message || "Failed to split PDF" });
  }
});

// Endpoint to retrieve a single page's PDF base64 on-demand
app.post("/api/get-page-pdf", adjuntarAuthSiExiste, async (req, res) => {
  try {
    const { sessionId, pageIndex } = req.body;
    if (!sessionId || pageIndex === undefined) {
      return res.status(400).json({ error: "Faltan parámetros sessionId o pageIndex" });
    }

    const base64 = await getPageBase64(sessionId, Number(pageIndex), req.uid ?? null);
    res.json({ base64 });
  } catch (error: any) {
    if (error instanceof SesionPdfInaccesible) {
      return res.status(404).json({ error: error.message });
    }
    console.error("Error extracting page PDF:", error);
    res.status(500).json({ error: error.message || "Failed to split page" });
  }
});

// Endpoint to trigger Canva Connect API Export & Download flow
app.post("/api/canva/export-design", adjuntarAuthSiExiste, async (req, res) => {
  try {
    const { designId, canvaToken } = req.body;
    if (!designId) {
      return res.status(400).json({ error: "Falta el ID del diseño de Canva" });
    }

    // Direct authentic API headers if key is provided
    const authHeader = canvaToken ? `Bearer ${canvaToken}` : "";

    if (!authHeader) {
      return res.status(400).json({
        error: "Se requiere un Token de Acceso de Canva (Canva Access Token) válido para realizar peticiones reales a la API de Canva. Puedes generar uno en canva.dev."
      });
    }

    console.log(`Iniciando exportación de Canva: ${designId}`);

    // Step 1: POST https://api.canva.com/v1/exports to start export job
    const exportInitRes = await fetch("https://api.canva.com/v1/exports", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        design_id: designId,
        format: {
          type: "pdf",
          size: "a4" // default
        }
      })
    });

    if (!exportInitRes.ok) {
      const errText = await exportInitRes.text();
      throw new Error(`Error de Canva API (Iniciación): ${errText}`);
    }

    const initData = await exportInitRes.json();
    const jobId = initData.job?.id;
    if (!jobId) {
      throw new Error("No se pudo obtener el ID del job de exportación.");
    }

    // Step 2: Poll for completion (up to 15 seconds)
    let downloadUrl: string | null = null;
    let attempts = 0;
    while (attempts < 15 && !downloadUrl) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      const pollRes = await fetch(`https://api.canva.com/v1/exports/${jobId}`, {
        headers: {
          "Authorization": authHeader,
        }
      });

      if (!pollRes.ok) {
        const errText = await pollRes.text();
        throw new Error(`Error al consultar estado de exportación: ${errText}`);
      }

      const pollData = await pollRes.json();
      const status = pollData.job?.status;

      if (status === "failed") {
        throw new Error(`La exportación de Canva ha fallado: ${pollData.job?.error?.message || "Error desconocido"}`);
      }

      if (status === "completed") {
        const urls = pollData.job?.urls;
        if (urls && urls.length > 0) {
          downloadUrl = urls[0];
        }
      }
    }

    if (!downloadUrl) {
      throw new Error("La exportación en Canva tardó demasiado. Vuelve a intentarlo.");
    }

    // Step 3: Fetch download PDF bytes and encode to base64
    const pdfResponse = await fetch(downloadUrl);
    if (!pdfResponse.ok) {
      throw new Error("No se pudo descargar el PDF exportado de los servidores de Canva.");
    }

    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfArrayBuffer).toString("base64");

    res.json({ success: true, pdfBase64 });
  } catch (error: any) {
    console.error("Error exporting from Canva Connect API:", error);
    res.status(500).json({ error: error.message || "Fallo inesperado al conectar con Canva" });
  }
});

// Endpoint to analyze a single PDF page with Gemini to extract the person's name
app.post("/api/analyze-page", exigirAuth, limitarAnalisisPorUid, async (req, res) => {
  try {
    const { pdfPageBase64, sessionId, pageIndex, recipientNames } = req.body;
    let activePageBase64 = pdfPageBase64;

    // Direct support for high-performance server-side extraction
    if (!activePageBase64 && sessionId && pageIndex !== undefined) {
      try {
        activePageBase64 = await getPageBase64(sessionId, Number(pageIndex), req.uid ?? null);
      } catch (err: any) {
        return res.status(404).json({ error: `No se pudo obtener la página ${pageIndex}: ${err.message}` });
      }
    }

    if (!activePageBase64) {
      return res.status(400).json({ error: "No PDF page base64 provided" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in the developer secrets panel."
      });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });

    // Helper to perform retries with exponential backoff on rate limits or service overloads
    const generateWithRetry = async (aiInstance: any, params: any, retries = 5, delay = 2000): Promise<any> => {
      try {
        return await aiInstance.models.generateContent(params);
      } catch (err: any) {
        const errorText = String(err.message || "").toLowerCase();
        const status = err.status || err.statusCode || 0;
        
        const isRetryable = 
          status === 429 || 
          status === 503 || 
          errorText.includes("429") || 
          errorText.includes("quota") || 
          errorText.includes("resource exhausted") || 
          errorText.includes("limit exceeded") || 
          errorText.includes("overloaded") || 
          errorText.includes("503") ||
          errorText.includes("service unavailable");

        if (isRetryable && retries > 0) {
          console.warn(`[GEMINI RETRY] Quota limit or server busy. Retrying in ${delay}ms... (${retries} retries left)`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return generateWithRetry(aiInstance, params, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    // Format the recipient names list as a string to ground the model list matching
    let candidatesListText = "No hay lista de destinatarios disponible.";
    if (Array.isArray(recipientNames) && recipientNames.length > 0) {
      candidatesListText = recipientNames.map((name, idx) => `${idx + 1}. ${name}`).join("\n");
    }

    const promptText = `Analiza detalladamente esta página que corresponde a un certificado, diploma o acta de capacitación/participación. Tu objetivo es identificar de manera asertiva e inequívoca el NOMBRE COMPLETO de la persona beneficiaria o receptora del certificado (el participante o estudiante).

Reglas estrictas de identificación:
1. El destinatario o alumno principal destaca visualmente en el centro del diseño del documento, con una fuente tipográfica de mayor tamaño o peso.
2. Comúnmente se sitúa inmediatamente después de verbos o frases de otorgamiento como: 'otorga el presente certificado a:', 'concede el presente diploma a:', 'certifica que:', 'presentado a:', 'hace entrega a:', o palabras clave como 'Participante:', 'Beneficiario:', 'Alumno:', 'Estudiante:'.
3. Ignora y descarta por completo los nombres de las personas que firman el documento al pie de página (representantes, directores, presidentes, secretarios, coordinadores, etc.). Estos suelen ir acompañados de cargos profesionales, títulos como 'Dr.', 'Ing.', 'Director' o estar alineados abajo horizontalmente.
4. Si hay nombres que parecen firmas, pero hay un único nombre principal destacado en el medio del documento, el nombre en el medio es el destinatario correcto.

LISTA DE CANDIDATOS ESPERADOS (Provenientes del Google Sheet):
A continuación, te proporcionamos la lista de personas registradas en el Google Sheet. Compara visualmente el texto de este certificado con este listado de candidatos esperando encontrar una coincidencia exacta o muy aproximada (como variaciones de acentos, abreviaturas o un apellido omitido):
[LISTA DE CANDIDATOS]
${candidatesListText}
[/FIN DE LISTA DE CANDIDATOS]

Reglas de respuesta:
- Si el certificado muestra el nombre de alguno de los candidatos en la lista anterior (admite diferencias menores de tildes, mayúsculas/minúsculas o falta de un segundo apellido), debes devolver EXACTAMENTE ese nombre tal cual aparece en la Lista de Candidatos en el campo "extractedName".
- Si el nombre del certificado NO figura en la lista de candidatos pero identificas claramente un nombre de persona que recibe el certificado en el centro de la página, por favor extraelo fielmente y colócalo en el campo "extractedName".
- Solo si de verdad no hay ningún nombre legible de persona física que parezca el destinatario del certificado, responde 'UNKNOWN'.`;

    // Invoke Gemini 3.5 Flash with the PDF page data inline and retry robustness
    const response = await generateWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            data: activePageBase64,
            mimeType: "application/pdf"
          }
        },
        promptText
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extractedName: {
              type: Type.STRING,
              description: "El nombre completo de la persona beneficiaria tal como se determinó (preferentemente coincidente con la lista de candidatos). Devuelve 'UNKNOWN' si no existe ningún nombre."
            }
          },
          required: ["extractedName"]
        }
      }
    });

    const rawText = (response.text || "").trim();
    let name = "UNKNOWN";

    try {
      const parsed = JSON.parse(rawText);
      name = String(parsed.extractedName || "UNKNOWN").trim();
    } catch {
      // Fallback if parsing fails
      name = rawText;
    }

    // Secondary sanitization for any remaining prefixes or noise
    name = name
      .replace(/^(nombre|nombre completo|usuario|destinatario|participante|alumno|beneficiario|otorgado a|concedido a|presentado a|entregado a|estudiante)\s*:\s*/i, "")
      .replace(/^[\s"'-]+|[\s"'-]+$/g, "") // Strip brackets, quotes, dashes, spaces
      .trim();

    res.json({ name, base64: activePageBase64 });
  } catch (error: any) {
    console.error("Error calling Gemini API:", error);
    res.status(500).json({ error: error.message || "Failed to analyze page with Gemini" });
  }
});

// Endpoint to send MIME-compliant Gmail with PDF attachment
app.post("/api/send-email", exigirAuth, async (req, res) => {
  // Cupo reservado por reservarEnvio() mas abajo (M19); si el envio no llega a confirmarse
  // (cualquier salida de esta ruta antes de confirmarEnvioExitoso), el catch de abajo lo libera
  // para que no quede bloqueado hasta que el lote expire.
  let loteReservado: string | null = null;
  // true desde que Gmail confirmo el envio (justo tras gmailResponse.ok, bajo vuelta 19): si algo
  // lanza despues, el catch nunca debe liberar la reserva ni responder 500 (el correo ya salio).
  let gmailEnvio = false;
  try {
    const { accessToken, to, subject, body, pdfBase64, sessionId, pageIndex, fila, filename, loteId } = req.body;

    // Lote autorizado por /api/lote/iniciar (Tarea 3, 2026-10-05): sin el, no se envia nada.
    // Esto es lo que impide que el navegador salte el limite del plan llamando esta ruta directo.
    if (!loteId) {
      return res.status(403).json({ error: "Falta el lote de envio autorizado. Vuelve a iniciar el envio masivo." });
    }

    // Reserva el cupo ANTES de llamar a Gmail (M19, corregido vuelta 18 del REVISOR): antes, el
    // cupo se comprobaba fuera de transaccion y envios paralelos del mismo lote podian superarlo
    // (Gmail ya habia salido para mas correos de los que el plan permitia). La reserva es
    // transaccional: solo entran los que caben en el cupo del lote y, si es Paquete, en el saldo.
    const reserva = await reservarEnvio(String(loteId), req.uid!);
    // Nota: se compara con `=== false` (no `!reserva.ok`) porque TS 5.8 no angosta el tipo union
    // con un discriminante booleano mediante negacion/truthiness, solo con `===`.
    if (reserva.ok === false) {
      return res.status(403).json({ error: reserva.error });
    }
    loteReservado = String(loteId);
    const planEfectivoLote = reserva.lote.planEfectivo;

    if (!accessToken) {
      await liberarReserva(loteReservado, req.uid!);
      loteReservado = null;
      return res.status(400).json({ error: "No access token provided" });
    }

    let activePdfBase64 = pdfBase64;
    if (!activePdfBase64 && sessionId && pageIndex !== undefined) {
      try {
        activePdfBase64 = await getPageBase64(sessionId, Number(pageIndex), req.uid ?? null);
      } catch (err: any) {
        await liberarReserva(loteReservado, req.uid!);
        loteReservado = null;
        return res.status(404).json({ error: `Fallo al extraer el certificado PDF: ${err.message}` });
      }
    }

    if (!to || !subject || !body || !activePdfBase64 || !filename) {
      await liberarReserva(loteReservado, req.uid!);
      loteReservado = null;
      return res.status(400).json({ error: "Faltan parámetros obligatorios del correo o el archivo PDF" });
    }

    // GRAVE 3 (correccion vuelta 33, 2026-10-06) + Medio 3 (correccion vuelta 31): decision
    // COMPLETA (sanear el correo -> validar formato -> exigir la huella HMAC del par
    // pagina-fila-correo contra lo que /api/lote/iniciar confirmo para ESTE lote) extraida a
    // `decidirEnvioSendEmail` (server/decisionesRuta.ts, correccion vuelta 35/36 sobre
    // tests/decisionesRuta.test.ts, que antes solo grepeaba texto fuente) — unico punto de llamada,
    // nunca se reimplementa inline ni se ignora su resultado.
    const decisionEnvio = await decidirEnvioSendEmail(
      loteReservado,
      { to, fila, pageIndex },
      { obtenerHuellasLote, secretoHuella: process.env.HUELLA_LOTE_SECRET }
    );
    if (decisionEnvio.ok === false) {
      if (decisionEnvio.httpStatus === 503) {
        console.error("[SEND-EMAIL] HUELLA_LOTE_SECRET no configurado; no se envia nada (falla cerrado).");
      }
      await liberarReserva(loteReservado, req.uid!);
      loteReservado = null;
      return res.status(decisionEnvio.httpStatus).json({ error: decisionEnvio.error });
    }
    const cleanTo = decisionEnvio.correo;

    const cleanSubject = String(subject || "")
      .replace(/[\r\n]+/g, " ")
      .trim();

    const boundary = "==_Boundary_Partition_Alternative_==" + Math.floor(Math.random() * 1000000).toString();

    // Construct raw MIME email format - wrapping email in brackets is highly compliant
    const mailParts = [
      `To: <${cleanTo}>`,
      `Subject: =?utf-8?B?${Buffer.from(cleanSubject).toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(body).toString("base64"),
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      activePdfBase64,
      ``,
      `--${boundary}--`
    ];

    const rawMessage = mailParts.join("\r\n");
    const base64RawHex = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const gmailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        raw: base64RawHex
      })
    });

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      let friendlyError = errorText;
      try {
        const parsed = JSON.parse(errorText);
        const code = parsed.error?.code;
        const msg = String(parsed.error?.message || "");
        
        if (msg.includes("Invalid To header") || msg.toLowerCase().includes("recipient") || msg.toLowerCase().includes("invalidto")) {
          friendlyError = `La API de Gmail rechazó la dirección "${cleanTo}" porque no es un correo válido. Por favor, asegúrate de que el PASO 1 (Configuración de Columnas) tenga seleccionada la columna de correos electrónicos de tu Google Sheet y que la celda de esta fila no contenga un nombre, número de teléfono o esté vacía.`;
        } else if (code === 401 || code === 403) {
          friendlyError = `Fallo de autorización con Google Gmail (Autorización expirada). Por favor, haz clic de nuevo en 'Conectar Google Sheets' para refrescar tu sesión.`;
        } else {
          friendlyError = `Detalle de API de Gmail: ${msg} (Código ${code})`;
        }
      } catch (e) {
        if (errorText.includes("Invalid To header")) {
          friendlyError = `La API de Gmail rechazó la dirección "${cleanTo}" al no ser un correo electrónico válido. Asegúrate de mapear la columna correcta en el Paso 1.`;
        } else {
          friendlyError = `Error técnico de Gmail: ${errorText}`;
        }
      }
      throw new Error(friendlyError);
    }

    // Gmail YA confirmo el envio (bajo, corregido vuelta 19 del REVISOR_EXTERNO_LAP): se marca
    // ANTES de `gmailResponse.json()` para que, si esa llamada lanzara (JSON invalido, conexion
    // cortada a mitad de la respuesta), el catch de abajo sepa que el correo SI salio y nunca
    // libere la reserva ni responda 500 por un correo que el destinatario ya recibio.
    gmailEnvio = true;

    const data = await gmailResponse.json();

    // Solo se confirma (pasa de reservado a descontado) tras el OK de Gmail (Tarea 3): si el
    // envio hubiera fallado, el `throw` de arriba ya habria saltado al catch, que libera la
    // reserva sin pasar por aqui.
    try {
      await confirmarEnvioExitoso(loteReservado, req.uid!, planEfectivoLote);
    } catch (contabError: any) {
      // Gmail YA ENVIO el correo de verdad (M20): nunca responder 500 aqui, porque el navegador
      // reintentaria la llamada y duplicaria un correo que ya salio. El detalle queda en el log
      // del servidor (solo loteId/uid, nunca el destinatario ni otro dato del correo) para
      // revisar el saldo a mano.
      console.error(
        `[CONTABILIDAD] Gmail envio el correo pero no se pudo descontar el cupo. loteId=${loteReservado} uid=${req.uid}:`,
        contabError
      );
      return res.json({ success: true, enviado: true, contabilizado: false, messageId: data.id });
    }

    res.json({ success: true, enviado: true, contabilizado: true, messageId: data.id });
  } catch (error: any) {
    // Sentinel/security-review (ad80fd6, hallazgo Bajo): `friendlyError` (arriba) puede incluir
    // el correo del destinatario en claro (util para el USUARIO, que ya lo escribio en su propia
    // hoja) — pero `console.error` llega a Cloud Logging (30 dias, declarado en la Politica de
    // Privacidad como la EXCEPCION, no la norma): se enmascara aqui, solo para el log.
    console.error(
      "Error sending email:",
      error instanceof Error ? enmascararCorreosEnTexto(error.message) : error
    );
    if (gmailEnvio) {
      // Gmail ya envio el correo de verdad (bajo): algo lanzo DESPUES (p. ej. gmailResponse.json())
      // sin llegar a confirmarse/descontarse. Nunca liberar la reserva (el correo si salio, el
      // cupo si se gasto) ni responder 500 (el navegador reintentaria y duplicaria el envio).
      console.error(
        `[CONTABILIDAD] Gmail envio el correo pero algo fallo despues, antes de confirmar. loteId=${loteReservado} uid=${req.uid}:`,
        error
      );
      return res.json({ success: true, enviado: true, contabilizado: false });
    }
    if (loteReservado) {
      // El envio no llego a confirmarse (fallo antes de o durante la llamada a Gmail): liberar
      // el cupo reservado para que no bloquee otros envios del mismo lote (M19).
      try {
        await liberarReserva(loteReservado, req.uid!);
      } catch (liberarError) {
        console.error(`[CONTABILIDAD] No se pudo liberar la reserva. loteId=${loteReservado}:`, liberarError);
      }
    }
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
});

// Endpoint to generate Mercado Pago checkout preference link
// --- Cobro (2026-10-05) ------------------------------------------------------------------
// El PRECIO lo fija el servidor, nunca el navegador (antes llegaba `amount` del cliente y
// cualquiera podia pagar $1). La cuenta de Mercado Pago es de Colombia: se cobra en COP con la
// TRM oficial del dia (Superfinanciera, datos.gov.co 32sa-8pi3), igual que Faro.
// Las claves son el `plan` que acepta esta ruta y el que viaja en `external_reference`
// (`CERTISEND|<uid>|<plan>|<cop>|<idAleatorio>`), nunca el titulo mostrado en el checkout.
const PLANES_USD = {
  paquete: { usd: 15, titulo: "CertiSend — Paquete de 150 envíos" },
  pro: { usd: 29, titulo: "CertiSend Pro Monthly" },
} as const;

// Version vigente de la Politica de Privacidad (docs/legal/privacidad.plantilla.md, "Versión:
// 2.3") que /api/autorizacion-datos guarda junto a la autorizacion (requisito B.3, Tarea 15,
// Ley 1581). Subir esta constante cuando cambie la version publicada.
const AUTORIZACION_DATOS_VERSION = "2.3";
// TRM del dia: validacion, timeout y cacheo robustos viven en server/trm.ts (Tarea 4, 2026-10-05)
// — igual que cuentas.ts, separado de este archivo para poder probarse con node:test sin red.

// URL publica donde Mercado Pago puede llamar de vuelta (`notification_url`). A diferencia de
// APP_URL (back_urls visibles al navegador, cae en localhost en dev), esta SIEMPRE tiene que ser
// un dominio real y accesible desde internet, porque la llama el servidor de Mercado Pago, no el
// navegador del usuario. Por defecto el dominio de produccion del Hosting de este proyecto
// (firebase-applet-config.json `authDomain` e index.html `og:url`): certisendpro.online. Si el
// dominio de Hosting cambiara, Leonardo debe fijar PUBLIC_BASE_URL en el entorno de Cloud Run.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://certisendpro.online";

// ── Tope global anti-inundacion de create-preference (Tarea 12, 2026-10-05) ────────────────────
// Limite GLOBAL en memoria, independiente de la IP (el limitador de arriba) y del uid: una
// peticion que rota X-Forwarded-For o que usa muchas cuentas distintas sigue topando aqui. Solo
// es un tope global de verdad si Cloud Run corre con max-instances=1 (ver server/limitador.ts).
// La URL directa *.run.app (M11) se salta Firebase Hosting, pero NO este middleware: vive en el
// propio Express, nunca en Hosting.
const VENTANA_COBRO_MS = 60_000;
const MAX_COBROS_POR_VENTANA = Number(process.env.RATE_LIMIT_COBROS_PER_MIN || 20);
let estadoCobroGlobal: EstadoVentana | null = null;
const limitarCobroGlobal: express.RequestHandler = (_req, res, next) => {
  const r = evaluarLimite(estadoCobroGlobal, Date.now(), VENTANA_COBRO_MS, MAX_COBROS_POR_VENTANA);
  estadoCobroGlobal = r.estado;
  if (!r.permitido) {
    res.setHeader("Retry-After", r.retryAfterSegundos!);
    return res.status(429).json({ error: "Demasiadas solicitudes de cobro en este momento. Intenta de nuevo en un minuto." });
  }
  next();
};

// ── Tope POR USUARIO de create-preference (M29, corrige vuelta 24) ─────────────────────────────
// Antes, `limitarCobroGlobal` corria ANTES de `exigirAuth` en la ruta de abajo: una peticion SIN
// token (401) ya gastaba un cupo del contador GLOBAL compartido por todos los usuarios, asi que
// 20 peticiones sin token podian agotar el tope global y bloquear a un usuario real autenticado
// que llegara despues. Ahora el orden es exigirAuth -> limitarCobroPorUid -> limitarCobroGlobal:
// sin un uid valido nunca se llega a ningun contador. `evaluarLimite` (server/limitador.ts) ya
// esta probado con node:test; este Map solo lo indexa por uid, igual patron que `visitas` arriba.
const VENTANA_COBRO_UID_MS = 60_000;
const MAX_COBROS_POR_UID_VENTANA = Number(process.env.RATE_LIMIT_COBROS_UID_PER_MIN || 3);
const estadosCobroPorUid = new Map<string, EstadoVentana>();
const limitarCobroPorUid: express.RequestHandler = (req, res, next) => {
  const uid = req.uid!; // exigirAuth ya corrio antes en la cadena de middlewares: siempre hay uid.
  const ahora = Date.now();
  const r = evaluarLimite(estadosCobroPorUid.get(uid) ?? null, ahora, VENTANA_COBRO_UID_MS, MAX_COBROS_POR_UID_VENTANA);
  estadosCobroPorUid.set(uid, r.estado);
  if (estadosCobroPorUid.size > 5000) {
    for (const [k, val] of estadosCobroPorUid) if (ahora - val.desde > VENTANA_COBRO_UID_MS) estadosCobroPorUid.delete(k);
  }
  if (!r.permitido) {
    res.setHeader("Retry-After", r.retryAfterSegundos!);
    return res.status(429).json({ error: "Demasiados intentos de cobro. Espera un minuto." });
  }
  next();
};

app.post("/api/mercadopago/create-preference", exigirAuth, limitarCobroPorUid, limitarCobroGlobal, async (req, res) => {
  // APAGADO hasta que Leonardo defina la entrega (05-oct): la landing manda a contacto. Encender
  // con PAGOS_ACTIVOS=1 en Cloud Run cuando exista que activar tras el pago (ver memoria).
  if (process.env.PAGOS_ACTIVOS !== "1") {
    return res.status(503).json({ error: "Pagos no disponibles por ahora. Escribenos a contacto@leonardoantolinez.com." });
  }
  try {
    // `amount`/`currency`/`planName` del cliente se ignoran a proposito. `aceptaTerminos` y
    // `aceptaRetracto` son las DOS casillas sin marcar del checkout (Tarea 14): las valida
    // `crearCobroPaquete`, mas abajo, para que la prueba "sin casilla no crea nada" sea real.
    // `copMostrado`/`idioma`/`modalidad` son del checkout (M28, corrige vuelta 24): el servidor
    // SIEMPRE recalcula el cop con la TRM de este momento; `copMostrado` solo se usa para
    // comparar (409 si no coincide, ver crearCobroPaquete), nunca para fijar el precio.
    const { plan, aceptaTerminos, aceptaRetracto, copMostrado, idioma, modalidad } = req.body as {
      plan?: string;
      aceptaTerminos?: unknown;
      aceptaRetracto?: unknown;
      copMostrado?: unknown;
      idioma?: unknown;
      modalidad?: unknown;
    };
    if (plan === "pro") {
      // Pro es suscripcion (Tarea 8); todavia no existe que activar cuando MP confirme el cobro.
      return res.status(501).json({ error: "Pro llega pronto. Escribenos a contacto@leonardoantolinez.com." });
    }
    if (plan !== "paquete") {
      return res.status(400).json({ error: "Plan no valido" });
    }

    // Verify v2 (ad80fd6, hallazgo Medio): `handlePagarPaquete` en LandingPage.tsx reusa el flujo
    // de "Ingresar con Google" cuando no hay sesion de Firebase, pero eso NO comprueba que las
    // casillas previas al login (autorizacion de datos T11 + aceptacion de Terminos O2) ya se
    // hayan marcado — un usuario con sesion de Firebase vieja (de antes de O2) podia llegar aqui
    // sin ninguna de las dos. Mismo gate EXACTO que /api/lote/iniciar, con los mismos motivos
    // ("autorizacion"/"terminos") para que el cliente sepa que modal reabrir.
    const decisionAutorizacionCobro = await decidirAutorizacionLoteRuta(req.uid!, AUTORIZACION_DATOS_VERSION, { obtenerAutorizacionDatos });
    if (decisionAutorizacionCobro.ok === false) {
      return res.status(decisionAutorizacionCobro.httpStatus).json({
        error: decisionAutorizacionCobro.error,
        motivo: decisionAutorizacionCobro.motivo,
      });
    }
    const decisionTerminosCobro = await decidirAceptacionUsoRuta(req.uid!, TERMINOS_VERSION, { obtenerAceptacionUso });
    if (decisionTerminosCobro.ok === false) {
      return res.status(decisionTerminosCobro.httpStatus).json({
        error: decisionTerminosCobro.error,
        motivo: decisionTerminosCobro.motivo,
      });
    }

    const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!mpAccessToken) {
      // Antes devolvia success:true "simulado" y la landing mostraba "pago exitoso" sin cobrar.
      console.warn("[MERCADO PAGO] MERCADO_PAGO_ACCESS_TOKEN no configurado.");
      return res.status(503).json({ error: "Pagos no disponibles en este momento." });
    }

    const { usd, titulo } = PLANES_USD.paquete;
    const base = process.env.APP_URL || "http://localhost:3000";
    const ahora = Date.now();

    const resultado = await crearCobroPaquete({
      uid: req.uid!,
      email: req.email ?? null,
      aceptaTerminos,
      aceptaRetracto,
      copMostrado,
      idioma,
      modalidad,
      // B.2 (Tarea 15, decision del Brain 2026-10-06): 409 si ya hay un Paquete vigente con
      // saldo > 0 — no se permite recomprar. Se relee la cuenta aqui (no la del `obtenerCuenta`
      // de otros handlers) porque este thunk es la unica forma en que `crearCobroPaquete` puede
      // comprobarlo sin acoplarse a Firestore directamente.
      tienePaqueteVigente: async () => tienePaqueteVigenteConSaldo(await obtenerCuenta(req.uid!), new Date()),
      obtenerTrm: trmHoy,
      copDesdeUsd,
      usdPaquete: usd,
      // Id aleatorio de esta preferencia/aceptacion (no el id que MP asigna despues al pago): es
      // la clave de `preferencias/{id}` y `aceptaciones/{id}`, y el ultimo campo del
      // external_reference, para que el webhook pueda volver a leer EXACTAMENTE lo que se
      // ofrecio aqui y comparar contra lo que MP dice que se cobro.
      generarId: randomUUID,
      guardarPreferencia,
      guardarAceptacion,
      log: console.error,
      crearPreferenciaMP: async ({ cop, externalReference }) => {
        // La ruta correcta es /checkout/preferences; /v1/preferences no existe ("resource not
        // found"), asi que el cobro de CertiSend nunca funciono hasta ese cambio.
        const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mpAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: [{ title: titulo, quantity: 1, unit_price: cop, currency_id: "COP" }],
            external_reference: externalReference,
            notification_url: `${PUBLIC_BASE_URL}/api/mp/webhook?src=certisend`,
            back_urls: {
              success: `${base}/?pago=ok`,
              failure: `${base}/?pago=error`,
              pending: `${base}/?pago=pendiente`,
            },
            auto_return: "approved",
            // Vence en 2 h: un cobro guardado no se paga despues a una TRM vieja.
            expires: true,
            expiration_date_from: new Date(ahora).toISOString(),
            expiration_date_to: new Date(ahora + 2 * 3600_000).toISOString(),
            statement_descriptor: "CERTISEND PRO",
          }),
        });
        return { ok: response.ok, status: response.status, json: () => response.json() };
      },
    });

    res.status(resultado.httpStatus).json(resultado.body);
  } catch (error: any) {
    // El detalle (respuesta de MP) va al log del servidor, no al navegador.
    console.error("Error al crear preferencia de Mercado Pago:", error);
    res.status(500).json({ error: "No se pudo iniciar el pago con Mercado Pago." });
  }
});

// ── Webhook propio de CertiSend (Tarea 6, 2026-10-05) ───────────────────────────────────────
// Mercado Pago llama aqui cuando hay novedad en un pago (`notification_url` de arriba). NUNCA se
// confia en el cuerpo/query de este aviso para decidir nada: solo se usan para sacar el id del
// pago; el resto (status, moneda, monto, referencia) se vuelve a consultar con GET
// /v1/payments/{id} usando el access token del SERVIDOR. La logica de verificacion vive en
// server/webhook.ts (testable con node:test, sin red ni Firestore real).
//
// Limite de tasa PROPIO de este endpoint (no comparte el contador de /api de arriba, que es por
// IP para las rutas de usuarios autenticados): un aviso de Mercado Pago entra sin sesion y no debe
// ni consumir ni verse afectado por el cupo de otras llamadas a /api.
const VENTANA_WEBHOOK_MS = 60_000;
const MAX_WEBHOOK_POR_VENTANA = Number(process.env.RATE_LIMIT_WEBHOOK_PER_MIN || 60);
const visitasWebhook = new Map<string, { n: number; desde: number }>();
const limitarWebhookMP: express.RequestHandler = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "desconocida";
  const ahora = Date.now();
  const v = visitasWebhook.get(ip);
  if (!v || ahora - v.desde > VENTANA_WEBHOOK_MS) {
    visitasWebhook.set(ip, { n: 1, desde: ahora });
  } else if (++v.n > MAX_WEBHOOK_POR_VENTANA) {
    res.setHeader("Retry-After", Math.ceil((VENTANA_WEBHOOK_MS - (ahora - v.desde)) / 1000));
    return res.status(429).end();
  }
  if (visitasWebhook.size > 5000) {
    for (const [k, val] of visitasWebhook) if (ahora - val.desde > VENTANA_WEBHOOK_MS) visitasWebhook.delete(k);
  }
  next();
};

// ── Aviso a Leonardo ante fallos repetidos del webhook (Tarea 5, requisito "vuelta 22",
// 2026-10-05) ────────────────────────────────────────────────────────────────────────────────
// `registrarResultadoWebhook` (server/webhook.ts, PURA) decide si, con el httpStatus que este
// webhook acaba de responder para un `paymentId`, hay que avisar a Leonardo (3 fallos SEGUIDOS
// del MISMO paymentId, una sola vez por racha). El Map en memoria es el mismo patron que
// `visitas`/`visitasWebhook` de arriba: se limpia solo para no crecer sin fin.
const fallosWebhookPorPago = new Map<string, EstadoFallosWebhook>();
async function avisarSiFallaRepetido(paymentId: string, httpStatus: number): Promise<void> {
  const clave = paymentId || "sin-id";
  const { estado, debeAvisar } = registrarResultadoWebhook(fallosWebhookPorPago.get(clave), httpStatus);
  if (estado.fallos === 0) {
    fallosWebhookPorPago.delete(clave); // exito: la racha se resetea, no hace falta guardar nada.
  } else {
    fallosWebhookPorPago.set(clave, estado);
  }
  if (fallosWebhookPorPago.size > 5000) {
    for (const [k, v] of fallosWebhookPorPago) if (v.fallos === 0) fallosWebhookPorPago.delete(k);
  }
  if (debeAvisar) {
    const { asunto, texto } = construirAvisoFalloWebhookLeonardo({ paymentId, fallosConsecutivos: estado.fallos });
    await enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
  }
}

// M-4 (corrige vuelta 36 del REVISOR_EXTERNO): el acuse EN LINEA (dentro de ESTA peticion del
// webhook, con `await`, antes de responder a Mercado Pago) usa un timeout corto de 8s para el
// correo — nunca los 20s por defecto de `enviarCorreo` (server/avisos.ts), que son para el
// barrido programado (`server/tareasFondo.ts`), sin un cliente HTTP esperando la respuesta. Si el
// relay tarda mas de 8s aqui, el correo queda pendiente y el barrido (que SI espera 20s) lo
// reintenta en la siguiente corrida — nunca se pierde, solo se pospone.
const TIMEOUT_CORREO_INLINE_MS = 8_000;
const enviarCorreoInline = (datos: Parameters<typeof enviarCorreo>[0]) =>
  enviarCorreo(datos, { timeoutMs: TIMEOUT_CORREO_INLINE_MS });
const notificarActivacionEnLinea = (datos: Parameters<typeof notificarActivacionPaquete>[0]) =>
  notificarActivacionPaquete(datos, new Date(), { ...depsNotificarActivacionReales, enviarCorreo: enviarCorreoInline });
const avisarReembolsoEnLinea = (datos: Parameters<typeof avisarReembolsoPaquete>[0]) =>
  avisarReembolsoPaquete(datos, { ...depsAvisarReembolsoReales, enviarCorreo: enviarCorreoInline });
const avisarPagoDobleEnLinea = (datos: Parameters<typeof avisarPagoDobleRequiereReembolso>[0]) =>
  avisarPagoDobleRequiereReembolso(datos, { ...depsAvisarPagoDobleReales, enviarCorreo: enviarCorreoInline });

app.post("/api/mp/webhook", limitarWebhookMP, async (req, res) => {
  let paymentIdInterno = "";
  try {
    // Mercado Pago manda el tipo/id por query (`type`/`topic` + `data.id`/`id`, formato nuevo o
    // IPN viejo) o, a veces, tambien en el body. Se acepta cualquiera de las dos fuentes, pero
    // solo para encontrar el id: lo que decide todo lo demas es la respuesta de la API (abajo).
    // Extraccion en funcion PURA (server/webhook.ts) para poder probarla con node:test.
    const { tipo, paymentId } = extraerAvisoWebhookMP({ query: req.query, body: req.body });
    paymentIdInterno = paymentId;

    const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!mpAccessToken) {
      console.error("[MP WEBHOOK] MERCADO_PAGO_ACCESS_TOKEN no configurado.");
      await avisarSiFallaRepetido(paymentId, 500);
      return res.status(500).end(); // configuracion incompleta: tratar como transitorio, que MP reintente.
    }

    const resultado = await procesarWebhookMP({
      tipo,
      paymentId,
      obtenerPago: async (id) => {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        });
        return { ok: r.ok, status: r.status, json: () => r.json() };
      },
      obtenerPreferencia,
      activarPaquete: activarPaqueteSiNoProcesado,
      timestampDesdeFecha: (fecha) => Timestamp.fromDate(fecha),
      log: (linea) => console.log(linea),
      // Tarea 5: correo de confirmacion al comprador + aviso de venta a Leonardo (idempotente,
      // nunca lanza — ver server/notificaciones.ts). M-4: timeout corto (8s), ver arriba.
      notificarActivacion: notificarActivacionEnLinea,
      // Tarea 9: reembolso/contracargo -> revierte a Gratis si era el pago activo + avisa a
      // Leonardo (idempotente, nunca lanza). M-4: timeout corto (8s), ver arriba.
      procesarReembolso: avisarReembolsoEnLinea,
      // Medio 4 (pago doble con 2 preferencias, 2026-10-06): aviso a Leonardo cuando un pago no
      // se activa por ya existir un Paquete vigente de OTRO pago (idempotente, nunca lanza).
      // M-4: timeout corto (8s), ver arriba.
      avisarPagoDoble: avisarPagoDobleEnLinea,
    });

    await avisarSiFallaRepetido(paymentId, resultado.httpStatus);

    res.status(resultado.httpStatus).json({ recibido: resultado.httpStatus === 200 });
  } catch (error: any) {
    // Error inesperado: 500 para que Mercado Pago reintente en vez de perder el aviso en silencio.
    console.error("[MP WEBHOOK] error inesperado:", error?.message || error);
    await avisarSiFallaRepetido(paymentIdInterno, 500);
    res.status(500).end();
  }
});

// ── Barrido programado de acuses pendientes — UNICO mecanismo de reintento (simplificacion
// 2026-10-06, decision del Brain tras el NO-GO de la revision externa vuelta 32) ────────────────
// El webhook de arriba manda el acuse de compra EN LINEA (await) al activar un pago; si falla,
// queda pendiente. Este endpoint es el UNICO que lo reintenta — ya no hay reintento desde
// GET /api/cuenta ni un barrido disparado por el propio webhook. Disparado por un job de Cloud
// Scheduler (cada 30 min, ver docs/ops.md). Protegido con un token de identidad OIDC: el
// verificador (server/schedulerAuth.ts) exige que el token lo haya firmado Google para la cuenta
// de servicio `SCHEDULER_SA_EMAIL`, con audiencia `SCHEDULER_AUDIENCE` (la URL de este servicio en
// Cloud Run). Sin token -> 401; token de otra cuenta/audiencia -> 403; token valido -> ejecuta
// `barrerTodosLosPagosPendientes` (server/tareasFondo.ts, paginado, con tope de paginas) y
// responde 200 con las estadisticas (o 500 con log estructurado si el barrido mismo falla). La
// decision de alertar a Leonardo es por ANTIGUEDAD del pago (server/notificaciones.ts,
// `reintentarAcusePendiente`): a las 20h, `ALERTA_ACUSE_ATRASADO` (sigue reintentando); a las 48h,
// `ALERTA_ACUSE_ABANDONADO` (deja de reintentar) — los dos son logs estructurados grepables para
// la alerta de Cloud Logging, ver docs/ops.md.
// M-4 (corrige vuelta 34 del REVISOR_EXTERNO): la ruta la registra `registrarRutasTareas`
// (server/tareasFondo.ts) — unica definicion, probada ahi con un app de Express real. El chequeo
// de arranque de abajo es la unica defensa contra el caso que ninguna prueba puede cubrir: que
// esta llamada se borre sin querer en un refactor futuro (ver el comentario de
// `verificarRutaTareasRegistrada`).
registrarRutasTareas(app);
verificarRutaTareasRegistrada(app);

// GRAVE 2 (correccion vuelta 31, 2026-10-06): salud publica, sin sesion. Reporta si la huella
// HMAC de confirmacion de lote (Tarea 15, requisito A.3) esta configurada, SIN revelar el valor
// del secreto — `/api/lote/iniciar` falla cerrado (503) si falta, ver mas abajo. Hereda el
// limitador de peticiones por IP ya montado arriba (`app.use("/api", ...)`).
//
// Medio 2 (vuelta 35): agrega `proveedor` (si `PROVEEDOR_NOMBRE` es un valor real, no el marcador
// "[PENDIENTE]" — `proveedorConfigurado`, server/avisos.ts) y `relay` (si `AVISOS_RELAY_URL`/
// `AVISOS_RELAY_SECRET` estan configurados — `relayConfigurado`, server/avisos.ts), mismo patron
// que `huella`: nunca revela ningun valor, solo si la pieza esta lista.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, huella: huellaConfigurada(), proveedor: proveedorConfigurado(), relay: relayConfigurado() });
});

// Endpoint publico de precios del dia (D3, decision del Brain 2026-10-05, Tarea 4): la web lo usa
// para mostrar "≈ $X COP hoy" ANTES de pagar, sin exigir sesion. Vive bajo /api, asi que hereda el
// limitador de peticiones por IP ya montado arriba (`app.use("/api", ...)`) sin duplicar logica.
// El COP de cada plan sale de la MISMA formula que /api/mercadopago/create-preference
// (`copDesdeUsd`), para que nunca se muestre un precio distinto del que de verdad se cobra.
app.get("/api/precios", async (_req, res) => {
  try {
    const trm = await trmHoy();
    if (!trm) {
      return res.status(503).json({ error: "No podemos calcular el precio de hoy; intenta más tarde." });
    }
    const usdPaquete = PLANES_USD.paquete.usd;
    const usdPro = PLANES_USD.pro.usd;
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      trm: trm.valor,
      fechaDesde: trm.fechaDesde,
      fechaHasta: trm.fechaHasta,
      paquete: { usd: usdPaquete, cop: copDesdeUsd(usdPaquete, trm.valor) },
      pro: { usd: usdPro, cop: copDesdeUsd(usdPro, trm.valor) },
      // M30 (corrige vuelta 24): la UI no tiene otra forma de saber si `create-preference` esta
      // encendido (PAGOS_ACTIVOS es una variable de servidor, nunca expuesta al bundle del
      // cliente) — sin este campo, el panel de pago del Paquete seguiria ofreciendo "Pagar"
      // aunque el servidor vaya a responder 503 a cualquier intento.
      pagosActivos: process.env.PAGOS_ACTIVOS === "1",
    });
  } catch (error: any) {
    console.error("Error al calcular /api/precios:", error);
    res.status(503).json({ error: "No podemos calcular el precio de hoy; intenta más tarde." });
  }
});

// Endpoint para que el usuario vea su plan, saldo y vencimiento (Tarea 2, 2026-10-05).
// La cuenta la lee/crea el servidor desde Firestore; el navegador nunca accede directo
// (ver firestore.rules). Requiere sesion: sin token valido, 401.
app.get("/api/cuenta", exigirAuth, async (req, res) => {
  try {
    const cuenta = await obtenerCuenta(req.uid!);

    // Simplificacion 2026-10-06: GET /api/cuenta ya NO reintenta el acuse de compra. El UNICO
    // mecanismo de reintento es POST /api/tareas/barrido-acuses (Cloud Scheduler cada 30 min, ver
    // server/tareasFondo.ts) — ver docs/plan/2026-10-05-cobro-real-con-planes.md, decision del
    // Brain tras el NO-GO de la vuelta 32.
    res.json({
      plan: cuenta.plan,
      enviosRestantes: cuenta.enviosRestantes,
      vence: cuenta.vence ? cuenta.vence.toDate().toISOString() : null,
      renueva: cuenta.renueva,
      // G6 (NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10, 2026-10-05): el sondeo del regreso
      // de Mercado Pago necesita saber si YA llego un pago NUEVO (no solo que la cuenta tenga
      // algun plan vigente de una compra anterior). Solo id+fecha: nunca el monto ni datos del
      // pagador.
      ultimoPago: cuenta.ultimoPago
        ? { id: cuenta.ultimoPago.id, fecha: cuenta.ultimoPago.fecha.toDate().toISOString() }
        : null,
    });
  } catch (error: any) {
    console.error("Error al obtener la cuenta:", error);
    res.status(500).json({ error: "No se pudo obtener tu cuenta en este momento." });
  }
});

// Autorizacion de tratamiento de datos personales, Ley 1581 (Tarea 15, requisito B.3,
// 2026-10-06; GRAVE 1/3 y MENORES, correccion vuelta 31): casilla explicita ANTES del primer uso
// (texto canonico T11 de docs/legal/textos-checkout.md v1.3), guardada en su PROPIA coleccion
// (`autorizaciones/{uid}`, ver server/cuentas.ts) para que nunca la borre un `tx.set` de
// `cuentas/{uid}` (GRAVE 1). GET dice si el usuario YA autorizo la version VIGENTE (para que la
// landing decida si mostrar el aviso: si la Politica cambia de version, se vuelve a pedir aunque
// exista una autorizacion vieja); POST la guarda con el idioma y el texto EXACTO que el usuario
// vio (reconstruido aqui, nunca confiado del navegador). Las dos requieren sesion real.
//
// MENORES (2026-10-06): si este GET falla (red, Firestore caido), el cliente debe tratarlo como
// "no autorizado" y mostrar el modal — nunca asumir que un usuario SIN respuesta ya autorizo.
app.get("/api/autorizacion-datos", exigirAuth, async (req, res) => {
  try {
    const autorizacion = await obtenerAutorizacionDatos(req.uid!);
    const autorizado = autorizacion !== null && autorizacion.version === AUTORIZACION_DATOS_VERSION;
    res.json({ autorizado, version: autorizacion?.version ?? null });
  } catch (error: any) {
    console.error("Error al consultar la autorizacion de datos:", error);
    res.status(500).json({ error: "No se pudo consultar tu autorizacion en este momento." });
  }
});

app.post("/api/autorizacion-datos", exigirAuth, async (req, res) => {
  try {
    // Medio 2 (correccion vuelta 33, 2026-10-06): `decidirRegistroAutorizacion` (server/cuentas.ts,
    // PURA) exige un PROVEEDOR_NOMBRE real (503 si falta o sigue en "[PENDIENTE]") y que el nombre
    // que el CLIENTE mostro en el texto T11 coincida EXACTO con el del servidor (409 si no) — antes
    // se guardaba la autorizacion sin comprobar ninguna de las dos cosas.
    const decision = decidirRegistroAutorizacion(req.body?.nombreProveedorMostrado, PROVEEDOR_NOMBRE);
    if (decision.ok === false) {
      return res.status(decision.httpStatus).json({ error: decision.error });
    }
    const idioma = normalizarIdioma(req.body?.idioma);
    const texto = textoAutorizacionDatos(idioma, PROVEEDOR_NOMBRE);
    await guardarAutorizacionDatos(req.uid!, AUTORIZACION_DATOS_VERSION, idioma, texto);
    res.json({ ok: true });
  } catch (error: any) {
    console.error("Error al guardar la autorizacion de datos:", error);
    res.status(500).json({ error: "No se pudo guardar tu autorización. Intenta de nuevo." });
  }
});

// Aceptacion de Terminos y Condiciones ANTES del primer uso (O2, Dictamen Abogado_LAP ronda 5,
// 2026-10-06, Alto): mismo patron EXACTO que GET/POST /api/autorizacion-datos arriba, en su propia
// coleccion (`aceptacionesUso/{uid}`, ver server/cuentas.ts) — un usuario Gratis nunca pasaba por
// el checkout del Paquete (unico lugar donde se aceptaban los Terminos), asi que nunca aceptaba la
// secc. 12 (responsable de los datos de sus destinatarios) ni la secc. 13.3 (revision obligatoria).
// A diferencia de la autorizacion de datos, este texto no interpola el nombre del proveedor: no
// hace falta una comprobacion de coincidencia como `decidirRegistroAutorizacion`.
app.get("/api/aceptacion-uso", exigirAuth, async (req, res) => {
  try {
    const aceptacion = await obtenerAceptacionUso(req.uid!);
    const aceptado = aceptacion !== null && aceptacion.version === TERMINOS_VERSION;
    res.json({ aceptado, version: aceptacion?.version ?? null });
  } catch (error: any) {
    console.error("Error al consultar la aceptacion de terminos:", error);
    res.status(500).json({ error: "No se pudo consultar tu aceptación en este momento." });
  }
});

app.post("/api/aceptacion-uso", exigirAuth, async (req, res) => {
  try {
    const idioma = normalizarIdioma(req.body?.idioma);
    const texto = textoAceptacionTerminosUso(idioma);
    await guardarAceptacionUso(req.uid!, TERMINOS_VERSION, idioma, texto);
    res.json({ ok: true });
  } catch (error: any) {
    console.error("Error al guardar la aceptacion de terminos:", error);
    res.status(500).json({ error: "No se pudo guardar tu aceptación. Intenta de nuevo." });
  }
});

// Endpoint para pedir permiso de envio ANTES de empezar un lote (Tarea 3, 2026-10-05). El
// navegador manda cuantos certificados quiere enviar; el servidor decide segun el plan real de
// la cuenta (nunca segun lo que diga el navegador) y, si lo aprueba, crea un lote autorizado que
// `/api/send-email` exigira en cada envio. Requiere sesion: sin token valido, 401.
app.post("/api/lote/iniciar", exigirAuth, async (req, res) => {
  try {
    const cantidad = Number(req.body?.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: "Falta una cantidad valida de certificados a enviar." });
    }

    // GRAVE 2 (correccion vuelta 31, 2026-10-06): sin HUELLA_LOTE_SECRET, NINGUN lote se
    // autoriza (falla cerrado) — antes, sin el secreto el lote se creaba igual pero sin huella,
    // asi que /api/send-email nunca tenia nada contra que comprobar lo que de verdad se envia
    // (Medio 3, mas abajo). Esto va ANTES de tocar Firestore: no se crea nada a medias.
    //
    // Medio 3 (correccion vuelta 31): `pares` ya NO es opcional — debe cubrir EXACTAMENTE la
    // `cantidad` del lote, sin pares vacios ni duplicados. `validarSecretoYPares`
    // (server/huellaLote.ts, PURA) decide las dos cosas de una vez.
    const secreto = process.env.HUELLA_LOTE_SECRET;
    const paresCrudos = Array.isArray(req.body?.pares) ? req.body.pares : [];
    const pares: ParConfirmacion[] = paresCrudos
      .filter((p: any) => p && Number.isFinite(p.pagina) && Number.isFinite(p.fila) && typeof p.correo === "string")
      .map((p: any) => ({ pagina: p.pagina, fila: p.fila, correo: p.correo }));
    if (pares.length !== paresCrudos.length) {
      return res.status(400).json({ error: "La lista de certificados a confirmar tiene datos incompletos." });
    }
    const validacion = validarSecretoYPares(secreto, cantidad, pares);
    // Nota: `=== false` (no `!validacion.ok`), mismo motivo que `reserva.ok` mas abajo — TS 5.8
    // no angosta un discriminante booleano con negacion/truthiness, solo con `===`.
    if (validacion.ok === false) {
      if (validacion.httpStatus === 503) {
        console.error("[LOTE] HUELLA_LOTE_SECRET no configurado; no se autoriza ningun lote (falla cerrado).");
      }
      return res.status(validacion.httpStatus).json({ error: validacion.error });
    }

    // B.3 (requisito Ley 1581): sin autorizacion de datos guardada PARA LA VERSION VIGENTE, no se
    // inicia ningun lote. GRAVE 3(d): el `motivo: "autorizacion"` es lo que el cliente usa para
    // reabrir el modal de autorizacion (en vez de solo mostrar el texto de error). Decision
    // extraida a `decidirAutorizacionLoteRuta` (server/decisionesRuta.ts, correccion vuelta 35/36
    // sobre tests/decisionesRuta.test.ts — antes solo grepeaba texto fuente).
    const decisionAutorizacion = await decidirAutorizacionLoteRuta(req.uid!, AUTORIZACION_DATOS_VERSION, { obtenerAutorizacionDatos });
    if (decisionAutorizacion.ok === false) {
      return res.status(decisionAutorizacion.httpStatus).json({
        error: decisionAutorizacion.error,
        motivo: decisionAutorizacion.motivo,
      });
    }

    // O2 (Dictamen Abogado_LAP ronda 5, 2026-10-06, Alto): sin aceptacion VIGENTE de los Terminos
    // y Condiciones, tampoco se inicia ningun lote — motivo "terminos" (distinto de "autorizacion")
    // para que el cliente reabra el modal correcto.
    const decisionTerminos = await decidirAceptacionUsoRuta(req.uid!, TERMINOS_VERSION, { obtenerAceptacionUso });
    if (decisionTerminos.ok === false) {
      return res.status(decisionTerminos.httpStatus).json({
        error: decisionTerminos.error,
        motivo: decisionTerminos.motivo,
      });
    }

    const cuenta = await obtenerCuenta(req.uid!);
    const decision = decidirLote(cuenta, cantidad, new Date());
    const venceISO = decision.vence ? decision.vence.toDate().toISOString() : null;

    if (!decision.permitido) {
      return res.json({
        permitido: false,
        motivo: decision.motivo,
        plan: decision.plan,
        enviosRestantes: decision.enviosRestantes,
        vence: venceISO,
      });
    }

    // Se guarda el plan EFECTIVO de este lote (R3-1: un lote <=15 es Gratis aunque la cuenta
    // tenga Paquete vigente), no el plan real de la cuenta — eso es lo que decide si se
    // descuenta saldo (ver decidirLote/reservarEnvioTx/confirmarEnvioExitosoTx).
    const { loteId } = await crearLote(req.uid!, cantidad, decision.planEfectivo);

    // A.3 (requisito §13.3(c)/§12.4 del legal) + Medio 3: huella HMAC-SHA256 por cada par
    // pagina-fila-correo, SIN guardar la lista ni los correos en claro. Siempre se guarda (ya no
    // es condicional: `secreto`/`pares` se validaron arriba, antes de crear el lote).
    const huellas = huellasLote(pares, secreto!); // validarSecretoYPares ya confirmo que existe.
    await guardarConfirmacionLote(loteId, pares.length, huellas, Timestamp.now());

    res.json({
      permitido: true,
      loteId,
      plan: decision.plan,
      enviosRestantes: decision.enviosRestantes,
      vence: venceISO,
    });
  } catch (error: any) {
    console.error("Error al iniciar lote de envio:", error);
    res.status(500).json({ error: "No se pudo validar tu lote de envio en este momento." });
  }
});

// Vite or Static Asset serving
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // GRAVE 2 (correccion vuelta 33, 2026-10-06): en Cloud Run (imagen construida con
    // "npm run build:server", ver Dockerfile) dist/ solo contiene server.cjs — el frontend lo
    // sirve Firebase Hosting por su cuenta (firebase.json: "**" -> /index.html, "/api/**" -> este
    // servicio). Si dist/index.html no existe, nunca se intenta `express.static`/`sendFile`
    // (que lanzarian ENOENT en cada peticion): se responde 404 explicito. Esto solo afecta
    // peticiones que llegaran DIRECTO a la URL de Cloud Run fuera de /api/** (nunca pasa a traves
    // de Hosting, que ya resuelve "**" por su cuenta); en un `npm start` local con
    // NODE_ENV=production y un `npm run build` completo (frontend incluido), dist/index.html SI
    // existe y el comportamiento es igual que antes.
    const distPath = path.join(process.cwd(), "dist");
    const frontendDisponible = fs.existsSync(path.join(distPath, "index.html"));
    if (frontendDisponible) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      app.get("*", (req, res) => {
        res.status(404).json({ error: "No encontrado. El frontend se sirve desde Firebase Hosting." });
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
};

startServer();
