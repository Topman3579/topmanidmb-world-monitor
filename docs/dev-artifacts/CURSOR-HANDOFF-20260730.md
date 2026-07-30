# TOPMAN World Monitor — Cursor handoff (2026-07-30)

> ผู้การสั่ง: บันทึก/จดจำ/อัพเดต + commit push · เดี๋ยวให้ **Cursor** ทำต่อ  
> Owner session: Grok Build · machine rose · verified live

## What this product is
- **TOPMAN News Room** — fork of World Monitor (AGPL) for executive Thai-first briefing
- Subtitle: ภาพรวมสถานการณ์ · โฟกัสไทย
- Public Vercel (no Tailscale, no site-wide password)
- Progressive disclosure: Simple vs Advanced (`?mode=simple|advanced`)

## Paths
| Item | Path / URL |
|------|------------|
| Local repo | `~/topmanidmb-local/projects/topmanidmb-world-monitor` |
| GitHub | `Topman3579/topmanidmb-world-monitor` (private) |
| Prod | https://topmanidmb-world-monitor.vercel.app/ |
| Upstream Pro | https://www.worldmonitor.app/dashboard |
| Playbook | https://topmanidmb-world-monitor.vercel.app/topman-pro-business-playbook.html |
| Tier1 topic | `~/.codex/claude-memory-git/topman-news-room-production-20260730.md` |
| In-repo handoff | `docs/dev-artifacts/CURSOR-HANDOFF-20260730.md` |

## HEAD / deploys (verified)
- `main` @ `7857ba7c` (PR #15 merge) · `git status` clean vs origin
- Vercel project `topmanidmb/topmanidmb-world-monitor` · Production Ready
- PRs: #12 News Room · #13 Earth links · #14 Pro desks · #15 seed_desks

## Features already shipped
1. Simple Mode UI + missions + guided tour
2. Map popup → Google Earth + Maps (outbound only)
3. Four Pro desks (tabs) from mission presets
4. Deep link install: `?seed_desks=1` or `?complete_pro=1`
5. Playbook HTML with ทำเลย checklist
6. Rose Claude Desktop: `mcpServers.worldmonitor` → `https://worldmonitor.app/mcp` (needs restart + OAuth)

## User-pending (NOT done — Cursor cannot fake these)
1. On **worldmonitor.app**: click green **ตั้งค่าให้เสร็จสมบูรณ์** with email that paid Business $49.99
2. Open once: https://topmanidmb-world-monitor.vercel.app/dashboard?mode=advanced&seed_desks=1 → confirm 4 tabs
3. **Quit/reopen Claude Desktop** → OAuth World Monitor MCP (same Pro account)
4. Optional: Thai-first UI polish across remaining chrome; Core health honesty (TOPMAN Core ≠ full system health)
5. Pause buying more data packs until briefing gaps are clear

## Recommended Cursor next work (pick with user)
| Priority | Task | Notes |
|----------|------|-------|
| P0 | Confirm user completed Pro banner + desks + MCP OAuth | Manual verify |
| P1 | Thai-primary UI pass (labels, toasts, Simple Mode copy) | i18n / topman-language-mode |
| P1 | Fix/clarify Core health vs system health in Simple summary | Avoid false "all green" |
| P2 | Entitlement parity fork vs upstream | Clerk/Dodo may not unlock Pro on fork |
| P2 | Export briefing workflow (PDF/CSV) into desk playbook | Business ROI |
| P3 | E2E for seed_desks deep link | Playwright |

## Key code map
```
src/components/TopmanSimpleMode.ts   # Simple shell + install desks button
src/services/topman-pro-desks.ts     # desk defs + build + localStorage flag
src/services/geo-external-links.ts   # Earth/Maps URLs
src/app/panel-layout.ts              # installTopmanProDesks()
src/App.ts                           # ?seed_desks=1 deep link
public/topman-pro-business-playbook.html
public/topman-welcome.html
tests/topman-pro-desks.test.mts
```

## Guardrails for Cursor
- AGPL — keep attribution; no strip license
- Public site = **sanitized only** (no raw PII / case evidence)
- Edge `api/*.js` cannot import `src/` or `server/`
- Prefer `npm ci`; sequential heavy checks in worktrees (OOM)
- **Never merge PR unless user explicitly asks to merge that PR**
- Do not invent deploy status — verify with `vercel inspect` / curl
- Vercel closeout: `vercel-arch-closeout <dir> --label "…" --vis public` or `--sync-registry-only` if PII scan false-positive on local env

## Verify commands
```bash
cd ~/topmanidmb-local/projects/topmanidmb-world-monitor
git log --oneline -5
curl -sI https://topmanidmb-world-monitor.vercel.app/ | head -5
curl -sL https://topmanidmb-world-monitor.vercel.app/topman-pro-business-playbook.html | rg -n "ทำเลย|seed_desks"
curl -sI https://worldmonitor.app/mcp | head -8
./node_modules/.bin/tsx --test tests/topman-pro-desks.test.mts
```

## Doctrine
รวบรวม → เรียบเรียง → วิเคราะห์ → นำเสนอ · ไทย-first · verification-first
