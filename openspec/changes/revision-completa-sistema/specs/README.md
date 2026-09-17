# Specs — `revision-completa-sistema`

> Multi-phase remediation of the VipePOS system. Six bounded phases with verifiable checkpoints.

## Change Summary

The VipePOS system accumulated foundational debt across realtime, security, schema integrity, build reliability, and state management. This change coordinates six PR-shaped phases to fix the root causes: missing `supabase_realtime` publication (causing cross-device mesa desync), zero RLS with plaintext credentials, non-atomic payment flows, unvalidated builds, unauthenticated printer listener, and a 748-line god-store. Phases are ordered P1 → (P2 ∥ P3) → P6; P4 and P5 are independent.

## Requirements Index

| ID | Label | Phase | File |
|----|-------|-------|------|
| R1-01 | Realtime publication enabled | P1 | `p1-realtime.md` |
| R1-02 | Realtime subscription uses merge, not full reload | P1 | `p1-realtime.md` |
| R1-03 | No flicker on realtime refetch | P1 | `p1-realtime.md` |
| R1-04 | Subscriptions unsubscribe cleanly | P1 | `p1-realtime.md` |
| R2-01 | Restaurant tenant model | P2 | `p2-multitenant-rls.md` |
| R2-02 | RLS enabled on every public table | P2 | `p2-multitenant-rls.md` |
| R2-03 | Anonymous access denied | P2 | `p2-multitenant-rls.md` |
| R2-04 | Role stored in `auth.users.app_metadata` | P2 | `p2-multitenant-rls.md` |
| R2-05 | `profiles.password` dropped | P2 | `p2-multitenant-rls.md` |
| R2-06 | `profiles.auth_user_id` linked | P2 | `p2-multitenant-rls.md` |
| R2-07 | Anonymous storage policies removed | P2 | `p2-multitenant-rls.md` |
| R3-01 | `complete_payment` is atomic | P3 | `p3-payment-atomicity.md` |
| R3-02 | `complete_payment` is idempotent | P3 | `p3-payment-atomicity.md` |
| R3-03 | Order delete cascades all children | P3 | `p3-payment-atomicity.md` |
| R3-04 | `ingredient_transactions_orders` exists | P3 | `p3-payment-atomicity.md` |
| R3-05 | Multi-payment roundtrip is atomic | P3 | `p3-payment-atomicity.md` |
| R4-01 | TypeScript errors break the build | P4 | `p4-build-infra.md` |
| R4-02 | ESLint errors break the build | P4 | `p4-build-infra.md` |
| R4-03 | CI workflow runs on every PR | P4 | `p4-build-infra.md` |
| R4-04 | Container runs as non-root | P4 | `p4-build-infra.md` |
| R4-05 | Container uses pnpm | P4 | `p4-build-infra.md` |
| R4-06 | `app` waits for `realtime` healthy | P4 | `p4-build-infra.md` |
| R4-7 | Package renamed to `vipe-pos-system` | P4 | `p4-build-infra.md` |
| R5-01 | `pos/requirements.txt` pinned | P5 | `p5-printer-listener.md` |
| R5-02 | Printer listener authenticates | P5 | `p5-printer-listener.md` |
| R5-03 | No duplicate prints within 30 s | P5 | `p5-printer-listener.md` |
| R5-04 | Encoding negotiated at startup | P5 | `p5-printer-listener.md` |
| R5-05 | Print components share renderer | P5 | `p5-printer-listener.md` |
| R6-01 | POS store split into 4 focused stores | P6 | `p6-state-cleanup.md` |
| R6-02 | React Query is the server-state source | P6 | `p6-state-cleanup.md` |
| R6-03 | `lib/supabase-service.ts` deleted | P6 | `p6-state-cleanup.md` |
| R6-04 | `lib/log.ts` is the only console logger | P6 | `p6-state-cleanup.md` |
| R6-05 | `types/models.ts` removed | P6 | `p6-state-cleanup.md` |

## Dependency Graph

```
P1 ──────────────────┐
                     ├──→ P6
P2 ──────────────────┤
                     │
P3 ──────────────────┘

P4  (independent)
P5  (independent)
```

- P1 must complete before P6 (P6 modifies `TableGrid` realtime paths)
- P2 and P3 are parallel; both must complete before P6
- P4 and P5 are fully independent of all others

## Assumptions (to confirm)

| # | Question | Default |
|---|----------|--------|
| A1 | Supabase Cloud path needed? | Local-only for this change |
| A2 | Max concurrent POS stations? | ≤ 4; invalidation-only |
| A3 | CI platform? | GitHub Actions |
| A4 | PINs currently in production? | Assume yes; rotation urgent, included in P2 |
| A5 | Supabase plan? | Free; design around 500 ms Realtime SLA |
| A6 | Printer listener scope? | Kitchen only; service-role token scoped to print topic |
| A7 | Multi-tenant model? | Shared DB, `restaurant_id` FK, per-tenant policies |
| A8 | UI language? | Spanish copy; English identifiers/comments |

## Open Questions

| # | Question | Default |
|---|----------|--------|
| Q1 | Printer listener: per-station tokens or one shared? | One per station, scoped to print topic |
| Q2 | `restaurant_id` type: `uuid` or `text` slug? | `uuid`; slug derived in a view |
| Q3 | Keep `usePOSStore` shim during P6 migration? | Thin shim for one release, then delete |
| Q4 | Data migration: backfill script or wipe-and-re-seed? | Both — idempotent backfill + `supabase db reset` path |
