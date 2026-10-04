/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { ParkingState } from "../types";

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

/**
 * Guarda el estado del parqueo en el servidor local centralizado (y en Firestore como réplica si está disponible).
 */
export async function saveParkingStateToDb(state: ParkingState): Promise<void> {
  const dataToSave = {
    ...state,
    lastSavedTime: Date.now(),
  };

  // 1. Guardar de forma primaria en el servidor local centralizado
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataToSave),
    });
    if (res.ok) {
      return;
    }
  } catch (e) {
    console.warn("Aviso: No se pudo contactar la API local del servidor, procediendo con réplica:", e);
  }

  // 2. Réplica o respaldo secundario en Firestore (si está configurado)
  try {
    const userDocRef = doc(db, "parkingStates", "global");
    await setDoc(userDocRef, dataToSave);
  } catch (error) {
    // Si no hay Firestore disponible, el estado ya se guarda en localStorage en App.tsx
    console.warn("Aviso: Réplica secundaria Firestore no disponible:", error);
  }
}

/**
 * Carga el estado inicial del parqueo desde el servidor central local o Firestore.
 */
export async function loadParkingStateFromDb(): Promise<ParkingState | null> {
  // 1. Intentar cargar desde el servidor local centralizado
  try {
    const res = await fetch("/api/state");
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        return json.data as ParkingState;
      }
    }
  } catch (e) {
    console.warn("Aviso: Servidor local no respondió a /api/state, intentando Firestore:", e);
  }

  // 2. Intentar cargar desde Firestore si la API local no respondió
  try {
    const userDocRef = doc(db, "parkingStates", "global");
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      return docSnap.data() as ParkingState;
    }
  } catch (error) {
    console.warn("Aviso: Consulta a Firestore no disponible:", error);
  }

  return null;
}

/**
 * Suscribe a cambios en tiempo real desde el servidor local central (Server-Sent Events)
 * con fallback continuo a Firestore snapshot listener.
 */
export function subscribeParkingState(callback: (state: ParkingState) => void): () => void {
  let eventSource: EventSource | null = null;
  let firestoreUnsub: (() => void) | null = null;
  let isClosed = false;

  // 1. Canal primario: Server-Sent Events desde el servidor local
  try {
    eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      if (isClosed) return;
      try {
        const data = JSON.parse(event.data);
        if (data && typeof data === "object") {
          callback(data as ParkingState);
        }
      } catch (err) {
        console.error("Error al procesar evento SSE:", err);
      }
    };
    eventSource.onerror = () => {
      // EventSource reconecta automáticamente de forma nativa
    };
  } catch (err) {
    console.warn("Aviso: EventSource no disponible o falló conexión:", err);
  }

  // 2. Canal secundario: Firestore listener en tiempo real
  try {
    const userDocRef = doc(db, "parkingStates", "global");
    firestoreUnsub = onSnapshot(userDocRef, (snapshot) => {
      if (isClosed) return;
      if (snapshot.exists()) {
        callback(snapshot.data() as ParkingState);
      }
    }, () => {
      // Ignorar silenciosamente errores de red externa para funcionamiento local offline
    });
  } catch {
    // Si Firebase no está configurado, la app sigue funcionando con SSE
  }

  return () => {
    isClosed = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (firestoreUnsub) {
      firestoreUnsub();
      firestoreUnsub = null;
    }
  };
}
