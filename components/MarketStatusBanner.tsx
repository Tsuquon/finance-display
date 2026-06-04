'use client';

import { useState, useEffect } from 'react';
import { getSessionUsage, TOKEN_EVENT, type TokenUsage } from '@/lib/tokenUsage';

// NYSE observed holidays
const NYSE_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-20', // MLK Day
  '2025-02-17', // Presidents' Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed; Jul 4 is Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
]);

const SEC_OPEN  = 9 * 3600 + 30 * 60; // 9:30 AM ET
const SEC_CLOSE = 16 * 3600;           // 4:00 PM ET

function getETComponents(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  let hour = parseInt(parts.hour);
  if (hour === 24) hour = 0; // some browsers emit 24 for midnight
  const minute = parseInt(parts.minute);
  const second = parseInt(parts.second);
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month), // 1-indexed
    day: parseInt(parts.day),
    weekday: parts.weekday,       // 'Mon' … 'Sun'
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    totalSec: hour * 3600 + minute * 60 + second,
  };
}

// Check if a given ET calendar date is a trading day.
// Uses noon UTC to avoid DST boundary issues when constructing the Date.
function isTradeDay(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short',
    }).formatToParts(d).map(p => [p.type, p.value])
  );
  return (
    parts.weekday !== 'Sat' &&
    parts.weekday !== 'Sun' &&
    !NYSE_HOLIDAYS.has(`${parts.year}-${parts.month}-${parts.day}`)
  );
}

function getMarketInfo(now: Date): { isOpen: boolean; secsUntil: number } {
  const et = getETComponents(now);
  const todayTrades = isTradeDay(et.year, et.month, et.day);
  const isOpen = todayTrades && et.totalSec >= SEC_OPEN && et.totalSec < SEC_CLOSE;

  if (isOpen) {
    return { isOpen: true, secsUntil: SEC_CLOSE - et.totalSec };
  }

  if (todayTrades && et.totalSec < SEC_OPEN) {
    return { isOpen: false, secsUntil: SEC_OPEN - et.totalSec };
  }

  // After close or weekend/holiday — find next trading day's 9:30 AM
  const secsUntilMidnight = 86400 - et.totalSec;
  for (let ahead = 1; ahead <= 7; ahead++) {
    if (isTradeDay(et.year, et.month, et.day + ahead)) {
      return {
        isOpen: false,
        secsUntil: secsUntilMidnight + (ahead - 1) * 86400 + SEC_OPEN,
      };
    }
  }

  return { isOpen: false, secsUntil: 0 };
}

function fmtCountdown(secs: number): string {
  if (secs <= 0) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export default function MarketStatusBanner() {
  const [info, setInfo] = useState<{ isOpen: boolean; secsUntil: number } | null>(null);
  const [tokens, setTokens] = useState<TokenUsage>({ input: 0, output: 0, cacheRead: 0 });

  useEffect(() => {
    const update = () => setInfo(getMarketInfo(new Date()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setTokens(getSessionUsage());
    const handler = (e: Event) => setTokens((e as CustomEvent<TokenUsage>).detail);
    window.addEventListener(TOKEN_EVENT, handler);
    return () => window.removeEventListener(TOKEN_EVENT, handler);
  }, []);

  if (!info) return null;

  const totalTokens = tokens.input + tokens.output + tokens.cacheRead;

  return (
    <div
      className={`w-full shrink-0 flex items-center px-4 py-1.5 text-xs font-medium border-b ${
        info.isOpen
          ? 'bg-emerald-950/60 border-emerald-900/50 text-emerald-400'
          : 'bg-gray-950 border-gray-800/60 text-gray-500'
      }`}
    >
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
            info.isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
          }`}
        />
        {info.isOpen ? (
          <>
            US Market{' '}
            <span className="font-semibold text-emerald-300">open</span>
            <span className="text-emerald-700 mx-1">·</span>
            closes in{' '}
            <span className="font-mono tabular-nums">{fmtCountdown(info.secsUntil)}</span>
          </>
        ) : (
          <>
            US Market{' '}
            <span className="font-semibold text-gray-400">closed</span>
            <span className="text-gray-700 mx-1">·</span>
            opens in{' '}
            <span className="font-mono tabular-nums">{fmtCountdown(info.secsUntil)}</span>
          </>
        )}
      </div>
      <div className="flex-1 flex justify-end">
        <span
          className="font-mono tabular-nums text-gray-500"
          title={`Input: ${tokens.input.toLocaleString()} · Output: ${tokens.output.toLocaleString()} · Cache read: ${tokens.cacheRead.toLocaleString()}`}
        >
          {fmtTokens(totalTokens)} tok
        </span>
      </div>
    </div>
  );
}
