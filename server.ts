/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Habilitar CORS para permitir peticiones desde cualquier origen (red local u otros clientes)
  app.use(cors());
  app.use(express.json());

  // Almacenamiento local centralizado en disco
  const DATA_DIR = path.join(process.cwd(), "data");
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.error("Error al crear carpeta data local:", e);
    }
  }
  const PRIMARY_LOCAL_FILE = path.join(DATA_DIR, "parking-state.json");
  const ROOT_FALLBACK_FILE = path.join(process.cwd(), "local-parking-state.json");

  // Función para guardar el estado local de forma atómica y segura contra cortes de energía
  function saveLocalStateAtomically(state: any) {
    const jsonStr = JSON.stringify(state, null, 2);
    const tempFile = path.join(DATA_DIR, `parking-state.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
      fs.writeFileSync(tempFile, jsonStr, "utf8");
      fs.renameSync(tempFile, PRIMARY_LOCAL_FILE);
    } catch {
      // Si falla renameSync (por ejemplo en sistemas de archivos específicos), escribir directo
      try {
        fs.writeFileSync(PRIMARY_LOCAL_FILE, jsonStr, "utf8");
      } catch (err) {
        console.error("Error al escribir PRIMARY_LOCAL_FILE:", err);
      }
    }

    // Mantener también el respaldo en la raíz por compatibilidad
    try {
      fs.writeFileSync(ROOT_FALLBACK_FILE, jsonStr, "utf8");
    } catch {}
  }

  // Función para leer el estado local persistido
  function loadLocalState(): any | null {
    for (const filePath of [PRIMARY_LOCAL_FILE, ROOT_FALLBACK_FILE]) {
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        } catch (e) {
          console.error(`Error al leer archivo ${filePath}:`, e);
        }
      }
    }
    return null;
  }

  // Clientes conectados por Server-Sent Events (SSE) para sincronización en tiempo real
  const sseClients = new Set<express.Response>();

  function broadcastState(state: any) {
    const dataString = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(dataString);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // Cargar Configuración de Firebase con soporte tolerante a fallos
  let dbFirebase: any = null;
  const configPaths = [
    path.join(process.cwd(), "firebase-applet-config.json"),
    path.join(__dirname, "firebase-applet-config.json"),
    path.resolve(process.cwd(), "firebase-applet-config.json"),
    "/firebase-applet-config.json"
  ];
  
  let configPath = "";
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }
  
  if (configPath) {
    try {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const appFirebase = initializeApp(firebaseConfig);
      dbFirebase = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);
      console.log(`Firebase inicializado como réplica en la nube desde: ${configPath}`);
    } catch (e) {
      console.warn("Firebase no disponible. El servidor opera en modo 100% autónomo local:", e);
    }
  } else {
    console.log("Modo 100% autónomo: Servidor local operando como base de datos central sin servicios externos.");
  }

  // Función auxiliar para parsear marcas de tiempo
  const getMsFromTimestamp = (val: any): number => {
    if (!val) return 0;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const parsed = Date.parse(val);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof val.toMillis === "function") {
      return val.toMillis();
    }
    if (typeof val.seconds === "number") {
      return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
    }
    if (val instanceof Date) {
      return val.getTime();
    }
    return 0;
  };

  // Helper central para obtener y actualizar el estado completo (catch-up y persistencia)
  async function getAndUpdateFullState(): Promise<any> {
    // 1. Cargar estado local en disco (servidor autoritativo)
    let parsedState: any = loadLocalState();

    // 2. Si no hay estado local pero hay Firestore, intentar cargar réplica
    if (!parsedState && dbFirebase) {
      try {
        const docRef = doc(dbFirebase, "parkingStates", "global");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          parsedState = docSnap.data();
        }
      } catch (err) {
        console.warn("No se pudo consultar Firestore, usando valores iniciales locales.");
      }
    }

    // 3. Si no hay estado previo, inicializar valores por defecto
    if (!parsedState) {
      parsedState = {
        balance: 0.0,
        isActive: false,
        currentSessionId: null,
        history: [],
        totalDeposits: 0.0,
        totalSpent: 0,
        speedMultiplier: 1,
        hourlyRate: 0.10,
        halfHourRate: 0.10,
        lastSavedTime: Date.now(),
      };
      saveLocalStateAtomically(parsedState);
    }

    // 4. Procesar cálculo de tiempo transcurrido (catch-up) si hay sesión activa
    if (parsedState.isActive && parsedState.currentSessionId && parsedState.lastSavedTime) {
      const lastSavedMs = getMsFromTimestamp(parsedState.lastSavedTime);
      const now = Date.now();
      const elapsedRealMs = now - lastSavedMs;
      if (elapsedRealMs > 0) {
        const speed = parsedState.speedMultiplier || 1;
        const simDeltaMs = elapsedRealMs * speed;
        const halfHourRate = parsedState.halfHourRate ?? parsedState.hourlyRate ?? 0.10;
        let offlineCost = 0;

        const updatedHistory = (parsedState.history || []).map((s: any) => {
          if (s.id === parsedState.currentSessionId) {
            const previousCost = s.cost || 0;
            const newElapsedTime = s.elapsedTimeMs + simDeltaMs;
            const newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
            offlineCost = newCost - previousCost;

            return {
              ...s,
              elapsedTimeMs: newElapsedTime,
              cost: newCost,
            };
          }
          return s;
        });

        parsedState = {
          ...parsedState,
          balance: parsedState.balance - offlineCost,
          history: updatedHistory,
          totalSpent: (parsedState.totalSpent || 0) + offlineCost,
          lastSavedTime: now,
        };

        // Guardar atómicamente en disco local
        saveLocalStateAtomically(parsedState);

        // Replicar en Firestore si está disponible
        if (dbFirebase) {
          try {
            const docRef = doc(dbFirebase, "parkingStates", "global");
            setDoc(docRef, parsedState).catch(() => {});
          } catch {}
        }

        // Emitir a todos los clientes SSE conectados
        broadcastState(parsedState);
      }
    }

    return parsedState;
  }

  async function getAndUpdateBalance(): Promise<number> {
    const state = await getAndUpdateFullState();
    return typeof state.balance === "number" ? state.balance : 0;
  }

  // --- Endpoints de Estado Central y SSE ---

  // Endpoint de Eventos en Tiempo Real (Server-Sent Events)
  app.get("/api/events", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    // Enviar estado actual de inmediato al conectar
    try {
      const currentState = await getAndUpdateFullState();
      res.write(`data: ${JSON.stringify(currentState)}\n\n`);
    } catch (e) {
      console.error("Error enviando estado inicial SSE:", e);
    }

    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
  });

  // Keepalive periódico cada 20 segundos para mantener vivas las conexiones SSE
  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(": keepalive\n\n");
      } catch {
        sseClients.delete(client);
      }
    }
  }, 20000);

  // Obtener estado completo
  app.get("/api/state", async (req, res) => {
    try {
      const state = await getAndUpdateFullState();
      res.status(200).json({ status: "success", data: state });
    } catch (err) {
      res.status(500).json({ status: "error", error: "Error al obtener estado local" });
    }
  });

  // Guardar estado completo desde el frontend (acciones de usuario)
  app.post("/api/state", async (req, res) => {
    try {
      const incomingState = req.body;
      if (!incomingState || typeof incomingState !== "object") {
        return res.status(400).json({ status: "error", message: "Cuerpo de estado inválido" });
      }

      const updatedState = {
        ...incomingState,
        lastSavedTime: Date.now(),
      };

      // 1. Guardar de forma atómica en el almacenamiento local del servidor
      saveLocalStateAtomically(updatedState);

      // 2. Replicar en Firestore en segundo plano si está disponible
      if (dbFirebase) {
        try {
          const docRef = doc(dbFirebase, "parkingStates", "global");
          setDoc(docRef, updatedState).catch((e: any) => console.warn("Aviso réplica Firestore:", e?.message));
        } catch {}
      }

      // 3. Notificar a todas las pantallas/pestañas conectadas en tiempo real
      broadcastState(updatedState);

      res.status(200).json({ status: "success", data: updatedState });
    } catch (err) {
      console.error("Error guardando estado:", err);
      res.status(500).json({ status: "error", error: "Error interno al guardar estado local" });
    }
  });

  // Endpoint 1: Retorna un JSON con el saldo y su formato (o texto plano si ?text=true)
  app.get("/saldo", async (req, res) => {
    try {
      const balance = await getAndUpdateBalance();
      if (req.query.text !== undefined) {
        res.setHeader("Content-Type", "text/plain");
        return res.status(200).send(balance.toFixed(2));
      }
      res.status(200).json({
        balance: parseFloat(balance.toFixed(2)),
        formatted: `$${balance.toFixed(2)}`,
        status: "success",
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({ error: "Error al obtener el saldo", status: "error" });
    }
  });

  // Endpoint 2: API estructurada en formato JSON
  app.get("/api/saldo", async (req, res) => {
    try {
      const balance = await getAndUpdateBalance();
      res.status(200).json({ 
        balance: parseFloat(balance.toFixed(2)), 
        formatted: balance < 0 ? `-$${Math.abs(balance).toFixed(2)}` : `$${balance.toFixed(2)}`,
        status: "success",
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({ error: "Error al obtener el saldo", status: "error" });
    }
  });

  // Endpoint para establecer saldo e iniciar sesión de parqueo automáticamente
  const handleSetSaldoRequest = async (req: express.Request, res: express.Response) => {
    try {
      const saldoParam = req.params.saldo || req.query.saldo || req.query.value;
      
      const isNewMessage = (saldoParam !== undefined && String(saldoParam).toLowerCase() === "new") ||
                           (req.query.msg && String(req.query.msg).toLowerCase() === "new") ||
                           (req.query.message && String(req.query.message).toLowerCase() === "new") ||
                           req.path.endsWith("/new");

      if (saldoParam === undefined && !isNewMessage) {
        return res.status(400).json({
          status: "error",
          message: "Debe proporcionar un valor de saldo, ej. ?saldo=10 o /set-saldo/10 o enviar un comando 'new'"
        });
      }

      // 1. Obtener estado actual consolidado
      let parsedState = await getAndUpdateFullState();
      const now = Date.now();

      if (isNewMessage) {
        // Cancelar / pausar la sesión de parqueo actual
        if (parsedState.isActive && parsedState.currentSessionId) {
          const lastSavedMs = getMsFromTimestamp(parsedState.lastSavedTime || now);
          const elapsedRealMs = now - lastSavedMs;
          const speed = parsedState.speedMultiplier || 1;
          const simDeltaMs = elapsedRealMs > 0 ? elapsedRealMs * speed : 0;
          const halfHourRate = parsedState.halfHourRate ?? parsedState.hourlyRate ?? 0.10;
          
          let sessionCostDiff = 0;

          parsedState.history = (parsedState.history || []).map((s: any) => {
            if (s.id === parsedState.currentSessionId) {
              const previousCost = s.cost || 0;
              const newElapsedTime = s.elapsedTimeMs + simDeltaMs;
              const newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
              sessionCostDiff = newCost - previousCost;

              return {
                ...s,
                endTime: now,
                elapsedTimeMs: newElapsedTime,
                cost: newCost,
                isActive: false
              };
            }
            return s;
          });

          parsedState.balance = (parsedState.balance || 0) - sessionCostDiff;
          parsedState.totalSpent = (parsedState.totalSpent || 0) + sessionCostDiff;
          parsedState.isActive = false;
          parsedState.currentSessionId = null;
        }

        parsedState.lastSavedTime = now;

        // Guardar atómicamente en disco local
        saveLocalStateAtomically(parsedState);

        // Replicar en Firestore
        if (dbFirebase) {
          try {
            const docRef = doc(dbFirebase, "parkingStates", "global");
            setDoc(docRef, parsedState).catch(() => {});
          } catch {}
        }

        // Notificar en tiempo real a clientes
        broadcastState(parsedState);

        return res.status(200).json({
          status: "success",
          message: "Sesión de parqueo cancelada con éxito mediante comando 'new'.",
          data: {
            balance: parseFloat(parsedState.balance.toFixed(2)),
            isActive: parsedState.isActive,
            currentSessionId: parsedState.currentSessionId,
            timestamp: now
          }
        });
      }

      const newBalance = parseFloat(String(saldoParam));
      if (isNaN(newBalance)) {
        return res.status(400).json({
          status: "error",
          message: "El saldo proporcionado debe ser un número válido, o enviar 'new' para cancelar la sesión."
        });
      }

      // 2. Si hay una sesión activa, actualizar su costo acumulado hasta ahora sin cerrarla
      if (parsedState.isActive && parsedState.currentSessionId && parsedState.lastSavedTime) {
        const lastSavedMs = getMsFromTimestamp(parsedState.lastSavedTime);
        const elapsedRealMs = now - lastSavedMs;
        const speed = parsedState.speedMultiplier || 1;
        const simDeltaMs = elapsedRealMs > 0 ? elapsedRealMs * speed : 0;
        const halfHourRate = parsedState.halfHourRate ?? parsedState.hourlyRate ?? 0.10;
        
        let sessionCostDiff = 0;

        parsedState.history = (parsedState.history || []).map((s: any) => {
          if (s.id === parsedState.currentSessionId) {
            const previousCost = s.cost || 0;
            const newElapsedTime = s.elapsedTimeMs + simDeltaMs;
            const newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
            sessionCostDiff = newCost - previousCost;

            return {
              ...s,
              elapsedTimeMs: newElapsedTime,
              cost: newCost,
              isActive: true
            };
          }
          return s;
        });
        parsedState.balance = (parsedState.balance || 0) - sessionCostDiff;
        parsedState.totalSpent = (parsedState.totalSpent || 0) + sessionCostDiff;
      }

      // 3. Establecer el nuevo saldo y actualizar los depósitos totales
      const diff = newBalance - parsedState.balance;
      if (diff > 0) {
        parsedState.totalDeposits = (parsedState.totalDeposits || 0) + diff;
      }
      parsedState.balance = newBalance;

      // 4. Iniciar automáticamente una nueva sesión de parqueo si NO hay sesión activa y el saldo es mayor a 0
      if (!parsedState.isActive && newBalance > 0) {
        const sessionId = `session-${now}`;
        const newSession = {
          id: sessionId,
          startTime: now,
          endTime: null,
          elapsedTimeMs: 0,
          cost: 0,
          isActive: true,
          startBalance: newBalance
        };

        parsedState.isActive = true;
        parsedState.currentSessionId = sessionId;
        parsedState.history = [newSession, ...(parsedState.history || [])];
      }

      parsedState.lastSavedTime = now;

      // 5. Guardar estado actualizado en el almacenamiento atómico del servidor
      saveLocalStateAtomically(parsedState);

      // Replicar en Firestore
      if (dbFirebase) {
        try {
          const docRef = doc(dbFirebase, "parkingStates", "global");
          setDoc(docRef, parsedState).catch(() => {});
        } catch {}
      }

      // Notificar a todos los navegadores conectados en tiempo real
      broadcastState(parsedState);

      return res.status(200).json({
        status: "success",
        message: newBalance > 0 
          ? `Saldo establecido en $${newBalance.toFixed(2)} USD y nueva sesión de parqueo iniciada automáticamente.`
          : `Saldo establecido en $${newBalance.toFixed(2)} USD (sesiones desactivadas por saldo cero).`,
        data: {
          balance: parseFloat(parsedState.balance.toFixed(2)),
          isActive: parsedState.isActive,
          currentSessionId: parsedState.currentSessionId,
          timestamp: now
        }
      });

    } catch (err) {
      console.error("Error en handleSetSaldoRequest:", err);
      return res.status(500).json({
        status: "error",
        message: "Error interno del servidor al establecer el saldo e iniciar la sesión."
      });
    }
  };

  // Registrar rutas para set-saldo y cancelamiento por "new"
  app.get("/api/set-saldo", handleSetSaldoRequest);
  app.get("/api/set-saldo/:saldo", handleSetSaldoRequest);
  app.get("/set-saldo", handleSetSaldoRequest);
  app.get("/set-saldo/:saldo", handleSetSaldoRequest);
  app.get("/api/new", handleSetSaldoRequest);
  app.get("/new", handleSetSaldoRequest);

  // Interceptar la raíz "/" si se pide saldo explícitamente, cURL/wget o JSON Header
  app.get("/", async (req, res, next) => {
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const isCommandLine = userAgent.includes("curl") || userAgent.includes("wget") || userAgent.includes("httpie");

    if (req.query.saldo !== undefined || req.query.json !== undefined || req.headers.accept === "application/json" || isCommandLine) {
      try {
        const balance = await getAndUpdateBalance();
        
        if (isCommandLine && req.query.json === undefined && req.headers.accept !== "application/json") {
          res.setHeader("Content-Type", "text/plain");
          return res.status(200).send(balance.toFixed(2));
        }

        return res.status(200).json({ 
          balance: parseFloat(balance.toFixed(2)), 
          formatted: balance < 0 ? `-$${Math.abs(balance).toFixed(2)}` : `$${balance.toFixed(2)}`
        });
      } catch (err) {
        if (isCommandLine) {
          return res.status(500).send("Error al obtener el saldo");
        }
        return res.status(500).json({ error: "Error al obtener el saldo" });
      }
    }
    next();
  });

  // Servir frontend con Vite (Desarrollo) o archivos estáticos (Producción)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        allowedHosts: true,
      },
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
    console.log(`Servidor de IA Parqueadero corriendo en http://localhost:${PORT}`);
    console.log(`Endpoint de saldo disponible en: http://localhost:${PORT}/saldo`);
    console.log(`Almacenamiento persistente centralizado en: ${PRIMARY_LOCAL_FILE}`);
  });
}

startServer();
