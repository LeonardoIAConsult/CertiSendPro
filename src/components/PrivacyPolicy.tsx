import React from "react";
import { ShieldCheck, ArrowLeft, Mail, Lock, Server, FileText } from "lucide-react";

interface PrivacyPolicyProps {
  theme: "light" | "dark";
  onBack: () => void;
}

export default function PrivacyPolicy({ theme, onBack }: PrivacyPolicyProps) {
  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen font-sans ${isDark ? "bg-[#090A0D] text-slate-100" : "bg-gray-50 text-slate-800"}`}>
      {/* Header */}
      <header className={`border-b sticky top-0 backdrop-blur-md z-30 py-4 px-6 flex justify-between items-center ${
        isDark ? "bg-[#090A0D]/90 border-[#222530]" : "bg-white/90 border-gray-200 shadow-sm"
      }`}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-indigo-500" />
          <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 bg-clip-text text-transparent">
            CertiSend Pro
          </span>
        </div>
        <button
          onClick={onBack}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
            isDark
              ? "bg-[#13151F] hover:bg-[#202330] border-[#222530] text-gray-300"
              : "bg-white hover:bg-gray-100 border-gray-200 text-gray-700"
          }`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver al Inicio
        </button>
      </header>

      {/* Main Content Container */}
      <main className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        {/* Title */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-indigo-500/10 text-indigo-500">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Política de Privacidad
          </h1>
          <p className="text-sm text-slate-500 max-w-lg mx-auto">
            Última actualización: Julio 2026. En CertiSend Pro nos tomamos la seguridad y privacidad de tus datos con absoluta seriedad y rigor.
          </p>
        </div>

        {/* Highlight Banner */}
        <div className={`p-6 rounded-2xl border ${
          isDark ? "bg-[#13151F]/60 border-indigo-500/20" : "bg-indigo-50/50 border-indigo-100"
        } flex flex-col md:flex-row items-start gap-4`}>
          <div className="p-2 rounded-xl bg-indigo-500 text-white shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-sm">Procesamiento 100% Seguro y Efímero</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              CertiSend Pro no cuenta con bases de datos externas de almacenamiento persistente para tus contactos, correos electrónicos, ni archivos PDF. Todo el procesamiento se realiza en tiempo real bajo sesiones efímeras que se eliminan por completo del servidor de forma automatizada cada 2 horas.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-8 divide-y divide-slate-500/10">
          {/* Section 1 */}
          <div className="pt-8 first:pt-0 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-indigo-500">1.</span> Información que Recopilamos
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Únicamente accedemos a la información necesaria para el correcto funcionamiento de la plataforma a través de la autorización voluntaria que nos otorgas mediante Google OAuth:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-500 pl-4 space-y-2 leading-relaxed">
              <li><strong>Información de Perfil de Google:</strong> Tu nombre, dirección de correo electrónico y foto de perfil para identificar tu sesión de usuario activa.</li>
              <li><strong>Datos de Hojas de Cálculo (Google Sheets):</strong> Exclusivamente las celdas de la hoja de cálculo que selecciones, con el fin de extraer los destinatarios (nombres y correos electrónicos).</li>
              <li><strong>Servicio de Correo (Gmail API):</strong> Enviamos correos electrónicos directamente desde tu cuenta de Gmail únicamente a los destinatarios que apruebes en la consola, adjuntando su certificado respectivo.</li>
            </ul>
          </div>

          {/* Section 2 */}
          <div className="pt-8 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-indigo-500">2.</span> Uso de los Datos del Usuario de Google (Google User Data)
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              CertiSend Pro cumple estrictamente con la <strong>Política de Datos del Usuario de los Servicios de Google API</strong>, incluyendo los requisitos de uso limitado. El uso de los datos obtenidos a través de las APIs de Google se apega a las siguientes reglas:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={`p-4 rounded-xl border ${isDark ? "bg-[#111219] border-[#222530]" : "bg-white border-gray-100 shadow-sm"} space-y-2`}>
                <div className="flex items-center gap-2 text-indigo-500">
                  <FileText className="w-4 h-4" />
                  <span className="font-bold text-xs">Lectura de Google Sheets</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Solo leemos las pestañas y columnas que nos indiques en la interfaz. Esta información permanece únicamente en la memoria volátil de tu navegador y sesión de backend activa y nunca es guardada o transferida a terceros.
                </p>
              </div>

              <div className={`p-4 rounded-xl border ${isDark ? "bg-[#111219] border-[#222530]" : "bg-white border-gray-100 shadow-sm"} space-y-2`}>
                <div className="flex items-center gap-2 text-indigo-500">
                  <Mail className="w-4 h-4" />
                  <span className="font-bold text-xs">Envío de Correos con Gmail</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Los correos se envían directamente utilizando la API oficial de Gmail mediante tu token de acceso OAuth seguro. No leemos tus correos entrantes, ni revisamos tu bandeja de entrada. Únicamente realizamos peticiones salientes para despachar los diplomas.
                </p>
              </div>
            </div>
          </div>

          {/* Section 3 */}
          <div className="pt-8 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-indigo-500">3.</span> Transferencia e Intercambio de Datos
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              <strong>Bajo ninguna circunstancia vendemos, alquilamos, distribuimos ni compartimos tus datos</strong> personales o de tus contactos con terceros. Los nombres extraídos de los certificados se envían de forma segura y encriptada (HTTPS) a la API oficial de Inteligencia Artificial de Google (Gemini) con el único fin de realizar la lectura automatizada del texto. Ninguno de estos datos se utiliza para entrenar modelos de IA de carácter público.
            </p>
          </div>

          {/* Section 4 */}
          <div className="pt-8 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-indigo-500">4.</span> Retención y Seguridad de Archivos
            </h2>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="p-3 bg-indigo-500/10 text-indigo-500 rounded-xl self-start">
                <Server className="w-5 h-5" />
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                Los archivos PDF que subes para segmentar se almacenan en un búfer efímero en la memoria RAM del servidor. Este búfer cuenta con un recolector de basura automático que purga cualquier residuo una vez transcurridas 2 horas desde el inicio de la carga, o inmediatamente cuando cierras la aplicación. Los datos de Google Sheets no se almacenan en absoluto en el servidor; se recuperan dinámicamente y se retienen solo en tu sesión activa de navegador (local state).
              </p>
            </div>
          </div>

          {/* Section 5 */}
          <div className="pt-8 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-indigo-500">5.</span> Revocación de Accesos
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Puedes revocar el acceso de CertiSend Pro a tus cuentas de Google en cualquier momento ingresando a la configuración de seguridad de tu cuenta de Google en <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Aplicaciones con acceso a tu cuenta</a>. Esto cerrará tu sesión de inmediato y eliminará cualquier credencial activa en la aplicación.
            </p>
          </div>

          {/* Section 6 */}
          <div className="pt-8 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-indigo-500">6.</span> Contacto y Soporte
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Si tienes preguntas, sugerencias o inquietudes sobre el procesamiento de datos y la seguridad de CertiSend Pro, por favor contáctanos directamente:
            </p>
            <div className={`p-4 rounded-xl border max-w-md ${isDark ? "bg-[#111219] border-[#222530]" : "bg-white border-gray-100 shadow-sm"} flex items-center gap-3`}>
              <Mail className="w-5 h-5 text-indigo-500" />
              <div>
                <p className="text-xs font-bold">Correo Electrónico de Asistencia</p>
                <a href="mailto:leonardoantolinezpizon@gmail.com" className="text-xs text-indigo-500 hover:underline font-mono">
                  leonardoantolinezpizon@gmail.com
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info inside Privacy page */}
        <div className="border-t border-slate-500/10 pt-8 text-center text-xs text-slate-500">
          <p>© 2026 CertiSend Pro. Todos los derechos reservados.</p>
        </div>
      </main>
    </div>
  );
}
