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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Habilitar CORS para permitir peticiones desde cualquier origen (local u otros servidores)
  app.use(cors());
  app.use(express.json());

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
      console.log(`Firebase inicializado correctamente en el servidor desde: ${configPath}`);
    } catch (e) {
      console.error("No se pudo cargar o parsear la configuración de Firebase:", e);
    }
  } else {
    console.warn("ADVERTENCIA: firebase-applet-config.json no existe. El servidor funcionará en modo offline local.");
  }

  // Helper para obtener y sincronizar el estado/saldo actual de Firestore (o usar valor de respaldo)
  async function getAndUpdateBalance(): Promise<number> {
    let parsedState: any = null;
    let isFromFirestore = false;

    // 1. Intentar cargar desde Firestore
    if (dbFirebase) {
      try {
        const docRef = doc(dbFirebase, "parkingStates", "global");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          parsedState = docSnap.data();
          isFromFirestore = true;
        }
      } catch (err) {
        console.error("Error al obtener estado de Firestore:", err);
      }
    }
    
    // 2. Si no hay Firestore o falló, intentar desde el respaldo local
    const fallbackPath = path.join(process.cwd(), "local-parking-state.json");
    if (!parsedState && fs.existsSync(fallbackPath)) {
      try {
        const raw = fs.readFileSync(fallbackPath, "utf8");
        parsedState = JSON.parse(raw);
      } catch (e) {
        console.error("Error al leer archivo local-parking-state.json:", e);
      }
    }

    // 3. Si no hay estado en ningún lado, usar valores por defecto
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

    // Función auxiliar para parsear timestamps de Firestore robustamente
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

    // 4. Procesar catch-up de tiempo transcurrido si está estacionado (isActive === true)
    if (parsedState.isActive && parsedState.currentSessionId && parsedState.lastSavedTime) {
      const lastSavedMs = getMsFromTimestamp(parsedState.lastSavedTime);
      const elapsedRealMs = Date.now() - lastSavedMs;
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

        // 5. Guardar el estado actualizado de vuelta a la base de datos o archivo local
        if (isFromFirestore && dbFirebase) {
          try {
            const docRef = doc(dbFirebase, "parkingStates", "global");
            await setDoc(docRef, parsedState);
            console.log("Estado de estacionamiento catch-up guardado en Firestore.");
          } catch (err) {
            console.error("Error al guardar estado catch-up en Firestore:", err);
          }
        }
        
        // Guardar siempre una copia local por seguridad
        try {
          fs.writeFileSync(fallbackPath, JSON.stringify(parsedState, null, 2), "utf8");
        } catch (e) {
          console.error("Error al guardar respaldo de estado local:", e);
        }
      }
    }

    return parsedState.balance;
  }

  // Endpoint 1: Retorna un JSON con el saldo y su formato (o texto plano si se especifica ?text=true)
  app.get("/saldo", async (req, res) => {
    try {
      const balance = await getAndUpdateBalance();
      if (req.query.text !== undefined) {
        res.setHeader("Content-Type", "text/plain");
        return res.status(200).send(balance.toFixed(4));
      }
      res.status(200).json({
        balance: parseFloat(balance.toFixed(4)),
        formatted: `$${balance.toFixed(4)}`,
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
        balance: parseFloat(balance.toFixed(4)), 
        formatted: `$${balance.toFixed(4)}`,
        status: "success",
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({ error: "Error al obtener el saldo", status: "error" });
    }
  });

  // Interceptar la raíz "/" si se pide saldo explícitamente, si es una herramienta de terminal (cURL/wget) o JSON Header
  app.get("/", async (req, res, next) => {
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const isCommandLine = userAgent.includes("curl") || userAgent.includes("wget") || userAgent.includes("httpie");

    if (req.query.saldo !== undefined || req.query.json !== undefined || req.headers.accept === "application/json" || isCommandLine) {
      try {
        const balance = await getAndUpdateBalance();
        
        // Si es curl/wget y no pide explícitamente JSON, devolvemos texto plano para comodidad en terminal
        if (isCommandLine && req.query.json === undefined && req.headers.accept !== "application/json") {
          res.setHeader("Content-Type", "text/plain");
          return res.status(200).send(balance.toFixed(4));
        }

        return res.status(200).json({ 
          balance: parseFloat(balance.toFixed(4)), 
          formatted: `$${balance.toFixed(4)}` 
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
    console.log(`Servidor de Parkflow Pro corriendo en http://localhost:${PORT}`);
    console.log(`Endpoint de saldo disponible en: http://localhost:${PORT}/saldo`);
  });
}

startServer();
