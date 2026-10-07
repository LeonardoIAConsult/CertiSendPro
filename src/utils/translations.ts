export interface TranslationDict {
  // Common
  appName: string;
  loginWithGoogle: string;
  logout: string;
  workspace: string;
  tagline: string;
  english: string;
  spanish: string;
  lightMode: string;
  darkMode: string;
  
  // Landing Page
  heroTitle: string;
  heroSub: string;
  startFree: string;
  // GRAVE 3(c) (correccion vuelta 31, 2026-10-06): titulo del boton de login/empezar cuando la
  // casilla de autorizacion de datos (T11) todavia no esta marcada.
  autorizacionDatosRequerida: string;
  seeDemo: string;
  featuresTitle: string;
  featuresSub: string;
  feat1Title: string;
  feat1Desc: string;
  feat2Title: string;
  feat2Desc: string;
  feat3Title: string;
  feat3Desc: string;
  feat4Title: string;
  feat4Desc: string;
  
  // Security Section
  securityTitle: string;
  securitySub: string;
  sec1Title: string;
  sec1Desc: string;
  sec2Title: string;
  sec2Desc: string;
  sec3Title: string;
  sec3Desc: string;

  // Pricing Section
  pricingTitle: string;
  pricingSub: string;
  buyNow: string;

  // Plans
  planFreeName: string;
  planFreePrice: string;
  planFreeFeature1: string;
  planFreeFeature2: string;
  planFreeFeature3: string;

  // Paquete (Tarea 11, cobro real con planes, 2026-10-05): planPayGoPrice se retira — el precio
  // real en COP del dia se calcula en LandingPage.tsx con /api/precios (nunca un "$0,10 USD por
  // envio" fijo, H5); planPayGoPriceCargando es el texto mientras ese precio no ha llegado (lo
  // reusa tambien la tarjeta de Pago por uso: el mensaje es generico, "calculando el precio").
  // Paso 16B (decision de Leonardo 2026-10-06): "Pro" desaparece de la UI — planPaqueteUsdGrande
  // es el precio principal en USD, grande ("US$15 · 150 envíos"); precioCopHoyNota/
  // precioCopPorEnvioNota (abajo, seccion Pricing/Checkout) son la linea en COP, siempre visible
  // y mas chica, justo debajo.
  planPayGoName: string;
  planPaqueteUsdGrande: string;
  planPayGoPriceCargando: string;
  planPayGoPriceError: string;
  planPayGoFeature1: string;
  planPayGoFeature2: string;
  planPayGoFeature3: string;
  planPayGoFeature4: string;
  planPayGoFeature5: string;

  // Pago por uso (Paso 16B, decision de Leonardo 2026-10-06): US$0,15 por envío, mínimo 50,
  // máximo 5000 por compra, saldo SIN vencimiento y ACUMULABLE. planPagoPorUsoUsdGrande es el
  // precio principal en USD, grande ("US$0,15 / envío"); planPagoPorUsoMinimoNota usa {minimo}
  // (reemplazado en LandingPage.tsx con `precios.porUso.minimo`).
  planPagoPorUsoName: string;
  planPagoPorUsoUsdGrande: string;
  planPagoPorUsoMinimoNota: string;
  planPagoPorUsoFeature1: string;
  planPagoPorUsoFeature2: string;
  planPagoPorUsoFeature3: string;
  planPagoPorUsoFeature4: string;
  // Boton de la tarjeta cuando `pagosActivos` esta encendido (abre el panel); con pagos apagados
  // la tarjeta sigue usando `buyNow` (mailto), igual que el Paquete.
  buyPorUso: string;

  // FAQ Section
  faqTitle: string;
  faqSub: string;
  faq1Q: string;
  faq1A: string;
  faq2Q: string;
  faq2A: string;
  faq3Q: string;
  faq3A: string;
  faq4Q: string;
  faq4A: string;

  // Footer. `footerText` usa el marcador `{proveedor}`, reemplazado en LandingPage.tsx con
  // `VITE_PROVEEDOR_NOMBRE` (Verify v2 sobre ad80fd6, hallazgo Bajo: nunca hardcodear el nombre
  // legal del proveedor en un archivo versionado — mismo criterio que shared/textosCasillas.ts).
  footerText: string;
  footerRights: string;

  // Limites de plan al enviar un lote (Tarea 3, cobro real con planes, 2026-10-05). Paso 16B:
  // batchLimitSaldo ahora menciona las DOS fuentes de saldo pagado ({paquete}/{porUso}/{total}),
  // nunca solo una — reemplazados en src/utils/plan.ts (`formatearMotivoRechazoLote`).
  batchLimitFree: string;
  batchLimitSaldo: string;
  // Opciones cuando se rechaza un lote (Tarea 10): dividirlo o ver los planes disponibles.
  batchLimitOpciones: string;

  // Vista "Mi plan" (Tarea 10, cobro real con planes, 2026-10-05). miPlanPaquete usa {restantes}
  // y {fecha} (reemplazados en src/utils/plan.ts). Paso 16B: miPlanSaldoPorUso usa {saldo} — se
  // muestra APARTE del Paquete (las dos fuentes son independientes, nunca una sustituye a la
  // otra); "Pro" desaparece (miPlanPro se retira).
  miPlanGratis: string;
  miPlanPaquete: string;
  miPlanPaqueteNota: string;
  miPlanSaldoPorUso: string;

  // Volver de Mercado Pago (Tarea 10): estados del sondeo contra /api/cuenta.
  pagoConfirmando: string;
  pagoActivo: string;
  pagoRevision: string;
  pagoRechazado: string;
  // G5 (NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10, 2026-10-05): sin sesion real de
  // Firebase no se sondea nada (se mentiria con "confirmando"/"en revision"); se pide iniciar
  // sesion.
  pagoSinSesion: string;

  // Panel de checkout del Paquete (M30, cobro real con planes, corrige vuelta 24). Solo se
  // muestra con PAGOS_ACTIVOS encendido (ver `/api/precios` -> `pagosActivos`); con pagos
  // apagados el boton del Paquete sigue mandando a `buyNow` (mailto). Textos citados de
  // `docs/legal/textos-checkout.md` v1.2 (T1/T4/T5); `checkoutReferencia`/`checkoutTrmNota` usan
  // {usd}/{trm}/{fecha}, `checkoutPrecioCambio` usa {anterior}/{nuevo} (reemplazados en
  // LandingPage.tsx).
  buyPaquete: string;
  checkoutPaqueteTitle: string;
  checkoutReferencia: string;
  checkoutTrmNota: string;
  checkoutVerTerminos: string;
  checkoutPrecioCambio: string;
  checkoutPagar: string;
  checkoutCerrar: string;
  checkoutErrorGenerico: string;
  checkoutSinPrecios: string;

  // Linea "Se cobra $X COP a la TRM del DD/MM" (Paso 16B, punto 1): siempre visible, mas chica,
  // justo debajo del precio grande en USD. precioCopHoyNota es el TOTAL (Paquete, o el total del
  // panel de Pago por uso); precioCopPorEnvioNota es el valor POR UNIDAD (solo la tarjeta de
  // Pago por uso, antes de elegir cantidad) — ambos usan {cop} y {fecha}.
  precioCopHoyNota: string;
  precioCopPorEnvioNota: string;

  // Panel de checkout de "Pago por uso" (Paso 16B, 2026-10-07): selector de cantidad (50-5000,
  // enteros, botones +/-10), total en vivo en USD y COP, mismas casillas que el Paquete pero con
  // `textoCasillaRetractoPorUso`. checkoutCantidadInvalida usa {minimo}/{maximo}.
  checkoutPorUsoTitle: string;
  checkoutCantidadLabel: string;
  checkoutCantidadInvalida: string;
  checkoutPorUsoTotalUsd: string;
  // Reemplaza, SOLO en el panel de Pago por uso, a `checkoutVencimientoNota` (que habla del
  // vencimiento del Paquete): el saldo Por uso nunca vence (R3 del punto 2 del encargo).
  checkoutSaldoNoVenceNota: string;

  // O3 (Dictamen Abogado_LAP ronda 5, 2026-10-06, Alto; T1/T3/T6 de
  // docs/legal/textos-checkout.md): "precio total, sin cargos adicionales" (tarjeta Y panel de
  // pago), "pago único" y el vencimiento con la perdida de los envios no usados — Terminos
  // §6.2/§4.5 ya lo prometian, la pantalla no lo mostraba.
  checkoutPrecioTotalSinCargos: string;
  // Bajo (verificacion ronda 5, 2026-10-06): la tarjeta del Paquete usa esta clave incluso con
  // PAGOS_ACTIVOS apagado (boton = mailto, no hay pago real hoy) — "Total a pagar hoy" quedaba mal
  // ahi; con pagos apagados la tarjeta usa esta clave en su lugar (LandingPage.tsx).
  checkoutPrecioDeHoySinCargos: string;
  checkoutPagoUnicoNota: string;
  checkoutVencimientoNota: string;
  checkoutMercadoPagoNota: string;
}

