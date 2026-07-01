/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Load Firebase Config
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // Initialize Firebase
  const appFirebase = initializeApp(firebaseConfig);
  const dbFirebase = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);

  async function getBalanceFromFirestore(): Promise<number> {
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
      console.error("Error in getBalanceFromFirestore:", err);
    }
    return 5.0; // Fallback default balance
  }

  // API/Custom endpoints FIRST
  app.get("/saldo", async (req, res) => {
    try {
      const balance = await getBalanceFromFirestore();
      res.setHeader("Content-Type", "text/plain");
      res.send(balance.toFixed(4));
    } catch (err) {
      res.status(500).send("Error al obtener el saldo");
    }
  });

  app.get("/api/saldo", async (req, res) => {
    try {
      const balance = await getBalanceFromFirestore();
      res.json({ balance, formatted: `$${balance.toFixed(4)}` });
    } catch (err) {
      res.status(500).json({ error: "Error al obtener el saldo" });
    }
  });

  // Intercept main page GET if requested as JSON or with query
  app.get("/", async (req, res, next) => {
    if (req.query.saldo !== undefined || req.query.json !== undefined || req.headers.accept === "application/json") {
      try {
        const balance = await getBalanceFromFirestore();
        return res.json({ balance, formatted: `$${balance.toFixed(4)}` });
      } catch (err) {
        return res.status(500).json({ error: "Error al obtener el saldo" });
      }
    }
    next();
  });

  // Vite middleware for development
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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
