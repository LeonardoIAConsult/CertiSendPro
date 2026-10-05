import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { PDFDocument } from "pdf-lib";
import { getAuth } from "firebase-admin/auth";
import { obtenerFirebaseApp } from "./server/firebaseAdmin";
import {
  obtenerCuenta,
  decidirLote,
  crearLote,
  reservarEnvio,
  confirmarEnvioExitoso,
  liberarReserva,
} from "./server/cuentas";
import { trmHoy, copDesdeUsd } from "./server/trm";

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

// Limite de peticiones por IP y minuto, en memoria. No pretende ser un WAF: es el
// tope que evita que alguien queme la cuota de Gemini o de Mercado Pago en bucle.
// Se limpia solo para no crecer sin fin.
const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = Number(process.env.RATE_LIMIT_PER_MIN || 30);
const visitas = new Map<string, { n: number; desde: number }>();
app.use("/api", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "desconocida";
  const ahora = Date.now();
  const v = visitas.get(ip);
  if (!v || ahora - v.desde > VENTANA_MS) {
    visitas.set(ip, { n: 1, desde: ahora });
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
}
const pdfCache = new Map<string, PdfCacheEntry>();

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

async function getPageBase64(sessionId: string, pageIndex: number): Promise<string> {
  const cached = pdfCache.get(sessionId);
  if (!cached) {
    throw new Error("La sesión del PDF ha expirado o no existe en el servidor. Por favor, selecciona y carga de nuevo tu archivo PDF.");
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

    // Create unique session ID
    const sessionId = "pdf_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);

    // Cache the root PDF buffer
    pdfCache.set(sessionId, {
      buffer: pdfBuffer,
      pageCount,
      timestamp: Date.now(),
      extractedPages: new Map()
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

    const base64 = await getPageBase64(sessionId, Number(pageIndex));
    res.json({ base64 });
  } catch (error: any) {
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
app.post("/api/analyze-page", adjuntarAuthSiExiste, async (req, res) => {
  try {
    const { pdfPageBase64, sessionId, pageIndex, recipientNames } = req.body;
    let activePageBase64 = pdfPageBase64;

    // Direct support for high-performance server-side extraction
    if (!activePageBase64 && sessionId && pageIndex !== undefined) {
      try {
        activePageBase64 = await getPageBase64(sessionId, Number(pageIndex));
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
    const { accessToken, to, subject, body, pdfBase64, sessionId, pageIndex, filename, loteId } = req.body;

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
        activePdfBase64 = await getPageBase64(sessionId, Number(pageIndex));
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

    // Sanitize email address: strip zero-width characters, invisible whitespace, carriage returns, etc.
    const cleanTo = String(to || "")
      .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E]/g, "") // Strip invisible Unicode characters
      .replace(/\s+/g, "") // Remove all whitespace characters (spaces, tabs, newlines)
      .trim();

    // Check if the email address is structurally valid to avoid raw Gmail "Invalid To header" errors.
    // If the user mapped columns incorrectly, this will fail-fast with an informative error.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanTo)) {
      await liberarReserva(loteReservado, req.uid!);
      loteReservado = null;
      return res.status(400).json({
        error: `La dirección de correo "${cleanTo}" no tiene un formato válido (p. ej., usuario@dominio.com). Por favor, en el PASO 1 (Configuración de Columnas), asegúrate de haber mapeado la 'COLUMNA DE CORREO' con la columna de tu Google Sheet que contiene los correos electrónicos reales.`
      });
    }

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
    console.error("Error sending email:", error);
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
const PLANES_USD: Record<string, number> = {
  "CertiSend Pro Monthly": 29,
  "CertiSend Pay-as-you-go Bundle": 15,
};
// TRM del dia: validacion, timeout y cacheo robustos viven en server/trm.ts (Tarea 4, 2026-10-05)
// — igual que cuentas.ts, separado de este archivo para poder probarse con node:test sin red.

app.post("/api/mercadopago/create-preference", exigirAuth, async (req, res) => {
  // APAGADO hasta que Leonardo defina la entrega (05-oct): la landing manda a contacto. Encender
  // con PAGOS_ACTIVOS=1 en Cloud Run cuando exista que activar tras el pago (ver memoria).
  if (process.env.PAGOS_ACTIVOS !== "1") {
    return res.status(503).json({ error: "Pagos no disponibles por ahora. Escribenos a contacto@leonardoantolinez.com." });
  }
  try {
    const { planName } = req.body;   // `amount` y `currency` del cliente se ignoran a proposito
    if (!Object.prototype.hasOwnProperty.call(PLANES_USD, String(planName))) {
      return res.status(400).json({ error: "Plan no valido" });
    }
    const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!mpAccessToken) {
      // Antes devolvia success:true "simulado" y la landing mostraba "pago exitoso" sin cobrar.
      console.warn("[MERCADO PAGO] MERCADO_PAGO_ACCESS_TOKEN no configurado.");
      return res.status(503).json({ error: "Pagos no disponibles en este momento." });
    }
    const trm = await trmHoy();
    if (!trm) return res.status(503).json({ error: "No podemos calcular el precio de hoy; intenta más tarde." });

    const usd = PLANES_USD[planName];
    const cop = copDesdeUsd(usd, trm.valor); // misma formula que /api/precios (D3): no se duplica.
    const base = process.env.APP_URL || "http://localhost:3000";
    const ahora = Date.now();
    // La ruta correcta es /checkout/preferences; /v1/preferences no existe ("resource not found"),
    // asi que el cobro de CertiSend nunca funciono hasta este cambio.
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [{ title: planName, quantity: 1, unit_price: cop, currency_id: "COP" }],
        external_reference: `CERTISEND|${planName}|${cop}`,
        back_urls: {
          success: `${base}/?pago=ok`,
          failure: `${base}/?pago=error`,
          pending: `${base}/?pago=pendiente`
        },
        auto_return: "approved",
        // Vence en 2 h: un cobro guardado no se paga despues a una TRM vieja.
        expires: true,
        expiration_date_from: new Date(ahora).toISOString(),
        expiration_date_to: new Date(ahora + 2 * 3600_000).toISOString(),
        statement_descriptor: "CERTISEND PRO"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Error de la API de Mercado Pago: ${errText}`);
    }

    const data = await response.json();
    res.json({
      success: true,
      initPoint: data.init_point,
      cop, usd, trm: trm.valor, fechaTrm: trm.fechaDesde
    });
  } catch (error: any) {
    // El detalle (respuesta de MP) va al log del servidor, no al navegador.
    console.error("Error al crear preferencia de Mercado Pago:", error);
    res.status(500).json({ error: "No se pudo iniciar el pago con Mercado Pago." });
  }
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
    const usdPaquete = PLANES_USD["CertiSend Pay-as-you-go Bundle"];
    const usdPro = PLANES_USD["CertiSend Pro Monthly"];
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      trm: trm.valor,
      fechaDesde: trm.fechaDesde,
      fechaHasta: trm.fechaHasta,
      paquete: { usd: usdPaquete, cop: copDesdeUsd(usdPaquete, trm.valor) },
      pro: { usd: usdPro, cop: copDesdeUsd(usdPro, trm.valor) },
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
    res.json({
      plan: cuenta.plan,
      enviosRestantes: cuenta.enviosRestantes,
      vence: cuenta.vence ? cuenta.vence.toDate().toISOString() : null,
      renueva: cuenta.renueva,
    });
  } catch (error: any) {
    console.error("Error al obtener la cuenta:", error);
    res.status(500).json({ error: "No se pudo obtener tu cuenta en este momento." });
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
};

startServer();
