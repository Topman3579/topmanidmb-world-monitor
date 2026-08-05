#!/usr/bin/env node
/**
 * Local/ops helper: trigger daily brief draft generation.
 *
 * Usage:
 *   TOPMAN_BRIEF_BASE_URL=https://topmanidmb-world-monitor.vercel.app \
 *   CRON_SECRET=... \
 *   node scripts/generate-topman-daily-brief.mjs
 */

const base = (process.env.TOPMAN_BRIEF_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const secret = process.env.CRON_SECRET || process.env.TOPMAN_BRIEF_ADMIN_SECRET;

if (!secret) {
  console.error('ต้องมี CRON_SECRET หรือ TOPMAN_BRIEF_ADMIN_SECRET');
  process.exit(1);
}

const url = `${base}/api/topman-daily-brief-generate`;
const resp = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await resp.text();
console.log(resp.status, body);
if (!resp.ok) process.exit(1);
