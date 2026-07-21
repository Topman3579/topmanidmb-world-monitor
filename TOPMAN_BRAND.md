# TOPMANIDMB World Intelligence brand adapter

This repository is a branded fork of World Monitor, not a replacement claim over the upstream project.

## Design contract

- Identity: TOPMANIDMB Official Brand System
- Logo: The Living Emblem official mark
- Dashboard language: Command HUD
- Core palette: navy `#0a1426`, gold `#ffcb2d`, cyan `#8fd0ff`, ivory `#f7f3ea`
- Source attribution: keep `Powered by World Monitor` visible in the application header

## Public-safe boundary

- Deploy without private TOPMANIDMB feeds, credentials, case data, PII, or fleet telemetry.
- Treat all upstream public data as situational-awareness leads, not verified case truth.
- Preserve source timestamps, freshness states, and upstream data-provider attribution.
- Do not label an unavailable or stale source as live or synchronized.

## Upstream maintenance

The branded changes are intentionally isolated to:

- `src/styles/topman-brand.css`
- header identity in `src/app/panel-layout.ts`
- public brand assets under `public/brand/`
- deployment metadata in `src/config/variant-meta.ts`

Keep `upstream` pointed at `https://github.com/koala73/worldmonitor.git` and review AGPL/source-availability obligations before each public release.
