import type { Palette, FontPair, LayoutVariant } from "@super-engine/schemas";

// ─────────────────────────────────────────────
//  Palettes — hand-picked, polished pairings
// ─────────────────────────────────────────────
export const PALETTES: Palette[] = [
  { name: "warm-ivory", bg: "#fbf7f0", fg: "#2a2520", accent: "#c0844b", muted: "#756960", surface: "#ffffff" },
  { name: "pearl-marine", bg: "#f5f8fa", fg: "#0f2035", accent: "#3a7ca5", muted: "#5a6a7a", surface: "#ffffff" },
  { name: "sage-sand", bg: "#f4f1ea", fg: "#2b3a2a", accent: "#7e9573", muted: "#5f6a5a", surface: "#ffffff" },
  { name: "charcoal-rose", bg: "#fafafa", fg: "#1a1a1a", accent: "#c47a82", muted: "#666666", surface: "#ffffff" },
  { name: "midnight-gold", bg: "#0f1419", fg: "#f5f0e6", accent: "#d4a954", muted: "#8a8a8a", surface: "#1a2028" },
  { name: "cream-terracotta", bg: "#faf5ee", fg: "#2d1f15", accent: "#b0502b", muted: "#7a5f4a", surface: "#ffffff" },
  { name: "ice-plum", bg: "#f7f5f9", fg: "#1e1833", accent: "#6b4586", muted: "#5a5569", surface: "#ffffff" },
  { name: "linen-forest", bg: "#f6f3ec", fg: "#1e2e23", accent: "#3d6b4c", muted: "#5a6a5e", surface: "#ffffff" },
];

export const FONTS: FontPair[] = [
  { name: "editorial", heading: "Playfair Display", body: "Inter", style: "serif-sans" },
  { name: "refined", heading: "Cormorant Garamond", body: "Manrope", style: "serif-sans" },
  { name: "modern", heading: "DM Serif Display", body: "DM Sans", style: "serif-sans" },
  { name: "tech", heading: "Space Grotesk", body: "Inter", style: "sans-sans" },
  { name: "classic", heading: "Libre Baskerville", body: "Source Sans 3", style: "serif-sans" },
];

export const LAYOUTS: LayoutVariant[] = [
  "hero-split",
  "hero-centered",
  "hero-asymmetric",
  "hero-editorial",
];

// Deterministic hash from UUID so the same prospect always gets the same variant
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

export interface VariantChoice {
  palette: Palette;
  fonts: FontPair;
  layout: LayoutVariant;
}

export function pickVariant(prospectId: string): VariantChoice {
  const h = fnv1a(prospectId);
  return {
    palette: PALETTES[h % PALETTES.length]!,
    fonts: FONTS[Math.floor(h / PALETTES.length) % FONTS.length]!,
    layout: LAYOUTS[Math.floor(h / (PALETTES.length * FONTS.length)) % LAYOUTS.length]!,
  };
}
