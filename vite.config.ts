import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Helper para obtener saldo de forma segura y tolerante a fallas en Node.js (entorno de compilación/Vite)
async function getBalanceFromStorage(): Promise<number> {
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  let dbFirebase: any = null;

  if (fs.existsSync(configPath)) {
    try {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const appFirebase = initializeApp(firebaseConfig);
      dbFirebase = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);
    } catch (e) {
      // Ignorar fallas al inicializar
    }
  }

  if (dbFirebase) {
    try {
      const docRef = doc(dbFirebase, "parkingStates", "global");
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && typeof data.balance === "number") {
          return data.balance;
        }
      }
    } catch (err) {
      // Ignorar fallas de conexión
    }
  }

  // Respaldo de estado local offline
  const fallbackPath = path.resolve(process.cwd(), "local-parking-state.json");
  if (fs.existsSync(fallbackPath)) {
    try {
      const raw = fs.readFileSync(fallbackPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.balance === "number") {
        return parsed.balance;
      }
    } catch (e) {
      // Ignorar error de parseo
    }
  }

  return 5.0; // Saldo por defecto
}

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'saldo-dev-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            
            // Interceptar /saldo y /api/saldo en el servidor de desarrollo de Vite
            if (url.pathname === '/saldo' || url.pathname === '/api/saldo') {
              try {
                const balance = await getBalanceFromStorage();
                
                // Si piden ?text=true o es /saldo con el parámetro text, retornar texto plano
                if (url.searchParams.has('text') && url.pathname === '/saldo') {
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.end(balance.toFixed(4));
                  return;
                }

                // De lo contrario, retornar siempre JSON estructurado
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Access-Control-Allow-Origin', '*'); // Permitir CORS
                res.end(JSON.stringify({
                  balance: parseFloat(balance.toFixed(4)),
                  formatted: `$${balance.toFixed(4)}`,
                  status: "success",
                  timestamp: Date.now()
                }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: "Error al obtener el saldo", status: "error" }));
              }
              return;
            }
            next();
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
