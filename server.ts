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
import { getFirestore, doc, getDoc } from "firebase/firestore";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Habilitar CORS para permitir peticiones desde cualquier origen (local u otros servidores)
  app.use(cors());
  app.use(express.json());

  // Cargar Configuración de Firebase con soporte tolerante a fallos
  let dbFirebase: any = null;
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  
  if (fs.existsSync(configPath)) {
    try {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const appFirebase = initializeApp(firebaseConfig);
      dbFirebase = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);
      console.log("Firebase inicializado correctamente en el servidor.");
    } catch (e) {
      console.error("No se pudo cargar o parsear la configuración de Firebase:", e);
    }
  } else {
    console.warn("ADVERTENCIA: firebase-applet-config.json no existe. El servidor funcionará en modo offline local.");
  }

  // Helper para obtener saldo actual de Firestore (o usar valor de respaldo)
  async function getBalance(): Promise<number> {
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
        console.error("Error al obtener saldo de Firestore:", err);
      }
    }
    
    // Si no hay conexión o no hay firebaseConfig, intentamos leer de un respaldo local
    const fallbackPath = path.join(process.cwd(), "local-parking-state.json");
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
    
    // Por defecto si no hay nada
    return 5.0;
  }

  // Endpoint 1: Retorna solo el número como texto (ideal para scripts simples, cURL, microcontroladores)
  app.get("/saldo", async (req, res) => {
    try {
      const balance = await getBalance();
      res.setHeader("Content-Type", "text/plain");
      res.status(200).send(balance.toFixed(4));
    } catch (err) {
      res.status(500).send("Error al obtener el saldo");
    }
  });

  // Endpoint 2: API estructurada en formato JSON
  app.get("/api/saldo", async (req, res) => {
    try {
      const balance = await getBalance();
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

  // Interceptar la raíz "/" si se pide saldo explícitamente vía query param (ej. /?saldo) o JSON Header
  app.get("/", async (req, res, next) => {
    if (req.query.saldo !== undefined || req.query.json !== undefined || req.headers.accept === "application/json") {
      try {
        const balance = await getBalance();
        return res.status(200).json({ 
          balance: parseFloat(balance.toFixed(4)), 
          formatted: `$${balance.toFixed(4)}` 
        });
      } catch (err) {
        return res.status(500).json({ error: "Error al obtener el saldo" });
      }
    }
    next();
  });

  // Servir frontend con Vite (Desarrollo) o archivos estáticos (Producción)
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
    console.log(`Servidor de Parkflow Pro corriendo en http://localhost:${PORT}`);
    console.log(`Endpoint de saldo disponible en: http://localhost:${PORT}/saldo`);
  });
}

startServer();
