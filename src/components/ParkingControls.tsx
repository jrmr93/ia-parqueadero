/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Play, Square, LogIn, LogOut, ArrowRight, ShieldCheck, History, AlertTriangle, Clock, Edit2, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ParkingControlsProps {
  isActive: boolean;
  balance: number;
  onStart: () => void;
  onPause: () => void;
  formattedTime: string;
  currentCost: number;
  startTime: number | null;
  hourlyRate: number;
  onUpdateHourlyRate: (rate: number) => void;
}

export default function ParkingControls({
  isActive,
  balance,
  onStart,
  onPause,
  formattedTime,
  currentCost,
  startTime,
  hourlyRate,
  onUpdateHourlyRate,
}: ParkingControlsProps) {
  
  const [showConfirmStart, setShowConfirmStart] = useState(false);
  const [showConfirmPause, setShowConfirmPause] = useState(false);
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [tempRate, setTempRate] = useState(hourlyRate.toString());
  const hasNoBalance = balance <= 0;

  const parsedRate = parseFloat(tempRate);
  const isValidRate = !isNaN(parsedRate) && parsedRate > 0 && parsedRate <= 100;

  const handleSaveRate = () => {
    if (isValidRate) {
      onUpdateHourlyRate(parsedRate);
      setIsEditingRate(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && isValidRate) {
      handleSaveRate();
    } else if (e.key === "Escape") {
      setIsEditingRate(false);
      setTempRate(hourlyRate.toString());
    }
  };

  // Format real clock time for the start timestamp
  const formatStartTime = (timestamp: number | null) => {
    if (!timestamp) return "--:--:--";
    const date = new Date(timestamp);
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between h-full" id="parking-controls-container">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Play className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-bold text-slate-700 tracking-wider uppercase">Acciones y Control</h2>
          </div>
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-sm font-bold uppercase tracking-tighter">Tarifa Fija</span>
        </div>

        {/* Informative Rate card */}
        <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-4 mb-5 text-xs text-slate-600 space-y-2">
          <div className="flex justify-between items-center pb-2 border-b border-slate-200/40">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Tarifa por hora:</span>
            {isEditingRate ? (
              <div className="flex items-center gap-1" id="hourly-rate-edit-wrapper">
                <span className="text-slate-400 font-bold font-mono">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100.00"
                  value={tempRate}
                  onChange={(e) => setTempRate(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-16 px-1 py-0.5 text-xs font-bold font-mono text-slate-800 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  id="input-hourly-rate"
                  autoFocus
                />
                <button
                  type="button"
                  id="btn-save-rate"
                  onClick={handleSaveRate}
                  disabled={!isValidRate}
                  className={`p-1 rounded cursor-pointer transition-colors ${isValidRate ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" : "bg-slate-100 text-slate-300 cursor-not-allowed"}`}
                  title="Guardar y reiniciar aplicación"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  id="btn-cancel-rate"
                  onClick={() => {
                    setIsEditingRate(false);
                    setTempRate(hourlyRate.toString());
                  }}
                  className="p-1 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded cursor-pointer transition-colors"
                  title="Cancelar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="font-bold text-slate-800">${hourlyRate.toFixed(2)} USD / hora</span>
                <button
                  type="button"
                  id="btn-edit-rate"
                  onClick={() => {
                    setTempRate(hourlyRate.toString());
                    setIsEditingRate(true);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Editar tarifa"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-slate-200/40">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Tarifa por minuto:</span>
            <span className="font-mono text-slate-700 font-bold">${(hourlyRate / 60).toFixed(5)} USD / min</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Pausa permitida:</span>
            <span className="text-blue-600 font-bold">Sí (Sin costos mientras está fuera)</span>
          </div>
        </div>

        {/* Current Active Session HUD */}
        {isActive && (
          <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-4 mb-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-rose-700 font-black uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
                Sesión de Parqueo Activa
              </span>
              <span className="text-xs font-mono text-slate-400 font-bold">Entrada: {formatStartTime(startTime)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-1">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Tiempo transcurrido</p>
                <p className="text-2xl font-black font-mono text-slate-800 tracking-tight" id="active-duration-display">
                  {formattedTime}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Costo acumulado</p>
                <p className="text-2xl font-black font-mono text-rose-600 tracking-tight" id="active-cost-display">
                  ${currentCost.toFixed(4)}
                </p>
              </div>
            </div>
          </div>
        )}

        {!isActive && (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-5 mb-5 text-center text-slate-500 text-xs">
            <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-bold text-slate-700 uppercase tracking-wide">Vehículo fuera del estacionamiento</p>
            <p className="mt-1 text-slate-400 font-medium">No se están generando cobros. Registra una entrada para iniciar el cobro por tiempo.</p>
          </div>
        )}
      </div>

      {/* Main Buttons */}
      <div className="space-y-3">
        {!isActive ? (
          <button
            type="button"
            id="btn-start-parking"
            disabled={hasNoBalance}
            onClick={() => setShowConfirmStart(true)}
            className={`w-full py-3.5 px-4 font-bold text-base rounded-xl transition-all shadow-md flex items-center justify-center gap-2 ${
              hasNoBalance
                ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white hover:shadow-lg hover:shadow-blue-100 active:scale-[0.98] cursor-pointer"
            }`}
          >
            <LogIn className="w-5 h-5 shrink-0" />
            Registrar Entrada (Entrar al Parqueo)
          </button>
        ) : (
          <button
            type="button"
            id="btn-stop-parking"
            onClick={() => setShowConfirmPause(true)}
            className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-bold text-base rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            Pausar / Registrar Salida (Salir)
          </button>
        )}

        {hasNoBalance && !isActive && (
          <p className="text-[11px] text-rose-600 text-center font-bold">
            ⚠️ Debes recargar tu saldo en "Mi Monedero" antes de poder parquear.
          </p>
        )}
      </div>

      {/* Confirm Start Modal */}
      <AnimatePresence>
        {showConfirmStart && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" id="start-modal-overlay">
            <div className="absolute inset-0 bg-transparent" onClick={() => setShowConfirmStart(false)}></div>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-150 z-10 overflow-hidden text-left"
              id="start-modal-content"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-600"></div>
              
              <div className="flex items-start gap-4 mt-1">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    ¿Iniciar Sesión de Parqueo?
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    ¿Estás seguro de que deseas registrar una entrada? Se iniciará el cobro por tiempo transcurrido en el parqueo.
                  </p>
                  <div className="text-xs text-blue-700 bg-blue-50/70 border border-blue-100 p-3 rounded-xl leading-relaxed mt-2">
                    <strong>Tarifa activa:</strong> $0.10 USD por hora ($0.00167 USD por minuto). El costo se debitará automáticamente de tu saldo disponible.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowConfirmStart(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  id="btn-modal-cancel-start"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onStart();
                    setShowConfirmStart(false);
                  }}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-blue-200 cursor-pointer"
                  id="btn-modal-confirm-start"
                >
                  Confirmar Entrada
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Pause Modal */}
      <AnimatePresence>
        {showConfirmPause && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" id="pause-modal-overlay">
            <div className="absolute inset-0 bg-transparent" onClick={() => setShowConfirmPause(false)}></div>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-150 z-10 overflow-hidden text-left"
              id="pause-modal-content"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500"></div>
              
              <div className="flex items-start gap-4 mt-1">
                <div className="p-3 bg-amber-50 text-amber-500 rounded-xl shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    ¿Pausar Sesión de Parqueo?
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    ¿Estás seguro de que deseas pausar y registrar tu salida? Esto detendrá la acumulación de cobros de forma inmediata.
                  </p>
                  <div className="text-xs text-amber-700 bg-amber-50/70 border border-amber-100 p-3 rounded-xl leading-relaxed mt-2">
                    <strong>Resumen actual:</strong> Tiempo parqueado: <strong className="font-mono text-slate-800">{formattedTime}</strong> con un costo acumulado de <strong className="font-mono text-slate-800">${currentCost.toFixed(4)} USD</strong>.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowConfirmPause(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  id="btn-modal-cancel-pause"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onPause();
                    setShowConfirmPause(false);
                  }}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-amber-200 cursor-pointer"
                  id="btn-modal-confirm-pause"
                >
                  Sí, Pausar Parqueo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
