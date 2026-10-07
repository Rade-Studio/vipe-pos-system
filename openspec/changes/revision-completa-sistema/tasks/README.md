# Tasks — `revision-completa-sistema`

> Task breakdown for the six-phase remediation. One `tasks-p{1..6}-*.md` per phase plus this index.
> Delivery strategy: `auto-chain` + chain strategy: `stacked-to-main`. Per-PR review budget: 400 changed lines.

## Phase Summary

| Phase | PR | Rough LOC | Target review-time | Depends on |
|-------|----|-----------|--------------------|------------|
| P1 — Realtime Publication & Skeleton | PR #1 | ~130 | ≤ 30 min | — |
| P2a — Multi-Tenant Schema | PR #2a | ~180 | ≤ 40 min | P1 (RLS gates realtime payloads after P2) |
| P2b — RLS Policies + Auth | PR #2b | ~270 | ≤ 50 min | P2a (policies depend on tenant FK) |
| P3 — Payment & Order Atomicity | PR #3 | ~330 | ≤ 50 min | P1, P2 (RPC relies on `restaurant_id`) |
| P4 — Build & Infra Safety | PR #4 | ~210 | ≤ 40 min | independent |
| P5 — Printer Listener Reliability | PR #5 | ~260 | ≤ 45 min | independent |
| P6a — Store Split | PR #6a | ~220 | ≤ 40 min | P1 (modifies TableGrid paths) |
| P6b — React Query Migration | PR #6b | ~240 | ≤ 45 min | P6a, P1 |
| P6c — Legacy Cleanup | PR #6c | ~220 | ≤ 40 min | P6b (delete legacy + log.ts migration) |
| **Total** | **9 PRs** | **~2,060** | | |

> All PRs target `main` per `stacked-to-main`. No feature/tracker branch.

## Dependency Graph

```
P1 ────────────────────────────────────────────┐
                                                │
P2a ─→ P2b ────────────────────────────────────┤
                                                ├──→ P6a ─→ P6b ─→ P6c
P3 ────────────────────────────────────────────┤     │
                                                │     │
P4  (independent) ──────────────────────────────┘     │
                                                      │
P5  (independent) ───────────────────────────────────┘
```

- P1 must merge before P6a (P6a modifies `TableGrid` realtime paths).
- P2a → P2b sequential; P2b before P6c (CHECK constraints and policies interact).
- P3 is parallel to P2 but must land before P6 (P6b queries call P3 RPCs).
- P4 and P5 are fully independent.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated total changed lines | ~2,100 |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Decision needed before apply | **No** (auto-chain) |
| Chain strategy | **stacked-to-main** |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Reasoning**: P2 (~450) and P6 (~700) exceed the 400-line budget when measured as a single PR. They are sliced as PR #2a + #2b and PR #6a + #6b + #6c respectively, all targeting `main` per `stacked-to-main`. With `auto-chain`, the orchestrator proceeds without asking the user.

### Per-PR boundary recommendations

| PR | Branch | Base | Stack order |
|----|--------|------|-------------|
| PR #1 | `sdd/revision-completa-sistema/p1-realtime` | `main` | 1 |
| PR #2a | `sdd/revision-completa-sistema/p2a-multitenant-schema` | `main` | 2 (after #1) |
| PR #2b | `sdd/revision-completa-sistema/p2b-rls-policies` | `main` | 3 (after #2a) |
| PR #3 | `sdd/revision-completa-sistema/p3-payment-atomicity` | `main` | 4 (after #2b) |
| PR #4 | `sdd/revision-completa-sistema/p4-build-infra` | `main` | 5 (parallel) |
| PR #5 | `sdd/revision-completa-sistema/p5-printer-listener` | `main` | 6 (parallel) |
| PR #6a | `sdd/revision-completa-sistema/p6a-store-split` | `main` | 7 (after #1) |
| PR #6b | `sdd/revision-completa-sistema/p6b-react-query` | `main` | 8 (after #6a) |
| PR #6c | `sdd/revision-completa-sistema/p6c-legacy-cleanup` | `main` | 9 (after #6b) |

> Because `stacked-to-main` is the chosen chain strategy, every PR targets `main` directly (no feature/tracker branch). The PR descriptions include a dependency diagram with `📍` marking the current PR.

## Per-Phase File Index

| Phase | File | Task IDs |
|-------|------|----------|
| P1 | `tasks-p1-realtime.md` | T1-01, T1-02, T1-03, T1-04, T1-05 |
| P2 | `tasks-p2-multitenant-rls.md` | T2-01, T2-02, T2-03, T2-04, T2-05, T2-06, T2-07, T2-08 |
| P3 | `tasks-p3-payment-atomicity.md` | T3-01, T3-02, T3-03, T3-04, T3-05, T3-06 |
| P4 | `tasks-p4-build-infra.md` | T4-01, T4-02, T4-03, T4-04, T4-05, T4-06, T4-07 |
| P5 | `tasks-p5-printer-listener.md` | T5-01, T5-02, T5-03, T5-04, T5-05, T5-06, T5-07 |
| P6 | `tasks-p6-state-cleanup.md` | T6-01, T6-02, T6-03, T6-04, T6-05, T6-06, T6-07, T6-08, T6-09, T6-10, T6-11, T6-12, T6-13, T6-14, T6-15 |
| Index | `README.md` (this file) | — |

## Skill Resolution

- **`chained-pr/SKILL.md`** — Loaded via orchestrator `## Skills to load before work` block. Applied to PR slicing (P2 → 2a/2b; P6 → 6a/6b/6c) and stacked-to-main branch mechanics.
- **`work-unit-commits/SKILL.md`** — Loaded via orchestrator. Applied to per-task `commit_split_hint` field: each task maps to one commit (or a small bundled commit group for closely coupled edits such as T1-03+T1-04 and T6-12).

## Apply Execution Recommendation

Because `delivery_strategy = auto-chain`, the orchestrator should launch `sdd-apply` starting with **P1** (the smallest, most-independent PR that fixes the user's reported realtime symptom). Subsequent launches slice per phase — P2 as #2a then #2b, P3 as #3, P4 as #4, P5 as #5, P6 as #6a → #6b → #6c. The orchestrator decides the launch order; this artifact documents the dependency order for that decision.
