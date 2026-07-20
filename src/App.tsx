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
import { Car, AlertTriangle, CheckCircle2, Cloud, CloudOff, Zap, ZapOff, LogIn, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { saveParkingStateToDb, loadParkingStateFromDb, subscribeParkingState } from "./lib/db";
import { auth } from "./firebase";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";

const DEFAULT_STATE: ParkingState = {
  balance: 0.0, // Default to $0.00
  isActive: false,
  currentSessionId: null,
  history: [],
  totalDeposits: 0.0,
  totalSpent: 0,
  speedMultiplier: 1,
  hourlyRate: 0.10,
  halfHourRate: 0.10,
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
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

  // Listen for authentication changes
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  // Initialize/Load state from database once and subscribe to changes per user ID
  useEffect(() => {
    let unsubscribeRemote: (() => void) | null = null;
    const userId = currentUser ? currentUser.uid : "global";

    const loadStateAndSubscribe = async () => {
      setDbSynced(false);
      let loadedState: ParkingState | null = null;
      try {
        const dbState = await loadParkingStateFromDb(userId);
        if (dbState) {
          loadedState = dbState;
          setDbSynced(true);
        }
      } catch (err) {
        console.error("Error loading state from Firestore:", err);
      }

      // Fallback to localStorage if Firestore load failed or was empty and not authenticated
      if (!loadedState && !currentUser) {
        const savedLocal = localStorage.getItem("parking_manager_state");
        if (savedLocal) {
          try {
            loadedState = JSON.parse(savedLocal);
          } catch (e) {
            console.error("Failed to parse local storage fallback", e);
          }
        }
      }

      const parsed: ParkingState = {
        ...DEFAULT_STATE,
        ...(loadedState || {}),
        history: (loadedState || {}).history || DEFAULT_STATE.history,
      };

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

      let finalState = parsed;

      // Handle calculating elapsed time while app was inactive
      if (parsed.isActive && parsed.currentSessionId && parsed.lastSavedTime) {
        const lastSavedMs = getMsFromTimestamp(parsed.lastSavedTime);
        const elapsedRealMs = Date.now() - lastSavedMs;
        if (elapsedRealMs > 0) {
          const simDeltaMs = elapsedRealMs * parsed.speedMultiplier;
          const halfHourRate = parsed.halfHourRate ?? parsed.hourlyRate ?? 0.10;
          let offlineCostAccumulated = 0;

          const updatedHistory = parsed.history.map((s) => {
            if (s.id === parsed.currentSessionId) {
              const previousCost = s.cost || 0;
              const newElapsedTime = s.elapsedTimeMs + simDeltaMs;
              const newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
              const diff = newCost - previousCost;
              offlineCostAccumulated = diff;

              return {
                ...s,
                elapsedTimeMs: newElapsedTime,
                cost: newCost,
              };
            }
            return s;
          });

          finalState = {
            ...parsed,
            balance: parsed.balance - offlineCostAccumulated,
            history: updatedHistory,
            totalSpent: parsed.totalSpent + offlineCostAccumulated,
          };
        }
      }

      setState(finalState);

      // If user had guest progress but no remote database record yet, persist it
      if (!loadedState && currentUser) {
        try {
          await saveParkingStateToDb(finalState, userId);
          setDbSynced(true);
        } catch (err) {
          console.error("Failed to save initial state for user:", err);
        }
      } else if (!currentUser) {
        localStorage.setItem("parking_manager_state", JSON.stringify(finalState));
      }

      // Start real-time remote sync listener for the current user ID
      unsubscribeRemote = subscribeParkingState(userId, (remoteState) => {
        setState((current) => {
          const remoteSavedTime = remoteState.lastSavedTime || 0;
          const currentSavedTime = current.lastSavedTime || 0;

          const fullyParsedRemote: ParkingState = {
            ...DEFAULT_STATE,
            ...remoteState,
          };

          const hasStructuralDiff = 
            fullyParsedRemote.isActive !== current.isActive || 
            fullyParsedRemote.currentSessionId !== current.currentSessionId ||
            fullyParsedRemote.hourlyRate !== current.hourlyRate ||
            Math.abs(fullyParsedRemote.balance - current.balance) > 0.01;

          if (hasStructuralDiff || remoteSavedTime > currentSavedTime + 1000) {
            if (fullyParsedRemote.isActive) {
              lastUpdatedRef.current = Date.now();
            } else {
              lastUpdatedRef.current = null;
            }

            if (!currentUser) {
              localStorage.setItem("parking_manager_state", JSON.stringify(fullyParsedRemote));
            }
            return fullyParsedRemote;
          }
          return current;
        });
        setDbSynced(true);
      });
    };

    loadStateAndSubscribe();

    return () => {
      if (unsubscribeRemote) {
        unsubscribeRemote();
      }
    };
  }, [currentUser]);

  // Centralized local state + Firestore save helper
  const updateAndSaveState = (newState: ParkingState) => {
    const stateWithTimestamp = {
      ...newState,
      lastSavedTime: Date.now(),
    };
    setState(stateWithTimestamp);
    
    // Save to local storage for quick offline recovery if guest
    if (!currentUser) {
      localStorage.setItem("parking_manager_state", JSON.stringify(stateWithTimestamp));
    }
    
    // Save to Firestore DB for the current user (defaults to "global" if not logged in)
    setIsSaving(true);
    const userId = currentUser ? currentUser.uid : "global";
    saveParkingStateToDb(stateWithTimestamp, userId)
      .then(() => {
        setDbSynced(true);
        setIsSaving(false);
      })
      .catch((err) => {
        console.error("Firestore save failed:", err);
        setIsSaving(false);
      });
  };

  const handleSignInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google:", error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setState(DEFAULT_STATE);
    } catch (error) {
      console.error("Error signing out:", error);
    }
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

      setState((prev) => {
        if (!prev.isActive || !prev.currentSessionId) return prev;

        const halfHourRate = prev.halfHourRate ?? prev.hourlyRate ?? 0.10;
        const currentSpeedMultiplier = prev.speedMultiplier ?? 1;

        const simDeltaMs = realDeltaMs * currentSpeedMultiplier;
        let costDiff = 0;

        const updatedHistory = prev.history.map((s) => {
          if (s.id === prev.currentSessionId) {
            const previousCost = s.cost || 0;
            const newElapsedTime = s.elapsedTimeMs + simDeltaMs;
            const newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
            costDiff = newCost - previousCost;

            return {
              ...s,
              elapsedTimeMs: newElapsedTime,
              cost: newCost,
            };
          }
          return s;
        });

        const newState = {
          ...prev,
          balance: prev.balance - costDiff,
          history: updatedHistory,
          totalSpent: prev.totalSpent + costDiff,
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
  }, [state.isActive, state.currentSessionId, state.speedMultiplier, state.hourlyRate]);

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
      startBalance: state.balance,
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
    const halfHourRate = state.halfHourRate ?? state.hourlyRate ?? 0.10;

    if (!state.isActive || !state.currentSessionId) return;

    let costDiff = 0;

    const updatedHistory = state.history.map((s) => {
      if (s.id === state.currentSessionId) {
        const previousCost = s.cost || 0;
        const newElapsedTime = s.elapsedTimeMs + skipMs;
        const newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
        costDiff = newCost - previousCost;

        return {
          ...s,
          elapsedTimeMs: newElapsedTime,
          cost: newCost,
        };
      }
      return s;
    });

    const newState = {
      ...state,
      balance: state.balance - costDiff,
      history: updatedHistory,
      totalSpent: state.totalSpent + costDiff,
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
      hourlyRate: state.halfHourRate ?? state.hourlyRate ?? 0.10,
      halfHourRate: state.halfHourRate ?? state.hourlyRate ?? 0.10,
    };
    updateAndSaveState(newState);
  };

  const handleUpdateHalfHourRate = (newRate: number) => {
    const newState = {
      ...state,
      halfHourRate: newRate,
      hourlyRate: newRate, // Keep in sync for compatibility
    };
    updateAndSaveState(newState);
  };

  const handleUpdateActiveSession = (newStartTime: number, newStartBalance: number) => {
    if (!state.isActive || !state.currentSessionId) return;

    const now = Date.now();
    const halfHourRate = state.halfHourRate ?? state.hourlyRate ?? 0.10;
    const currentSpeedMultiplier = state.speedMultiplier ?? 1;

    let costDiff = 0;
    let oldCost = 0;
    let newCost = 0;

    const updatedHistory = state.history.map((s) => {
      if (s.id === state.currentSessionId) {
        oldCost = s.cost || 0;
        const newElapsedTime = Math.max(0, now - newStartTime) * currentSpeedMultiplier;
        newCost = newElapsedTime <= 0 ? 0 : Math.ceil(newElapsedTime / (30 * 60 * 1000)) * halfHourRate;
        costDiff = newCost - oldCost;

        return {
          ...s,
          startTime: newStartTime,
          startBalance: newStartBalance,
          elapsedTimeMs: newElapsedTime,
          cost: newCost,
        };
      }
      return s;
    });

    const newState = {
      ...state,
      balance: newStartBalance - newCost,
      history: updatedHistory,
      totalSpent: state.totalSpent + costDiff,
    };

    updateAndSaveState(newState);
    lastUpdatedRef.current = now;
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
              IA
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight uppercase">
                IA <span className="text-blue-400">Parqueadero</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Control de Parqueo Inteligente</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
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

            {/* Google Authentication Section */}
            {isAuthLoading ? (
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-xl border border-slate-700/80 shadow-xs text-xs text-slate-400 font-bold uppercase tracking-wider animate-pulse">
                Cargando...
              </div>
            ) : currentUser ? (
              <div className="flex items-center gap-3 bg-slate-800 pl-3 pr-1 py-1 rounded-xl border border-slate-700/80 shadow-xs">
                <div className="flex items-center gap-2">
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || "Usuario"}
                      className="w-7 h-7 rounded-full border border-slate-600 shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center font-bold text-xs text-white uppercase shrink-0">
                      {(currentUser.displayName || currentUser.email || "U").substring(0, 1)}
                    </div>
                  )}
                  <div className="hidden md:block text-left">
                    <p className="text-[11px] font-bold text-white max-w-[110px] truncate">
                      {currentUser.displayName || "Usuario de Google"}
                    </p>
                    <p className="text-[9px] text-slate-400 truncate max-w-[110px]">
                      {currentUser.email}
                    </p>
                  </div>
                </div>
                <button
                  id="btn-sign-out"
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-850 hover:bg-rose-950 hover:text-rose-200 hover:border-rose-900 text-slate-300 rounded-lg border border-slate-700 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Cerrar Sesión</span>
                </button>
              </div>
            ) : (
              <button
                id="btn-google-sign-in"
                onClick={handleSignInWithGoogle}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl border border-blue-500 hover:border-blue-400 shadow-sm text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Conectar con Google
              </button>
            )}

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
                  {currentUser ? "Sesión Guardada en Nube" : "Sesión Temporal Local"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-6 mt-6 space-y-6">
        {/* Call to Connect Banner if not signed in */}
        {!isAuthLoading && !currentUser && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm" id="google-connect-banner">
            <div className="flex items-center gap-3 text-center sm:text-left flex-col sm:flex-row">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shrink-0">
                <Car className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-blue-900">Guarda tus sesiones en tu Cuenta de Google</h3>
                <p className="text-xs text-blue-700 mt-0.5">Inicia sesión para registrar de forma independiente tus recargas, historial y tiempo de parqueo en la nube.</p>
              </div>
            </div>
            <button
              id="btn-banner-google-sign-in"
              onClick={handleSignInWithGoogle}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm hover:shadow transition-all cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#ffffff"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#ffffff"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#ffffff"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ffffff"/>
              </svg>
              Conectar Cuenta
            </button>
          </div>
        )}
        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* 1. Mi Monedero Digital (WalletCard) */}
          {/* Mobile: Order 1 (Top!), Tablet: Col 1, Desktop: Cols 9-12 (Order 3) */}
          <div className="col-span-1 md:col-span-1 lg:col-span-4 order-1 lg:order-3 h-full">
            <WalletCard
              balance={state.balance}
              onRecharge={handleRecharge}
              onResetBalance={handleResetBalance}
              halfHourRate={state.halfHourRate ?? state.hourlyRate ?? 0.10}
              isActive={state.isActive}
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
              startBalance={activeSession?.startBalance ?? state.balance}
              halfHourRate={state.halfHourRate ?? state.hourlyRate ?? 0.10}
              onUpdateHalfHourRate={handleUpdateHalfHourRate}
              onUpdateActiveSession={handleUpdateActiveSession}
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
                halfHourRate={state.halfHourRate ?? state.hourlyRate ?? 0.10}
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
            <span className="font-bold text-slate-800 uppercase">Tarifa Actual:</span> ${(state.halfHourRate ?? state.hourlyRate ?? 0.10).toFixed(2)} USD / 30 Minutos
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
