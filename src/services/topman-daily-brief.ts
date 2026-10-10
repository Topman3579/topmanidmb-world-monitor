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
  isTopmanDailyBriefApprovable,
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
  revision?: string;
  serverRevision?: string | null;
  localEdited?: boolean;
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
  isTopmanDailyBriefApprovable,
  MAX_LINE_MESSAGE_CHARS,
};

const LOCAL_BRIEF_PREFIX = 'topman-daily-brief-local:';
let reviewerExpiresAt = 0;

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
  core?: unknown;
  nowMs?: number;
  existing?: TopmanDailyBrief | null;
}): TopmanDailyBrief {
  const cards: SimpleSummaryCard[] = input.summary?.cards ?? [];
  return asBrief(buildCore({
    insights: input.insights ?? null,
    core: input.core ?? null,
    cards,
    nowMs: input.nowMs,
    existing: input.existing ? toCoreRecord(input.existing) : null,
  }));
}

export function generateLocalTopmanDailyBrief(input: {
  summary: SimpleExecutiveSummary | null;
  insights?: unknown;
  core?: unknown;
  nowMs?: number;
  existing?: TopmanDailyBrief | null;
}): { brief: TopmanDailyBrief; generated: boolean } {
  const targetDateKey = bangkokDateKey(input.nowMs);
  const sameDayExisting = input.existing?.dateKey === targetDateKey ? input.existing : null;
  if (sameDayExisting?.status === 'approved' || sameDayExisting?.status === 'sent') {
    return { brief: sameDayExisting, generated: false };
  }

  return {
    brief: buildTopmanDailyBriefFromSummary({ ...input, existing: sameDayExisting }),
    generated: true,
  };
}

export function patchTopmanDailyBrief(
  brief: TopmanDailyBrief,
  patch: { lineMessage?: string; memoMarkdown?: string; nowMs?: number },
): TopmanDailyBrief {
  const next = asBrief(patchCore(toCoreRecord(brief), patch));
  next.localEdited = brief.localEdited || next.lineMessage !== brief.lineMessage || next.memoMarkdown !== brief.memoMarkdown;
  return next;
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

export function hasBriefReviewerSession(): boolean {
  return reviewerExpiresAt > Date.now();
}

export async function refreshBriefReviewerSession(): Promise<boolean> {
  try {
    const response = await fetch('/api/topman-daily-brief?session=1', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    reviewerExpiresAt = response.ok && data.authenticated && Number.isFinite(data.expiresAt) ? data.expiresAt : 0;
  } catch {
    reviewerExpiresAt = 0;
  }
  return hasBriefReviewerSession();
}

export async function startBriefReviewerSession(secret: string): Promise<boolean> {
  reviewerExpiresAt = 0;
  const response = await fetch('/api/topman-daily-brief', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'login' }),
  });
  const data = await response.json();
  reviewerExpiresAt = response.ok && data.authenticated && Number.isFinite(data.expiresAt) ? data.expiresAt : 0;
  return hasBriefReviewerSession();
}

export async function endBriefReviewerSession(): Promise<void> {
  reviewerExpiresAt = 0;
  const response = await fetch('/api/topman-daily-brief', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }),
  });
  if (!response.ok) throw new Error('Reviewer logout failed');
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
  const serverBrief = isTopmanDailyBrief(data?.brief) ? asBrief(data.brief) : null;
  if (serverBrief) { serverBrief.serverRevision = serverBrief.revision || serverBrief.updatedAt; serverBrief.localEdited = false; }
  if (resp.status === 401) reviewerExpiresAt = 0;
  return {
    ok: resp.ok,
    brief: serverBrief,
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
    expectedRevision?: string | null;
  } = {},
): Promise<TopmanDailyBriefApiResponse> {
  const resp = await fetch('/api/topman-daily-brief', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await resp.json().catch(() => ({}));
  const serverBrief = isTopmanDailyBrief(data?.brief) ? asBrief(data.brief) : null;
  if (serverBrief) { serverBrief.serverRevision = serverBrief.revision || serverBrief.updatedAt; serverBrief.localEdited = false; }
  if (resp.status === 401) reviewerExpiresAt = 0;
  return {
    ok: resp.ok,
    brief: serverBrief,
    lineConfigured: Boolean(data?.lineConfigured),
    dateKey: typeof data?.dateKey === 'string' ? data.dateKey : bangkokDateKey(),
    error: typeof data?.error === 'string' ? data.error : undefined,
  };
}
