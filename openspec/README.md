# OpenSpec — vipe-pos-system

Spec-Driven Development artifacts for the Vipe POS restaurant point-of-sale system.

Created by `sdd-init` on 2026-09-17. Edit `config.yaml` to update project conventions; phase-specific rules live under `rules:`.

## Layout

```
openspec/
├── config.yaml                       # SDD config + testing capabilities (single source of truth)
├── specs/                            # Main specs (source of truth per domain)
│   └── {domain}/spec.md
└── changes/                          # Active and archived changes
    ├── archive/                      # Completed changes (audit trail)
    │   └── YYYY-MM-DD-{slug}/
    └── {slug}/                       # Active change folder
        ├── state.yaml                # DAG state, survives compaction
        ├── exploration.md            # (optional) sdd-explore output
        ├── research.md               # (optional) sdd-research output
        ├── proposal.md               # sdd-propose
        ├── specs/{domain}/spec.md    # sdd-spec delta specs
        ├── design.md                 # sdd-design
        ├── tasks.md                  # sdd-tasks, updated by sdd-apply
        └── verify-report.md          # sdd-verify
```

## Project snapshot

- **Stack**: Next.js 15.2.4 (App Router, standalone) + React 19 + TypeScript 5 strict, Zustand, TanStack React Query, Tailwind + shadcn/ui, Supabase (PostgreSQL/Auth/Storage/Realtime), Python 3.11 print listener under `pos/`.
- **Persistence mode**: hybrid (OpenSpec + Engram).
- **Strict TDD**: `false` — no test runner is installed and no CI defines a workspace-level test command. Install a runner (vitest/playwright) before turning strict_tdd back on.
- **Delivery strategy**: auto-chain; active change slug: `revision-completa-sistema`.
