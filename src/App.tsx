/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { ParkingState, ParkingSession } from "./types";
import WalletCard from "./components/WalletCard";
import ParkingBay from "./components/ParkingBay";
import ParkingControls from "./components/ParkingControls";
import ParkingHistory from "./components/ParkingHistory";
import SimulatorPanel from "./components/SimulatorPanel";
import { Car, AlertTriangle, CheckCircle2, Cloud, CloudOff, Zap, ZapOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { saveParkingStateToDb, loadParkingStateFromDb, subscribeParkingState } from "./lib/db";

const DEFAULT_STATE: ParkingState = {
  balance: 0.0, // Default to $0.00
  isActive: false,
  currentSessionId: null,
  history: [],
  totalDeposits: 0.0,
  totalSpent: 0,
  speedMultiplier: 1,
  hourlyRate: 0.10,
};

export default function App() {
  const [state, setState] = useState<ParkingState>(DEFAULT_STATE);
  const [isSimulatorVisible, setIsSimulatorVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem("parking_manager_simulator_visible");
    return saved !== null ? saved === "true" : false;
  });
  const [showEmptyAlert, setShowEmptyAlert] = useState<boolean>(false);
  const [dbSynced, setDbSynced] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const lastUpdatedRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem("parking_manager_simulator_visible", String(isSimulatorVisible));
  }, [isSimulatorVisible]);

  // Initialize/Load state from database once on mount
  useEffect(() => {
    const loadState = async () => {
      setDbSynced(false);
      let loadedState: ParkingState | null = null;
      try {
        const dbState = await loadParkingStateFromDb();
        if (dbState) {
          loadedState = dbState;
          setDbSynced(true);
        }
      } catch (err) {
        console.error("Error loading state from Firestore:", err);
      }

      // Fallback to localStorage if Firestore load failed or was empty
      if (!loadedState) {
        const savedLocal = localStorage.getItem("parking_manager_state");
        if (savedLocal) {
          try {
            loadedState = JSON.parse(savedLocal);
          } catch (e) {
            console.error("Failed to parse local storage fallback", e);
          }
        }
      }

      const parsed = loadedState || DEFAULT_STATE;

      // Helper to parse Firestore/LocalStorage timestamps robustly
      const getMsFromTimestamp = (val: any): number => {
        if (!val) return 0;
        if (typeof val === "number") return val;
        if (typeof val === "string") {
          const p = Date.parse(val);
          return isNaN(p) ? 0 : p;
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

      // Handle calculating elapsed time while app was inactive
      if (parsed.isActive && parsed.currentSessionId && parsed.lastSavedTime) {
        const lastSavedMs = getMsFromTimestamp(parsed.lastSavedTime);
        const elapsedRealMs = Date.now() - lastSavedMs;
        if (elapsedRealMs > 0) {
          const simDeltaMs = elapsedRealMs * parsed.speedMultiplier;
          const RATE_PER_MS = (parsed.hourlyRate ?? 0.10) / (3600 * 1000); // custom hourly cost
          const offlineCost = simDeltaMs * RATE_PER_MS;

          const updatedHistory = parsed.history.map((s) => {
            if (s.id === parsed.currentSessionId) {
              return {
                ...s,
                elapsedTimeMs: s.elapsedTimeMs + simDeltaMs,
                cost: s.cost + offlineCost,
              };
            }
            return s;
          });

          const finalState = {
            ...parsed,
            balance: parsed.balance - offlineCost,
            history: updatedHistory,
            totalSpent: parsed.totalSpent + offlineCost,
          };
          setState(finalState);
          saveParkingStateToDb(finalState);
        } else {
          setState(parsed);
        }
      } else {
        setState(parsed);
      }
    };

    loadState();
  }, []);

  // Real-time listener for remote changes (e.g. from the API / set-saldo url)
  useEffect(() => {
    const unsubscribe = subscribeParkingState((remoteState) => {
      setState((current) => {
        const remoteSavedTime = remoteState.lastSavedTime || 0;
        const currentSavedTime = current.lastSavedTime || 0;

        // Only overwrite current state if the update was made externally
        // (lastSavedTime is strictly newer by more than a brief network lag)
        // or if there are important structural differences
        const hasStructuralDiff = 
          remoteState.isActive !== current.isActive || 
          remoteState.currentSessionId !== current.currentSessionId ||
          Math.abs(remoteState.balance - current.balance) > 0.01;

        if (hasStructuralDiff || remoteSavedTime > currentSavedTime + 1000) {
          // Reset local timer reference if active state is updated
          if (remoteState.isActive) {
            lastUpdatedRef.current = Date.now();
          } else {
            lastUpdatedRef.current = null;
          }

          // Also update localStorage
          localStorage.setItem("parking_manager_state", JSON.stringify(remoteState));
          return remoteState;
        }
        return current;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Centralized local state + Firestore save helper
  const updateAndSaveState = (newState: ParkingState) => {
    const stateWithTimestamp = {
      ...newState,
      lastSavedTime: Date.now(),
    };
    setState(stateWithTimestamp);
    
    // Save to local storage for quick offline recovery
    localStorage.setItem("parking_manager_state", JSON.stringify(stateWithTimestamp));
    
    // Save to Firestore DB
    setIsSaving(true);
    saveParkingStateToDb(stateWithTimestamp)
      .then(() => {
        setDbSynced(true);
        setIsSaving(false);
      })
      .catch((err) => {
        console.error("Firestore save failed:", err);
        setIsSaving(false);
      });
  };

  // Active Session ticking logic (every 100ms)
  useEffect(() => {
    if (!state.isActive || !state.currentSessionId) {
      lastUpdatedRef.current = null;
      return;
    }

    if (lastUpdatedRef.current === null) {
      lastUpdatedRef.current = Date.now();
    }

    const timerId = setInterval(() => {
      const now = Date.now();
      const lastTime = lastUpdatedRef.current ?? now;
      const realDeltaMs = now - lastTime;
      if (realDeltaMs <= 0) return;

      lastUpdatedRef.current = now;

      const simDeltaMs = realDeltaMs * state.speedMultiplier;
      const RATE_PER_MS = (state.hourlyRate ?? 0.10) / (3600 * 1000);
      const tickCost = simDeltaMs * RATE_PER_MS;

      setState((prev) => {
        if (!prev.isActive || !prev.currentSessionId) return prev;

        const updatedHistory = prev.history.map((s) => {
          if (s.id === prev.currentSessionId) {
            return {
              ...s,
              elapsedTimeMs: s.elapsedTimeMs + simDeltaMs,
              cost: s.cost + tickCost,
            };
          }
          return s;
        });

        const newState = {
          ...prev,
          balance: prev.balance - tickCost,
          history: updatedHistory,
          totalSpent: prev.totalSpent + tickCost,
        };

        // Cache state locally on tick for fast recovery
        const stateToSave = {
          ...newState,
          lastSavedTime: Date.now(),
        };
        localStorage.setItem("parking_manager_state", JSON.stringify(stateToSave));

        return newState;
      });
    }, 100);

    return () => clearInterval(timerId);
  }, [state.isActive, state.currentSessionId, state.speedMultiplier]);

  // Actions
  const handleStart = () => {
    if (state.balance <= 0) return;
    const now = Date.now();
    const sessionId = `session-${now}`;
    const newSession: ParkingSession = {
      id: sessionId,
      startTime: now,
      endTime: null,
      elapsedTimeMs: 0,
      cost: 0,
      isActive: true,
    };

    lastUpdatedRef.current = now;
    const newState = {
      ...state,
      isActive: true,
      currentSessionId: sessionId,
      history: [newSession, ...state.history],
    };
    updateAndSaveState(newState);
  };

  const handlePause = () => {
    const now = Date.now();
    if (!state.currentSessionId) return;

    const updatedHistory = state.history.map((s) => {
      if (s.id === state.currentSessionId) {
        return {
          ...s,
          endTime: now,
          isActive: false,
        };
      }
      return s;
    });

    const newState = {
      ...state,
      isActive: false,
      currentSessionId: null,
      history: updatedHistory,
    };

    updateAndSaveState(newState);
    lastUpdatedRef.current = null;
  };

  const handleRecharge = (amount: number) => {
    const newState = {
      ...state,
      balance: state.balance + amount,
      totalDeposits: state.totalDeposits + amount,
    };
    updateAndSaveState(newState);
  };

  const handleResetBalance = () => {
    let updatedHistory = state.history;
    let isActive = state.isActive;
    let currentSessionId = state.currentSessionId;
    
    if (state.isActive && state.currentSessionId) {
      const now = Date.now();
      updatedHistory = state.history.map((s) => {
        if (s.id === state.currentSessionId) {
          return {
            ...s,
            endTime: now,
            isActive: false,
          };
        }
        return s;
      });
      isActive = false;
      currentSessionId = null;
      lastUpdatedRef.current = null;
    }

    const newState = {
      ...state,
      balance: 0,
      isActive,
      currentSessionId,
      history: updatedHistory,
    };
    updateAndSaveState(newState);
  };

  const handleSetSpeed = (speed: number) => {
    const newState = {
      ...state,
      speedMultiplier: speed,
    };
    updateAndSaveState(newState);
  };

  const handleTimeSkip = (minutes: number) => {
    const skipMs = minutes * 60 * 1000;
    const RATE_PER_MS = (state.hourlyRate ?? 0.10) / (3600 * 1000);
    const skipCost = skipMs * RATE_PER_MS;

    if (!state.isActive || !state.currentSessionId) return;

    const updatedHistory = state.history.map((s) => {
      if (s.id === state.currentSessionId) {
        return {
          ...s,
          elapsedTimeMs: s.elapsedTimeMs + skipMs,
          cost: s.cost + skipCost,
        };
      }
      return s;
    });

    const newState = {
      ...state,
      balance: state.balance - skipCost,
      history: updatedHistory,
      totalSpent: state.totalSpent + skipCost,
    };

    updateAndSaveState(newState);
  };

  const handleClearHistory = () => {
    const newState = {
      balance: 0.0,
      isActive: false,
      currentSessionId: null,
      history: [],
      totalDeposits: 0.0,
      totalSpent: 0,
      speedMultiplier: 1,
      hourlyRate: state.hourlyRate ?? 0.10,
    };
    updateAndSaveState(newState);
    localStorage.removeItem("parking_manager_state");
  };

  const handleUpdateHourlyRate = (newRate: number) => {
    const newState = {
      balance: 0.0,
      isActive: false,
      currentSessionId: null,
      history: [],
      totalDeposits: 0.0,
      totalSpent: 0,
      speedMultiplier: 1,
      hourlyRate: newRate,
    };
    updateAndSaveState(newState);
    localStorage.removeItem("parking_manager_state");
  };

  // Get current active session details
  const activeSession = state.history.find((s) => s.id === state.currentSessionId);
  const currentDuration = activeSession?.elapsedTimeMs ?? 0;
  const currentCost = activeSession?.cost ?? 0;

  // Format active session time
  const getFormattedTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num: number) => String(num).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-12 font-sans" id="app-root-container">
      {/* Navigation Header */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 border-b-4 border-blue-600 shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center font-bold text-xl text-white">
              P
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight uppercase">
                ParkFlow <span className="text-blue-400">Pro</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Control de Parqueo Inteligente</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              id="btn-toggle-simulator"
              onClick={() => setIsSimulatorVisible(!isSimulatorVisible)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-750 text-slate-300 hover:text-white rounded-xl border border-slate-700/80 shadow-xs text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
            >
              {isSimulatorVisible ? (
                <>
                  <ZapOff className="w-4 h-4 text-amber-500 shrink-0" />
                  Ocultar Simulador
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-blue-400 animate-pulse shrink-0" />
                  Mostrar Simulador
                </>
              )}
            </button>

            <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-800 rounded-xl border border-slate-700 shadow-sm text-left">
              <div className={`p-1.5 rounded-lg ${dbSynced ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                {dbSynced ? <Cloud className="w-4 h-4 animate-pulse" /> : <CloudOff className="w-4 h-4" />}
              </div>
              <div className="text-xs">
                <div className="font-bold flex items-center gap-1.5">
                  <span className={`text-[9px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded border ${
                    dbSynced 
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                      : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  }`}>
                    {dbSynced ? "Sincronizado" : "Sincronizando..."}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Base de Datos Única Activa
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-6 mt-6 space-y-6">
        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* 1. Mi Monedero Digital (WalletCard) */}
          {/* Mobile: Order 1 (Top!), Tablet: Col 1, Desktop: Cols 9-12 (Order 3) */}
          <div className="col-span-1 md:col-span-1 lg:col-span-4 order-1 lg:order-3 h-full">
            <WalletCard
              balance={state.balance}
              onRecharge={handleRecharge}
              onResetBalance={handleResetBalance}
              hourlyRate={state.hourlyRate ?? 0.10}
            />
          </div>

          {/* 2. Estado de Estacionamiento (ParkingBay) */}
          {/* Mobile: Order 2, Tablet: Col 2, Desktop: Cols 1-4 (Order 1) */}
          <div className="col-span-1 md:col-span-1 lg:col-span-4 order-2 lg:order-1 h-full">
            <ParkingBay
              isActive={state.isActive}
              formattedTime={getFormattedTime(currentDuration)}
              accumulatedCost={currentCost}
            />
          </div>

          {/* 3. Acciones y Control (ParkingControls) */}
          {/* Mobile: Order 3, Tablet: Col 1 Row 2, Desktop: Cols 5-8 (Order 2) */}
          <div className="col-span-1 md:col-span-1 lg:col-span-4 order-3 lg:order-2 h-full">
            <ParkingControls
              isActive={state.isActive}
              balance={state.balance}
              onStart={handleStart}
              onPause={handlePause}
              formattedTime={getFormattedTime(currentDuration)}
              currentCost={currentCost}
              startTime={activeSession?.startTime ?? null}
              hourlyRate={state.hourlyRate ?? 0.10}
              onUpdateHourlyRate={handleUpdateHourlyRate}
            />
          </div>



        </div>

        {/* Simulator Panel (Optional / Persistent show/hide) */}
        <AnimatePresence initial={false}>
          {isSimulatorVisible && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="w-full overflow-hidden"
              id="simulation-section-container"
            >
              <SimulatorPanel
                isActive={state.isActive}
                speedMultiplier={state.speedMultiplier}
                onSetSpeed={handleSetSpeed}
                onTimeSkip={handleTimeSkip}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Parking History and Stats Logs */}
        <div className="w-full">
          <ParkingHistory
            history={state.history}
            totalSpent={state.totalSpent}
            onClearHistory={handleClearHistory}
          />
        </div>
      </main>

      {/* Footer Status Bar with Professional Polish Design elements */}
      <footer className="max-w-6xl mx-auto px-6 mt-12 bg-white border border-slate-200 rounded-xl py-4 flex flex-col md:flex-row justify-between items-center gap-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-bold text-slate-800 uppercase">Tarifa Actual:</span> $0.10 / Hora
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-bold text-slate-800 uppercase">Saldo Estimado:</span>{' '}
            <span className={state.balance < 0 ? "text-rose-600 font-bold" : ""}>
              {state.balance < 0 ? `-$${Math.abs(state.balance).toFixed(2)}` : `$${state.balance.toFixed(2)}`} USD
            </span>
          </div>
        </div>
        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic">
          Última actualización: {new Date().toLocaleTimeString("es-ES")}
        </div>
      </footer>

      {/* Out of Money Dialog/Alert Modal */}
      <AnimatePresence>
        {showEmptyAlert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" id="empty-balance-modal">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¡Saldo Agotado!</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-6">
                Tu saldo de estacionamiento ha llegado a <strong>$0.00 USD</strong>.
                La sesión de parqueo activa se ha cerrado y guardado automáticamente. Por favor, realiza una recarga en tu monedero para poder parquear de nuevo.
              </p>
              <button
                id="btn-close-empty-modal"
                onClick={() => setShowEmptyAlert(false)}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl transition-all"
              >
                Entendido, recargar saldo
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
