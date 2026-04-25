# Outreach Engine — Demo App

Interactive MVP demo of the operator dashboard + pipeline simulator. This is the visual reference for what the production system should look like.

## Run it

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173.

## What's inside

Four tabs at the bottom:

- **Queue** — pending inbound replies triaged by Claude. Tap any to see the triage detail with draft reply + approve/edit/reject.
- **Pipeline** — all prospects grouped by state machine state. Tap any to walk through their scrape → qualify → redesign → deploy → outreach journey. The redesign step has real generated HTML previews you can shuffle.
- **Dashboard** — weekly metrics, funnel, per-campaign breakdown.
- **Controls** — campaign play/pause, prompt library, trust ladder for auto-send.

## What's real vs. mocked

Everything in this demo is mocked data — no API calls, no database, nothing persists. The redesign HTML *is* really generated at runtime from templated vertical definitions + variant tokens (palette × fonts × layout). Click "Shuffle" on the Redesign step to see the variant system in action.

In the production build, these mocks get replaced by real integrations: Google Places scraping, Claude API for vision + redesign + triage, Instantly for email sending, Unipile for LinkedIn, Supabase for state, BullMQ for queues.

See `../docs/SPEC.md` for the full production blueprint.

## File layout

```
app/
├── src/
│   ├── App.jsx       # Everything — all views and the generateRedesignHTML function
│   ├── main.jsx      # React entry
│   └── index.css     # Tailwind directives
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

The entire app is in `App.jsx` intentionally — single file for easy reference when wiring up the real version. In production this would be split across the folder structure described in the spec.

## Known limitations

- **Data resets on reload.** Nothing is persisted; approvals/rejects are in-memory state only.
- **Mock iframe previews.** The redesigned "site" rendered in the Pipeline → Redesign view is a real HTML document but uses CSS gradient blocks for imagery. Production would use scraped photos or stock imagery.
- **No real sending.** Clicking approve just marks the item handled in UI state.
- **Desktop iframe on mobile.** The preview iframe renders at desktop width inside a mobile container, so you'll need to pinch-zoom to see detail on a phone.
