import { CREDIT_DISPLAY_MULTIPLIER } from './config';

// Same rounding and ⚡ format as formatCredits() in public/header.js.
export function toDisplayCredits(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number((n * CREDIT_DISPLAY_MULTIPLIER).toFixed(2)) : 0;
}

export function formatCredits(value: unknown): string {
  const n = toDisplayCredits(value);
  return `${Number.isInteger(n) ? n : n.toFixed(2)}⚡`;
}
