/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParkingSession {
  id: string;
  startTime: number; // timestamp
  endTime: number | null; // timestamp
  elapsedTimeMs: number; // total active time in milliseconds
  cost: number; // accumulated cost in USD
  isActive: boolean;
}

export interface ParkingState {
  balance: number; // current balance in USD
  isActive: boolean; // whether currently parked
  currentSessionId: string | null;
  history: ParkingSession[];
  totalDeposits: number; // total amount loaded
  totalSpent: number; // total amount spent on finished sessions + current session
  speedMultiplier: number; // speed coefficient (e.g., 1x, 10x, 60x, 3600x)
  lastSavedTime?: number; // timestamp of last save for catching up offline elapsed time
  hourlyRate?: number; // hourly cost in USD, defaults to 0.10
}
