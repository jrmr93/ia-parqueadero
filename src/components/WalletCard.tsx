/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Wallet, Coins, Clock, AlertTriangle, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface WalletCardProps {
  balance: number;
  onRecharge: (amount: number) => void;
  onResetBalance: () => void;
  hourlyRate?: number;
}

export default function WalletCard({ balance, onRecharge, onResetBalance, hourlyRate = 0.10 }: WalletCardProps) {
  const [customAmount, setCustomAmount] = useState<string>("");
  const [notification, setNotification] = useState<string | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState<boolean>(false);
  const [showConfirmRecharge, setShowConfirmRecharge] = useState<boolean>(false);
  const [amountToConfirm, setAmountToConfirm] = useState<number>(0);

  const handleCustomRecharge = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(customAmount);
    if (!isNaN(amount) && amount > 0) {
      if (amount > 100) {
        triggerNotification("El monto máximo por recarga es de $100.00");
        return;
      }
      setAmountToConfirm(amount);
      setShowConfirmRecharge(true);
    } else {
      triggerNotification("Por favor ingresa un monto válido mayor a $0");
    }
  };

  const confirmCustomRecharge = () => {
    onRecharge(amountToConfirm);
    triggerNotification(`¡Se han cargado $${amountToConfirm.toFixed(2)} correctamente!`);
    setCustomAmount("");
    setShowConfirmRecharge(false);
  };

  const triggerNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => {
      setNotification(null);
    }, 3000);
  };

  // Calculate remaining parking time
  // Rate: custom hourly rate
  const ratePerHour = hourlyRate;
  const totalHoursLeft = balance / ratePerHour;
  const days = Math.floor(totalHoursLeft / 24);
  const hours = Math.floor(totalHoursLeft % 24);
  const minutes = Math.floor((totalHoursLeft * 60) % 60);

  const formatRemainingTime = () => {
    if (balance <= 0) return "Sin saldo de parqueo";
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || (days === 0 && hours === 0)) parts.push(`${minutes}m`);
    return parts.join(" ");
  };

  const isLowBalance = balance > 0 && balance < hourlyRate; // less than 1 hour left

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between h-full relative overflow-hidden" id="wallet-card-container">
      {/* Background Subtle Gradient Accents */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl pointer-events-none"></div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Wallet className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-bold text-slate-700 tracking-wider uppercase">Mi Monedero Digital</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">Tarifa: ${hourlyRate.toFixed(2)}/h</span>
        </div>

        {/* Balance Display */}
        <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-5 mb-4">
          <div className="flex justify-between items-center mb-1">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Saldo Disponible</p>
            {balance > 0 && (
              <button
                onClick={() => setShowConfirmReset(true)}
                className="text-[10px] font-bold text-slate-400 hover:text-rose-600 uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                title="Reiniciar saldo a 0"
                id="btn-trigger-reset-balance"
              >
                <RotateCcw className="w-3 h-3" />
                Reiniciar
              </button>
            )}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-4xl font-black tracking-tight font-sans ${balance < 0 ? "text-rose-600" : "text-slate-900"}`} id="wallet-balance-display">
              {balance < 0 ? `-$${Math.abs(balance).toFixed(2)}` : `$${balance.toFixed(2)}`}
            </span>
            <span className="text-xs text-slate-400 font-bold uppercase">USD</span>
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              {balance > 0 ? (
                <>
                  Equivale a: <strong className="text-slate-900 font-bold">{formatRemainingTime()}</strong> de parqueo continuo
                </>
              ) : balance < 0 ? (
                <span className="text-rose-600 font-bold">Tienes una deuda activa de: -${Math.abs(balance).toFixed(2)} USD</span>
              ) : (
                <span className="text-rose-500 font-bold">Recarga saldo para poder parquear</span>
              )}
            </span>
          </div>

          {/* Inline confirmation removed in favor of gorgeous backdrop overlay modal */}
        </div>

        {/* Alerts */}
        <AnimatePresence>
          {isLowBalance && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs mb-4 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">¡Saldo Bajo!</p>
                <p>Te queda menos de 1 hora de estacionamiento disponible. Recarga pronto para evitar pausas.</p>
              </div>
            </motion.div>
          )}

          {balance === 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-3 text-xs mb-4 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Sin Saldo</p>
                <p>Tu saldo está en $0.00. No se pueden iniciar nuevas sesiones de parqueo.</p>
              </div>
            </motion.div>
          )}

          {balance < 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-rose-100 border border-rose-300 text-rose-900 rounded-lg p-3 text-xs mb-4 flex items-start gap-2 animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold uppercase tracking-wider">Deuda Activa / Saldo Negativo</p>
                <p className="mt-0.5 font-medium">Tienes una deuda acumulada de <strong className="font-mono text-rose-700">-${Math.abs(balance).toFixed(2)} USD</strong>. Realiza una recarga para saldarla.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom Recharge */}
        <div className="mb-4">
          <p className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Cargar Saldo</p>
          <div className="space-y-3">
            <form onSubmit={handleCustomRecharge} className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  placeholder="Monto"
                  id="custom-recharge-input"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full pl-6 pr-3 py-3 sm:py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white text-slate-800"
                />
              </div>
              <button
                type="submit"
                id="btn-submit-custom-recharge"
                className="px-4 py-3 sm:py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-all shadow-md shadow-blue-100 cursor-pointer"
              >
                Cargar
              </button>
            </form>

            <button
              id="btn-reset-balance-direct"
              onClick={() => setShowConfirmReset(true)}
              className="w-full py-3 sm:py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 border border-rose-200 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 text-rose-500" />
              Poner saldo en $0.00
            </button>
          </div>
        </div>
      </div>



      {/* Floating Recharge Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="absolute bottom-4 left-4 right-4 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs text-center font-medium shadow-md border border-slate-800"
          >
            {notification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Backdrop Overlay Modal */}
      <AnimatePresence>
        {showConfirmReset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" id="reset-modal-overlay">
            {/* Backdrop click to cancel */}
            <div className="absolute inset-0 bg-transparent" onClick={() => setShowConfirmReset(false)}></div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-150 z-10 overflow-hidden text-left"
              id="reset-modal-content"
            >
              {/* Decorative top colored warning accent line */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-rose-500"></div>
              
              <div className="flex items-start gap-4 mt-1">
                <div className="p-3 bg-rose-50 text-rose-500 rounded-xl shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    ¿Confirmar Reinicio de Saldo?
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    ¿Estás seguro de que realmente quieres poner tu saldo en <strong className="text-slate-900 font-bold">$0.00 USD</strong>?
                  </p>
                  <div className="text-xs text-rose-700 bg-rose-50/70 border border-rose-100 p-3 rounded-xl leading-relaxed mt-2">
                    <strong>¡Atención!</strong> Esta acción vaciará completamente el saldo del monedero y detendrá de inmediato cualquier sesión de parqueo activa.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowConfirmReset(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  id="btn-modal-cancel-reset"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onResetBalance();
                    setShowConfirmReset(false);
                    triggerNotification("Saldo reiniciado a $0.00 USD");
                  }}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-rose-200 cursor-pointer"
                  id="btn-modal-confirm-reset"
                >
                  Sí, poner en $0.00
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Recharge Confirmation Backdrop Overlay Modal */}
      <AnimatePresence>
        {showConfirmRecharge && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" id="recharge-modal-overlay">
            {/* Backdrop click to cancel */}
            <div className="absolute inset-0 bg-transparent" onClick={() => setShowConfirmRecharge(false)}></div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-150 z-10 overflow-hidden text-left"
              id="recharge-modal-content"
            >
              {/* Decorative top colored accent line */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-500"></div>
              
              <div className="flex items-start gap-4 mt-1">
                <div className="p-3 bg-blue-50 text-blue-500 rounded-xl shrink-0">
                  <Coins className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    ¿Confirmar Carga de Saldo?
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    ¿Estás seguro de que quieres cargar un monto manual de <strong className="text-slate-900 font-bold">${amountToConfirm.toFixed(2)} USD</strong> a tu monedero?
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowConfirmRecharge(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  id="btn-modal-cancel-recharge"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmCustomRecharge}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-blue-200 cursor-pointer"
                  id="btn-modal-confirm-recharge"
                >
                  Sí, cargar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