export type Lang = "es" | "en";

export const translations: Record<Lang, TranslationDict> = {
  es: {
    appName: "CertiSend Pro",
    loginWithGoogle: "Ingresar con Google",
    logout: "Cerrar sesión",
    workspace: "Consola de Trabajo",
    // R6 ampliada de docs/legal/textos-checkout.md v1.2 (N2, Tarea 11, 2026-10-05): textos
    // revisados para que ninguno prometa algo que la app no hace de verdad.
    tagline: "Certificados personalizados, enviados desde tu propio Gmail",
    english: "English",
    spanish: "Español",
    lightMode: "Modo Claro",
    darkMode: "Modo Oscuro",

    heroTitle: "Envía cientos de certificados personalizados desde tu propio Gmail",
    heroSub: "Sube un solo PDF con todos los diplomas, tarjetas, invitaciones, certificados o lo que quieras enviar, conecta tu Google Sheet donde está la lista de personas a quien le quieres enviar el documento personalizado, y CertiSend Pro empareja cada certificado con su destinatario, tú lo revisas y se envía desde tu Gmail.",
    startFree: "Comenzar Gratis",
    seeDemo: "Ver Planes y Precios",

    featuresTitle: "Características Premium",
    featuresSub: "CertiSend Pro es una herramienta diseñada para automatizar el envío de tu flujo de PDF´s sin esfuerzo.",
    feat1Title: "Segmentación Inteligente",
    feat1Desc: "Sube un PDF masivo. Nuestro sistema divide el archivo en Los PDF´s individuales de forma instantánea.",
    feat2Title: "Lectura de Google Sheets",
    feat2Desc: "Conéctate de forma directa y segura con tus hojas de cálculo (sheet) online, para leer nombres y correos.",
    feat3Title: "Escaneo con IA",
    feat3Desc: "CertiSend lee el nombre con IA y te deja revisarlo antes de enviar.",
    feat4Title: "Envío desde tu Gmail",
    feat4Desc: "Envía correos personalizados directamente desde tu cuenta de Gmail con el certificado adjunto.",

    securityTitle: "Cómo cuidamos tus datos",
    securitySub: "Lo que guardamos, lo que no y quién más los procesa, sin letra pequeña.",
    sec1Title: "Tus listas y certificados no se guardan",
    // O11 (Dictamen Abogado_LAP ronda 5, 2026-10-06, Bajo): "Guardamos solo..." omitia que
    // tambien se guarda la prueba de lo que el usuario acepto/confirmo (aceptaciones,
    // autorizaciones, aceptacionesUso — ver Política de Privacidad §3).
    sec1Desc: "Tu lista de destinatarios no se guarda en nuestros servidores y tus PDF se borran solos en unas 2 horas. Guardamos tu cuenta, tu plan, tus pagos y la prueba de lo que aceptaste y confirmaste, como explica la Política de Privacidad.",
    sec2Title: "Conexión Directa de API",
    sec2Desc: "La aplicación utiliza tokens de acceso temporales directos de Google OAuth 2.0. Los correos se envían desde tu propia bandeja de salida de Gmail.",
    sec3Title: "Tu sesión es tuya",
    sec3Desc: "Tus archivos y tu lista se procesan solo en tu sesión; no los mostramos a otros usuarios.",

    pricingTitle: "Planes Sencillos y Transparentes",
    // O11 (Dictamen Abogado_LAP ronda 5, 2026-10-06, Bajo): v1 no tiene nada que cancelar (pago
    // único, sin suscripcion) — "cancelas cuando quieres" sugiere una suscripcion que no existe.
    pricingSub: "Sin permanencia: pagas una vez y no hay nada que cancelar.",
    buyNow: "Hablemos de este plan",

    planFreeName: "Plan Gratuito",
    planFreePrice: "$0",
    planFreeFeature1: "Hasta 15 certificados por lote",
    planFreeFeature2: "Asunto y cuerpo del correo personalizados",
    planFreeFeature3: "Lectura de nombres con IA",

    planPayGoName: "Paquete",
    planPaqueteUsdGrande: "US$15 · 150 envíos",
    planPayGoPriceCargando: "Calculando el precio de hoy…",
    planPayGoPriceError: "Escríbenos para el precio de hoy",
    planPayGoFeature1: "150 envíos con éxito para lotes de más de 15",
    planPayGoFeature2: "Los lotes de 15 o menos siguen siendo gratis y no gastan el Paquete",
    planPayGoFeature3: "Válidos 1 mes o hasta gastarlos; no se acumulan",
    planPayGoFeature4: "Pago único",
    planPayGoFeature5: "Los envíos que fallan no se descuentan",

    planPagoPorUsoName: "Pago por uso",
    planPagoPorUsoUsdGrande: "US$0,15 / envío",
    planPagoPorUsoMinimoNota: "mínimo {minimo} envíos · tu saldo no vence",
    planPagoPorUsoFeature1: "Compra entre 50 y 5.000 envíos",
    planPagoPorUsoFeature2: "Tu saldo nunca vence y se acumula entre compras",
    planPagoPorUsoFeature3: "Los lotes de 15 o menos siguen siendo gratis",
    planPagoPorUsoFeature4: "Pago único, sin suscripción",
    buyPorUso: "Comprar saldo",

    faqTitle: "Preguntas Frecuentes",
    faqSub: "Resolvemos tus dudas sobre el funcionamiento y la seguridad de la plataforma.",
    faq1Q: "¿Cómo reconoce el sistema los nombres en los diplomas?",
    faq1A: "Usamos IA (Gemini, de Google) para leer el nombre en cada página y compararlo con tu lista. Puede equivocarse: por eso te mostramos cada certificado con el nombre y el correo de su destinatario para que lo revises antes de enviar.",
    faq2Q: "¿Mis contactos o PDFs se guardan en sus servidores?",
    faq2A: "Tus PDF se borran solos en unas 2 horas y tu lista no se guarda en nuestros servidores. Tu cuenta y tus pagos se guardan según la Política de Privacidad.",
    faq3Q: "¿Cómo funciona el envío masivo?",
    faq3A: "Se envía con la API oficial de Gmail: el correo sale desde tu propia cuenta de Gmail, con tu dirección.",
    faq4Q: "¿Cuáles son los métodos de pago aceptados?",
    faq4A: "Pagos en pesos colombianos con Mercado Pago, con los medios que Mercado Pago muestre al pagar.",

    footerText: "CertiSend Pro es un servicio de {proveedor} para enviar certificados desde tu propio Gmail.",
    footerRights: "Todos los derechos reservados.",

    autorizacionDatosRequerida: "Marca la casilla de autorización de datos para continuar.",
    batchLimitFree: "El plan Gratis permite hasta 15 certificados por lote. Puedes dividirlo o escribirnos.",
    batchLimitSaldo: "Tienes {paquete} del Paquete y {porUso} de Pago por uso ({total} en total) y el lote es de {lote}.",
    batchLimitOpciones: "Puedes dividir el lote en partes de 15 o menos, o escribirnos a contacto@leonardoantolinez.com para ver los planes.",

    miPlanGratis: "Plan Gratis · hasta 15 certificados por lote",
    miPlanPaquete: "Paquete · te quedan {restantes} envíos · vencen el {fecha}",
    miPlanPaqueteNota: "Los lotes de 15 certificados o menos no gastan tu saldo.",
    miPlanSaldoPorUso: "Saldo por uso: {saldo} envíos (no vence)",

    pagoConfirmando: "Estamos confirmando tu pago…",
    pagoActivo: "¡Pago confirmado! Tu plan ya está activo.",
    // M32 (corrige vuelta 26): mientras no haya relay de avisos configurado en produccion (Tarea
    // 5, docs/relay/README.md), este texto NO puede prometer un correo que todavia no sale.
    pagoRevision: "Si ya pagaste, tu plan se activará en unos minutos; recarga o escríbenos a contacto@leonardoantolinez.com.",
    pagoRechazado: "No se realizó ningún cobro.",
    pagoSinSesion: "Inicia sesión para ver el estado de tu pago.",

    buyPaquete: "Comprar paquete",
    checkoutPaqueteTitle: "Paquete · 150 envíos",
    checkoutReferencia: "Referencia US${usd}",
    checkoutTrmNota: "TRM {trm} COP, vigente el {fecha}",
    checkoutVerTerminos: "Ver Términos y Condiciones",
    checkoutPrecioCambio: "El precio cambió: antes ${anterior} COP, ahora ${nuevo} COP. Revisa y vuelve a marcar las casillas.",
    checkoutPagar: "Pagar",
    checkoutCerrar: "Cerrar",
    checkoutErrorGenerico: "No se pudo iniciar el pago con Mercado Pago.",
    checkoutSinPrecios: "No podemos calcular el precio de hoy; intenta más tarde.",

    precioCopHoyNota: "Se cobra ${cop} COP a la TRM del {fecha}.",
    precioCopPorEnvioNota: "Se cobra ~${cop} COP por envío a la TRM del {fecha}.",

    checkoutPorUsoTitle: "Pago por uso",
    checkoutCantidadLabel: "Cantidad de envíos",
    checkoutCantidadInvalida: "Ingresa un número entero entre {minimo} y {maximo}.",
    checkoutPorUsoTotalUsd: "Total US${usd}",
    checkoutSaldoNoVenceNota: "Importante: este saldo no vence y se acumula con compras futuras. Los envíos que no uses quedan disponibles para siempre.",

    checkoutPrecioTotalSinCargos: "Total a pagar hoy · precio total, sin cargos adicionales.",
    checkoutPrecioDeHoySinCargos: "Precio de hoy · precio total, sin cargos adicionales.",
    checkoutPagoUnicoNota: "Pago único: no se renueva y no habrá más cobros. Se activa cuando Mercado Pago confirme el pago.",
    checkoutVencimientoNota: "Importante: tus 150 envíos vencen un mes después de confirmarse el pago o cuando los gastes, lo que ocurra primero. Los envíos que no uses se pierden y no se acumulan.",
    checkoutMercadoPagoNota: "Pagas con Mercado Pago. CertiSend no ve ni guarda los datos de tu tarjeta.",
  },
  en: {
    appName: "CertiSend Pro",
    loginWithGoogle: "Login with Google",
    logout: "Log out",
    workspace: "Workspace Console",
    // R6 ampliada de docs/legal/textos-checkout.md v1.2 (N2, Tarea 11, 2026-10-05): courtesy
    // translation, same corrections as the ES block above.
    tagline: "Personalized certificates, sent from your own Gmail",
    english: "English",
    spanish: "Español",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",

    heroTitle: "Send hundreds of personalized certificates from your own Gmail",
    heroSub: "Upload a single PDF containing all diplomas, cards, invitations, certificates, or whatever you want to send, connect your Google Sheet where the list of people you want to send the personalized document to is located, and CertiSend Pro matches each certificate to its recipient, you review it, and it is sent from your Gmail.",
    startFree: "Start for Free",
    seeDemo: "See Plans & Pricing",

    featuresTitle: "Premium Features",
    featuresSub: "CertiSend Pro is a tool designed to automate your PDF delivery workflow completely hassle-free.",
    feat1Title: "Smart PDF Splitting",
    feat1Desc: "Upload a bulk PDF file. Our system immediately splits it into individual PDFs.",
    feat2Title: "Google Sheets Integration",
    feat2Desc: "Connect directly and securely to your online spreadsheets (sheets) to fetch recipient names and emails instantly.",
    feat3Title: "AI Scanning",
    feat3Desc: "CertiSend reads the name with AI and lets you review it before sending.",
    feat4Title: "Sent from your Gmail",
    feat4Desc: "Send personalized emails directly from your own Gmail account with the certificate attached.",

    securityTitle: "How we look after your data",
    securitySub: "What we keep, what we don't, and who else processes it, no fine print.",
    sec1Title: "Your lists and certificates are not stored",
    sec1Desc: "Your recipient list is not stored on our servers and your PDFs are deleted automatically within about 2 hours. We keep your account, plan, payments, and proof of what you accepted and confirmed, as explained in the Privacy Policy.",
    sec2Title: "Direct API Integration",
    sec2Desc: "The app relies on temporary secure access tokens from Google OAuth 2.0. Emails are dispatched directly from your own Gmail outbox.",
    sec3Title: "Your session is yours",
    sec3Desc: "Your files and list are processed only in your session; we don't show them to other users.",

    pricingTitle: "Simple and Transparent Pricing",
    pricingSub: "No minimum term: you pay once and there's nothing to cancel.",
    buyNow: "Let's talk about this plan",

    planFreeName: "Free Plan",
    planFreePrice: "$0",
    planFreeFeature1: "Up to 15 certificates per batch",
    planFreeFeature2: "Custom subject and body",
    planFreeFeature3: "AI name reading",

    planPayGoName: "Bundle",
    planPaqueteUsdGrande: "US$15 · 150 sends",
    planPayGoPriceCargando: "Calculating today's price…",
    planPayGoPriceError: "Write to us for today's price",
    planPayGoFeature1: "150 successful sends for batches over 15",
    planPayGoFeature2: "Batches of 15 or fewer stay free and never spend the Bundle",
    planPayGoFeature3: "Valid for 1 month or until used up; unused sends do not roll over",
    planPayGoFeature4: "One-time payment",
    planPayGoFeature5: "Failed sends are never deducted",

    planPagoPorUsoName: "Pay-as-you-go",
    planPagoPorUsoUsdGrande: "US$0.15 / send",
    planPagoPorUsoMinimoNota: "minimum {minimo} sends · your balance never expires",
    planPagoPorUsoFeature1: "Buy between 50 and 5,000 sends",
    planPagoPorUsoFeature2: "Your balance never expires and rolls over between purchases",
    planPagoPorUsoFeature3: "Batches of 15 or fewer stay free",
    planPagoPorUsoFeature4: "One-time payment, no subscription",
    buyPorUso: "Buy balance",

    faqTitle: "Frequently Asked Questions",
    faqSub: "Answering your common questions about how the platform works and its security.",
    faq1Q: "How does the system recognize names on certificates?",
    faq1A: "We use AI (Google's Gemini) to read the name on each page and compare it with your list. It can make mistakes, so we show you each certificate with its recipient's name and email for you to review before sending.",
    faq2Q: "Are my contacts or PDFs saved on your servers?",
    faq2A: "Your PDFs are deleted automatically within about 2 hours and your list is not stored on our servers. Your account and payments are kept as described in the Privacy Policy.",
    faq3Q: "How does the bulk emailing work?",
    faq3A: "It is sent through the official Gmail API: the email goes out from your own Gmail account, with your address.",
    faq4Q: "What payment methods are supported?",
    faq4A: "Payments in Colombian pesos through Mercado Pago, with the methods Mercado Pago shows at checkout.",

    footerText: "CertiSend Pro is a service by {proveedor} to send certificates from your own Gmail.",
    footerRights: "All rights reserved.",

    autorizacionDatosRequerida: "Check the data-authorization box to continue.",
    batchLimitFree: "The Free plan allows up to 15 certificates per batch. You can split it or email us.",
    batchLimitSaldo: "You have {paquete} from the Bundle and {porUso} from Pay-as-you-go ({total} total) and this batch has {lote}.",
    batchLimitOpciones: "You can split the batch into parts of 15 or fewer, or email us at contacto@leonardoantolinez.com to see the plans.",

    miPlanGratis: "Free plan · up to 15 certificates per batch",
    miPlanPaquete: "Bundle · {restantes} sends left · expires {fecha}",
    miPlanPaqueteNota: "Batches of 15 or fewer never spend your balance.",
    miPlanSaldoPorUso: "Pay-as-you-go balance: {saldo} sends (never expires)",

    pagoConfirmando: "We're confirming your payment…",
    pagoActivo: "Payment confirmed! Your plan is now active.",
    // M32 (corrige vuelta 26): same reason as the ES string above.
    pagoRevision: "If you already paid, your plan will activate in a few minutes; refresh or email us at contacto@leonardoantolinez.com.",
    pagoRechazado: "No charge was made.",
    pagoSinSesion: "Sign in to see your payment status.",

    buyPaquete: "Buy bundle",
    checkoutPaqueteTitle: "Bundle · 150 sends",
    checkoutReferencia: "Reference US${usd}",
    checkoutTrmNota: "TRM {trm} COP, effective {fecha}",
    checkoutVerTerminos: "View Terms and Conditions",
    checkoutPrecioCambio: "The price changed: before COP ${anterior}, now COP ${nuevo}. Please review and tick the boxes again.",
    checkoutPagar: "Pay",
    checkoutCerrar: "Close",
    checkoutErrorGenerico: "We couldn't start the payment with Mercado Pago.",
    checkoutSinPrecios: "We couldn't get today's price; please try again later.",

    precioCopHoyNota: "Charged as COP ${cop} at today's exchange rate ({fecha}).",
    precioCopPorEnvioNota: "Charged as ~COP ${cop} per send at today's exchange rate ({fecha}).",

    checkoutPorUsoTitle: "Pay-as-you-go",
    checkoutCantidadLabel: "Number of sends",
    checkoutCantidadInvalida: "Enter a whole number between {minimo} and {maximo}.",
    checkoutPorUsoTotalUsd: "Total US${usd}",
    checkoutSaldoNoVenceNota: "Important: this balance never expires and rolls over with future purchases. Unused sends stay available forever.",

    // O3 (sin "even if you renew": v1 solo tiene el Paquete de pago único, nunca renovable — ver
    // el dictamen, que pide quitar esa clausula de la frase EN de T6).
    checkoutPrecioTotalSinCargos: "Total due today · total price, no additional charges.",
    checkoutPrecioDeHoySinCargos: "Today's price · total price, no additional charges.",
    checkoutPagoUnicoNota: "One-time payment: it does not renew and there will be no further charges. It's activated once Mercado Pago confirms the payment.",
    checkoutVencimientoNota: "Important: your 150 sends expire one month after the payment is confirmed or when used up, whichever comes first. Unused sends are lost and do not carry over.",
    checkoutMercadoPagoNota: "Payment is processed by Mercado Pago. CertiSend never sees or stores your card details.",
  }
};
