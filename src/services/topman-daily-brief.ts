/**
 * Client-facing daily executive brief helpers for TOPMAN News Room.
 * Core composition lives in shared/topman-daily-brief.js (API + tests).
 */

import type { SimpleExecutiveSummary, SimpleSummaryCard } from '@/services/topman-simple-summary';
import { topmanText } from '@/services/topman-language-mode';
import {
  approveTopmanDailyBrief as approveCore,
  bangkokDateKey,
  briefRedisKey,
  buildTopmanDailyBrief as buildCore,
  formatThaiOfficialDate,
  formatThaiShortDate,
  isTopmanDailyBrief,
  markTopmanDailyBriefSent as markSentCore,
  MAX_LINE_MESSAGE_CHARS,
  patchTopmanDailyBrief as patchCore,
} from '../../shared/topman-daily-brief.js';

export type TopmanBriefStatus = 'draft' | 'approved' | 'sent';

export interface TopmanBriefSection {
  body: string;
  caveat: string;
}

export interface TopmanDailyBrief {
  version: number;
  dateKey: string;
  status: TopmanBriefStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  lineMessage: string;
  memoMarkdown: string;
  sections: {
    security: TopmanBriefSection;
    disaster: TopmanBriefSection;
    energy: TopmanBriefSection;
    markets: TopmanBriefSection;
  };
  followUps: Array<{ item: string; reason: string }>;
  facts: string[];
  gaps: string[];
  sources: string[];
  generatedFrom: string[];
}

export {
  bangkokDateKey,
  briefRedisKey,
  formatThaiOfficialDate,
  formatThaiShortDate,
  isTopmanDailyBrief,
  MAX_LINE_MESSAGE_CHARS,
};

const LOCAL_BRIEF_PREFIX = 'topman-daily-brief-local:';
export const TOPMAN_BRIEF_ADMIN_SESSION_KEY = 'topman-brief-admin-secret';

function asBrief(value: unknown): TopmanDailyBrief {
  if (!isTopmanDailyBrief(value)) {
    throw new Error('Invalid TOPMAN daily brief payload');
  }
  return value as unknown as TopmanDailyBrief;
}

function toCoreRecord(brief: TopmanDailyBrief): Record<string, unknown> {
  return brief as unknown as Record<string, unknown>;
}

export function buildTopmanDailyBriefFromSummary(input: {
  summary: SimpleExecutiveSummary | null;
  insights?: unknown;
  nowMs?: number;
  existing?: TopmanDailyBrief | null;
}): TopmanDailyBrief {
  const cards: SimpleSummaryCard[] = input.summary?.cards ?? [];
  return asBrief(buildCore({
    insights: input.insights ?? null,
    cards,
    nowMs: input.nowMs,
    existing: input.existing ? toCoreRecord(input.existing) : null,
  }));
}

export function patchTopmanDailyBrief(
  brief: TopmanDailyBrief,
  patch: { lineMessage?: string; memoMarkdown?: string; nowMs?: number },
): TopmanDailyBrief {
  return asBrief(patchCore(toCoreRecord(brief), patch));
}

export function approveTopmanDailyBrief(brief: TopmanDailyBrief, nowMs?: number): TopmanDailyBrief {
  return asBrief(approveCore(toCoreRecord(brief), nowMs));
}

export function markTopmanDailyBriefSent(brief: TopmanDailyBrief, nowMs?: number): TopmanDailyBrief {
  return asBrief(markSentCore(toCoreRecord(brief), nowMs));
}

export function formatBriefStatusLabel(status: TopmanBriefStatus): string {
  switch (status) {
    case 'approved':
      return topmanText('อนุมัติแล้ว', 'Approved');
    case 'sent':
      return topmanText('ส่งแล้ว', 'Sent');
    default:
      return topmanText('ร่าง', 'Draft');
  }
}

export function loadLocalDailyBrief(dateKey = bangkokDateKey()): TopmanDailyBrief | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_BRIEF_PREFIX}${dateKey}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isTopmanDailyBrief(parsed) ? asBrief(parsed) : null;
  } catch {
    return null;
  }
}

export function saveLocalDailyBrief(brief: TopmanDailyBrief): void {
  try {
    localStorage.setItem(`${LOCAL_BRIEF_PREFIX}${brief.dateKey}`, JSON.stringify(brief));
  } catch {
    // private mode / quota
  }
}

export function getBriefAdminSecret(): string {
  try {
    return sessionStorage.getItem(TOPMAN_BRIEF_ADMIN_SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setBriefAdminSecret(secret: string): void {
  try {
    if (secret) sessionStorage.setItem(TOPMAN_BRIEF_ADMIN_SESSION_KEY, secret);
    else sessionStorage.removeItem(TOPMAN_BRIEF_ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
}

export interface TopmanDailyBriefApiResponse {
  ok: boolean;
  brief: TopmanDailyBrief | null;
  lineConfigured: boolean;
  dateKey: string;
  error?: string;
}

export async function fetchServerDailyBrief(dateKey?: string): Promise<TopmanDailyBriefApiResponse> {
  const q = dateKey ? `?date=${encodeURIComponent(dateKey)}` : '';
  const resp = await fetch(`/api/topman-daily-brief${q}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await resp.json().catch(() => ({}));
  return {
    ok: resp.ok,
    brief: isTopmanDailyBrief(data?.brief) ? asBrief(data.brief) : null,
    lineConfigured: Boolean(data?.lineConfigured),
    dateKey: typeof data?.dateKey === 'string' ? data.dateKey : bangkokDateKey(),
    error: typeof data?.error === 'string' ? data.error : undefined,
  };
}

export async function postDailyBriefAction(
  action: 'save' | 'approve' | 'send' | 'regenerate',
  body: {
    dateKey?: string;
    lineMessage?: string;
    memoMarkdown?: string;
    brief?: TopmanDailyBrief;
  } = {},
): Promise<TopmanDailyBriefApiResponse> {
  const secret = getBriefAdminSecret();
  const resp = await fetch('/api/topman-daily-brief', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await resp.json().catch(() => ({}));
  return {
    ok: resp.ok,
    brief: isTopmanDailyBrief(data?.brief) ? asBrief(data.brief) : null,
    lineConfigured: Boolean(data?.lineConfigured),
    dateKey: typeof data?.dateKey === 'string' ? data.dateKey : bangkokDateKey(),
    error: typeof data?.error === 'string' ? data.error : undefined,
  };
}
