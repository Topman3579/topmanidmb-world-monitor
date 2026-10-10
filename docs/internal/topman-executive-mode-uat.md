# TOPMAN executive mode: review and acceptance

This guide uses synthetic data only. Passing automated checks does not authorize a production merge or a real LINE message.

## Use one brief

1. Open the PR Preview and choose Simple Mode. Inspect each source and its data timestamp.
2. Type into the LINE or memo editor. Edits are saved locally as you type and survive reload or switching modes.
3. Sign in with the reviewer credential using the labeled password field. The browser exchanges it for a host-only, HttpOnly, Secure, SameSite=Strict reviewer session lasting 15 minutes. No reviewer credential is stored in browser storage or retained for each request.
4. Save the draft to the server. A changed server revision is shown for comparison; loading it preserves a separate recovery draft. Restore that draft with the recovery button when needed. Sent server records cannot be overwritten. Approve only when facts, named sources, and provenance are present.
5. Editing an approved brief returns it to draft and disables sending. Save and approve the new revision again.
6. Sending uses only the server's approved revision. An atomic claim prevents concurrent duplicate delivery. If delivery is uncertain, that revision stays locked; verify the provider's receipt before any manual recovery. Sign out when finished.

This is the existing single-reviewer authority with a bounded browser session. It does not add named-user attribution or multi-user RBAC. Signing out removes the browser cookie; a copied token remains bounded by its 15-minute expiry, and changing the reviewer secret invalidates existing tokens. A named-user identity rollout remains a separate release decision.

## Verified acceptance cases

- Typed edits survive reload and mode switch regardless of client/server clock skew. A conflicting sent server copy stays visible for comparison; switching copies preserves local recovery. Revision checks and atomic compare-and-set writes reject stale server updates. Scheduled generation only creates a missing draft and never replaces reviewer work.
- Reviewer password input has a visible label and help text, masks its value, and is usable with the keyboard.
- Same-origin reviewer cookies are accepted; cross-origin mutations, malformed/tampered/expired tokens, anonymous sessions, and cron credentials are rejected.
- Unauthenticated JSON is limited to 64 KiB and five seconds; login and direct bearer authentication are limited to five attempts per minute and fails closed when its limiter is unavailable.
- Server tests use fake Redis and fake LINE transport: edits invalidate approval; client approval metadata is discarded on first save, forged client approvals and changed payloads cannot send; simultaneous sends deliver once; claim-store failure delivers zero times; successful delivery with failed persistence stays locked.
- A network exception or provider 5xx produces `DELIVERY_UNCONFIRMED` and keeps the claim. Definite 4xx rejection releases it for a corrected request.
- Mobile width 390 px has no horizontal overflow. These are targeted accessibility checks, not a full WCAG certification.
- Compact health distinguishes unavailable/degraded state from ready; a successful login page response is not health evidence.

## Trace a Preview

Match the PR head to the Vercel deployment's Git SHA, then fetch `/build-hash.txt` on that exact deployment and compare it with the head. Use the application's source link to open that commit. A protected Preview requires authorized Vercel login; do not disable protection to test it.

## Release gates

Keep the PR in Draft until the live dependency audit, required code-owner/approving review, named-user identity decision, and authorized user acceptance are resolved. The repository requires an explicit user instruction for the merge itself. Production is not changed by this guide.
