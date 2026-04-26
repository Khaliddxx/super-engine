/**
 * Layout archetypes for the redesign prompt.
 *
 * Why this exists: V2 of the redesign prompt was producing visually identical
 * sites within a niche because the prompt jumped straight to HTML with no
 * per-business creative direction. By assigning each prospect a deterministic
 * archetype (based on a hash of their ID), we force structural variance —
 * two law firms in the queue end up with two genuinely different layouts.
 *
 * Archetype IDs are stable per prospect (so a regenerate produces the same
 * archetype unless the operator overrides via `redesignInstruction`). The
 * hash is FNV-1a over the prospect ID.
 */

export interface Archetype {
  id: string;
  name: string;
  brief: string;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: "editorial",
    name: "Editorial / Magazine",
    brief: `Treat the homepage like a longform magazine cover. Display serif headline (think Fraunces, GT Sectra, or Tiempos) at clamp(2.4rem, 6vw, 5rem). Body copy in a clean grotesk. Pull-quotes set in italic at 1.5x body. Use a left-aligned single-column hero with a thin horizontal rule separating sections. Plenty of whitespace, asymmetric image placement, occasional drop caps. The vibe is "thoughtful publication", not "marketing site".`,
  },
  {
    id: "gallery-led",
    name: "Gallery-led",
    brief: `The homepage IS the imagery. Open with a full-bleed horizontally-scrolling photo strip (or large hero image with crop), copy strictly subordinate to visuals. Headlines are short, almost like exhibit captions. Use a 12-column asymmetric grid for follow-on sections — wide tiles next to tall tiles, never 3-equal-cards. Typography is restrained, image-first. Think gallery website or photographer's portfolio.`,
  },
  {
    id: "document",
    name: "Document / Newspaper",
    brief: `Set the page like a printed document. Two-column body copy below the hero (CSS columns) on desktop, single-column on mobile. Use a serif typeface throughout. Section headings are small caps in a thin sans (eyebrow style). Justified text in long passages. Include a "Table of contents"-style sidebar nav on long pages. Subtle paper-textured background OR pure off-white (#f6f3ee). The vibe is "this business has gravitas".`,
  },
  {
    id: "card-grid-asymmetric",
    name: "Asymmetric Card Grid",
    brief: `Aggressive use of CSS Grid with asymmetric tile sizes. Hero is one large tile filling 8/12 columns, with a 4/12 column tile next to it carrying the primary CTA. Below: a bento-style grid where every tile is a different aspect ratio. Bold sans-serif headlines (Inter Tight, Plus Jakarta, or Space Grotesk) at heavy weights. Lots of color blocks. NEVER 3-equal-cards.`,
  },
  {
    id: "scroll-narrative",
    name: "Scroll Narrative",
    brief: `Each home section is a full-viewport-height scene that tells a chapter of the business's story. Sticky headers within sections. Strong vertical rhythm. Each section uses different layout primitives (left-image-right-copy, full-bleed photo, centered editorial, split type/image). Subtle scroll-triggered reveals via CSS transitions on intersection (use simple opacity/translate, no JS frameworks). The vibe is "scrolling through a deck", not browsing a directory.`,
  },
  {
    id: "brutalist",
    name: "Modern Brutalist",
    brief: `Heavy borders, monospace touches, raw aesthetic. Solid black or saturated brand color frames around content blocks. A monospace pairing for eyebrows and metadata (JetBrains Mono, IBM Plex Mono). Display type is condensed and uppercase. Minimal rounded corners. The page feels engineered, not decorated. Use this archetype for businesses with gravitas (law, finance, security) where a "soft minimal" treatment would feel too generic.`,
  },
  {
    id: "soft-minimal",
    name: "Soft Minimal",
    brief: `Generous whitespace, single-column body, light pastel surface (off-white or muted cream), soft shadows. Type is a refined humanist sans (Inter, Plus Jakarta) at moderate weights, NEVER bold-everything. CTAs are quietly confident — pill buttons with thin borders, not loud accent fills. Imagery uses rounded-2xl or rounded-3xl with subtle drop shadows. The vibe is "boutique, considered, calm".`,
  },
  {
    id: "split-screen",
    name: "Split-Screen Hero",
    brief: `Homepage hero is a 50/50 split: full-bleed image on one side, copy stack on the other. Below the hero, alternate horizontal split sections (image-left/copy-right, then copy-left/image-right). Maintain a strong vertical line dividing every section. Typography is editorial — display serif paired with a tight sans. Mobile collapses splits to stacked rows. The vibe is "art-directed lookbook".`,
  },
];

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned
  return h >>> 0;
}

/**
 * Deterministic archetype pick from prospect ID. Same prospect always gets
 * the same archetype (so regens are stable), but different prospects in the
 * same niche will land on different archetypes — which is the whole point.
 */
export function pickArchetype(prospectId: string): Archetype {
  const idx = fnv1a(prospectId) % ARCHETYPES.length;
  return ARCHETYPES[idx]!;
}
