export const TOPMAN_DAILY_BRIEF_KEY_PREFIX: string;
export const MAX_LINE_MESSAGE_CHARS: number;

export function bangkokDateKey(now?: Date | number | string): string;
export function formatThaiOfficialDate(dateKey: string): string;
export function formatThaiShortDate(dateKey: string): string;
export function briefRedisKey(dateKey: string): string;

export function summarizeTopmanCoreForBrief(core?: unknown, nowMs?: number): {
  security: string;
  disaster: string;
  energy: string;
  markets: string;
  sources: string[];
  used: string[];
};

export function buildTopmanDailyBrief(input?: {
  insights?: unknown;
  core?: unknown;
  cards?: Array<{ id?: string; title?: string; summary?: string; sources?: string[] }>;
  nowMs?: number;
  existing?: Record<string, unknown> | null;
}): Record<string, unknown>;

export function isTopmanDailyBrief(value: unknown): value is Record<string, unknown>;

export function patchTopmanDailyBrief(
  brief: Record<string, unknown>,
  patch?: { lineMessage?: string; memoMarkdown?: string; nowMs?: number },
): Record<string, unknown>;

export function approveTopmanDailyBrief(
  brief: Record<string, unknown>,
  nowMs?: number,
): Record<string, unknown>;

export function markTopmanDailyBriefSent(
  brief: Record<string, unknown>,
  nowMs?: number,
): Record<string, unknown>;
