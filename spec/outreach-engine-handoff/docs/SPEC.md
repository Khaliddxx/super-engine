# The Outreach Engine — Implementation Spec

**Version:** 1.0
**Status:** Ready for build
**Target implementor:** Solo build with Claude Code as pair programmer
**Estimated build time:** 6–8 weeks of evenings

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [The State Machine](#3-the-state-machine)
4. [Architecture](#4-architecture)
5. [Data Model](#5-data-model)
6. [Module Specifications](#6-module-specifications)
7. [External Services & Configuration](#7-external-services--configuration)
8. [The Approval Surface](#8-the-approval-surface)
9. [Prompts](#9-prompts)
10. [Build Phases](#10-build-phases)
11. [Operating the System](#11-operating-the-system)
12. [Open Questions](#12-open-questions)
13. [Optional: v0 SDK integration](#13-optional-v0-sdk-integration-phase-6)

---

## 1. Executive Summary

### What this is
An always-on service that runs an end-to-end cold outreach loop targeting local businesses with outdated websites. One prospect enters as a scraped lead, moves through qualification, redesign, outreach, followup, reply triage, and (if successful) booking — all without manual orchestration. The operator approves high-stakes moves on their phone and handles booked calls.

### What it is not
Not a general-purpose CRM. Not a multi-tenant SaaS. Not a chatbot. Not a fully autonomous system — humans approve every message that goes to prospects in month one, and approve high-stakes replies forever.

### Why this exists
Manual outreach at 100+ leads/week is possible but inbox QC kills throughput. Existing tools (Instantly, Smartlead, Heyreach) solve individual steps but none integrate the whole loop with LLM-driven reply triage. This system is the integration.

### Success criteria
- Month 1: 20 prospects processed end-to-end with full human approval; reply rate measured
- Month 3: 100 prospects/week running, operator spends ≤30 min/day on approvals
- Month 6: Auto-send enabled for low-risk categories (unsubscribes, polite passes); operator ≤15 min/day

### Explicit non-goals
- WhatsApp, SMS, Instagram DM integration
- A/B test framework (manual iteration is fine at this scale)
- Team/multi-seat support
- Mobile native app (PWA is sufficient)
- Analytics beyond basic funnel metrics

---

## 2. System Overview

### The core loop

```
SCRAPE → QUALIFY → REDESIGN → DEPLOY → SEND → WAIT → TRIAGE → RESPOND → BOOK → CLOSE
```

Each step is a pure function with a clear input, output, and failure mode. The orchestrator advances prospects through these states on a schedule; Claude API calls happen only where judgment is required (qualify, redesign copy, triage, draft responses).

### Key design principles

1. **State machine over agent.** Every prospect has exactly one state. Transitions are deterministic code, not LLM decisions. This is not negotiable — agents freestyling a 10-step pipeline will fail unpredictably at scale.
2. **Human-in-the-loop by default, autonomy by trust.** No message ships to a prospect without approval in month one. Auto-send is unlocked category-by-category as the operator gains confidence in the agent's classifications.
3. **Idempotent steps.** Every transition can be safely retried. A failed Vercel deploy doesn't corrupt state; a missed cron cycle just means the next cycle catches up.
4. **Separation of creative and compliance.** Claude generates; Instantly/Unipile send. The sending layer handles deliverability, warm-up, rate limits, and unsubscribe compliance — we don't reinvent these.
5. **Phone-first operator experience.** The operator approves from their phone while doing other things. The UI is ruthlessly minimal.

### Scope for v1

- One operator (the agency owner)
- Two channels: Email (Gmail via Instantly) and LinkedIn (via Unipile)
- Five verticals at launch: nail salon, wedding venue, plumber, dentist, hotel
- Target volume: 100 prospects/week at steady state
- Target languages: English only

---

## 3. The State Machine

### States

| State | Meaning | Entry condition | Next transitions |
|-------|---------|-----------------|------------------|
| `NEW` | Scraped from Places API, enrichment pending | Scraper wrote record | → `ENRICHED` or `REJECTED` |
| `ENRICHED` | Has email + contact data | Hunter/manual added contact | → `QUALIFIED` or `REJECTED` |
| `QUALIFIED` | Vision check passed, worth redesigning | Claude vision returned pass | → `REDESIGNED` or `REJECTED` |
| `REDESIGNED` | HTML generated and deployed | Vercel returned live URL | → `APPROVED_TO_SEND` |
| `APPROVED_TO_SEND` | Operator approved outbound (or auto-approved after trust threshold) | Operator tap or auto-rule | → `SENT` |
| `SENT` | Initial outreach delivered | Instantly confirmed delivery | → `FOLLOWUP_1` (3d), `AWAITING` (on reply), `LOST` (on bounce) |
| `FOLLOWUP_1` | First followup sent | 3 days elapsed, no reply | → `FOLLOWUP_2` (7d), `AWAITING` (on reply), `LOST` |
| `FOLLOWUP_2` | Second followup sent | 7 days after FOLLOWUP_1, no reply | → `AWAITING` (on reply), `LOST` (14d no reply) |
| `AWAITING` | Reply received, triage pending | Inbound message detected | → `RESPONDED`, `BOOKING`, `LOST`, `PAUSED` |
| `RESPONDED` | We replied, waiting for them | Operator approved reply | → `AWAITING` (on new reply), `LOST` (30d no reply) |
| `BOOKING` | Call scheduled | Calendar event created | → `WON`, `LOST` (post-call outcome) |
| `WON` | Became a customer | Operator marked won | Terminal |
| `LOST` | Explicit no, unsub, bounced, ghosted | Various | Terminal |
| `PAUSED` | Operator manual hold | Operator action | → any state (manual resume) |
| `REJECTED` | Filtered out (already has good site, invalid lead, etc.) | Enrichment or qualify failed | Terminal |

### Transitions are code, not LLM decisions

Each transition is a function in the orchestrator:

```typescript
// apps/orchestrator/src/transitions.ts
export async function promoteNewToEnriched(prospect: Prospect): Promise<TransitionResult>
export async function promoteEnrichedToQualified(prospect: Prospect): Promise<TransitionResult>
export async function promoteQualifiedToRedesigned(prospect: Prospect): Promise<TransitionResult>
// ... etc
```

Every transition returns `{ success, newState, reason, error? }` and writes a state_transitions audit row. No LLM ever writes directly to the state field.

### The orchestrator loop

Runs every 15 minutes via cron:

```
1. SELECT prospects WHERE state IN (eligible states for promotion)
2. For each, apply the appropriate transition function (with concurrency limit)
3. Fetch new inbound messages across channels → create AWAITING triage items
4. Run triage classification on AWAITING items
5. Notify operator of high-priority items
6. Log cycle stats
```

Cycle budget: 10 minutes. If it runs longer, something's wrong.

---

## 4. Architecture

### High-level diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          ORCHESTRATOR                            │
│                   (Node.js + TypeScript)                         │
│                                                                  │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐            │
│  │  Scheduler  │──▶│  Workers    │──▶│  Transitions│            │
│  │  (cron/15m) │   │  (BullMQ)   │   │  (pure fns) │            │
│  └─────────────┘   └─────────────┘   └─────────────┘            │
└────────────────┬────────────────────────────┬────────────────────┘
                 │                            │
                 ▼                            ▼
      ┌──────────────────────┐    ┌──────────────────────┐
      │      POSTGRES        │    │       REDIS          │
      │    (state + audit)   │    │    (BullMQ queues)   │
      └──────────────────────┘    └──────────────────────┘
                 │
      ┌──────────┼──────────┬──────────┬──────────┐
      ▼          ▼          ▼          ▼          ▼
  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
  │Places │  │Hunter │  │Firecrawl│  │Claude │  │Vercel │
  │  API  │  │  API  │  │  API  │  │  API  │  │  API  │
  └───────┘  └───────┘  └───────┘  └───────┘  └───────┘
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                    ┌───────────┐            ┌───────────┐
                    │ Instantly │            │  Unipile  │
                    │  (email)  │            │ (LinkedIn)│
                    └───────────┘            └───────────┘

  ┌─────────────────────────────────────────────────────┐
  │              APPROVAL SURFACE (PWA)                 │
  │    Next.js app on Vercel, JWT auth, phone-first     │
  └─────────────────────────────────────────────────────┘
```

### Services and where they run

| Service | Hosting | Cost | Notes |
|---------|---------|------|-------|
| Orchestrator | Railway or Fly.io | $10/mo | Single Node service |
| Postgres | Supabase (free tier) | $0 | Upgrade when >500MB |
| Redis | Upstash or Railway addon | $0–10/mo | For BullMQ |
| Approval PWA | Vercel | $0 | Hobby tier fine |
| Preview deploys (prospect redesigns) | Vercel | $0 | Hobby tier handles hundreds |

### Technology choices

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20 LTS
- **ORM:** Drizzle (lightweight, type-safe, easy migrations)
- **Queue:** BullMQ
- **Web framework (for approval PWA):** Next.js 14 App Router
- **Validation:** Zod schemas shared between orchestrator and PWA
- **LLM SDK:** `@anthropic-ai/sdk`
- **Scheduling:** Node cron inside the orchestrator (not external) — simpler for v1

### Repo layout

```
/outreach-engine
├── apps/
│   ├── orchestrator/          # Node service that runs the loop
│   │   ├── src/
│   │   │   ├── index.ts       # entrypoint, starts cron + workers
│   │   │   ├── scheduler.ts   # decides what to promote each cycle
│   │   │   ├── transitions/   # one file per state transition
│   │   │   ├── modules/       # scrape, qualify, redesign, send, triage
│   │   │   ├── llm/           # Claude client + prompt templates
│   │   │   ├── integrations/  # Places, Hunter, Instantly, Unipile, Vercel
│   │   │   └── lib/           # db, logging, error handling
│   │   └── package.json
│   └── approval-pwa/          # Next.js app for operator
│       ├── app/
│       │   ├── queue/         # main approval queue
│       │   ├── dashboard/     # campaign metrics
│       │   └── controls/      # start/pause/edit
│       └── package.json
├── packages/
│   ├── db/                    # Drizzle schema + migrations
│   ├── schemas/               # Zod shared types
│   └── prompts/               # Claude prompt templates (shared)
├── infra/
│   └── railway.toml           # deploy config
├── .env.example
└── README.md
```

---

## 5. Data Model

### Core tables

```sql
-- prospects: one row per business targeted
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  state VARCHAR(32) NOT NULL DEFAULT 'NEW',

  -- identity
  business_name TEXT NOT NULL,
  niche VARCHAR(64) NOT NULL,         -- 'nail-salon', 'plumber', etc.
  city TEXT,
  country VARCHAR(2),                  -- ISO code

  -- contact
  website TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,

  -- Places API data
  google_place_id TEXT UNIQUE,
  rating NUMERIC(2,1),
  review_count INT,

  -- enrichment
  scraped_services TEXT[],             -- from Firecrawl
  scraped_copy TEXT,                   -- from Firecrawl, about/hero text
  detected_year INT,                   -- estimated site age

  -- qualification
  qualification_score NUMERIC(3,2),
  qualification_reasoning TEXT,
  screenshot_url TEXT,

  -- redesign
  variant_palette VARCHAR(64),
  variant_fonts VARCHAR(64),
  variant_layout VARCHAR(64),
  redesign_html_url TEXT,              -- Vercel preview URL
  redesign_deployed_at TIMESTAMPTZ,

  -- outreach tracking
  first_sent_at TIMESTAMPTZ,
  last_touched_at TIMESTAMPTZ,

  -- outcome
  outcome VARCHAR(32),                 -- 'won', 'lost_no_reply', 'lost_unsub', etc.
  outcome_reason TEXT,

  -- audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prospects_state ON prospects(state);
CREATE INDEX idx_prospects_campaign ON prospects(campaign_id);
CREATE INDEX idx_prospects_last_touched ON prospects(last_touched_at);

-- campaigns: a batch of prospects with shared config
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  niche VARCHAR(64) NOT NULL,
  target_city TEXT,
  target_country VARCHAR(2),
  status VARCHAR(32) DEFAULT 'active', -- active | paused | complete
  max_prospects INT DEFAULT 200,

  -- config overrides
  outreach_channel VARCHAR(16) DEFAULT 'email', -- 'email' | 'linkedin' | 'both'
  auto_send_enabled BOOLEAN DEFAULT FALSE,
  auto_approve_categories TEXT[],      -- which triage categories auto-send

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- threads: one per prospect per channel (email thread, LI conversation)
CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id),
  channel VARCHAR(16) NOT NULL,        -- 'email' | 'linkedin'
  external_thread_id TEXT,             -- Instantly thread ID or Unipile chat ID
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_threads_prospect ON threads(prospect_id);
CREATE UNIQUE INDEX idx_threads_external ON threads(channel, external_thread_id);

-- messages: every message in or out
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id),
  direction VARCHAR(8) NOT NULL,       -- 'out' | 'in'
  channel VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  subject TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  external_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_thread ON messages(thread_id);

-- triage: one per inbound message needing handling
CREATE TABLE triage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE REFERENCES messages(id),
  prospect_id UUID NOT NULL REFERENCES prospects(id),

  classification VARCHAR(32),          -- booking|hot|warm|objection|notnow|unsub|human
  confidence NUMERIC(3,2),
  summary TEXT,
  draft_response TEXT,
  reasoning TEXT,
  priority VARCHAR(8),                 -- 'high' | 'medium' | 'low'

  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|approved|edited|rejected|auto_sent
  operator_note TEXT,                  -- if edited
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_triage_status ON triage(status);
CREATE INDEX idx_triage_priority ON triage(priority, status);

-- state_transitions: audit log for every state change
CREATE TABLE state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id),
  from_state VARCHAR(32),
  to_state VARCHAR(32) NOT NULL,
  reason TEXT,
  triggered_by VARCHAR(32),            -- 'scheduler' | 'operator' | 'webhook'
  triggered_by_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transitions_prospect ON state_transitions(prospect_id);

-- deployments: track every Vercel deploy for billing/cleanup
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id),
  vercel_deployment_id TEXT,
  url TEXT NOT NULL,
  html_content TEXT,                   -- for debugging/regeneration
  variant_json JSONB,                  -- palette/fonts/layout snapshot
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- market_scans: ranked (niche, city) opportunities from the market-scout module
CREATE TABLE market_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id UUID NOT NULL,           -- groups rows from the same scan
  country VARCHAR(2) NOT NULL,
  niche VARCHAR(64) NOT NULL,
  city TEXT NOT NULL,
  business_count INT,
  avg_rating NUMERIC(2,1),
  total_reviews INT,
  pct_with_website NUMERIC(3,2),
  pct_outdated_estimate NUMERIC(3,2),
  opportunity_score NUMERIC(6,2),      -- higher = better
  niche_ticket_weight NUMERIC(3,2),
  expires_at TIMESTAMPTZ,              -- 30 days from scan
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scans_score ON market_scans(scan_run_id, opportunity_score DESC);

-- operator_settings: per-operator config
CREATE TABLE operator_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_email TEXT UNIQUE NOT NULL,
  timezone TEXT DEFAULT 'Europe/Amsterdam',
  notification_channels JSONB,         -- slack webhook, push tokens, etc.
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  auto_send_rules JSONB,               -- per-category autosend thresholds
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Design notes

- **`state` is the single source of truth.** Everything else (timestamps, outcomes) is derived or metadata.
- **`state_transitions` is append-only.** Never delete. It's the replay log for debugging.
- **UUIDs everywhere.** No autoincrements — easier to avoid ID collisions across environments.
- **JSONB for flexible config** (operator_settings, campaign overrides) — but structured tables for the hot path.
- **No soft deletes.** If a prospect is `REJECTED` or `LOST`, the state reflects that. Deletion only happens on GDPR request.

---

## 6. Module Specifications

Each module is a self-contained unit with explicit inputs, outputs, and failure modes. Build them in the order listed.

### 6.0 `market-scout` module

**Input:** Target country/region, optional niche list filter
**Output:** Ranked list of (niche × city) market opportunities, saved to `market_scans` table

Optional but highly recommended. Eliminates "which niche and city should I target" paralysis by scoring candidate markets on objective signals before you commit budget to a campaign.

**Steps:**
1. Define candidate matrix: ~15 niches × ~20 cities = ~300 (niche, city) cells for the target region
2. For each cell, gather signals via Places API (cached 30 days):
   - Business count (density)
   - Average rating across top 20 results
   - Total review volume (market maturity)
   - % with websites listed on their Places record
3. Sample 5 random websites per cell and run a lightweight qualify check (reuses §6.3 logic, minus Claude vision — just the hard disqualifiers + Lighthouse score) to estimate % outdated
4. Compute a simple opportunity score per cell:

```
score = log(business_count) × pct_outdated × avg_review_volume_rank × niche_ticket_weight
```

5. Save top 30 results to `market_scans`, surface in the Controls tab as "recommended markets to launch"

**Niche ticket weights** (starting values, operator-tunable):

| Niche | Ticket weight | Typical deal size range |
|-------|---------------|-------------------------|
| Wedding venues, hotels | 2.0 | $3-8k |
| Dentists, med spas, law firms | 1.5 | $2-5k |
| Plumbers, HVAC, electricians | 1.2 | $1.5-3k |
| Restaurants, cafés | 0.8 | $800-2k |
| Nail salons, hair salons | 0.7 | $800-2k |

Higher weight = higher potential deal size = worth prioritizing even if volume is lower.

**Failure modes:**
- Places API rate limited during scan → slow down to 5 req/sec, checkpoint progress, resume
- Lighthouse API unavailable → skip `pct_outdated` for that cell, rely on age + visual heuristics only
- Scan takes too long → cap at 30 min; partial results are better than no results

**Config:**
- Runs manually or on-demand, not on cron
- Cost per full scan: ~$3-8 (Places API + a few Claude calls for cell summaries)
- Results cached for 30 days; rerun quarterly or when entering a new region

**Operator flow:**

```
You: "Scan AU for best markets"
System: runs 20 min scan, surfaces top 10
System: [shows ranked list with business counts, % outdated, est. avg deal]
You: tap "Launch campaign" on any row → pre-fills campaign config
```

### 6.1 `scrape` module

**Input:** Campaign config `{ niche, city, country, max_prospects }`
**Output:** N `prospect` rows in state `NEW`

**Steps:**
1. Call Google Places Nearby Search API with niche + city
2. For each result, call Place Details API to get website + phone
3. Filter: skip if no website, skip if domain already in DB (any campaign)
4. Insert as `NEW` prospects

**Failure modes:**
- Places API rate limited → backoff + retry
- No results → log campaign as `active_empty`, notify operator
- Malformed address → skip with reason

**Config:**
- `PLACES_API_KEY` env var
- Rate limit: 10 requests/sec (Google default)

### 6.2 `enrich` module

**Input:** Prospect in state `NEW`
**Output:** Prospect in state `ENRICHED` (or `REJECTED`)

**Steps:**
1. If no website, reject
2. Call Hunter.io domain-search for email addresses on the domain
3. Pick best email (decision-maker patterns: owner@, info@, principal's name)
4. Call Firecrawl to scrape homepage → extract services list + hero copy + detect year from footer
5. Estimate site age from: copyright year, design patterns in HTML, tech stack (jQuery vs modern)
6. Update prospect; transition to `ENRICHED`

**Failure modes:**
- No email found → transition to `REJECTED` with reason `no_email`
- Firecrawl timeout → retry once, then skip enrichment fields (still transition to `ENRICHED`)
- Site returns 403/captcha → `REJECTED` with reason `site_blocked`

**Config:**
- `HUNTER_API_KEY`, `FIRECRAWL_API_KEY`
- Cost target: <$0.05 per prospect enrichment

### 6.3 `qualify` module

**Input:** Prospect in state `ENRICHED`
**Output:** Prospect in state `QUALIFIED` (or `REJECTED`)

Qualification is **not** a single vision check. It's a multi-signal scorer that filters out zombie leads (closed businesses, chains, wrong-language sites) before spending API budget on a redesign. A pretty-but-dead site is worse than an ugly-but-alive one.

**Step 1 — Hard disqualifiers (free signals, no LLM call):**

| Signal | Source | Disqualifies if... |
|--------|--------|---------------------|
| `business_status` | Places API | `CLOSED_PERMANENTLY` |
| `review_recency` | Places API (most recent review date) | No reviews in last 540 days |
| `review_volume` | Places API | Below 20 reviews (too small) or above 2000 (likely chain) |
| `franchise_risk` | Name heuristic ("Domino's", "Supercuts" pattern match) | Matches known chain names |
| `language_match` | `franc` or `cld3` on scraped HTML | Primary language ≠ campaign target |
| `contact_reachable` | Hunter.io result | No email found AND no contact form detected |
| `domain_parked` | Site content length after Firecrawl | <500 chars of text content |

If any disqualifier hits, transition to `REJECTED` with a specific `rejection_reason`. Skip the vision step.

**Step 2 — Soft signals (weighted scoring):**

| Signal | Source | Weight |
|--------|--------|--------|
| `visual_score` | Claude vision check on screenshot (the original 1-5 rating) | 40% |
| `code_quality` | Lighthouse or PageSpeed Insights API — mobile score | 20% |
| `site_age` | Detected year from copyright/HTML patterns | 15% |
| `review_rating` | Places API average | 15% |
| `review_trajectory` | Recency of positive reviews (is the business growing?) | 10% |

**Step 3 — Judgment check (one Claude call):**

Pass the full signal bundle + the screenshot to Claude with the prompt in §9.1. Ask it to flag anything weird the signals missed: "Is this a legitimate business that would benefit from a redesign, or is there something about it that suggests we should skip?" Claude can override a borderline score with a veto (e.g., "this is a yoga studio that was sold 6 months ago — current owner may rebrand, skip").

**Final decision:**
- Hard disqualifier hit → `REJECTED`
- Soft score < 2.5 → `REJECTED`
- Soft score ≥ 3.0 AND Claude doesn't veto → `QUALIFIED`
- Soft score 2.5-3.0 → Claude makes the call

**Failure modes:**
- Screenshot fails → retry with different viewport; if still fails, reject with `screenshot_failed`
- Places API misses business_status → treat as OPERATIONAL but flag for manual review if review_recency is also stale
- Lighthouse API down → skip code_quality signal (re-weight others proportionally)
- Claude returns malformed JSON → retry with stricter prompt once, then default to soft-score-only decision

**Config:**
- `ANTHROPIC_API_KEY`
- Model: `claude-sonnet-4-5-20250929` (vision-capable)
- Cost target: <$0.02 per qualification (only one Claude call per prospect that makes it past step 1)

### 6.4 `redesign` module

**Input:** Prospect in state `QUALIFIED`
**Output:** Prospect in state `REDESIGNED` with live Vercel URL

**Steps:**
1. Load or generate the vertical template for this niche (see "Dynamic template generation" below)
2. Pick variant deterministically from prospect ID (palette + fonts + layout)
3. Choose imagery strategy based on campaign config (see "Imagery strategy" below)
4. Build the redesign prompt (see §9.2) with scraped copy + variant + template + imagery refs
5. Call Claude to generate single-file HTML
6. Validate HTML: must have `<html>`, `<style>`, hero section, services section, and a `<section id="book">` for the primary CTA anchor to land on
7. Deploy to Vercel as a static deployment (one file, unique subdomain)
8. Store URL in prospect; transition to `REDESIGNED`

**Dynamic template generation:**

Templates are stored in a `vertical_templates` table keyed by niche name. When a campaign starts in a niche that has no template yet, the system generates one in a single Claude call:

```typescript
async function getOrCreateTemplate(niche: string): Promise<VerticalTemplate> {
  const existing = await db.verticalTemplates.findByNiche(niche);
  if (existing) return existing;

  const generated = await claude.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    messages: [{ role: 'user', content: GENERATE_TEMPLATE_PROMPT({ niche }) }],
  });
  const parsed = parseTemplateJSON(generated);

  return await db.verticalTemplates.create({ niche, ...parsed, generatedAt: now() });
}
```

The generated template has the same shape as the hardcoded ones in the MVP demo: `tagline`, `heroSubtitle`, `primaryCTA`, `secondaryCTA`, `services[]`, `extraSectionTitle`, `extraSection`. Operator can edit the stored template from the Controls tab before the first send. After 10+ prospects in that niche the template stabilizes, since operator edits accumulate.

Template generation prompt is in §9.5.

**Imagery strategy:**

Four options, campaign-configurable via `campaigns.imagery_strategy`:

| Strategy | How it works | When to use |
|----------|--------------|-------------|
| `none` | CSS gradient blocks only (the MVP default) | Plumbers, dentists, general services — looks like a mockup, sells the idea |
| `scraped` | Firecrawl pulls images from prospect's current site, hosted from original URLs | If images are decent; always check they load via HEAD request before using |
| `stock` | Pexels/Unsplash API by niche keywords | Generic but polished. Safe fallback. |
| `generated` | Nano Banana / Gemini image gen with palette-aware prompts | Hotels, wedding venues, restaurants where imagery *is* the product |

Recommend starting all campaigns with `none` to pitch the *structure*, not the finished site. Switch per-campaign when testing shows better reply rate with real imagery.

**Failure modes:**
- Claude returns incomplete HTML → retry with "continue from where you left off" prompt
- Vercel deploy fails → retry with exponential backoff up to 3 times
- HTML validation fails (no `#book` anchor, broken structure) → regenerate with stricter prompt
- Imagery strategy=`scraped` but images 404 → fall back to `none` for that prospect

**HTML validation specifics:**

Every CTA in a generated redesign must scroll to a real section. The validator checks:
- All `href="#..."` anchor targets exist as IDs in the document
- Every primary CTA (`btn-primary` class) has a valid `#book` target
- The `<section id="book">` block exists and contains contact info (email + phone)

If validation fails, regenerate (max 2 retries). If still broken, mark the prospect as `REJECTED` with reason `html_validation_failed` and notify operator.

**Config:**
- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`
- Preview subdomain pattern: `{slugified-business-name}-{short-hash}.vercel.app`
- Cost target: <$0.08 per redesign

### 6.5 `send` module

**Input:** Prospect in state `APPROVED_TO_SEND` (or `SENT` for followups)
**Output:** Message sent via appropriate channel; state transitions to `SENT`, `FOLLOWUP_1`, or `FOLLOWUP_2`

**Steps:**
1. Load appropriate prompt (initial / followup_1 / followup_2, see §9.3)
2. Generate personalized message with Claude using prospect data + redesign URL
3. Get operator approval (unless auto-send enabled for this campaign + category)
4. Push to Instantly (email) or Unipile (LinkedIn) via their API
5. Record outbound message; create thread if needed
6. Transition state

**Failure modes:**
- Instantly reports bounce → prospect → `LOST` with reason `bounced`
- Unipile rate limited → defer to next cycle
- Operator rejected draft → prospect stays in current state; operator can edit + re-approve

**Config:**
- `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID` (reuse a warmed-up sending domain)
- `UNIPILE_API_KEY`, `UNIPILE_ACCOUNT_ID`
- Send window: 09:00–17:00 prospect local time; defer outside this

### 6.6 `inbox` module

**Input:** (triggered on schedule) all prospects in `SENT`, `FOLLOWUP_*`, `AWAITING`, `RESPONDED`
**Output:** New inbound messages recorded; `AWAITING` items created for new replies

**Steps:**
1. For each channel, fetch messages since `thread.last_checked_at`
2. Match to existing thread by external_thread_id
3. For each new inbound message:
   a. Insert into `messages` with direction='in'
   b. Transition prospect: `SENT` → `AWAITING`, `FOLLOWUP_*` → `AWAITING`, `RESPONDED` → `AWAITING`
   c. Enqueue triage job
4. Update `thread.last_checked_at`

**Failure modes:**
- Instantly API down → skip this cycle, log error, alert if down >1 hour
- Duplicate webhook delivery → dedupe by external_message_id

**Config:**
- Polling interval: 15 min for email, 15 min for LinkedIn
- Preferred: webhooks where supported (Instantly supports them)

### 6.7 `triage` module

**Input:** A message needing classification
**Output:** A `triage` row with classification + draft response

**Steps:**
1. Load thread history (original outreach + all replies)
2. Load prospect context (name, niche, campaign)
3. Send to Claude with triage prompt (see §9.4)
4. Parse structured response: `{ classification, confidence, summary, draft_response, priority, reasoning }`
5. Apply confidence floor: if confidence < 0.75 and classification != `unsubscribe`, downgrade to `needs_human`
6. Insert triage row; notify operator if priority='high'

**Failure modes:**
- Claude returns invalid JSON → retry once with "respond only in JSON" prompt; if still fails, priority=high, classification=needs_human
- Message is empty or only attachments → classification=needs_human

**Config:**
- Model: `claude-sonnet-4-5-20250929`
- Cost target: <$0.03 per triage

### 6.8 `approve` module

Lives in the PWA. Operator-facing.

**Views:**
- **Queue:** list of pending triage items, newest first, grouped by priority
- **Item detail:** thread history + classification + draft + approve/edit/reject
- **Dashboard:** campaign metrics
- **Controls:** start/pause campaigns, edit prompts, configure auto-send rules

**Actions:**
- Approve → marks triage `approved`, enqueues send job, optimistic state transition to `RESPONDED`
- Edit → operator modifies draft, then approves
- Reject → marks triage `rejected`; operator either writes their own reply or leaves prospect in `AWAITING`
- Mark as won/lost → manual state override for anything edge-case

**Auth:** Single-operator JWT, long-lived token stored in device. No OAuth, no session UX — this is a tool for one person.

---

## 7. External Services & Configuration

### Required third-party accounts

| Service | Purpose | Setup time | Cost (100 prospects/week) |
|---------|---------|------------|---------------------------|
| Anthropic API | Claude calls (all modules) | 5 min | ~$40/mo |
| Google Cloud (Places API) | Lead scraping | 15 min, billing setup | ~$10/mo |
| Hunter.io | Email enrichment | 5 min | $49/mo (Starter) |
| Firecrawl | Site content scraping | 5 min | $20/mo (Hobby) |
| Vercel | Preview deployments | 5 min | $0 (Hobby) |
| Instantly | Email sending + warm-up | 30 min (domain + DKIM) | $37/mo (Growth) |
| Unipile | LinkedIn messaging API | 20 min | $40/mo |
| Supabase | Postgres | 5 min | $0 (free tier) |
| Railway or Fly.io | Orchestrator hosting | 15 min | $10/mo |
| Upstash | Redis for BullMQ | 5 min | $0 (free tier) |

**Total monthly cost at 100 prospects/week: ~$210**

### Secrets management

All secrets live in environment variables. Use Railway's secret manager or Fly.io secrets. Never commit `.env` files. Keep a `.env.example` with placeholder values and descriptions.

```env
# .env.example
ANTHROPIC_API_KEY=sk-ant-...
PLACES_API_KEY=AIza...
HUNTER_API_KEY=...
FIRECRAWL_API_KEY=fc-...
VERCEL_TOKEN=...
VERCEL_TEAM_ID=team_...
INSTANTLY_API_KEY=...
INSTANTLY_CAMPAIGN_ID=...
UNIPILE_API_KEY=...
UNIPILE_ACCOUNT_ID=...
DATABASE_URL=postgres://...
REDIS_URL=redis://...
JWT_SECRET=...
OPERATOR_EMAIL=you@example.com
NOTIFY_WEBHOOK=https://hooks.slack.com/... # or expo push token, etc.
```

### Domain & DKIM setup (Instantly)

Non-negotiable before sending: buy a separate domain for cold outreach (e.g., `agency-outreach.com`). Forward it to your main site. Configure SPF, DKIM, DMARC via Instantly's wizard. Warm up for 2 weeks before first campaign. Budget: ~$15 for domain + 2 weeks of warmup time.

Do not send cold email from your primary business domain. This is a one-way trip to a spam folder.

---

## 8. The Approval Surface

### Design principles

- **Phone-first.** 90% of approvals happen on phone while walking, eating, etc.
- **One screen, one decision.** No nav drawers, no tabs for the queue view.
- **Swipe-optimized.** Left swipe = reject, right swipe = approve, tap = open for edit.
- **Notifications are curated.** Push only for `booking` and `hot` categories. Everything else batches into a 3×/day digest.

### Screens

**`/queue`** (home)
- Header: count of pending items + current auto-send status
- List of items sorted by priority (high → medium → low), then time
- Each card: classification badge, prospect name, reply summary (2 lines), 3 buttons
- Pull-to-refresh

**`/queue/:id`** (item detail)
- Full thread (original outreach → their reply)
- Classification with confidence bar
- Draft response (editable)
- Operator notes field
- Approve / Edit / Reject / Mark as handled elsewhere

**`/dashboard`**
- This week: sent, replies, bookings
- Per-campaign: funnel (new → qualified → sent → replied → booked)
- Variant performance (once enough data)
- Top prompts flagged as "needs tuning"

**`/controls`**
- Active campaigns (play/pause toggles)
- Edit prompts (initial / followup_1 / followup_2 / triage)
- Auto-send rules (category × confidence threshold)
- Notification preferences

### Tech

- Next.js 14 App Router
- Server actions for approve/edit/reject (no REST endpoints needed)
- PWA manifest for install-to-home-screen
- Tailwind + shadcn/ui for components
- Push notifications: web push API + service worker (Android) / share to Apple Push via APNs bridge (iOS)

---

## 9. Prompts

Prompts live in `/packages/prompts/` as TypeScript files so they're type-safe and testable. Never inline in business logic. Treat them as code with versions.

### 9.1 Qualification prompt

```
You are evaluating whether a local business website would benefit from a modern redesign.
You'll be shown a screenshot of the current website homepage.

<business>
Name: {name}
Niche: {niche}
City: {city}
Rating: {rating} ({review_count} reviews)
Estimated site age: {detected_year}
</business>

Rate the site on these dimensions (1-5, 1=worst, 5=best):
- Visual modernity (typography, spacing, color use)
- Information hierarchy (can a visitor find what they need?)
- Mobile-readiness (is it clearly responsive?)
- Trust signals (professional appearance, credibility)
- Conversion potential (clear CTAs, booking flow)

A site qualifies for redesign outreach if:
- At least 2 dimensions score ≤ 2
- Overall score is ≤ 3.5
- The business has enough review volume to suggest they care about their reputation (reviews > 30)

Return JSON:
{
  "pass": boolean,
  "score": number (0-5, average),
  "dimension_scores": { "visual": N, "hierarchy": N, "mobile": N, "trust": N, "conversion": N },
  "reasoning": "2-3 sentences explaining your call",
  "top_issues": ["specific issue 1", "specific issue 2", "specific issue 3"]
}
```

### 9.2 Redesign generation prompt

```
You are generating a single-file HTML redesign for a local business website.
The output will be deployed as-is and shown to the business owner in a cold outreach email.
It must be polished, modern, and specific to their business.

<business>
Name: {name}
Niche: {niche}
City: {city}
Services offered: {scraped_services}
Hero copy from current site: {scraped_copy}
Years in business: {years}
</business>

<design_system>
Palette: {palette_json}  // {name, bg, fg, accent, muted, surface}
Fonts: {fonts_json}      // {heading, body, style}
Layout: {layout_name}    // hero-split | hero-centered | hero-asymmetric | hero-editorial
</design_system>

<vertical_template>
Primary CTA: {primary_cta}
Secondary CTA: {secondary_cta}
Tagline direction: {tagline}
Hero subtitle style: {hero_subtitle_style}
Required sections: {required_sections}
</vertical_template>

Hard requirements:
- Single HTML file, everything inline (CSS in <style>, no external JS)
- Import fonts from Google Fonts (only)
- Mobile responsive (breakpoint at 768px)
- Use the provided palette as CSS variables
- Use the provided fonts for heading (serif) and body (sans)
- Include: nav, hero, services grid (3 cards), info section, footer
- Business name must appear prominently
- Services must be specific (use scraped_services, not generic)
- No stock image URLs (use CSS gradient visual blocks instead)
- Output nothing except the HTML document

Begin output with <!DOCTYPE html>.
```

### 9.3 Outreach message prompts

**Initial:**
```
Write a cold email from a web design service to a local business owner.
The email introduces a specific redesigned preview of their homepage.
Tone: warm, direct, respectful of their time. Not salesy. No jargon.

<prospect>
Business: {name}
Recipient role: Owner / Manager
Their city: {city}
Top issues with their current site: {top_issues}
</prospect>

<redesign>
Live preview: {redesign_url}
</redesign>

Requirements:
- Subject line under 50 chars
- Body under 120 words
- Reference one specific issue from top_issues (not a generic complaint)
- Include the preview link exactly once, with clear context
- No P.S.
- No "I hope this finds you well"
- Sign off with just "— {operator_first_name}"

Return JSON: { "subject": "...", "body": "..." }
```

**Followup 1 (3 days later):**
```
Write a short followup to a cold email that got no reply. Previous email showed a redesigned preview.
Tone: brief, low-pressure, useful on its own.

<context>
Previous subject: {previous_subject}
Days since initial: 3
Preview still live at: {redesign_url}
</context>

Under 60 words. One line of value added (e.g., "left the preview up in case you want to show it to anyone"). Do not use "just following up" or "bumping this". No new link.

Return JSON: { "subject": "Re: {previous_subject}", "body": "..." }
```

**Followup 2 (7 days after followup 1):**
```
Final followup. Break-up message. Polite, respectful, leaves the door open.
Do not ask for a reply. Tell them the preview will be taken down in 7 days unless they want it.

Under 40 words. Return JSON: { "subject": "Re: {previous_subject}", "body": "..." }
```

### 9.4 Triage prompt

```
You are triaging an inbound reply to a cold outreach email offering a website redesign.
The outreach showed the prospect a redesigned version of their website.

<original_outreach>
Subject: {initial_subject}
Body: {initial_body}
Sent: {initial_sent_at}
</original_outreach>

<thread_history>
{all_prior_messages_in_order}
</thread_history>

<newest_reply>
From: {from_email}
Received: {received_at}
Body:
{reply_body}
</newest_reply>

<prospect>
Business: {name}, Niche: {niche}, City: {city}
</prospect>

Classify into exactly one category:
- `booking` — they proposed a call, date, or asked to schedule
- `hot` — strong positive interest, asked about pricing or next step
- `warm` — mild interest, wants to know more, not yet ready to decide
- `objection` — specific pushback (have a dev, bad timing, not the decision maker)
- `notnow` — polite pass with soft future possibility
- `unsub` — explicit request to stop or clear "not interested"
- `human` — ambiguous, angry, confused, needs operator judgment

Return JSON ONLY (no prose, no markdown):
{
  "classification": "booking|hot|warm|objection|notnow|unsub|human",
  "confidence": 0.0-1.0,
  "priority": "high|medium|low",
  "summary": "one sentence, what they actually said",
  "draft_response": "..." | null,
  "reasoning": "why you classified it this way"
}

Draft response rules:
- Match their energy and length. If they wrote 10 words, write 20 max.
- No "Thank you for your response" corporate openers.
- For `booking`: acknowledge their proposed time, confirm, mention you'll send a calendar invite.
- For `hot`: answer their question directly (pricing: $2.5-6k typical, depends on scope), offer a 15-min call.
- For `warm`: share one concrete detail about process, ask one qualifying question.
- For `objection`: acknowledge the objection sincerely, offer one-line counterpoint if genuine, otherwise gracefully bow out.
- For `notnow`: acknowledge, leave door open, no pressure.
- For `unsub`: short "Done, removed. All the best." No pitch.
- For `human`: return draft_response: null.

Priority:
- `high`: booking, hot
- `medium`: warm, objection
- `low`: notnow, unsub, human
```

### 9.5 Vertical template generation prompt

This runs once per niche, the first time a campaign starts in that niche. Output is stored in the `vertical_templates` table and reused (with operator edits) for all prospects in that niche going forward.

```
You are defining a website template for a specific local business niche.
The template will be used to generate redesigned homepages for dozens of businesses in this niche.
It must capture what makes this niche distinctive — not just generic copy.

<niche>{niche_name}</niche>

Think about this niche like an experienced web designer would:
- What's the primary action a visitor takes? (book, call, request quote, reserve)
- What's the tone — warm and personal, urgent and technical, aspirational, trustworthy?
- What content sections do sites in this niche need?
- What services or offerings are typical at 3 tiers (entry, standard, premium)?
- What practical info do visitors actually look for (hours, pricing, location, credentials)?

Return a JSON object matching this exact shape:

{
  "tagline": "5-8 word tagline that captures the niche's essence. Ends with period.",
  "heroSubtitleStyle": "one-sentence description of how to phrase a hero subtitle for a business in this niche — you'll reference this pattern later when generating actual sites",
  "primaryCTA": "2-3 word primary action (e.g. 'Book appointment', 'Get a quote', 'Check availability')",
  "secondaryCTA": "2-3 word secondary action (e.g. 'View menu', 'See our work')",
  "services": [
    { "name": "Entry-tier offering", "desc": "One sentence, 15-25 words, specific" },
    { "name": "Standard offering", "desc": "One sentence" },
    { "name": "Premium offering", "desc": "One sentence" }
  ],
  "extraSectionTitle": "Title of a second info section (e.g. 'Booking & hours', 'Why us', 'Planning your visit')",
  "extraSectionItems": [
    { "heading": "Short heading", "body": "One sentence, specific, useful" },
    { "heading": "Short heading", "body": "One sentence" },
    { "heading": "Short heading", "body": "One sentence" }
  ],
  "suggestedImageryStrategy": "none | scraped | stock | generated — your recommendation for this niche",
  "suggestedPalettes": ["warm-ivory", "pearl-marine"],
  "suggestedFonts": ["editorial", "refined"]
}

Rules:
- No generic placeholder copy like "Our services", "Contact us". Be specific to the niche.
- Don't invent fake credentials (license numbers, years in business) — those get filled in per-prospect later.
- Services should reflect what businesses in this niche actually sell, not buzzwords.
- If the niche is broad ("restaurants"), pick a common sub-specialty and note it in the tagline.

Return the JSON object only. No preamble, no markdown fences, no explanation.
```

On operator edit, the stored template is updated but the `generatedAt` timestamp stays — so there's always an audit trail of what Claude originally produced vs. what the operator refined.

### Prompt versioning

Store prompts with version numbers. When changing a production prompt, bump the version, deploy, and tag which campaigns use which version. This lets you A/B test and roll back.

```typescript
// packages/prompts/src/triage.ts
export const TRIAGE_PROMPT_V2 = {
  version: "2.0",
  deployedAt: "2026-05-01",
  template: "..." // the string above
};
```

---

## 10. Build Phases

### Phase 0: Setup (1 evening)
- [ ] Create Supabase project, apply schema migrations
- [ ] Set up Railway project with Postgres + Redis
- [ ] Create Anthropic, Places, Hunter, Firecrawl, Vercel accounts
- [ ] Buy outreach domain, configure DNS, start Instantly warmup (runs in background for 2 weeks)
- [ ] Initialize monorepo, set up TypeScript + ESLint + Drizzle

### Phase 1: Offline pipeline (Week 1–2)
**Goal:** Scrape → Qualify → Redesign → Deploy, running end-to-end, no sending.

- [ ] `market-scout` module + CLI (`pnpm run scan --country=AU`)
- [ ] `scrape` module + tests
- [ ] `enrich` module + tests
- [ ] `qualify` module + Claude vision integration
- [ ] `redesign` module + variant system + dynamic templates
- [ ] Vercel deploy integration
- [ ] State machine scaffolding + transition logging
- [ ] Basic orchestrator cron loop
- [ ] CLI to kick off a campaign: `pnpm run campaign --from-scan=<id> --rank=1 --max=20`

**Acceptance:** Run the market scan, pick a top-ranked (niche, city), kick off a 5-prospect campaign, end up with 5 live Vercel URLs in the database. Manually review the 5 redesigns; they should be publishable quality.

### Phase 2: Sending (Week 3–4)
**Goal:** Complete domain warmup; send approved outreach; handle bounces.

- [ ] Instantly integration (send, bounce webhook)
- [ ] `send` module with prompt-based personalization
- [ ] Basic approval PWA: list of `APPROVED_TO_SEND` items, approve/edit/reject
- [ ] Followup scheduling (3d, 7d)
- [ ] Unsubscribe handling (webhook → state=LOST, reason=unsub)

**Acceptance:** Send 20 real outreach emails with manual approval. Measure reply rate and deliverability. If deliverability is < 95% or reply rate is < 3%, stop and iterate on the message prompt or warmup before continuing.

### Phase 3: Triage (Week 5–6)
**Goal:** Inbound replies get classified and drafted; operator approves drafts.

- [ ] `inbox` module for Gmail/Instantly
- [ ] `triage` module + prompt
- [ ] Approval PWA: full queue view + item detail + edit flow
- [ ] Push notifications for high-priority items
- [ ] Metrics dashboard (basic)

**Acceptance:** Process 20 real inbound replies. Measure classification accuracy — when you'd have classified it differently, note it. After 20, retune prompt if accuracy < 85%.

### Phase 4: LinkedIn (Week 7)
**Goal:** Second channel fully wired.

- [ ] Unipile integration
- [ ] LinkedIn thread detection and message polling
- [ ] Extend `send` and `inbox` to handle channel routing
- [ ] Campaign config for channel selection

**Acceptance:** Run a 10-prospect LinkedIn-only campaign. Verify messages send, replies are detected and triaged correctly.

### Phase 5: Autonomy (Week 8+)
**Goal:** Gradually unlock auto-send for unambiguous categories.

- [ ] Auto-send rules engine (category × confidence threshold)
- [ ] Per-campaign auto-send overrides
- [ ] Weekly accuracy report
- [ ] Fallback: any triage with confidence < threshold always goes to human

**Acceptance:** Auto-send for `unsub` only. Monitor for 2 weeks. If no errors, expand to `notnow` at confidence ≥ 0.9.

---

## 11. Operating the System

### Daily rhythm (post-launch)

- **Morning (5 min):** Review overnight queue on phone. Approve/edit high-priority items first.
- **Midday (5 min):** Approve any new `APPROVED_TO_SEND` drafts. Glance at dashboard.
- **Evening (5 min):** Final queue pass. Mark any booked calls in calendar. Review any `LOST` prospects for patterns.

### Weekly review (20 min, Monday)

- Check funnel metrics per campaign
- Identify prompts that need tuning (low-confidence classifications clustering in a category)
- Review any prospects in `PAUSED` — decide manual action
- Pause any campaign with reply rate < 2% after 30+ sends
- Launch next week's campaigns

### Alerts and failure modes

The system alerts the operator via Slack/push in these cases:
- Any module erroring 3+ times in an hour
- Instantly deliverability dropping below 90%
- Queue backlog > 30 pending triage items
- Campaign produces 0 qualified prospects (likely misconfigured)
- Claude API cost exceeding $5/day (threshold configurable)

### Data retention

- Prospects: keep forever unless GDPR deletion
- Messages: 2 years rolling
- State transitions: 1 year rolling
- Screenshots/HTML deployments: 90 days (Vercel cleanup job)

---

## 12. Open Questions

These should be decided before or during Phase 0. Flagged rather than assumed.

1. **Single operator now; multi-operator ever?** If yes, data model needs an `operators` table and row-level security. If no, skip.
2. **CRM integration?** Pipedrive, HubSpot, GHL, Notion — pick one if relationships with prospects extend beyond this system. Otherwise WON prospects are just flagged and handed to the operator's existing CRM manually.
3. **Calendar booking.** Does the operator want Cal.com / Calendly links in the draft responses, or should the agent suggest specific times based on the operator's free calendar? The first is simpler; the second is more personal but needs Google Calendar integration.
4. **Prospect privacy / GDPR.** For EU-based prospects, need explicit opt-out handling and data deletion on request. Document a process.
5. **Fallback when APIs break.** If Unipile goes down mid-campaign, do messages queue for retry or fail permanently? Recommend: queue for 24 hours, then alert.
6. **What defines `WON`?** Manual marking by operator, or automatic on contract signed (requires payment integration)? Recommend manual for v1.
7. **How often do templates need refreshing?** Redesigns start to look samey after a while. Plan for a quarterly refresh of palettes/fonts/layouts.

---

## 13. Optional: v0 SDK integration (Phase 6+)

Not needed for v1. Documented here so future-you (or future-Claude-Code) doesn't have to rediscover the tradeoffs.

### The opportunity

Once a prospect replies with feedback ("I like it but can you make it purple and add a gallery?"), your close rate depends on how fast you can turn that into an updated preview. v0 is Vercel's AI design tool that excels at iterative visual edits on React/Tailwind code. If you can get feedback → updated preview in under 5 minutes, you close more deals.

### Three integration modes (ranked)

**Mode C — Claude Code in the deployed repo (RECOMMENDED for v1+)**

Each deployed redesign is already a tiny Vercel project. When feedback comes in, spawn Claude Code in that repo, feed it the feedback, let it push changes, Vercel auto-redeploys. No conversion step.

- **Pro:** Zero friction with your existing pipeline. Works today.
- **Pro:** Operator can review the diff before merge.
- **Con:** Each iteration is an isolated Claude Code session — no persistent "conversation" with the prospect.

**Mode B — v0 as the editing layer**

Pipeline keeps producing single-file HTML (Claude API). When feedback comes in, operator taps a button that imports the redesign into a v0 chat session via the v0 SDK. From there, iteration happens in v0's visual canvas.

- **Pro:** v0's iteration UX is genuinely excellent for design feedback.
- **Con:** v0 expects React/Tailwind projects. Single-file HTML → v0 project is a conversion step that either requires manual work or a fragile adapter.
- **Con:** Adds another vendor to the stack. Another API to monitor, rate-limit, and pay for.

**Mode A — v0 as the generator (replaces Claude for redesign step)**

Send v0 the prospect context + design tokens at the redesign step. It returns a v0 project URL that auto-deploys to Vercel.

- **Pro:** Operator can then iterate in v0 natively from day one.
- **Con:** Output style becomes v0's house style — recognizable, and not yours.
- **Con:** Pricier per generation than the Claude API.
- **Con:** Less control over the variant system — v0 makes its own design decisions.

### Decision

Stay with Mode C (Claude Code in the repo) for Phase 6. Revisit v0 integration only if:
1. You productize this as a self-serve tool where prospects iterate their own previews, or
2. Operator feedback consistently shows v0's iteration UX would save >10 min per prospect over Claude Code.

### If Mode C is implemented, the operator-facing flow is:

1. Triage item detail shows "Iterate this design" button when feedback is actionable
2. Button opens a modal: textarea for feedback + "Run Claude Code" button
3. Backend spawns a Claude Code session in `prospect.deployment.repo_url`
4. Claude Code commits to a new branch; CI deploys a preview URL
5. Operator reviews the new preview URL; if good, merges to main (production preview URL stays stable)
6. Operator sends reply with "Here's v2 based on your feedback: [new-preview-url]"

Whole loop target: under 3 minutes from feedback received to updated preview sent.



For the solo implementor pairing with Claude Code, here's the order in which to create files. Each is independently testable.

```
Phase 1:
  packages/db/schema.ts                    # Drizzle schema
  packages/db/migrations/0001_initial.sql
  packages/schemas/src/prospect.ts         # Zod types
  packages/schemas/src/campaign.ts
  apps/orchestrator/src/lib/db.ts
  apps/orchestrator/src/lib/claude.ts      # thin SDK wrapper
  apps/orchestrator/src/integrations/places.ts
  apps/orchestrator/src/integrations/hunter.ts
  apps/orchestrator/src/integrations/firecrawl.ts
  apps/orchestrator/src/integrations/vercel.ts
  apps/orchestrator/src/modules/market-scout.ts   # §6.0 — run this first, picks the niche/city
  apps/orchestrator/src/modules/scrape.ts
  apps/orchestrator/src/modules/enrich.ts
  apps/orchestrator/src/modules/qualify.ts
  apps/orchestrator/src/modules/redesign.ts
  packages/prompts/src/qualify.ts
  packages/prompts/src/redesign.ts
  apps/orchestrator/src/transitions/*.ts   # one per state transition
  apps/orchestrator/src/scheduler.ts
  apps/orchestrator/src/cli/market-scan.ts # pnpm run scan --country=AU
  apps/orchestrator/src/cli/campaign.ts    # pnpm run campaign --from-scan=<id> --rank=1

Phase 2:
  apps/orchestrator/src/integrations/instantly.ts
  apps/orchestrator/src/modules/send.ts
  packages/prompts/src/outreach-initial.ts
  packages/prompts/src/outreach-followup.ts
  apps/approval-pwa/*                      # Next.js scaffold
  apps/approval-pwa/app/queue/page.tsx
  apps/approval-pwa/app/api/approve/route.ts

Phase 3:
  apps/orchestrator/src/modules/inbox.ts
  apps/orchestrator/src/modules/triage.ts
  packages/prompts/src/triage.ts
  apps/approval-pwa/app/queue/[id]/page.tsx

Phase 4:
  apps/orchestrator/src/integrations/unipile.ts
  apps/orchestrator/src/modules/inbox.ts   # extend for LI

Phase 5:
  apps/orchestrator/src/lib/auto-send-rules.ts
  apps/approval-pwa/app/controls/auto-send/page.tsx
```

---

## Appendix B: What to ask Claude Code when you start

When you open Claude Code in this repo, start with:

> "Read `SPEC.md` in full. Then start on Phase 0, step 1: set up the Drizzle schema from Section 5 of the spec. Ask me if anything is ambiguous before writing code."

Then one phase at a time. Don't skip phases. Don't let Claude Code skip phases. If it proposes shortcuts ("let's merge scrape and enrich into one step"), push back — the separation is what makes things retryable.

---

*End of spec.*
