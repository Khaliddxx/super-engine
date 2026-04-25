# Handoff to Claude Code

Paste this entire file into Claude Code as your first message. It tells Claude Code what you're building, what's already decided, and — importantly — what *not* to do.

---

## You are helping me build a production system from a detailed spec

Read `docs/SPEC.md` in full before writing any code. It's ~8k words, 13 sections + 2 appendices. Don't skim. Every section exists because the alternative was worse.

You're also welcome to run the demo in `app/` first (`cd app && npm install && npm run dev`) to see the target UX. The demo is the north star for what the operator surface should feel like.

## Ground rules — please respect these

**1. Don't turn the pipeline into an agent.**

The spec is deliberate about this. The orchestration layer is a **state machine**, not an agent. Each state transition is a pure function. Claude API calls happen only at specific steps (qualify, redesign, triage, drafting) — never to decide *what* to do next. If you find yourself wanting to "let Claude figure out the next step," stop and re-read Section 3.

**2. Follow the phased build plan.**

Section 10 of the spec lays out 5 phases in order. Build them in order. Don't start Phase 2 before Phase 1 is running end-to-end. Don't skip acceptance criteria. If I say "let's just do the whole thing," push back — the phasing is what makes this finish-able.

**3. Mocks first, integrations second.**

For each module (scrape, qualify, redesign, etc.), build the function signature and the happy path with mocked external data first. Write tests against the mocks. Then wire the real API. This lets me see the shape before the API bill starts.

**4. Don't start files I haven't asked for.**

Specifically: no dashboard code until Phase 2. No LinkedIn code until Phase 4. No v0 integration ever unless I explicitly request Phase 6. Appendix A of the spec has the file-by-file order.

**5. Ask me before adding dependencies.**

The spec names specific tools: Drizzle, BullMQ, Next.js, shadcn/ui, Zod. If you want to add something not in the spec, ask first. No silent swap-in of Prisma, no ORM flips, no "I preferred clsx over cn()." The stack is chosen.

**6. Prompts are versioned code, not strings.**

Every Claude prompt lives in `packages/prompts/src/` as a TypeScript file. See Section 9 of the spec for the prompt templates themselves and the versioning pattern. Don't inline prompts in business logic modules.

**7. When in doubt about scope, ask.**

If a requirement seems ambiguous or the spec seems to contradict itself, ask me before coding. I'd rather answer 3 questions than un-do 3 days of work.

## Things the spec leaves for me to decide

Section 12 of the spec lists explicit open questions. Surface these during Phase 0 before writing code. Specifically:

- Which CRM (if any) do I want WON prospects handed off to?
- How should calendar booking work — a Cal.com link in responses, or agent-suggested times from my calendar?
- Do I want GDPR-triggered data deletion as a first-class feature, or manual-only for v1?

Don't assume answers. Ask.

## What I'll do on my end

- I'll have the API keys ready before each phase starts (see `.env.example`).
- I'll test manually between phases — don't merge to main until I've run the phase end-to-end on real data.
- I'll flag prompts that produce low-quality output so you can tune them with me, not unilaterally.

## The first thing I want you to do

1. Read `docs/SPEC.md` in full. Reply with:
   - A 5-bullet summary of what you understood, in your own words
   - Any contradictions or ambiguities you spotted
   - The 3 open questions you want answered before Phase 0 starts

Don't write code yet. Don't create files yet. Just the summary + questions.

Once I respond to your questions, we start Phase 0 (step 1 = the Drizzle schema from Section 5).

---

## Context about me, the operator

- Solo builder. Evening hours. Not a full-time project.
- Comfortable with TypeScript, React, Postgres. Not an ops specialist.
- This is a standalone project, unrelated to my day work. Do not import knowledge from other contexts.
- I've been burned by over-engineered agent-based systems before. That's why the spec is so explicit about the state machine.
- I prefer pushback over agreement when your instinct is different from mine. If you think a spec decision is wrong, say so before implementing it.

Let's begin.
