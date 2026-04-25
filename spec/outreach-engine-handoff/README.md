# Outreach Engine

End-to-end automation for cold outreach to local businesses with outdated websites. Scrape leads → qualify with vision → generate redesigned preview → deploy to Vercel → send personalized outreach → triage replies → route to operator for high-stakes approvals.

## What's in this folder

```
outreach-engine-handoff/
├── README.md                       ← you are here
├── .env.example                    ← all API keys, grouped by build phase
├── HANDOFF_TO_CLAUDE_CODE.md       ← open this in Claude Code to start building
│
├── app/                            ← interactive MVP demo (runnable)
│   ├── README.md                   ← how to run the demo locally
│   ├── src/App.jsx                 ← the whole dashboard + pipeline simulator
│   ├── package.json
│   └── (Vite + React + Tailwind scaffolding)
│
└── docs/
    └── SPEC.md                     ← full production spec, ~8k words
```

## Three things to read, in order

1. **`app/README.md`** — run the demo. Get a visual feel for what you're building before you read 8k words of spec.
2. **`docs/SPEC.md`** — the complete production blueprint. State machine, data model, module specs, prompts, build phases.
3. **`HANDOFF_TO_CLAUDE_CODE.md`** — the opening prompt for Claude Code. This is what you paste into Claude Code first when you're ready to start building.

## Quick start (demo only)

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173.

## Quick start (production build)

Open Claude Code in this folder, then paste the contents of `HANDOFF_TO_CLAUDE_CODE.md` as your first message. Claude Code will follow the phased build plan from the spec.

Expected build time: 6–8 weeks of evenings (solo, with Claude Code as pair programmer).

## Status

- ✅ Demo app (this folder) — runnable, mocked data
- ✅ Full spec (`docs/SPEC.md`) — implementation-ready
- ⏳ Production build — not started. `HANDOFF_TO_CLAUDE_CODE.md` is where you pick up.

## Cost to run (rough)

| Phase | Monthly cost |
|-------|--------------|
| Phase 1 only (scrape → qualify → redesign → deploy, no sending) | ~$0–20 |
| Phase 2 (+ email sending) | ~$110/mo + $12/yr for outreach domain |
| Phase 4 (+ LinkedIn) | ~$210/mo |

See SPEC §7 for the full breakdown.
