import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// Helper para obtener saldo de forma segura y tolerante a fallas en Node.js (entorno de compilación/Vite)
async function getBalanceFromStorage(): Promise<number> {
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  let dbFirebase: any = null;
  let parsedState: any = null;
  let isFromFirestore = false;

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
        parsedState = docSnap.data();
        isFromFirestore = true;
      }
    } catch (err) {
      // Ignorar fallas de conexión
    }
  }

  const fallbackPath = path.resolve(process.cwd(), "local-parking-state.json");
  if (!parsedState && fs.existsSync(fallbackPath)) {
    try {
      const raw = fs.readFileSync(fallbackPath, "utf8");
      parsedState = JSON.parse(raw);
    } catch (e) {
      // Ignorar error de parseo
    }
  }

  if (!parsedState) {
    parsedState = {
      balance: 5.0,
      isActive: false,
      currentSessionId: null,
      history: [],
      totalDeposits: 5.0,
      totalSpent: 0,
      speedMultiplier: 1,
    };
  }

  // Calcular catch-up de tiempo transcurrido en segundo plano
  if (parsedState.isActive && parsedState.currentSessionId && parsedState.lastSavedTime) {
    const elapsedRealMs = Date.now() - parsedState.lastSavedTime;
    if (elapsedRealMs > 0) {
      const speed = parsedState.speedMultiplier || 1;
      const simDeltaMs = elapsedRealMs * speed;
      const RATE_PER_MS = 0.10 / (3600 * 1000); // $0.10 por hora
      const offlineCost = simDeltaMs * RATE_PER_MS;

      let finalState = { ...parsedState };

      if (offlineCost >= parsedState.balance) {
        const finalAffordableMs = parsedState.balance / RATE_PER_MS;
        const updatedHistory = (parsedState.history || []).map((s: any) => {
          if (s.id === parsedState.currentSessionId) {
            return {
              ...s,
              endTime: s.startTime + s.elapsedTimeMs + finalAffordableMs,
              elapsedTimeMs: s.elapsedTimeMs + finalAffordableMs,
              cost: s.cost + parsedState.balance,
              isActive: false,
            };
          }
          return s;
        });

        finalState = {
          ...parsedState,
          balance: 0,
          isActive: false,
          currentSessionId: null,
          history: updatedHistory,
          totalSpent: (parsedState.totalSpent || 0) + parsedState.balance,
          lastSavedTime: Date.now(),
        };
      } else {
        const updatedHistory = (parsedState.history || []).map((s: any) => {
          if (s.id === parsedState.currentSessionId) {
            return {
              ...s,
              elapsedTimeMs: s.elapsedTimeMs + simDeltaMs,
              cost: s.cost + offlineCost,
            };
          }
          return s;
        });

        finalState = {
          ...parsedState,
          balance: parsedState.balance - offlineCost,
          history: updatedHistory,
          totalSpent: (parsedState.totalSpent || 0) + offlineCost,
          lastSavedTime: Date.now(),
        };
      }

      parsedState = finalState;

      // Guardar de vuelta
      if (isFromFirestore && dbFirebase) {
        try {
          const docRef = doc(dbFirebase, "parkingStates", "global");
          await setDoc(docRef, parsedState);
        } catch (e) {
          // Ignorar fallas al guardar
        }
      }

      try {
        fs.writeFileSync(fallbackPath, JSON.stringify(parsedState, null, 2), "utf8");
      } catch (e) {
        // Ignorar
      }
    }
  }

  return parsedState.balance;
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
