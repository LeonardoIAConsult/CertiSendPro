import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { PDFDocument } from "pdf-lib";

const app = express();
const PORT = 3000;

// Setup JSON and body parsing with standard limits for PDF processing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
app.post("/api/split-pdf", async (req, res) => {
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
app.post("/api/get-page-pdf", async (req, res) => {
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
app.post("/api/canva/export-design", async (req, res) => {
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
app.post("/api/analyze-page", async (req, res) => {
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
app.post("/api/send-email", async (req, res) => {
  try {
    const { accessToken, to, subject, body, pdfBase64, sessionId, pageIndex, filename } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "No access token provided" });
    }

    let activePdfBase64 = pdfBase64;
    if (!activePdfBase64 && sessionId && pageIndex !== undefined) {
      try {
        activePdfBase64 = await getPageBase64(sessionId, Number(pageIndex));
      } catch (err: any) {
        return res.status(404).json({ error: `Fallo al extraer el certificado PDF: ${err.message}` });
      }
    }

    if (!to || !subject || !body || !activePdfBase64 || !filename) {
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

    const data = await gmailResponse.json();
    res.json({ success: true, messageId: data.id });
  } catch (error: any) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
});

// Endpoint to generate Mercado Pago checkout preference link
app.post("/api/mercadopago/create-preference", async (req, res) => {
  try {
    const { planName, amount, currency } = req.body;
    const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!mpAccessToken) {
      console.warn("[MERCADO PAGO] MERCADO_PAGO_ACCESS_TOKEN is not configured. Returning simulation marker.");
      return res.json({ 
        success: true, 
        simulated: true, 
        initPoint: null,
        message: "No MP Access Token configured."
      });
    }

    const response = await fetch("https://api.mercadopago.com/v1/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [
          {
            title: planName || "Suscripción CertiSend Pro",
            quantity: 1,
            unit_price: Number(amount) || 29.00,
            currency_id: currency || "USD"
          }
        ],
        back_urls: {
          success: process.env.APP_URL || "http://localhost:3000",
          failure: process.env.APP_URL || "http://localhost:3000",
          pending: process.env.APP_URL || "http://localhost:3000"
        },
        auto_return: "approved"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Error de la API de Mercado Pago: ${errText}`);
    }

    const data = await response.json();
    res.json({
      success: true,
      initPoint: data.init_point
    });
  } catch (error: any) {
    console.error("Error al crear preferencia de Mercado Pago:", error);
    res.status(500).json({ error: error.message || "Fallo al iniciar checkout de Mercado Pago" });
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
