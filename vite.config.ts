import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// GRAVE 3(b) (correccion vuelta 31, 2026-10-06): el build de PRODUCCION ("vite build", mode
// "production" salvo --mode distinto) no debe poder salir con los textos legales o el pie del
// acuse de compra mostrando "[dato pendiente]" por haber olvidado una variable de entorno. Falla
// el build (nunca solo un warning) si falta cualquier VITE_PROVEEDOR_NOMBRE/DOC/DIR/TEL. En
// cualquier otro modo (dev, test) no actua: el fallback "[dato pendiente]" de
// src/utils/legalMarkdown.ts sigue funcionando igual que antes.
const VARIABLES_PROVEEDOR_REQUERIDAS = [
  'VITE_PROVEEDOR_NOMBRE',
  'VITE_PROVEEDOR_DOC',
  'VITE_PROVEEDOR_DIR',
  'VITE_PROVEEDOR_TEL',
] as const;

function exigirVariablesProveedorEnProduccion(mode: string): Plugin {
  return {
    name: 'certisend-exigir-proveedor-produccion',
    buildStart() {
      if (mode !== 'production') return;
      // `loadEnv` mezcla `.env*` de este directorio CON `process.env` (las variables reales del
      // proceso ganan) - asi el oraculo "con valores de prueba en una variable de entorno del
      // proceso, sin escribir archivos versionados" funciona igual que con un .env.production.local.
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const faltantes = VARIABLES_PROVEEDOR_REQUERIDAS.filter((clave) => !env[clave] || !env[clave].trim());
      if (faltantes.length > 0) {
        this.error(
          `[certisend] Build de produccion sin datos del proveedor: faltan ${faltantes.join(', ')}. ` +
            `Define estas variables (Secret Manager / .env.production.local / variables de entorno del ` +
            `proceso de build) antes de compilar para produccion.`
        );
      }
    },
  };
}

export default defineConfig(({mode}) => {
  return {
    plugins: [react(), tailwindcss(), exigirVariablesProveedorEnProduccion(mode)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
