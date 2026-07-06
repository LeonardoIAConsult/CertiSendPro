import { LogoMark } from "./components/BrandLogo";
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  FileText,
  Mail,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Sparkles,
  Download,
  Send,
  RefreshCw,
  LogOut,
  HelpCircle,
  Check,
  FileDown,
  User,
  LayoutGrid,
  Settings,
  ChevronRight,
  Shield,
  KeyRound,
  Info,
  Calendar,
  Layers,
  Database,
  Terminal,
  TableProperties,
  Globe,
  Sun,
  Moon
} from "lucide-react";
import { initAuth, googleSignIn, logout, getAccessToken } from "./firebaseAuth";
import { Recipient, CertificatePage } from "./types";
import {
  extractSpreadsheetId,
  fetchSpreadsheetTabs,
  fetchSpreadsheetRecipients
} from "./utils/googleSheets";
import { findBestRecipient } from "./utils/matching";
import JSZip from "jszip";
import LandingPage from "./components/LandingPage";
import PrivacyPolicy from "./components/PrivacyPolicy";
import { translations } from "./utils/translations";

// Helper to extract clean Canva Design ID from link
function extractCanvaDesignId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/design\/([a-zA-Z0-9_-]{11,25})/);
  if (match && match[1]) {
    return match[1];
  }
  // Try clean ID match
  if (/^[a-zA-Z0-9_-]{11,25}$/.test(url.trim())) {
    return url.trim();
  }
  return null;
}

