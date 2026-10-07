# Spec Index — investigar-mesa-sync-realtime

## Files

| File | Domain | Phase | Requirements | Source |
|------|--------|-------|-------------|--------|
| `infra-foundation.md` | Infrastructure | IF | IF-01, IF-02, IF-03 | **NEW** — root-cause fix |
| `p1-realtime.md` | Realtime | P1 | R1-01 – R1-06 | Lifted & adapted from `revision-completa-sistema/specs/p1-realtime.md` |
| `p2-multitenant-rls.md` | Multi-tenant RLS | P2 | R2-01 – R2-07 | Lifted from `revision-completa-sistema/specs/p2-multitenant-rls.md` |
| `p3-payment-atomicity.md` | Payment Atomicity | P3 | R3-01 – R3-05 | Lifted from `revision-completa-sistema/specs/p3-payment-atomicity.md` |
| `p4-build-infra.md` | Build & Infra | P4 | R4-01, R4-02 | Trimmed from `revision-completa-sistema/specs/p4-build-infra.md` (scope reduced) |
| `p5-printer-listener.md` | Printer Listener | P5 | R5-01 – R5-05 | Lifted from `revision-completa-sistema/specs/p5-printer-listener.md` |
| `p6-state-cleanup.md` | State & Data Layer | P6 | R6-01 – R6-05 | Lifted from `revision-completa-sistema/specs/p6-state-cleanup.md` |

## Proposal Capability Mapping

| Capability | Spec File | Notes |
|------------|-----------|-------|
| `realtime-publication` | `p1-realtime.md` | + R1-05 (two-tab), R1-06 (double-subscribe bug fix) |
| `multi-tenant-rls` | `p2-multitenant-rls.md` | Apply via `db reset` (user-confirmed) |
| `payment-atomicity` | `p3-payment-atomicity.md` | — |
| `printer-listener-reliability` | `p5-printer-listener.md` | — |
| `state-data-layer-cleanup` | `p6-state-cleanup.md` | — |
| Infra foundation (root cause) | `infra-foundation.md` | **NEW** — not in previous change |

## Requirement ID Summary

| Prefix | Count | Range |
|--------|-------|-------|
| IF | 3 | IF-01, IF-02, IF-03 |
| R1 | 6 | R1-01 – R1-06 |
| R2 | 7 | R2-01 – R2-07 |
| R3 | 5 | R3-01 – R3-05 |
| R4 | 2 | R4-01, R4-02 |
| R5 | 5 | R5-01 – R5-05 |
| R6 | 5 | R6-01 – R6-05 |
| **Total** | **33** | |

## Key Decisions

- **Apply path**: `supabase db reset` (user-confirmed, data loss accepted)
- **P4 scope reduction**: Only GoTrue Dockerfile (IF-03 equivalent) and docker-compose image swap are in scope; broader CI/non-root/pnpm hardening is follow-up
- **P1 additions**: Two-tab verification scenario (R1-05) and `subscribeToTables` double-call bug fix (R1-06)
- **R2 apply note**: No idempotent shim; `db reset` is the confirmed apply mechanism

## Next Phase

Ready for `sdd-design`. If design already exists, ready for `sdd-tasks`.
