// Pagina generica para /terminos y /privacidad (Tarea 11, cobro real con planes, 2026-10-05).
// Reemplaza a PrivacyPolicy.tsx (version de julio de 2026, con texto falso sobre almacenamiento —
// ver H11/B30 en docs/legal/textos-checkout.md): esta version NUNCA tiene su propio texto legal
// fijo, siempre renderiza el markdown que le pasan (src/legal/terminos.md o privacidad.md),
// despues de sustituir los placeholders {{PROVEEDOR_*}} con las variables VITE_PROVEEDOR_* del
// build (nunca inventadas; si faltan, "[dato pendiente]" — ver src/utils/legalMarkdown.ts).
import React from "react";
import { ShieldCheck, ArrowLeft, FileText } from "lucide-react";
import { markdownAHtml, reemplazarPlaceholdersProveedor } from "../utils/legalMarkdown";

interface LegalPageProps {
  theme: "light" | "dark";
  titulo: string;
  markdown: string;
  onBack: () => void;
  onNavigateOtra: () => void;
  tituloOtra: string;
}

export default function LegalPage({
  theme,
  titulo,
  markdown,
  onBack,
  onNavigateOtra,
  tituloOtra,
}: LegalPageProps) {
  const isDark = theme === "dark";

  // Las variables de entorno del PROVEEDOR nunca se hardcodean (igual que server/avisos.ts): se
  // leen de VITE_PROVEEDOR_* en build (desde .env.production.local, que NO se commitea). Sin
  // ninguna, cada placeholder del markdown queda "[dato pendiente]" — el build nunca falla por
  // esto (ver reemplazarPlaceholdersProveedor).
  const html = React.useMemo(
    () =>
      markdownAHtml(
        reemplazarPlaceholdersProveedor(markdown, {
          nombre: import.meta.env.VITE_PROVEEDOR_NOMBRE,
          documento: import.meta.env.VITE_PROVEEDOR_DOC,
          direccion: import.meta.env.VITE_PROVEEDOR_DIR,
          telefono: import.meta.env.VITE_PROVEEDOR_TEL,
        })
      ),
    [markdown]
  );

  return (
    <div className={`min-h-screen font-sans ${isDark ? "bg-[#090A0D] text-slate-100" : "bg-gray-50 text-slate-800"}`}>
      <header
        className={`border-b sticky top-0 backdrop-blur-md z-30 py-4 px-6 flex justify-between items-center ${
          isDark ? "bg-[#090A0D]/90 border-[#222530]" : "bg-white/90 border-gray-200 shadow-sm"
        }`}
      >
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
          Volver al inicio
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-500">
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{titulo}</h1>
        </div>

        {/* El markdown ya viene convertido a HTML seguro (legalMarkdown.ts escapa < > & antes de
            generar cualquier etiqueta): es nuestro propio contenido (src/legal/*.md), nunca texto
            de un usuario. */}
        <div
          className={`space-y-4 leading-relaxed text-sm [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_hr]:my-6 [&_hr]:border-dashed ${
            isDark ? "[&_hr]:border-[#222530] [&_a]:text-indigo-400" : "[&_hr]:border-gray-200 [&_a]:text-indigo-600"
          } [&_a]:underline [&_a]:font-semibold [&_strong]:font-bold`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>

      <footer
        className={`py-8 text-center text-xs border-t ${
          isDark ? "bg-[#090A0D] border-[#222530] text-slate-500" : "bg-gray-100 border-gray-200 text-slate-500"
        }`}
      >
        <div className="flex justify-center gap-4">
          <button onClick={onBack} className="text-indigo-500 hover:underline font-semibold">
            Inicio
          </button>
          <button onClick={onNavigateOtra} className="text-indigo-500 hover:underline font-semibold">
            {tituloOtra}
          </button>
        </div>
      </footer>
    </div>
  );
}