export default function App() {
  // Auth state
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Privacy Policy state
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(window.location.pathname === "/privacy");

  useEffect(() => {
    const handlePopState = () => {
      setShowPrivacyPolicy(window.location.pathname === "/privacy");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleNavigateToPrivacy = () => {
    window.history.pushState({}, "", "/privacy");
    setShowPrivacyPolicy(true);
  };

  const handleNavigateToHome = () => {
    window.history.pushState({}, "", "/");
    setShowPrivacyPolicy(false);
  };

  // Localization & Theme states
  const [language, setLanguage] = useState<"es" | "en">("es");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Connection badges
  const [isSheetsLinked, setIsSheetsLinked] = useState(false);
  const [isCanvaConnected, setIsCanvaConnected] = useState(false);
  const [isGmailActive, setIsGmailActive] = useState(false);

  // Spreadsheet state
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [selectedNameCol, setSelectedNameCol] = useState<number>(0);
  const [selectedEmailCol, setSelectedEmailCol] = useState<number>(1);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [isLoadingSheet, setIsLoadingSheet] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // PDF & Upload Choice state
  const [activeUploadTab, setActiveUploadTab] = useState<"upload" | "canva">("upload");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pages, setPages] = useState<CertificatePage[]>([]);
  const recipientsRef = useRef<Recipient[]>([]);
  const pagesRef = useRef<CertificatePage[]>([]);

  // Sync refs to avoid stale closure references inside async handlers
  useEffect(() => {
    recipientsRef.current = recipients;
  }, [recipients]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  const [isSplitting, setIsSplitting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Canva API state
  const [canvaUrlOrId, setCanvaUrlOrId] = useState("");
  const [canvaToken, setCanvaToken] = useState("");
  const [isConnectingCanva, setIsConnectingCanva] = useState(false);

  // AI & Matching processing state
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [aiStepProgress, setAiStepProgress] = useState(0);

  // Live monitor logging system
  const [logs, setLogs] = useState<{ id: string; time: string; text: string; type: "info" | "success" | "warning" | "error" }[]>([
    { id: "init", time: new Date().toLocaleTimeString(), text: "Sistema preparado. Esperando configuración de origen...", type: "info" }
  ]);

  // Recipient queue filtering
  const [queueFilter, setQueueFilter] = useState("");

  // Email template state
  const [emailSubject, setEmailSubject] = useState("Tu Certificado de Participación");
  const [emailBody, setEmailBody] = useState(
    "Hola {Nombre},\n\n¡Felicitaciones! Adjuntamos en este correo tu certificado oficial de participación.\n\nSaludos cordiales,\nEl equipo organizador."
  );

  // Delivery state
  const [isDelivering, setIsDelivering] = useState(false);

  // General Notification Banner state
  const [banner, setBanner] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Logging utility helper
  const addLog = (text: string, type: "info" | "success" | "warning" | "error" = "info") => {
    const newLog = {
      id: Math.random().toString(),
      time: new Date().toLocaleTimeString(),
      text,
      type
    };
    setLogs((prev) => [...prev.slice(-38), newLog]);
  };

  // Initialize auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, activeToken) => {
        setUser(currentUser);
        setToken(activeToken);
        setNeedsAuth(false);
        setIsGmailActive(true);
        addLog(`Usuario de Google autenticado: ${currentUser.displayName}`, "success");
      },
      () => {
        setNeedsAuth(true);
        setIsGmailActive(false);
        setIsSheetsLinked(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Update sheet linkage status badge
  useEffect(() => {
    if (recipients.length > 0) {
      setIsSheetsLinked(true);
    } else {
      setIsSheetsLinked(false);
    }
  }, [recipients]);

  // Update Canva status badge
  useEffect(() => {
    if (pages.length > 0) {
      setIsCanvaConnected(true);
    } else {
      setIsCanvaConnected(false);
    }
  }, [pages]);

  // Set timeout helper for notification banner
  const triggerBanner = (type: "success" | "error" | "info", msg: string) => {
    setBanner({ type, msg });
    setTimeout(() => setBanner(null), 6000);
  };

  // Google Sign-in Handler
  const handleLogin = async () => {
    setIsLoggingIn(true);
    addLog("Iniciando flujo seguro de autenticación OAuth en Google Workspace...", "info");
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
        setIsGmailActive(true);
        addLog(`Acceso permitido por descriptor: ${result.user.email}`, "success");
        triggerBanner("success", `¡Sesión iniciada con éxito como ${result.user.displayName}!`);
      }
    } catch (err: any) {
      const isPopupClosed = 
        err.code === "auth/popup-closed-by-user" || 
        (err.message && err.message.includes("popup-closed-by-user"));

      if (!isPopupClosed) {
        console.error(err);
      }

      if (isPopupClosed) {
        addLog("Inicio de sesión cancelado: Se cerró la ventana emergente de Google. Si deseas iniciar sesión (por ejemplo, con ejecutivosyemprendedores@casaroca.org), recuerda no cerrar la ventana emergente y permitir popups en tu navegador.", "warning");
        triggerBanner("info", "Has cerrado la ventana de inicio de sesión de Google.");
      } else if (err.code === "auth/unauthorized-domain") {
        addLog("Dominio no autorizado: agrega certisendpro.online en Firebase Console -> Authentication -> Settings -> Authorized domains.", "error");
        triggerBanner("error", "Dominio no autorizado en Firebase (auth/unauthorized-domain).");
      } else if (err.code === "auth/popup-blocked") {
        addLog("El navegador bloqueó la ventana emergente. Permite popups para certisendpro.online e inténtalo de nuevo.", "error");
        triggerBanner("error", "Popup bloqueado por el navegador. Permite ventanas emergentes.");
      } else {
        addLog(`La autenticación de Google falló [${err.code || "sin código"}]: ${err.message || err}`, "error");
        triggerBanner("error", `No se pudo completar la autenticación (${err.code || "error desconocido"}).`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setToken(null);
      setNeedsAuth(true);
      setIsGmailActive(false);
      setIsSheetsLinked(false);
      setIsCanvaConnected(false);
      // Clean everything
      setRecipients([]);
      setPages([]);
      setTabs([]);
      setSpreadsheetUrl("");
      setPdfFile(null);
      setSessionId(null);
      sessionIdRef.current = null;
      addLog("Sesión cerrada. Datos locales restablecidos.", "warning");
      triggerBanner("info", "Has cerrado sesión correctamente.");
    } catch (err) {
      console.error(err);
    }
  };

  // Guest/Demo Mode Login Handler
  const handleGuestLogin = () => {
    setIsLoggingIn(true);
    addLog("Iniciando sesión en Modo Invitado de CertiSend Pro...", "info");
    setTimeout(() => {
      const guestUser = {
        displayName: "Invitado de Honor",
        email: "demo@certisend.pro",
        photoURL: "https://api.dicebear.com/7.x/bottts/svg?seed=CertiSendGuest",
        isGuest: true
      };
      setUser(guestUser);
      setToken("dummy-guest-demo-token");
      setNeedsAuth(false);
      setIsGmailActive(true);
      
      // Seed high fidelity mock spreadsheet
      setSpreadsheetUrl("https://docs.google.com/spreadsheets/d/1_demo_spreadsheet_id/edit");
      setSpreadsheetId("1_demo_spreadsheet_id");
      setTabs(["Lista de Participantes (Demo)", "Oradores Especiales"]);
      setSelectedTab("Lista de Participantes (Demo)");
      setHeaders(["Nombre Completo", "Correo Electrónico", "Código de Registro", "Rol"]);
      setSelectedNameCol(0);
      setSelectedEmailCol(1);
      
      const demoRecipients: Recipient[] = [
        { name: "Juan Pérez", email: "juan.perez@example.com", originalRowIndex: 2 },
        { name: "María Camila Restrepo", email: "camila.restrepo@example.com", originalRowIndex: 3 },
        { name: "Carlos Eduardo Gómez", email: "carlos.gomez@example.com", originalRowIndex: 4 },
        { name: "Sofia Valentina Rojas", email: "sofia.rojas@example.com", originalRowIndex: 5 },
        { name: "Alejandro Londoño", email: "alejandro.l@example.com", originalRowIndex: 6 }
      ];
      setRecipients(demoRecipients);
      setIsSheetsLinked(true);

      // Seed high-fidelity mock certificate segmentation pages
      const demoPages: CertificatePage[] = [
        {
          pageIndex: 1,
          base64: "JVBERi0xLjQKJeejx9I...", // mock representation
          extractedName: "Juan Pérez",
          matchedRecipient: demoRecipients[0],
          status: "success",
          errorMessage: null
        },
        {
          pageIndex: 2,
          base64: "JVBERi0xLjQKJeejx9I...",
          extractedName: "María Camila Restrepo",
          matchedRecipient: demoRecipients[1],
          status: "success",
          errorMessage: null
        },
        {
          pageIndex: 3,
          base64: "JVBERi0xLjQKJeejx9I...",
          extractedName: "Carlos E. Gómez",
          matchedRecipient: demoRecipients[2],
          status: "success",
          errorMessage: null
        },
        {
          pageIndex: 4,
          base64: "JVBERi0xLjQKJeejx9I...",
          extractedName: "UNKNOWN",
          matchedRecipient: null,
          status: "error",
          errorMessage: "No se pudo identificar un nombre claro con Inteligencia Artificial."
        }
      ];
      setPages(demoPages);
      setIsCanvaConnected(true);

      addLog("¡Sesión iniciada con éxito en Modo Invitado! Datos de demostración listos para explorar.", "success");
      addLog("Prueba a ajustar las columnas, descargar el ZIP, re-escanear con IA o enviar correos de simulación.", "info");
      triggerBanner("success", "¡Bienvenido al panel demo de CertiSend Pro!");
      setIsLoggingIn(false);
    }, 1200);
  };

  // Load Spreadsheet Details (Metadata and Tab Names)
  const handleLoadSpreadsheet = async () => {
    if (!spreadsheetUrl) {
      setSheetError("Por favor ingresa un enlace de Google Sheets válido.");
      return;
    }

    const sId = extractSpreadsheetId(spreadsheetUrl);
    if (!sId) {
      setSheetError("Enlace inválido. Asegúrate de copiar la URL completa del navegador.");
      return;
    }

    setIsLoadingSheet(true);
    setSheetError(null);
    setSpreadsheetId(sId);
    setRecipients([]);
    setTabs([]);
    addLog(`Cargando información del documento de Sheets ID [${sId.substring(0, 10)}...]`, "info");

    if (user?.isGuest) {
      setTimeout(() => {
        setTabs(["Lista de Participantes (Demo)", "Oradores Especiales"]);
        setSelectedTab("Lista de Participantes (Demo)");
        addLog("[Modo Invitado] Se cargaron las pestañas simuladas con éxito.", "success");
        setIsLoadingSheet(false);
      }, 700);
      return;
    }

    try {
      if (!token) throw new Error("Acceso no autorizado. Inicia sesión de nuevo.");
      const loadedTabs = await fetchSpreadsheetTabs(sId, token);
      setTabs(loadedTabs);
      if (loadedTabs.length > 0) {
        setSelectedTab(loadedTabs[0]);
      }
      addLog(`Hojas detectadas con éxito (${loadedTabs.length} tabs found)`, "success");
    } catch (err: any) {
      console.error(err);
      addLog(`Error al conectar con la hoja: ${err.message}`, "error");
      setSheetError(err.message || "Error al conectar con la hoja de cálculo. Verifica permisos de acceso.");
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Pull recipients and rows once a specific tab or columns are selected
  const handleFetchRows = async (tabName = selectedTab) => {
    if (!spreadsheetId || !tabName) return;

    setIsLoadingSheet(true);
    setSheetError(null);
    addLog(`Recuperando filas de la pestaña: "${tabName}"...`, "info");

    if (user?.isGuest) {
      setTimeout(() => {
        const demoRecipients: Recipient[] = [
          { name: "Juan Pérez", email: "juan.perez@example.com", originalRowIndex: 2 },
          { name: "María Camila Restrepo", email: "camila.restrepo@example.com", originalRowIndex: 3 },
          { name: "Carlos Eduardo Gómez", email: "carlos.gomez@example.com", originalRowIndex: 4 },
          { name: "Sofia Valentina Rojas", email: "sofia.rojas@example.com", originalRowIndex: 5 },
          { name: "Alejandro Londoño", email: "alejandro.l@example.com", originalRowIndex: 6 }
        ];
        setHeaders(["Nombre Completo", "Correo Electrónico", "Código de Registro", "Rol"]);
        setRecipients(demoRecipients);
        addLog(`[Modo Invitado] Se cargaron correctamente ${demoRecipients.length} destinatarios de la pestaña "${tabName}"!`, "success");
        triggerBanner("success", `¡Se cargaron ${demoRecipients.length} filas simuladas!`);
        setIsLoadingSheet(false);
      }, 800);
      return;
    }

    try {
      if (!token) throw new Error("Sesión OAuth expirada.");
      const { recipients: loadedRecipients, headers: loadedHeaders } =
        await fetchSpreadsheetRecipients(
          spreadsheetId,
          tabName,
          selectedNameCol,
          selectedEmailCol,
          token
        );

      setHeaders(loadedHeaders);
      setRecipients(loadedRecipients);

      // Automatically match with existing pages if any are loaded/analyzed
      setPages((prevPages) => {
        if (prevPages.length === 0) return prevPages;
        return prevPages.map((p) => {
          if (p.extractedName && p.extractedName !== "UNKNOWN") {
            const { best } = findBestRecipient(p.extractedName, loadedRecipients);
            return {
              ...p,
              matchedRecipient: best,
              status: "success" as const,
              errorMessage: null,
            };
          }
          return p;
        });
      });

      // Attempt smart guesses for name and email column if they are initially zero/one
      if (loadedHeaders.length > 0) {
        const nameIdx = loadedHeaders.findIndex(h =>
          /nombre|name|recipient|persona|alumno/i.test(h)
        );
        const emailIdx = loadedHeaders.findIndex(h =>
          /correo|email|mail|contacto/i.test(h)
        );

        if (nameIdx !== -1 && nameIdx !== selectedNameCol) {
          setSelectedNameCol(nameIdx);
        }
        if (emailIdx !== -1 && emailIdx !== selectedEmailCol) {
          setSelectedEmailCol(emailIdx);
        }
      }

      addLog(`¡Se cargaron correctamente ${loadedRecipients.length} destinatarios del Sheet!`, "success");
      triggerBanner("success", `¡Se cargaron ${loadedRecipients.length} filas desde la pestaña "${tabName}"!`);
    } catch (err: any) {
      console.error(err);
      addLog(`Error en el volcado de destinatarios: ${err.message}`, "error");
      setSheetError(err.message || "No se pudieron obtener las filas de la hoja.");
    } finally {
      setIsLoadingSheet(false);
    }
  };

  // Re-run fetching whenever name/email select indexes change or tab is changed
  useEffect(() => {
    if (spreadsheetId && selectedTab) {
      handleFetchRows(selectedTab);
    }
  }, [selectedTab, selectedNameCol, selectedEmailCol]);

  // Handle PDF file selection and read as Base64 helper
  const handleFileChange = (file: File) => {
    if (file.type !== "application/pdf") {
      setPdfError("Solo se admiten archivos PDF estándar.");
      return;
    }
    setPdfError(null);
    setPdfFile(file);
    setPages([]); // Clear old segment pages to ensure fresh start
    addLog(`Cargado archivo local: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`, "info");

    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setPdfBase64(base64);
      
      // Auto-trigger high-speed splitter on this loaded file!
      await handleSplitPDF(base64);
    };
    reader.onerror = () => {
      setPdfError("Error al leer el archivo PDF.");
    };
    reader.readAsDataURL(file);
  };

  // Split multi-page PDF into single page files on the backend
  const handleSplitPDF = async (customBase64?: string) => {
    const activeBase64 = customBase64 || pdfBase64;
    if (!activeBase64) {
      setPdfError("Por favor selecciona un archivo PDF exportado desde Canva.");
      return;
    }

    setIsSplitting(true);
    setPdfError(null);
    setPages([]);
    addLog("Iniciando segmentación de alta velocidad para separar páginas individuales del PDF...", "info");

    try {
      const response = await fetch("/api/split-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pdfBase64: activeBase64 }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Error al procesar el PDF.");
      }

      const jsonRes = await response.json();
      const sId = jsonRes.sessionId || null;
      const splitPages = jsonRes.pages || [];
      setSessionId(sId);
      sessionIdRef.current = sId;

      const mappedPages: CertificatePage[] = splitPages.map((p: any) => ({
        pageIndex: p.index ?? p.pageIndex,
        base64: p.base64 || "",
        extractedName: "",
        matchedRecipient: null,
        status: "idle",
        errorMessage: null,
      }));

      setPages(mappedPages);
      addLog(`¡Páginas extraídas correctamente! Total: ${mappedPages.length} certificados.`, "success");
      triggerBanner("success", `¡PDF dividido en ${mappedPages.length} hojas individuales!`);

      // Auto-trigger Gemini AI scanning on the newly segmented pages!
      setTimeout(() => {
        handleRunAIScan(mappedPages);
      }, 500);
    } catch (err: any) {
      console.error(err);
      addLog(`Fallo al dividir el PDF: ${err.message}`, "error");
      setPdfError(err.message || "Error al dividir el documento PDF en páginas individuales.");
    } finally {
      setIsSplitting(false);
    }
  };

  // Connect Canva URL / ID directly via the exports polling API
  const handleCanvaDirectConnect = async () => {
    const designId = extractCanvaDesignId(canvaUrlOrId);
    if (!designId) {
      triggerBanner("error", "URL o ID de diseño Canva no reconocido.");
      addLog("Error: El formato de URL o ID ingresado para Canva no es correcto.", "error");
      return;
    }

    if (!canvaToken.trim()) {
      triggerBanner("error", "Requiere ingresar tu Canva Token.");
      addLog("Error: Para conectar en vivo requieres un Canva Access Token.", "error");
      return;
    }

    setIsConnectingCanva(true);
    addLog(`Conectando con Canva para exportar diseño ID [${designId}]...`, "info");
    addLog("Generando exportación asíncrona de PDF oficial de Canva Connect API...", "warning");

    try {
      const res = await fetch("/api/canva/export-design", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          designId,
          canvaToken: canvaToken.trim(),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Fallo inesperado de conexión con Canva API");
      }

      const { pdfBase64: fetchedBase64 } = await res.json();
      addLog("¡Canva PDF descargado correctamente a nuestro servidor!", "success");

      // Auto trigger splitter on this newly downloaded Canva PDF base64!
      await handleSplitPDF(fetchedBase64);
    } catch (err: any) {
      console.error(err);
      addLog(`Error en Canva Direct: ${err.message}`, "error");
      triggerBanner("error", err.message || "Fallo al conectar o descargar de tu cuenta de Canva.");
    } finally {
      setIsConnectingCanva(false);
    }
  };

  // Trigger Gemini AI scanning on each split page to extract recipient name
  const handleRunAIScan = async (pagesToUse?: any) => {
    // Ensure activePages uses pagesRef.current rather than stale pages closure,
    // and skip any React SyntheticEvent object passed if clicked directly.
    const activePages = (Array.isArray(pagesToUse) && pagesToUse.length > 0) ? pagesToUse : pagesRef.current;
    if (activePages.length === 0) return;

    // Use latest recipients to avoid empty/stale lists due to closures
    const activeRecipients = recipientsRef.current;

    // Detect pages that actually need scanning (either idle, error, or missing extracted name)
    const pagesToScan = activePages.map((page, index) => {
      const needsScan = page.status !== "success" || !page.extractedName || page.extractedName === "UNKNOWN";
      return { page, index, needsScan };
    });

    const totalToScan = pagesToScan.filter((p) => p.needsScan).length;
    if (totalToScan === 0) {
      addLog("Todos los nombres han sido extraídos previamente. Iniciando cruce y emparejamiento inteligente de forma local con la lista del Google Sheet...", "info");
      
      let matchedCount = 0;
      const updatedPages = activePages.map((p) => {
        if (p.extractedName && p.extractedName !== "UNKNOWN") {
          const { best, score } = findBestRecipient(p.extractedName, activeRecipients);
          if (best) {
            matchedCount++;
            addLog(`[Emparejado Inteligente] Página ${p.pageIndex}: "${p.extractedName}" -> ${best.name} (${Math.round(score * 100)}% de coincidencia)`, "success");
          } else {
            addLog(`[Sin Coincidencia] Página ${p.pageIndex}: "${p.extractedName}" no tiene coincidencia cercana en el Sheet.`, "warning");
          }
          return {
            ...p,
            matchedRecipient: best,
            status: "success" as const,
            errorMessage: null,
          };
        }
        return p;
      });

      setPages(updatedPages);
      triggerBanner("success", `¡Cruce de datos completado! Se emparejaron ${matchedCount} de ${activePages.length} certificados.`);
      return;
    }

    setIsProcessingAI(true);
    setAiStepProgress(0);
    addLog(`Iniciando escaneo con IA (Gemini 3.5 Flash) de ${totalToScan} certificados pendientes...`, "warning");

    const currentPages = [...activePages];

    if (user?.isGuest) {
      let scannedCount = 0;
      const mockNames = [
        "Juan Pérez",
        "María Camila Restrepo",
        "Carlos Eduardo Gómez",
        "Sofia Valentina Rojas",
        "Alejandro Londoño"
      ];

      // Mark pages as analyzing
      pagesToScan.forEach(({ index, needsScan }) => {
        if (needsScan) {
          currentPages[index] = {
            ...currentPages[index],
            status: "analyzing",
            extractedName: "",
            matchedRecipient: null,
            errorMessage: null,
          };
        }
      });
      setPages([...currentPages]);

      for (let i = 0; i < currentPages.length; i++) {
        const pageInfo = pagesToScan.find((p) => p.index === i);
        if (!pageInfo || !pageInfo.needsScan) {
          continue;
        }

        scannedCount++;
        setAiStepProgress(scannedCount);
        addLog(`[Modo Invitado] Analizando certificado digital página ${currentPages[i].pageIndex} con IA...`, "info");

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const name = mockNames[i % mockNames.length];
        const { best, score } = findBestRecipient(name, activeRecipients);

        currentPages[i] = {
          ...currentPages[i],
          extractedName: name,
          matchedRecipient: best,
          status: "success",
          errorMessage: null,
        };

        if (best) {
          addLog(`[IA Invitado] Página ${currentPages[i].pageIndex}: Extraído: "${name}" -> Emparejado (${Math.round(score * 100)}% sim) con ${best.name}.`, "success");
        } else {
          addLog(`[IA Invitado] Página ${currentPages[i].pageIndex}: Extraído: "${name}" -> Sin coincidencia exacta en el Sheet.`, "warning");
        }

        setPages([...currentPages]);
      }

      setIsProcessingAI(false);
      addLog("¡Simulación de análisis masivo con Inteligencia Artificial completado!", "success");
      triggerBanner("success", "¡Análisis simulado con IA finalizado!");
      return;
    }

    // Mark active ones as analyzing, keep successful ones untouched
    pagesToScan.forEach(({ index, needsScan }) => {
      if (needsScan) {
        currentPages[index] = {
          ...currentPages[index],
          status: "analyzing",
          extractedName: "",
          matchedRecipient: null,
          errorMessage: null,
        };
      }
    });
    setPages([...currentPages]);

    let scannedCount = 0;

    // Process pages sequentially with rate limit pacing and automated client+server retries
    for (let i = 0; i < currentPages.length; i++) {
      const pageInfo = pagesToScan.find((p) => p.index === i);
      if (!pageInfo || !pageInfo.needsScan) {
        continue;
      }

      const page = currentPages[i];
      scannedCount++;
      setAiStepProgress(scannedCount);
      addLog(`[HOLA ${page.pageIndex}] Analizando certificado e identificando nombre... (${scannedCount}/${totalToScan})`, "info");

      let name = "UNKNOWN";
      let success = false;
      let attempt = 0;
      let lastErrorMessage = "";

      while (!success && attempt < 3) {
        attempt++;
        try {
          // Dynamic pacing delay to protect the Gemini free-tier rate limits (15 requests per minute)
          // 15 requests per minute is exactly 4000ms. We use 4300ms for safety.
          let pacingDelay = 4300; 
          if (attempt > 1) {
            pacingDelay = 6000 * attempt; // exponentially backed off delay on retries
            addLog(`[RETRY] Reintentando página ${page.pageIndex} (Intento ${attempt}/3) en ${pacingDelay / 1000}s...`, "warning");
          } else if (scannedCount === 1) {
            pacingDelay = 0; // immediate request for the very first page
          }

          if (pacingDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, pacingDelay));
          }

          const res = await fetch("/api/analyze-page", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
              sessionId: sessionIdRef.current || sessionId || undefined,
              pageIndex: page.pageIndex,
              pdfPageBase64: page.base64 || undefined,
              recipientNames: activeRecipients.map((r) => r.name)
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Error al conectar con la Inteligencia Artificial.");
          }

          const data = await res.json();
          name = data.name || "UNKNOWN";
          page.base64 = data.base64 || page.base64 || "";
          success = true;
        } catch (err: any) {
          lastErrorMessage = err.message || "Fallo inesperado al analizar la página.";
          console.warn(`Attempt ${attempt} failed for page ${page.pageIndex}:`, lastErrorMessage);
          
          if (lastErrorMessage.toLowerCase().includes("quota") || lastErrorMessage.toLowerCase().includes("429") || lastErrorMessage.toLowerCase().includes("limit") || lastErrorMessage.toLowerCase().includes("exhausted")) {
            // Wait an additional 8 seconds if we hit a rate limit
            await new Promise((resolve) => setTimeout(resolve, 8000));
          }
        }
      }

      if (success) {
        // Perform fuzzy matching with the Sheet recipients
        const { best, score } = findBestRecipient(name, activeRecipients);
        const isKnown = name !== "UNKNOWN";

        currentPages[i] = {
          ...page,
          extractedName: name,
          matchedRecipient: best,
          status: isKnown ? "success" : "error",
          errorMessage: isKnown ? null : "No se pudo identificar un nombre claro con Inteligencia Artificial.",
        };

        if (isKnown) {
          if (best) {
            addLog(`[HOLA ${page.pageIndex}] Extraído: [${name}] -> Emparejado (${Math.round(score * 100)}% sim) con ${best.name}.`, "success");
          } else {
            addLog(`[HOLA ${page.pageIndex}] Extraído: [${name}] -> Sin coincidencia en el Sheet.`, "warning");
          }
        } else {
          addLog(`[HOLA ${page.pageIndex}] No se ha podido reconocer ningún nombre legible en esta página.`, "error");
        }
      } else {
        addLog(`[HOLA ${page.pageIndex}] Falló tras 3 intentos con IA: ${lastErrorMessage}`, "error");
        currentPages[i] = {
          ...page,
          status: "error",
          errorMessage: lastErrorMessage || "La IA falló tras múltiples reintentos.",
        };
      }

      // Live update UI state so user sees ongoing progress instantly
      setPages([...currentPages]);
    }

    // Final step: run fuzzy matching on all pages to ensure complete alignment with recipients list
    addLog("Sincronizando de forma masiva los resultados de la IA con la lista de Google Sheet...", "info");
    let matchedCount = 0;
    const finalPages = currentPages.map((p) => {
      if (p.extractedName && p.extractedName !== "UNKNOWN") {
        const { best, score } = findBestRecipient(p.extractedName, activeRecipients);
        if (best) {
          matchedCount++;
          addLog(`[Coincidencia] Página ${p.pageIndex}: "${p.extractedName}" -> ${best.name} (${Math.round(score * 100)}% similitud)`, "success");
        } else {
          addLog(`[Coincidencia] Página ${p.pageIndex}: "Extracción: [${p.extractedName}]" -> No se encontró ningún destinatario compatible en la hoja.`, "warning");
        }
        return {
          ...p,
          matchedRecipient: best,
          status: p.status === "analyzing" ? "success" : p.status,
          errorMessage: null,
        };
      }
      return p;
    });

    setPages(finalPages);
    setIsProcessingAI(false);
    addLog(`Análisis e inteligente emparejado de nombres finalizado. Total emparejados: ${matchedCount} de ${finalPages.length}.`, "success");
    triggerBanner("success", `¡Filtrado finalizado! Se emparejaron ${matchedCount} certificados.`);
  };

  // Perform a manual pairing update for a specific page
  const handleManualPairing = (pageIndex: number, recipientName: string) => {
    const updated = pages.map((p) => {
      if (p.pageIndex === pageIndex) {
        if (recipientName === "__none__") {
          addLog(`[HOLA ${pageIndex}] Desasociado manualmente del destinatario anterior.`, "info");
          return { ...p, matchedRecipient: null };
        }
        const matched = recipients.find((r) => r.name === recipientName) || null;
        if (matched) {
          addLog(`[HOLA ${pageIndex}] Asociado manualmente con ${matched.name}.`, "success");
        }
        return { ...p, matchedRecipient: matched };
      }
      return p;
    });
    setPages(updated);
  };

  // Create ZIP of all renamed pages and trigger direct download
  const handleDownloadZIPProducts = async () => {
    if (pages.length === 0) {
      triggerBanner("error", "No hay páginas de certificado disponibles para descargar.");
      return;
    }

    const pendingPagesCount = pages.filter((p) => p.status === "idle" || p.status === "analyzing").length;
    if (pendingPagesCount > 0) {
      const confirmDownload = window.confirm(
        `Atención: Hay ${pendingPagesCount} certificados que aún no han sido analizados por la Inteligencia Artificial.\n\nSi descargas ahora, estos archivos se guardarán con nombres genéricos ("Pagina_X.pdf").\n\n¿Deseas descargar el ZIP de todas formas?`
      );
      if (!confirmDownload) return;
    }

    addLog("Comenzando consolidación y compresión de certificados procesados...", "info");

    const updatedPages = [...pages];
    const missingBase64Pages = updatedPages.filter((p) => !p.base64);

    if (missingBase64Pages.length > 0) {
      const currentSessionId = sessionIdRef.current || sessionId;
      if (!currentSessionId) {
        triggerBanner("error", "La sesión del PDF ha expirado o no es válida. Por favor, selecciona y carga el archivo PDF nuevamente.");
        addLog("Error: El identificador de la sesión PDF ha expirado.", "error");
        return;
      }

      addLog(`Descargando en paralelo datos PDF de alta resolución para ${missingBase64Pages.length} certificados faltantes desde el servidor...`, "warning");
      try {
        const promises = updatedPages.map(async (p, idx) => {
          if (!p.base64) {
            const res = await fetch("/api/get-page-pdf", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              body: JSON.stringify({
                sessionId: currentSessionId,
                pageIndex: p.pageIndex,
              }),
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error || `Error al recuperar la página ${p.pageIndex}`);
            }
            const data = await res.json();
            updatedPages[idx] = { ...p, base64: data.base64 };
          }
        });
        await Promise.all(promises);
        setPages(updatedPages);
        addLog("¡Todos los datos estructurados consolidados con éxito!", "success");
      } catch (err: any) {
        console.error(err);
        addLog(`Error al preparar el ZIP de descargas: ${err.message}`, "error");
        triggerBanner("error", "Fallo al pre-cargar páginas del PDF.");
        return;
      }
    }

    const zip = new JSZip();
    let count = 0;

    updatedPages.forEach((p) => {
      // Determine the filename based on matched recipient, fallback to Gemini recognized name, fallback to page no.
      let nameRepresentation = "Certificado";
      if (p.matchedRecipient) {
        nameRepresentation = p.matchedRecipient.name;
      } else if (p.extractedName && p.extractedName !== "UNKNOWN") {
        nameRepresentation = p.extractedName;
      } else {
        nameRepresentation = `Pagina_${p.pageIndex}`;
      }

      // Sanitize filename to avoid invalid zip characters
      const sanitizedFilename = nameRepresentation
        .replace(/[^a-zA-Z0-9\såéíóúÁÉÍÓÚñÑ_-]/g, "")
        .trim()
        .replace(/\s+/g, "_") + ".pdf";

      // Decode Base64 to binary Array
      const binaryString = atob(p.base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      zip.file(sanitizedFilename, bytes);
      count++;
    });

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `Certificados_Divididos_${new Date().toISOString().split("T")[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addLog(`¡Descarga ZIP ejecutada! Se empaquetaron con éxito ${count} certificados ordenados.`, "success");
      triggerBanner("success", `¡Se ha descargado correctamente un archivo ZIP con ${count} certificados ordenados!`);
    } catch (err: any) {
      console.error(err);
      addLog(`Error al compilar el ZIP: ${err.message}`, "error");
      triggerBanner("error", "Error al compilar el paquete ZIP.");
    }
  };

  // Run bulk delivery via Gmail endpoint (Only upon manual confirmation - "User approves")
  const handleSendEmails = async () => {
    const matchedCount = pages.filter((p) => p.matchedRecipient !== null).length;
    if (matchedCount === 0) {
      triggerBanner("error", "No hay certificados asociados a correos válidos para enviar.");
      return;
    }

    const confirmed = window.confirm(
      `¿Estás seguro de que deseas autorizar el envío automatizado de ${matchedCount} correos electrónicos personalizados utilizando tu cuenta de Gmail?`
    );
    if (!confirmed) {
      addLog("Envío masivo abortado por el usuario.", "warning");
      return;
    }

    setIsDelivering(true);
    addLog(`Despachando masivamente ${matchedCount} certificados mediante la API oficial de Gmail...`, "warning");
    const updatedPages = [...pages];

    if (user?.isGuest) {
      for (let i = 0; i < updatedPages.length; i++) {
        const page = updatedPages[i];
        if (!page.matchedRecipient) continue;

        updatedPages[i] = { ...page, status: "sending" };
        setPages([...updatedPages]);

        await new Promise((resolve) => setTimeout(resolve, 800));

        updatedPages[i] = {
          ...page,
          status: "sent",
          errorMessage: null,
        };
        addLog(`[SIMULACIÓN ENVIADO] Correo premium enviado a: ${page.matchedRecipient.name} (${page.matchedRecipient.email})`, "success");
        setPages([...updatedPages]);
      }
      setIsDelivering(false);
      addLog("¡Listo! Envío simulado finalizado sin errores. Todos los destinatarios marcados con éxito.", "success");
      triggerBanner("success", "¡Envío simulado completado con éxito!");
      return;
    }

    for (let i = 0; i < updatedPages.length; i++) {
      const page = updatedPages[i];
      if (!page.matchedRecipient) continue;

      updatedPages[i] = { ...page, status: "sending" };
      setPages([...updatedPages]);

      try {
        const recipient = page.matchedRecipient;
        // Build customized body content replacing variables
        const customBodyHtml = emailBody
          .replace(/{Nombre}/g, recipient.name)
          .replace(/{Correo}/g, recipient.email)
          .replace(/\n/g, "<br>");

        const filename = `${recipient.name.replace(/\s+/g, "_")}.pdf`;

        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken: token,
            to: recipient.email,
            subject: emailSubject.replace(/{Nombre}/g, recipient.name),
            body: customBodyHtml,
            pdfBase64: page.base64 || undefined,
            sessionId: sessionIdRef.current || sessionId || undefined,
            pageIndex: page.pageIndex,
            filename: filename,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Fallo en la llamada a la API de Gmail");
        }

        updatedPages[i] = {
          ...page,
          status: "sent",
          errorMessage: null,
        };
        addLog(`[CERTIFICADO ENVIADO] Despachado con éxito a ${recipient.name} (${recipient.email})`, "success");
      } catch (err: any) {
        console.error(`Error sending email for page ${page.pageIndex}:`, err);
        addLog(`[ERROR ENVÍO] Falló la entrega a ${page.matchedRecipient.name}: ${err.message}`, "error");
        updatedPages[i] = {
          ...page,
          status: "send_error",
          errorMessage: err.message || "No se pudo enviar el correo de Gmail.",
        };
      }

      setPages([...updatedPages]);
    }

    setIsDelivering(false);
    const successCount = updatedPages.filter((p) => p.status === "sent").length;
    addLog(`Resumen final: ${successCount} correos despachados con éxito.`, "success");
    triggerBanner("success", `¡Proceso completado! Se enviaron con éxito ${successCount} correos de Gmail.`);
  };

  // Drag over handler for visuals
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Filter queue recipients to show match lists easily
  const filteredRecipients = recipients.filter((rec) => {
    if (!queueFilter) return true;
    const q = queueFilter.toLowerCase();
    return rec.name.toLowerCase().includes(q) || rec.email.toLowerCase().includes(q);
  });

  if (showPrivacyPolicy) {
    return (
      <PrivacyPolicy
        theme={theme}
        onBack={handleNavigateToHome}
      />
    );
  }

  if (needsAuth) {
    return (
      <LandingPage
        language={language}
        setLanguage={setLanguage}
        theme={theme}
        setTheme={setTheme}
        onStart={handleLogin}
        onViewPrivacy={handleNavigateToPrivacy}
        isLoggingIn={isLoggingIn}
      />
    );
  }

  const isDark = theme === "dark";
  const bgMain = isDark ? "bg-[#0B0C0E] text-[#D1D5DB]" : "bg-[#F3F4F6] text-[#374151]";
  const bgHeader = isDark ? "bg-[#0F1115] border-[#2D2F36]" : "bg-white border-gray-200 shadow-sm";
  const bgCard = isDark ? "bg-[#16181D] border-[#2D2F36]" : "bg-white border-gray-200 shadow-sm text-[#374151]";
  const bgInput = isDark ? "bg-[#0B0C0E] border-[#2D2F36] text-white" : "bg-white border-gray-300 text-gray-900";
  const textTitle = isDark ? "text-white" : "text-[#1F2937]";
  const textMuted = isDark ? "text-slate-400" : "text-slate-500";
  const borderCol = isDark ? "border-[#2D2F36]" : "border-gray-200";

  return (
    <div className={`min-h-screen flex flex-col font-sans select-none antialiased transition-colors duration-300 ${bgMain}`}>
      {/* Dynamic Status / Floating Banner */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 py-3 px-6 rounded-lg shadow-2xl flex items-center gap-3 max-w-lg border ${
              banner.type === "success"
                ? "bg-[#061C14] border-emerald-500/50 text-emerald-100 shadow-emerald-950/20"
                : banner.type === "error"
                ? "bg-[#1C0606] border-rose-500/50 text-rose-100 shadow-rose-950/20"
                : "bg-[#06101C] border-blue-500/50 text-blue-100 shadow-blue-950/20"
            }`}
          >
            {banner.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="text-xs font-semibold">{banner.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Header with High-Density Layout */}
      <header className={`flex justify-between items-center border-b pb-4 px-6 py-4 transition-colors duration-300 ${bgHeader}`}>
        <div className="flex items-center gap-4">
          <LogoMark className="w-10 h-10" />
          <div>
            <h1 className={`text-base font-extrabold tracking-tight ${textTitle}`}>CertiSend Pro</h1>
            <p className="text-[10px] text-indigo-500 uppercase tracking-wider font-mono">
              {translations[language].tagline}
            </p>
          </div>
        </div>

        {/* Real Status Badges */}
        <div className="hidden lg:flex items-center gap-3">
          {/* Workspace language and theme controls */}
          <div className={`flex items-center gap-1 border rounded-lg p-1 mr-2 ${borderCol}`}>
            <button
              onClick={() => setLanguage(language === "es" ? "en" : "es")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 text-[10px] font-bold transition-colors ${
                isDark ? "hover:bg-[#1D2130] text-gray-300" : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span>{language === "es" ? "EN" : "ES"}</span>
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`p-1 rounded-md transition-colors ${
                isDark ? "hover:bg-[#1D2130] text-yellow-400" : "hover:bg-gray-100 text-slate-700"
              }`}
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-[#16181D] border border-[#2D2F36]" : "bg-gray-50 border border-gray-200"}`}>
            <div className={`w-2 h-2 rounded-full ${isCanvaConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-slate-600"}`}></div>
            <span className="text-[10px] font-mono">Canva: {isCanvaConnected ? "Connected" : "Idle"}</span>
          </div>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-[#16181D] border border-[#2D2F36]" : "bg-gray-50 border border-gray-200"}`}>
            <div className={`w-2 h-2 rounded-full ${isSheetsLinked ? "bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-slate-600"}`}></div>
            <span className="text-[10px] font-mono">G-Sheets: {isSheetsLinked ? "Linked" : "Disconnected"}</span>
          </div>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-[#16181D] border border-[#2D2F36]" : "bg-gray-50 border border-gray-200"}`}>
            <div className={`w-2 h-2 rounded-full ${isGmailActive ? "bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-slate-600"}`}></div>
            <span className="text-[10px] font-mono">Gmail: {isGmailActive ? "Active" : "Locked"}</span>
          </div>

          {!needsAuth && user && (
            <div className={`flex items-center gap-2.5 px-3 py-1 rounded-md transform scale-95 origin-right ${isDark ? "bg-[#1A1D24] border border-[#2D2F36]" : "bg-gray-50 border border-gray-200"}`}>
              {user.photoURL && <img src={user.photoURL} referrerPolicy="no-referrer" className="w-4 h-4 rounded-full" alt="User" />}
              <span className="text-[10px] font-mono font-medium max-w-[100px] truncate">{user.displayName}</span>
              <button onClick={handleLogout} title="Cerrar sesión" className="text-slate-400 hover:text-rose-400 p-0.5">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace Grid - High-Density columns Arrangement */}
      {needsAuth ? (
        <div className="flex-1 flex items-center justify-center p-6 bg-[#0B0C0E]">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#16181D] p-8 max-w-sm w-full rounded-xl border border-[#2D2F36] text-center shadow-2xl"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-[#2563EB] to-[#8B5CF6] mx-auto flex items-center justify-center mb-5 shadow-lg shadow-[#8B5CF6]/10">
              <Mail className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight mb-2">Conecta con tu Cuenta Google</h2>
            <p className="text-xs text-[#9CA3AF] mb-6 leading-relaxed">
              Inicia sesión con Google para conceder permisos y poder leer tu listado en Sheets y enviar los correos por tu cuenta de Gmail.
            </p>

            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] hover:opacity-95 text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow-md transition-opacity"
              id="google-signin-btn"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              <span>Iniciar Sesión con Google</span>
            </button>
          </motion.div>
        </div>
      ) : (
        <main className="flex-1 grid grid-cols-12 gap-6 p-6 min-h-0 overflow-auto">
          {/* LEFT PANEL (Col span 3): Sources & Direct Canva Connection */}
          <section className="col-span-12 xl:col-span-3 flex flex-col gap-6">
            {/* STEP 1: Google Sheets Setup */}
            <div className="bg-[#16181D] border border-[#2D2F36] rounded-xl p-4 flex flex-col gap-3.5">
              <div className="flex items-center gap-2 pb-2.5 border-b border-[#2D2F36]">
                <FileSpreadsheet className="w-4 h-4 text-[#60A5FA]" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">1. Destinatarios (G-Sheets)</h3>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#9CA3AF] uppercase font-semibold">Enlace del Google Sheet:</span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="Pegar link del navegador..."
                      value={spreadsheetUrl}
                      onChange={(e) => setSpreadsheetUrl(e.target.value)}
                      className="flex-1 bg-[#0B0C0E] border border-[#2D2F36] rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#8B5CF6] font-sans"
                    />
                    <button
                      onClick={handleLoadSpreadsheet}
                      disabled={isLoadingSheet}
                      className="bg-[#1C1E24] hover:bg-[#252830] text-white border border-[#2D2F36] text-[11px] px-2.5 rounded font-mono flex items-center gap-1 shrink-0"
                    >
                      {isLoadingSheet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {sheetError && (
                  <div className="bg-[#1C0606] border border-rose-900/40 text-rose-300 text-[10px] p-2 rounded flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                    <span>{sheetError}</span>
                  </div>
                )}

                {tabs.length > 0 && (
                  <div className="space-y-2 border-t border-[#2D2F36] pt-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-[#9CA3AF] uppercase font-semibold">Seleccionar pestaña:</span>
                      <select
                        value={selectedTab}
                        onChange={(e) => setSelectedTab(e.target.value)}
                        className="bg-[#0B0C0E] border border-[#2D2F36] rounded p-1.5 text-xs text-white font-mono"
                      >
                        {tabs.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    {headers.length > 0 && (
                      <div className="bg-[#0B0C0E] p-2.5 rounded border border-[#2D2F36] space-y-2 text-xs">
                        <span className="text-[10px] font-bold text-[#9CA3AF] block uppercase tracking-wider">Mapeo de Datos</span>
                        
                        <div className="space-y-1.5">
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[9px] text-slate-400 font-mono">COLUMNA DE NOMBRE:</label>
                            <select
                              value={selectedNameCol}
                              onChange={(e) => setSelectedNameCol(Number(e.target.value))}
                              className="bg-[#16181D] border border-[#2D2F36] text-[11px] text-[#60A5FA] font-mono rounded px-1.5 py-1"
                            >
                              {headers.map((h, i) => (
                                <option key={i} value={i}>
                                  Col {i + 1}: {h || "(Vacío)"}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex flex-col gap-0.5">
                            <label className="text-[9px] text-slate-400 font-mono">COLUMNA DE CORREO:</label>
                            <select
                              value={selectedEmailCol}
                              onChange={(e) => setSelectedEmailCol(Number(e.target.value))}
                              className="bg-[#16181D] border border-[#2D2F36] text-[11px] text-[#8B5CF6] font-mono rounded px-1.5 py-1"
                            >
                              {headers.map((h, i) => (
                                <option key={i} value={i}>
                                  Col {i + 1}: {h || "(Vacío)"}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* STEP 2: Canva Connect and PDF Importer */}
            <div className="bg-[#16181D] border border-[#2D2F36] rounded-xl p-4 flex flex-col gap-3.5 flex-1 min-h-0">
              <div className="flex items-center gap-2 pb-2.5 border-b border-[#2D2F36]">
                <FileText className="w-4 h-4 text-[#8B5CF6]" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">2. Importar Certificados</h3>
              </div>

              {/* Toggle Switch */}
              <div className="grid grid-cols-2 bg-[#0B0C0E] p-1 rounded-lg border border-[#2D2F36]">
                <button
                  onClick={() => setActiveUploadTab("upload")}
                  className={`text-[10px] font-bold uppercase py-1 px-2 rounded font-mono transition-all ${
                    activeUploadTab === "upload" ? "bg-[#1A1D24] text-[#60A5FA] shadow" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Subir PDF
                </button>
                <button
                  onClick={() => setActiveUploadTab("canva")}
                  className={`text-[10px] font-bold uppercase py-1 px-2 rounded font-mono transition-all ${
                    activeUploadTab === "canva" ? "bg-[#1A1D24] text-[#8B5CF6] shadow" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Conectar Canva
                </button>
              </div>

              {activeUploadTab === "upload" ? (
                // Manual Upload Block
                <div className="flex flex-col gap-3 flex-1 min-h-0">
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "application/pdf";
                      input.onchange = (e: any) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileChange(e.target.files[0]);
                        }
                      };
                      input.click();
                    }}
                    className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors flex-1 min-h-[140px] max-h-[220px] ${
                      isDragging
                        ? "border-[#8B5CF6] bg-[#8B5CF6]/5"
                        : pdfFile
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-[#2D2F36] hover:border-slate-500 bg-[#0B0C0E]"
                    }`}
                  >
                    <FileText className={`w-8 h-8 mb-2 ${pdfFile ? "text-emerald-400" : "text-slate-500"}`} />
                    {pdfFile ? (
                      <div className="overflow-hidden w-full px-2">
                        <span className="text-[11px] font-semibold text-white block truncate">
                          {pdfFile.name}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {(pdfFile.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                    ) : (
                      <div className="px-2">
                        <span className="text-[11px] font-medium text-slate-300 block">
                          Suelte el PDF de Canva aquí o explore
                        </span>
                        <span className="text-[9px] text-slate-500 block mt-1">
                          Admite lote consolidado multi-página en PDF estándar
                        </span>
                      </div>
                    )}
                  </div>

                  {pdfError && (
                    <div className="bg-[#1C0606] border border-rose-900/30 text-[#FB7185] text-[10px] p-2.5 rounded flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{pdfError}</span>
                    </div>
                  )}

                  {pdfFile && pages.length === 0 && (
                    <button
                      onClick={() => handleSplitPDF()}
                      disabled={isSplitting}
                      className="w-full bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] hover:opacity-95 text-white font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all mt-auto"
                    >
                      {isSplitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Segmentando PDF...</span>
                        </>
                      ) : (
                        <>
                          <Layers className="w-3.5 h-3.5" />
                          <span>Segmentar Certificados</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              ) : (
                // Live Canva Direct Connect API Integration
                <div className="flex flex-col gap-3 flex-1 min-h-0">
                  <div className="bg-[#0B0C0E] border border-[#2D2F36] p-3 rounded-lg flex flex-col gap-2.5">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-[#9CA3AF] uppercase font-bold tracking-wider font-mono">1. Canva Link / Edit URL</span>
                      <input
                        type="text"
                        placeholder="https://www.canva.com/design/DA.../edit"
                        value={canvaUrlOrId}
                        onChange={(e) => setCanvaUrlOrId(e.target.value)}
                        className="bg-[#16181D] border border-[#2D2F36] rounded p-1.5 text-[11px] text-white focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-[#9CA3AF] uppercase font-bold tracking-wider font-mono">2. Access Token (canva.dev)</span>
                        <div className="relative group/help">
                          <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 cursor-help" />
                          <div className="invisible group-hover/help:visible absolute bottom-5 right-0 w-48 bg-[#1A1C22] text-[9px] text-slate-300 p-2 rounded-lg border border-[#2D2F36] shadow-2xl z-20">
                            Crea una integración gratis en Canva Developers, obtén tu Token de Acceso e ingrésalo para automatizar al instante.
                          </div>
                        </div>
                      </div>
                      <input
                        type="password"
                        placeholder="Token de Acceso de Canva..."
                        value={canvaToken}
                        onChange={(e) => setCanvaToken(e.target.value)}
                        className="bg-[#16181D] border border-[#2D2F36] rounded p-1.5 text-[11px] text-white focus:outline-none placeholder:text-slate-700 font-mono"
                      />
                    </div>

                    <button
                      onClick={handleCanvaDirectConnect}
                      disabled={isConnectingCanva}
                      className="w-full bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 hover:opacity-95"
                    >
                      {isConnectingCanva ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Descargando de Canva...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Conectar & Descargar 127 pág</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Manual guidelines in case they are not technical as helper */}
                  <div className="bg-gradient-to-br from-[#1A1D24] to-[#121419] p-2.5 rounded-lg border border-[#2D2F36] text-[10px] space-y-1.5 mt-auto">
                    <span className="text-[#60A5FA] font-bold block uppercase tracking-wider font-mono">¿No tienes clave de desarrollador?</span>
                    <p className="text-[#9CA3AF] leading-relaxed">
                      ¡No te preocupes! Canva te permite descargar tus 127 páginas en 2 clics:
                      Click en <b>Compartir</b> → <b>Descargar</b> → Elige <b>"PDF Estándar"</b>.
                      Luego, súbelo en la pestaña de la izquierda para tener todos ordenados.
                    </p>
                  </div>
                </div>
              )}

              {pages.length > 0 && (
                <div className="bg-[#0B0C0E] border border-[#2D2F36] p-2 rounded flex items-center justify-between text-[11px] font-mono mt-auto">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-slate-300"><b>{pages.length}</b> pág extraídas</span>
                  </div>
                  <button
                    onClick={() => {
                      setPdfFile(null);
                      setPdfBase64(null);
                      setPages([]);
                      setSessionId(null);
                      sessionIdRef.current = null;
                    }}
                    className="text-[10px] text-slate-400 hover:text-rose-400 bg-[#16181D] px-2 py-0.5 rounded border border-[#2D2F36]"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* MIDDLE DISPLAY (Col span 6): Live Execution Monitor & Email Designer */}
          <section className="col-span-12 xl:col-span-6 flex flex-col gap-6 min-h-0">
            {/* Live Execution Monitor Dashboard Block */}
            <div className="bg-[#16181D] border border-[#2D2F36] rounded-xl flex flex-col min-h-[220px] max-h-[300px] overflow-hidden">
              <div className="p-3 border-b border-[#2D2F36] flex justify-between items-center bg-[#0F1115]">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#60A5FA]" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">Monitor de Ejecución en Vivo</span>
                </div>
                {isProcessingAI || isDelivering ? (
                  <span className="px-2 py-0.5 bg-indigo-600/30 border border-indigo-400/40 text-[#A5B4FC] text-[9px] font-bold rounded animate-pulse font-mono">
                    PROCESANDO LOTE
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-[9px] font-bold rounded font-mono">
                    READY
                  </span>
                )}
              </div>

              {/* Console log list outputs */}
              <div className="flex-1 overflow-y-auto p-4 bg-[#0B0C0E] font-mono text-[10px] leading-relaxed space-y-1 select-text">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-[#6B7280] shrink-0">[{log.time}]</span>
                    <span
                      className={
                        log.type === "success"
                          ? "text-emerald-400 font-medium"
                          : log.type === "error"
                          ? "text-rose-400 font-medium"
                          : log.type === "warning"
                          ? "text-amber-400"
                          : "text-slate-300"
                      }
                    >
                      {log.text}
                    </span>
                  </div>
                ))}
              </div>

              {/* Progress bar info */}
              {(isProcessingAI || isDelivering) && (
                <div className="p-3 bg-[#0B0C0E] border-t border-[#2D2F36]">
                  <div className="flex justify-between text-[10px] font-mono mb-1.5">
                    <span className="text-[#9CA3AF]">
                      {isProcessingAI ? `IA Escaneando pág: ${aiStepProgress} de ${pages.length}` : "Despachando correos masivos..."}
                    </span>
                    <span className="text-white font-bold font-mono">
                      {isProcessingAI ? `${Math.round((aiStepProgress / pages.length) * 100)}%` : ""}
                    </span>
                  </div>
                  <div className="w-full bg-[#1A1C21] h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] h-full transition-all duration-300"
                      style={{
                        width: isProcessingAI ? `${(aiStepProgress / pages.length) * 100}%` : "50%"
                      }}
                    ></div>
                  </div>
                </div>
              )}
            </div>

            {/* Step 3: Mail content customizer & bulk manual dispatcher */}
            <div className="bg-[#16181D] border border-[#2D2F36] rounded-xl p-4 flex flex-col gap-4 flex-1 min-h-0">
              <div className="flex items-center gap-2 pb-2 border-b border-[#2D2F36]">
                <Mail className="w-4 h-4 text-[#60A5FA]" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">3. Diseñador de Correo Electrónico</h3>
              </div>

              <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-1">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-[#9CA3AF] uppercase font-semibold">Asunto del Correo:</span>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="ej. Tu Certificado de Participación"
                    className="bg-[#0B0C0E] border border-[#2D2F36] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                    <span>Admite el marcador dinámico {'{Nombre}'} para personalizar</span>
                    <span className="font-mono text-slate-600">Gmail MIME</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 flex-1 min-h-[140px]">
                  <span className="text-[10px] text-[#9CA3AF] uppercase font-semibold">Cuerpo del Correo (HTML básico permitido):</span>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Escribe tu mensaje interactivo aquí..."
                    className="flex-1 bg-[#0B0C0E] border border-[#2D2F36] rounded p-3 text-xs text-white focus:outline-none focus:border-[#8B5CF6] font-sans resize-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 bg-[#0B0C0E] p-2 rounded border border-[#2D2F36] text-[10px]">
                  <Info className="w-3.5 h-3.5 text-[#60A5FA]" />
                  <span className="text-[#9CA3AF]">Sustituciones automáticas por destinatario:</span>
                  <span className="bg-[#16181D] text-[#60A5FA] px-1 rounded font-mono">{"{Nombre}"}</span>
                  <span className="text-slate-500">e</span>
                  <span className="bg-[#16181D] text-[#8B5CF6] px-1 rounded font-mono">{"{Correo}"}</span>
                </div>
              </div>

              {/* Interactive audit match display in card grids */}
              {pages.length > 0 && (
                <div className="border-t border-[#2D2F36] pt-3 mt-1 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">Visor de Asociación de Certificados:</span>
                    <button
                      onClick={handleRunAIScan}
                      disabled={isProcessingAI}
                      className="bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] hover:opacity-95 text-white font-bold py-1 px-3 text-[10px] rounded flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      {isProcessingAI ? "Escaneando..." : "Intentar Clasificar con IA"}
                    </button>
                  </div>

                  {/* Horizontal scrolling list of mini pages to keep preview lightweight */}
                  <div className="flex gap-3 overflow-x-auto pb-2 select-text">
                    {pages.map((p) => (
                      <div
                        key={p.pageIndex}
                        className={`p-2.5 bg-[#0B0C0E] rounded-lg border flex-shrink-0 w-[180px] flex flex-col justify-between gap-2 text-xs relative ${
                          p.status === "success" || p.status === "sent"
                            ? "border-emerald-500/30 bg-emerald-505/5"
                            : p.status === "error" || p.status === "send_error"
                            ? "border-[#E11D48]/50 bg-[#E11D48]/5"
                            : "border-[#2D2F36]"
                        }`}
                      >
                        <div className="flex justify-between items-center bg-[#16181D] p-1 rounded">
                          <span className="text-[10px] font-mono font-bold text-slate-400">PÁG. {p.pageIndex}</span>
                          <span className={`text-[8px] font-bold uppercase ${
                            p.status === "sent" 
                              ? "text-emerald-400" 
                              : p.status === "success" 
                              ? "text-emerald-500" 
                              : p.status === "send_error" || p.status === "error"
                              ? "text-rose-400 font-extrabold"
                              : "text-amber-500"
                          }`}>
                            {p.status === "send_error" ? "ERROR ENVÍO" : p.status === "error" ? "ERROR IA" : p.status}
                          </span>
                        </div>

                        <div className="bg-[#16181D] p-1.5 rounded text-center relative overflow-hidden shrink-0">
                          <div className={`absolute top-0 inset-x-0 h-1 ${p.status === "send_error" || p.status === "error" ? "bg-rose-500" : "bg-[#2563EB]"}`}></div>
                          <span className="text-[9px] text-[#9CA3AF] block uppercase tracking-wider font-mono">Nombre IA</span>
                          <span className="text-[10px] font-bold text-white block truncate" title={p.extractedName}>
                            {p.extractedName || "Pendiente"}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 uppercase block font-mono">Coincidencia G-Sheet:</label>
                          <select
                            value={p.matchedRecipient?.name || "__none__"}
                            onChange={(e) => handleManualPairing(p.pageIndex, e.target.value)}
                            className="bg-[#16181D] border border-[#2D2F36] text-[10px] text-white rounded w-full p-1 focus:outline-none focus:border-[#8B5CF6]"
                          >
                            <option value="__none__">Ninguno (Ignorar)</option>
                            {recipients.map((rec) => (
                              <option key={rec.originalRowIndex} value={rec.name}>
                                {rec.originalRowIndex}. {rec.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {p.errorMessage && (
                          <div className="text-[9px] text-rose-300 bg-[#3B1212]/50 border border-[#E11D48]/25 rounded p-1.5 leading-snug break-words select-text">
                            <span className="font-bold uppercase text-[7px] text-rose-400 block mb-0.5">Detalle del Error:</span>
                            {p.errorMessage}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* RIGHT PANEL (Col span 3): Recipient Queue Table & Global Actions */}
          <section className="col-span-12 xl:col-span-3 flex flex-col bg-[#16181D] border border-[#2D2F36] rounded-xl overflow-hidden shadow-xl min-h-[400px]">
            <div className="p-4 border-b border-[#2D2F36] bg-[#0F1115] shrink-0">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                <TableProperties className="w-4 h-4 text-[#60A5FA]" />
                Cola de Destinatarios ({recipients.length})
              </h3>
              <input
                type="text"
                placeholder="Buscar destinatario..."
                value={queueFilter}
                onChange={(e) => setQueueFilter(e.target.value)}
                className="w-full mt-2.5 bg-[#0B0C0E] border border-[#2D2F36] text-xs px-2 py-1 rounded placeholder-slate-600 focus:outline-none"
              />
            </div>

            {/* Recipients Queue table with High-Density Layout */}
            <div className="flex-1 overflow-y-auto select-text">
              {recipients.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500">
                  <Database className="w-8 h-8 text-slate-600 mb-2" />
                  <span>Sin destinatarios cargados.<br />Por favor conecta tu Google Sheet en el paso 1.</span>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#16181D] text-[9px] text-[#9CA3AF] uppercase font-mono border-b border-[#2D2F36] z-10">
                    <tr>
                      <th className="p-2.5 pl-3">Nombre</th>
                      <th className="p-2.5 text-right pr-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="text-[11px] font-sans">
                    {filteredRecipients.map((rec) => {
                      // Check matching status of this recipient
                      const matchedPage = pages.find((p) => p.matchedRecipient?.name === rec.name);
                      let statusLabel = "ESPERANDO";
                      let statusClass = "text-slate-500";

                      if (matchedPage) {
                        if (matchedPage.status === "sent") {
                          statusLabel = "ENVIADO";
                          statusClass = "text-[#60A5FA]";
                        } else if (matchedPage.status === "sending") {
                          statusLabel = "ENTREGANDO";
                          statusClass = "text-indigo-400 animate-pulse";
                        } else if (matchedPage.status === "send_error") {
                          statusLabel = "ERROR ENVÍO";
                          statusClass = "text-rose-400 font-bold";
                        } else {
                          statusLabel = "LISTO (OK)";
                          statusClass = "text-emerald-400 font-medium";
                        }
                      }

                      return (
                        <tr key={rec.originalRowIndex} className="border-b border-[#2D2F36]/40 hover:bg-[#1C1F26] transition-colors">
                          <td className="p-2.5 pl-3 truncate max-w-[140px]" title={rec.name}>
                            <p className="font-medium text-white truncate">{rec.name}</p>
                            <span className="text-[9px] text-slate-500 font-mono block truncate">{rec.email}</span>
                          </td>
                          <td className={`p-2.5 text-right pr-3 font-mono text-[9px] font-bold ${statusClass}`}>
                            {statusLabel}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Compact overview statistics display at bottom panel */}
            <div className="p-4 bg-[#0B0C0E] border-t border-[#2D2F36] shrink-0 space-y-3">
              <span className="text-[10px] font-bold text-[#9CA3AF] uppercase block font-mono">Consola de Entrega Masiva</span>
              
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-[#16181D] p-2.5 rounded border border-[#2D2F36]">
                <div className="flex flex-col">
                  <span className="text-slate-500">Páginas de Canva:</span>
                  <span className="text-white font-bold">{pages.length}</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-slate-500">Emparejados:</span>
                  <span className="text-emerald-400 font-bold">{pages.filter((p) => p.matchedRecipient !== null).length}</span>
                </div>
              </div>

              {/* Action Buttons center - User approval explicitly required for emails */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleDownloadZIPProducts}
                  disabled={pages.length === 0}
                  className="w-full bg-[#1C1E24] hover:bg-[#252830] border border-[#2D2F36] text-white font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-40"
                >
                  <FileDown className="w-4 h-4 text-[#60A5FA]" />
                  <span>Descargar Lote (ZIP)</span>
                </button>

                <button
                  onClick={handleSendEmails}
                  disabled={isDelivering || pages.filter((p) => p.matchedRecipient !== null).length === 0}
                  className="w-full bg-gradient-to-r from-blue-600 to-[#8B5CF6] text-white font-extrabold py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all text-xs shadow-lg shadow-blue-900/40 hover:opacity-95 disabled:opacity-40"
                >
                  <Send className="w-4 h-4 shrink-0" />
                  <span>Enviar Correos Masivos</span>
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Global Metadata Footer information bar */}
      <footer className="shrink-0 border-t border-[#2D2F36] text-[10px] font-mono text-slate-500 py-3.5 px-6 flex justify-between items-center bg-[#0F1115]">
        <div className="flex items-center gap-1.5">
          <span>Integración con Google Workspace (OAuth 2.0)</span>
          <span className="text-[#60A5FA]">● Active</span>
        </div>
        <div className="flex items-center gap-4">
          <span>© 2026 CertiSend Pro. Todos los derechos reservados.</span>
          <button
            onClick={handleNavigateToPrivacy}
            className="text-slate-400 hover:text-white underline transition-colors cursor-pointer"
          >
            Política de Privacidad
          </button>
        </div>
      </footer>
    </div>
  );
}
