import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Inbox, LayoutDashboard, Settings, Workflow, Play, Pause, Check, X, Edit3,
  ArrowLeft, Flame, Calendar, MessageSquare, AlertCircle, Clock, Send, Eye,
  ChevronRight, Bell, BellOff, Plus, MoreVertical, Zap, Shield, ExternalLink,
  User, Building2, MapPin, Star, Sparkles, Search, Globe, Copy, Shuffle,
  Loader2, RefreshCw, Rocket
} from 'lucide-react';

// ============================================================================
// DESIGN TOKEN LIBRARY
// ============================================================================

const PALETTES = [
  { id: 'warm-ivory', name: 'Warm Ivory', bg: '#F5EFE6', fg: '#1A1512', muted: '#6B5B4D', accent: '#C65D3A', surface: '#FFFFFF' },
  { id: 'cloud-lavender', name: 'Cloud Lavender', bg: '#E8E4F0', fg: '#2A2438', muted: '#6B6580', accent: '#7B6FA8', surface: '#F5F2F8' },
  { id: 'pearl-marine', name: 'Pearl Marine', bg: '#F0F4F5', fg: '#0F2027', muted: '#516B70', accent: '#2C5F6F', surface: '#FFFFFF' },
  { id: 'rust-bone', name: 'Rust & Bone', bg: '#EDE4D3', fg: '#2B1810', muted: '#7A5C4A', accent: '#A0411E', surface: '#F7F0E3' },
  { id: 'forest-moss', name: 'Forest Moss', bg: '#E8EDE4', fg: '#1A2416', muted: '#5A6B52', accent: '#3D5A2E', surface: '#F2F5EF' },
  { id: 'charcoal-gold', name: 'Charcoal Gold', bg: '#1A1A1A', fg: '#F0EBE0', muted: '#888377', accent: '#C9A961', surface: '#242424' },
  { id: 'deep-rose', name: 'Deep Rose', bg: '#F5E8E8', fg: '#2A1518', muted: '#8A6670', accent: '#A63D52', surface: '#FAF0F0' },
  { id: 'terracotta-sage', name: 'Terracotta Sage', bg: '#F0E6D9', fg: '#2B2017', muted: '#75665A', accent: '#B8613D', surface: '#F9F1E6' },
];

const FONT_PAIRS = [
  { id: 'editorial', heading: 'Cormorant Garamond', body: 'Outfit', headingWeight: 500 },
  { id: 'refined', heading: 'Fraunces', body: 'Inter', headingWeight: 400 },
  { id: 'classic-lux', heading: 'Playfair Display', body: 'DM Sans', headingWeight: 500 },
  { id: 'modern-serif', heading: 'Libre Caslon Text', body: 'Work Sans', headingWeight: 400 },
  { id: 'condensed-bold', heading: 'Barlow Condensed', body: 'Barlow', headingWeight: 600 },
  { id: 'elegant-sans', heading: 'Syne', body: 'Manrope', headingWeight: 600 },
];

const LAYOUTS = [
  { id: 'hero-split', name: 'Hero Split' },
  { id: 'hero-centered', name: 'Hero Centered' },
  { id: 'hero-asymmetric', name: 'Asymmetric' },
  { id: 'hero-editorial', name: 'Editorial' },
];

// ============================================================================
// VERTICAL TEMPLATES
// ============================================================================

const VERTICALS = {
  'nail-salon': {
    tagline: 'Where hands become art.',
    heroSubtitle: (l) => `A ${l.city} nail salon built around detail, hygiene, and the quiet craft of a perfect finish.`,
    primaryCTA: 'Book an appointment', secondaryCTA: 'View services',
    services: [
      { name: 'Signature Gel Manicure', desc: '14-day chip-free finish with our signature prep and cuticle care.' },
      { name: 'Builder-Gel Extensions', desc: 'Natural-look length with structured overlay. Soak-off, no damage.' },
      { name: 'Russian Pedicure', desc: 'Dry, precise, deeply restorative. Our most-loved treatment.' },
    ],
    extraSectionTitle: 'Booking & hours',
    extraSection: (l) => `<div class="info-grid">
      <div><strong>Walk-ins</strong><p>Welcome Tue–Sat, 10am–6pm.</p></div>
      <div><strong>Bookings</strong><p>Secure your slot 24/7 online.</p></div>
      <div><strong>Location</strong><p>${l.city} CBD, ground floor.</p></div>
    </div>`,
  },
  'wedding-venue': {
    tagline: 'The day, held beautifully.',
    heroSubtitle: (l) => `A ${l.city} estate for weddings held with precision and warmth. Capacity 40–280.`,
    primaryCTA: 'Request site visit', secondaryCTA: 'Download brochure',
    services: [
      { name: 'Ceremony & Reception', desc: 'Full-day exclusive use. Indoor chapel, garden ceremony lawn, grand ballroom.' },
      { name: 'Intimate Elopement', desc: 'Curated micro-weddings up to 30 guests. Officiant, florals, dinner included.' },
      { name: 'Multi-day Celebration', desc: 'Welcome dinner, main day, next-morning brunch. On-site accommodation.' },
    ],
    extraSectionTitle: 'What\'s included',
    extraSection: () => `<div class="info-grid">
      <div><strong>Planning</strong><p>Dedicated coordinator from booking to day-of.</p></div>
      <div><strong>Catering</strong><p>In-house kitchen, seasonal menus, full bar.</p></div>
      <div><strong>Staying</strong><p>Bridal suite + 14 guest rooms on property.</p></div>
    </div>`,
  },
  'plumber': {
    tagline: 'Fixed right. Fixed fast.',
    heroSubtitle: (l) => `24/7 emergency plumbing across ${l.city}. Licensed, insured, upfront quotes before we start work.`,
    primaryCTA: 'Call now', secondaryCTA: 'Get a quote',
    services: [
      { name: 'Emergency & Burst Pipes', desc: '60-min response in metro areas. Fully equipped vans, no callout surcharge on weekends.' },
      { name: 'Hot Water Systems', desc: 'Repair, replacement, install. Gas, electric, heat-pump. Same-day where possible.' },
      { name: 'Drain & Sewer', desc: 'CCTV inspection, high-pressure jetting, root removal. Fix the cause, not the symptom.' },
    ],
    extraSectionTitle: 'Why us',
    extraSection: (l) => `<div class="info-grid">
      <div><strong>Licensed</strong><p>Master Plumber Lic. #${20000 + l.id * 137}. Fully insured.</p></div>
      <div><strong>Upfront pricing</strong><p>Quote before work begins. No surprise invoices.</p></div>
      <div><strong>${l.reviews}+ reviews</strong><p>${l.rating}★ across Google and local trade directories.</p></div>
    </div>`,
  },
  'dentist': {
    tagline: 'A calmer kind of dentistry.',
    heroSubtitle: (l) => `Modern general and cosmetic dentistry in ${l.city}. Same-day emergency appointments available.`,
    primaryCTA: 'Book consultation', secondaryCTA: 'New patient info',
    services: [
      { name: 'General & Preventive', desc: 'Check-ups, hygiene, fillings. Health-fund claims processed on the spot.' },
      { name: 'Cosmetic & Veneers', desc: 'Digital smile design, porcelain veneers, whitening. Preview before you commit.' },
      { name: 'Implants & Reconstruction', desc: 'In-house surgery, guided implants, full-mouth rehabilitation. Sedation available.' },
    ],
    extraSectionTitle: 'For new patients',
    extraSection: () => `<div class="info-grid">
      <div><strong>First visit</strong><p>Comprehensive exam, X-rays, treatment plan — from $189.</p></div>
      <div><strong>Payment plans</strong><p>Afterpay, SuperCare, Humm. Spread major treatment.</p></div>
      <div><strong>Anxiety-friendly</strong><p>Sedation, headphones, weighted blankets, slow pace.</p></div>
    </div>`,
  },
  'hotel': {
    tagline: 'Stay like you meant to.',
    heroSubtitle: (l) => `A ${l.city} retreat of 42 rooms, one restaurant, and a quiet pool. Ten minutes from the beach.`,
    primaryCTA: 'Check availability', secondaryCTA: 'Explore the property',
    services: [
      { name: 'Rooms & Suites', desc: 'Queen, King, and two-bedroom suites. Garden or ocean view. All with terraces.' },
      { name: 'The Restaurant', desc: 'Seasonal coastal menu, open breakfast through dinner. Non-guests welcome.' },
      { name: 'Weddings & Retreats', desc: 'Full-property buyouts for up to 80 guests. Wellness and yoga programming on request.' },
    ],
    extraSectionTitle: 'Planning your stay',
    extraSection: () => `<div class="info-grid">
      <div><strong>Check-in</strong><p>From 3pm. Early arrival welcome.</p></div>
      <div><strong>Direct rate</strong><p>Book here for lowest rate + breakfast included.</p></div>
      <div><strong>Getting here</strong><p>90 min from the airport. Transfers on request.</p></div>
    </div>`,
  },
};

// ============================================================================
// UNIFIED DATA MODEL - prospects exist in the pipeline AND the triage queue
// ============================================================================

const PROSPECTS = [
  { id: 1, state: 'AWAITING', name: 'Bloom Dental', niche: 'Dentist', vertical: 'dentist', city: 'Melbourne', website: 'bloomdental.com.au', email: 'sarah@bloomdental.com.au', firstName: 'Sarah', rating: 4.7, reviews: 156, yearDetected: 2012, issues: ['Clip-art icons', 'Purple gradient buttons', 'No patient portal'], campaignId: 'c2', hasReply: true },
  { id: 2, state: 'AWAITING', name: 'Hillside Plumbing', niche: 'Plumber', vertical: 'plumber', city: 'Brisbane', website: 'hillsideplumbing.com.au', email: 'dan@hillsideplumbing.com.au', firstName: 'Dan', rating: 4.8, reviews: 234, yearDetected: 2011, issues: ['Stock hero image', 'Too many CTAs', 'No trust signals'], campaignId: 'c1', hasReply: true },
  { id: 3, state: 'AWAITING', name: 'Allegro Receptions', niche: 'Wedding Venue', vertical: 'wedding-venue', city: 'Sydney', website: 'allegroreceptions.com.au', email: 'events@allegroreceptions.com.au', firstName: 'Mia', rating: 4.6, reviews: 92, yearDetected: 2014, issues: ['Tiny body text', 'No clear hierarchy', 'Weak visuals'], campaignId: 'c3', hasReply: true },
  { id: 4, state: 'NEW', name: 'MD Nails', niche: 'Nail Salon', vertical: 'nail-salon', city: 'Sydney', website: 'mdnails.com.au', email: 'info@mdnails.com.au', firstName: null, rating: 4.2, reviews: 187, yearDetected: 2009, issues: ['Outdated gradient header', 'Red banner aesthetic', 'Cramped layout', 'No mobile optimization'], campaignId: null, hasReply: false },
  { id: 5, state: 'NEW', name: 'Northern Pines Resort', niche: 'Hotel', vertical: 'hotel', city: 'Byron Bay', website: 'northernpinesresort.com.au', email: 'gm@northernpinesresort.com.au', firstName: 'Tom', rating: 4.4, reviews: 412, yearDetected: 2010, issues: ['Flash-era carousel', 'Yellow/brown palette', 'Broken booking widget'], campaignId: null, hasReply: false },
];

const TRIAGE_BY_PROSPECT = {
  1: {
    classification: 'hot', confidence: 0.91, priority: 'high', minutesAgo: 18, channel: 'email',
    summary: 'Asked for pricing and whether you can match current brand colors.',
    theirReply: 'Hey — this actually looks pretty great, nice work. What would a full rebuild run? And is it possible to keep our existing brand colours (the forest green and cream) rather than what you\'ve shown? Thanks, Sarah',
    originalOutreach: { subject: 'Quick redesign of bloomdental.com.au', body: 'Hey Sarah, spent 20 min reworking your homepage — the purple-gradient CTAs were pulling attention away from the booking flow. New version here: bloom-dental-redesign.vercel.app\n\nKept all your content, just restructured the hierarchy. If it\'s useful, happy to chat about a proper rebuild. If not, no hard feelings — delete and have a great week.\n\n—' },
    draft: 'Hi Sarah, glad it landed. A full rebuild runs $3.5–5.5k depending on scope (patient portal + booking integration vs. marketing-only). And yes — keeping your forest green and cream is straightforward, it\'s actually a stronger palette than what I mocked.\n\nWant to put 15 min on the calendar this week to talk through what you\'d want?',
    reasoning: 'Clear buying signal — asked about pricing, which is the top-of-funnel indicator. Second question (brand colors) is a reasonable objection that\'s easy to address. Confidence high.',
  },
  2: {
    classification: 'objection', confidence: 0.84, priority: 'medium', minutesAgo: 110, channel: 'email',
    summary: 'Already works with a designer, but left the door open for future.',
    theirReply: 'thanks mate, appreciate the effort but we\'ve got someone doing our site already. might reach out down the track if that changes',
    originalOutreach: { subject: 'Quick redesign for Hillside', body: 'Hey Dan — redid your homepage, tried to make the 24/7 emergency line more obvious since that\'s clearly your biggest service. Preview: hillside-plumbing-redesign.vercel.app\n\nIf it\'s useful take it, if not delete it. Cheers.\n\n—' },
    draft: 'All good Dan, appreciate you taking a look. I\'ll leave the preview up for a couple weeks in case you ever want to show it to them. Take care.',
    reasoning: 'Polite pass with soft future possibility. Standard "have a designer" objection — no point pushing. Short acknowledgment, leave door open, move on.',
  },
  3: {
    classification: 'booking', confidence: 0.96, priority: 'high', minutesAgo: 434, channel: 'email',
    summary: 'Proposed a call Tuesday at 2pm Sydney time.',
    theirReply: 'Hi — this is lovely. Can we chat Tuesday 2pm? I have a couple of other redesigns I\'m considering but yours is the cleanest. Mia',
    originalOutreach: { subject: 'A redesign of allegroreceptions.com.au', body: 'Hi there — took a pass at the Allegro homepage. The current body text is tough to read on phones, so I made the typography do more work. Preview: allegro-receptions-redesign.vercel.app\n\nLet me know if it\'s useful.\n\n—' },
    draft: 'Perfect — Tuesday 2pm Sydney works. I\'ll send a Google Meet invite. Happy to dig into what you\'d want specifically and how it compares to the other options you\'re looking at.',
    reasoning: 'Explicit call request with a specific time. "Yours is the cleanest" is strong positioning signal. Confirm time, offer the meet link, acknowledge competitive context.',
  },
};

const CAMPAIGNS = [
  { id: 'c1', name: 'Plumbers · Brisbane', niche: 'Plumber', city: 'Brisbane', status: 'active', channel: 'email', autoSend: false, stats: { new: 12, enriched: 8, qualified: 24, redesigned: 18, sent: 47, awaiting: 3, won: 1, lost: 8 }, maxProspects: 100, cost: 34.20 },
  { id: 'c2', name: 'Dentists · Melbourne', niche: 'Dentist', city: 'Melbourne', status: 'active', channel: 'both', autoSend: true, stats: { new: 5, enriched: 3, qualified: 16, redesigned: 22, sent: 38, awaiting: 7, won: 2, lost: 5 }, maxProspects: 100, cost: 52.10 },
  { id: 'c3', name: 'Wedding Venues · Sydney', niche: 'Wedding Venue', city: 'Sydney', status: 'paused', channel: 'email', autoSend: false, stats: { new: 0, enriched: 0, qualified: 4, redesigned: 12, sent: 22, awaiting: 1, won: 0, lost: 3 }, maxProspects: 50, cost: 19.80 },
];

// ============================================================================
// UTILITIES
// ============================================================================

const CLASS_STYLES = {
  booking: { label: 'BOOKING', bg: 'bg-emerald-100', text: 'text-emerald-800', icon: Calendar },
  hot: { label: 'HOT', bg: 'bg-orange-100', text: 'text-orange-800', icon: Flame },
  warm: { label: 'WARM', bg: 'bg-amber-100', text: 'text-amber-800', icon: MessageSquare },
  objection: { label: 'OBJECTION', bg: 'bg-blue-100', text: 'text-blue-800', icon: AlertCircle },
  notnow: { label: 'NOT NOW', bg: 'bg-slate-100', text: 'text-slate-700', icon: Clock },
  unsub: { label: 'UNSUB', bg: 'bg-stone-100', text: 'text-stone-600', icon: BellOff },
  human: { label: 'NEEDS YOU', bg: 'bg-rose-100', text: 'text-rose-800', icon: User },
};

const STATE_COLORS = {
  NEW: 'bg-stone-100 text-stone-700',
  ENRICHED: 'bg-blue-100 text-blue-700',
  QUALIFIED: 'bg-indigo-100 text-indigo-700',
  REDESIGNED: 'bg-purple-100 text-purple-700',
  APPROVED_TO_SEND: 'bg-amber-100 text-amber-800',
  SENT: 'bg-sky-100 text-sky-700',
  AWAITING: 'bg-orange-100 text-orange-800',
  RESPONDED: 'bg-teal-100 text-teal-800',
  BOOKING: 'bg-emerald-100 text-emerald-800',
  WON: 'bg-green-100 text-green-800',
  LOST: 'bg-stone-200 text-stone-600',
};

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function timeAgo(minutes) {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function pickVariant(leadId, seed = 0) {
  const hash = (leadId * 2654435761 + seed * 374761393) >>> 0;
  return {
    palette: PALETTES[hash % PALETTES.length],
    fonts: FONT_PAIRS[(hash >>> 8) % FONT_PAIRS.length],
    layout: LAYOUTS[(hash >>> 16) % LAYOUTS.length],
  };
}

function generateRedesignHTML(lead, variant) {
  const { palette, fonts, layout } = variant;
  const tmpl = VERTICALS[lead.vertical] || VERTICALS['nail-salon'];
  const fontImport = `family=${fonts.heading.replace(/ /g, '+')}:wght@400;500;600&family=${fonts.body.replace(/ /g, '+')}:wght@400;500;600&display=swap`;

  const heroByLayout = {
    'hero-split': `<section class="hero split"><div class="hero-content"><div class="overline">Est. ${lead.yearDetected} · ${lead.city}</div><h1>${lead.name.split(' ')[0]}<br/><em>${lead.name.split(' ').slice(1).join(' ') || lead.niche}</em></h1><p class="lede">${tmpl.heroSubtitle(lead)}</p><div class="cta-row"><a class="btn-primary" href="#book">${tmpl.primaryCTA}</a><a class="btn-ghost" href="#services">${tmpl.secondaryCTA} →</a></div></div><div class="hero-visual"><div class="visual-block"></div></div></section>`,
    'hero-centered': `<section class="hero centered"><div class="overline">${lead.city} · ${lead.niche}</div><h1>${lead.name}</h1><p class="lede">${tmpl.tagline} ${tmpl.heroSubtitle(lead)}</p><div class="cta-row center"><a class="btn-primary" href="#book">${tmpl.primaryCTA}</a></div><div class="hero-visual wide"><div class="visual-block"></div></div></section>`,
    'hero-asymmetric': `<section class="hero asymmetric"><div class="hero-visual float"><div class="visual-block"></div></div><div class="hero-content offset"><div class="overline">${lead.rating} ★ · ${lead.reviews} reviews</div><h1>${lead.name}<span class="amp">—</span><em>${tmpl.tagline.replace(/\.$/, '')}</em></h1><p class="lede">${tmpl.heroSubtitle(lead)}</p><a class="btn-primary" href="#book">${tmpl.primaryCTA} →</a></div></section>`,
    'hero-editorial': `<section class="hero editorial"><div class="overline">Issue N°${lead.id.toString().padStart(2, '0')} · ${lead.city}</div><h1>${tmpl.tagline.split(' ').slice(0, 2).join(' ')}<br/><em>${tmpl.tagline.split(' ').slice(2).join(' ').replace(/\.$/, '') || lead.niche.toLowerCase()}</em></h1><div class="editorial-meta"><div><strong>${lead.name}</strong><br/>${lead.city}, AU</div><div><strong>Est.</strong><br/>${lead.yearDetected}</div><div><strong>Rated</strong><br/>${lead.rating} / 5.0</div></div><div class="hero-visual wide"><div class="visual-block"></div></div></section>`,
  };

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${lead.name}</title><link href="https://fonts.googleapis.com/css2?${fontImport}" rel="stylesheet"/><style>:root{--bg:${palette.bg};--fg:${palette.fg};--muted:${palette.muted};--accent:${palette.accent};--surface:${palette.surface};--font-h:'${fonts.heading}',serif;--font-b:'${fonts.body}',sans-serif}*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}html,body{background:var(--bg);color:var(--fg);font-family:var(--font-b);-webkit-font-smoothing:antialiased}.nav{display:flex;justify-content:space-between;align-items:center;padding:24px 48px;border-bottom:1px solid ${palette.accent}22}.logo{font-family:var(--font-h);font-size:22px;font-weight:${fonts.headingWeight};letter-spacing:-0.02em}.nav-links{display:flex;gap:32px;font-size:13px}.nav-links a{color:var(--fg);text-decoration:none;opacity:0.7}.nav-book{background:var(--fg);color:var(--bg);padding:10px 20px;border-radius:999px;font-size:13px;font-weight:500;text-decoration:none}.hero{padding:80px 48px 120px;max-width:1400px;margin:0 auto}.overline{font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--accent);margin-bottom:32px;font-weight:500}h1{font-family:var(--font-h);font-weight:${fonts.headingWeight};font-size:clamp(48px,8vw,104px);line-height:0.95;letter-spacing:-0.03em;margin-bottom:32px}h1 em{font-style:italic;color:var(--accent)}h1 .amp{color:var(--accent);margin:0 16px}.lede{font-size:19px;line-height:1.5;color:var(--muted);max-width:520px;margin-bottom:40px}.cta-row{display:flex;gap:16px;align-items:center}.cta-row.center{justify-content:center}.btn-primary{background:var(--fg);color:var(--bg);padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:500;font-size:15px;display:inline-block}.btn-ghost{color:var(--fg);text-decoration:none;font-weight:500;font-size:15px;padding:16px 0}.hero.split{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}.hero.centered{text-align:center}.hero.centered .lede{margin:0 auto 40px}.hero.asymmetric{position:relative;min-height:70vh}.hero.asymmetric .hero-visual.float{position:absolute;right:48px;top:0;width:45%}.hero.asymmetric .hero-content.offset{padding-top:120px;max-width:55%}.hero.editorial .editorial-meta{display:flex;gap:48px;margin:48px 0;font-size:13px;line-height:1.6;border-top:1px solid ${palette.accent}33;border-bottom:1px solid ${palette.accent}33;padding:24px 0}.hero.editorial .editorial-meta strong{font-family:var(--font-h);font-size:16px}.hero-visual{aspect-ratio:4/5;border-radius:4px;overflow:hidden;background:var(--surface)}.hero-visual.wide{aspect-ratio:16/9;margin-top:48px}.visual-block{width:100%;height:100%;background:radial-gradient(at 30% 30%,${palette.accent}40 0%,transparent 50%),radial-gradient(at 70% 70%,${palette.accent}60 0%,transparent 50%),linear-gradient(135deg,${palette.surface} 0%,${palette.bg} 100%)}.services{padding:120px 48px;max-width:1400px;margin:0 auto;border-top:1px solid ${palette.accent}22}.services h2{font-family:var(--font-h);font-size:56px;font-weight:${fonts.headingWeight};letter-spacing:-0.02em;margin-bottom:64px;max-width:800px;line-height:1.05}.services h2 em{font-style:italic;color:var(--accent)}.service-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}.service-card{padding:32px;background:var(--surface);border-radius:8px}.service-num{font-family:var(--font-h);font-size:13px;color:var(--accent);margin-bottom:16px;letter-spacing:0.1em}.service-card h3{font-family:var(--font-h);font-size:24px;font-weight:${fonts.headingWeight};margin-bottom:12px}.service-card p{color:var(--muted);font-size:14px;line-height:1.6}.info{padding:120px 48px;max-width:1400px;margin:0 auto;border-top:1px solid ${palette.accent}22}.info h2{font-family:var(--font-h);font-size:40px;font-weight:${fonts.headingWeight};margin-bottom:48px}.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:40px}.info-grid>div{padding-top:16px;border-top:2px solid var(--accent)}.info-grid strong{font-family:var(--font-h);font-size:20px;display:block;margin-bottom:12px}.info-grid p{color:var(--muted);font-size:14px;line-height:1.6}footer{padding:48px;max-width:1400px;margin:0 auto;border-top:1px solid ${palette.accent}22;display:flex;justify-content:space-between;font-size:13px;color:var(--muted)}footer em{font-family:var(--font-h);color:var(--accent);font-style:italic}.book-cta{padding:120px 48px;max-width:1400px;margin:0 auto;border-top:1px solid ${palette.accent}22;text-align:center}.book-inner{max-width:640px;margin:0 auto}.book-cta h2{font-family:var(--font-h);font-size:56px;font-weight:${fonts.headingWeight};letter-spacing:-0.02em;margin:16px 0 24px;line-height:1.05}.book-lede{font-size:18px;color:var(--muted);line-height:1.5;margin-bottom:40px}.book-contact{display:flex;flex-direction:column;align-items:center;gap:32px}.book-direct{display:flex;gap:48px;font-size:13px;color:var(--muted);line-height:1.6;padding-top:32px;border-top:1px solid ${palette.accent}22;width:100%;justify-content:center}.book-direct strong{font-family:var(--font-h);color:var(--fg);font-size:16px}@media(max-width:768px){.nav{padding:20px}.nav-links{display:none}.hero{padding:40px 20px 80px}.hero.split,.hero.asymmetric{grid-template-columns:1fr;gap:40px}.hero.asymmetric .hero-visual.float{position:relative;right:auto;width:100%}.hero.asymmetric .hero-content.offset{padding-top:0;max-width:100%}.hero.editorial .editorial-meta{flex-direction:column;gap:16px}.services,.info,.book-cta{padding:60px 20px}.book-cta h2{font-size:36px}.book-direct{flex-direction:column;gap:16px}.services h2{font-size:36px;margin-bottom:32px}.info h2{font-size:28px;margin-bottom:32px}.service-grid,.info-grid{grid-template-columns:1fr;gap:24px}footer{flex-direction:column;gap:16px;padding:24px 20px}}</style></head><body><nav class="nav"><div class="logo">${lead.name}</div><div class="nav-links"><a href="#about">About</a><a href="#services">Services</a><a href="#contact">Contact</a></div><a class="nav-book" href="#book">Book</a></nav>${heroByLayout[layout.id]}<section id="services" class="services"><h2>${tmpl.tagline.replace(/\.$/, '')}<br/><em>Built on craft.</em></h2><div class="service-grid">${tmpl.services.map((s, i) => `<div class="service-card"><div class="service-num">${String(i+1).padStart(2,'0')} / ${lead.niche.toUpperCase()}</div><h3>${s.name}</h3><p>${s.desc}</p></div>`).join('')}</div></section><section class="info"><h2>${tmpl.extraSectionTitle}</h2>${tmpl.extraSection(lead)}</section><section id="book" class="book-cta"><div class="book-inner"><div class="overline">Book</div><h2>Ready when you are.</h2><p class="book-lede">${tmpl.primaryCTA.toLowerCase()} online in under a minute, or reach us directly.</p><div class="book-contact"><a class="btn-primary" href="mailto:${lead.email}">${tmpl.primaryCTA}</a><div class="book-direct"><div><strong>Email</strong><br/>${lead.email}</div><div><strong>Phone</strong><br/>${lead.phone || "+61 (0)2 0000 0000"}</div></div></div></div></section><footer><div>© ${lead.name}, ${lead.city} · <em>Redesigned concept</em></div><div>${lead.email}</div></footer><script>document.addEventListener('click',function(e){var link=e.target.closest('a');if(!link)return;var href=link.getAttribute('href');if(href&&href.startsWith('#')){e.preventDefault();var target=document.getElementById(href.slice(1));if(target){target.scrollIntoView({behavior:'smooth',block:'start'});}}});</script></body></html>`;
}

// ============================================================================
// MAIN APP
// ============================================================================

export default function OutreachEngine() {
  const [tab, setTab] = useState('queue');
  const [selectedTriageId, setSelectedTriageId] = useState(null);
  const [pipelineProspectId, setPipelineProspectId] = useState(null);
  const [prospects, setProspects] = useState(PROSPECTS);
  const [triageStatus, setTriageStatus] = useState({}); // id -> 'approved' | 'rejected'
  const [campaigns, setCampaigns] = useState(CAMPAIGNS);

  const pendingTriage = prospects.filter(p => p.hasReply && !triageStatus[p.id]);
  const highPriority = pendingTriage.filter(p => TRIAGE_BY_PROSPECT[p.id]?.priority === 'high').length;

  const handleApprove = (id, newDraft) => {
    setTriageStatus({ ...triageStatus, [id]: 'approved' });
    setSelectedTriageId(null);
  };
  const handleReject = (id) => {
    setTriageStatus({ ...triageStatus, [id]: 'rejected' });
    setSelectedTriageId(null);
  };
  const toggleCampaign = (id) => {
    setCampaigns(campaigns.map(c => c.id === id ? { ...c, status: c.status === 'active' ? 'paused' : 'active' } : c));
  };

  // Triage item detail view
  if (selectedTriageId) {
    const prospect = prospects.find(p => p.id === selectedTriageId);
    const triage = TRIAGE_BY_PROSPECT[selectedTriageId];
    return <TriageDetail prospect={prospect} triage={triage} onBack={() => setSelectedTriageId(null)} onApprove={handleApprove} onReject={handleReject} onOpenPipeline={() => { setSelectedTriageId(null); setPipelineProspectId(selectedTriageId); }} />;
  }

  // Pipeline walkthrough view
  if (pipelineProspectId) {
    const prospect = prospects.find(p => p.id === pipelineProspectId);
    return <PipelineView prospect={prospect} onBack={() => setPipelineProspectId(null)} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 pb-20" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200">
        <div className="px-4 py-3 flex items-center justify-between max-w-3xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-stone-900 flex items-center justify-center">
              <Sparkles size={14} className="text-stone-50" />
            </div>
            <div>
              <div className="font-semibold text-sm">Outreach Engine</div>
              <div className="text-[10px] text-stone-500">{pendingTriage.length} pending · {highPriority} high priority</div>
            </div>
          </div>
          <button className="p-2 text-stone-500"><Bell size={16} /></button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {tab === 'queue' && <QueueView prospects={pendingTriage} triageStatus={triageStatus} onSelect={setSelectedTriageId} />}
        {tab === 'pipeline' && <PipelineListView prospects={prospects} onSelect={setPipelineProspectId} />}
        {tab === 'dashboard' && <DashboardView campaigns={campaigns} />}
        {tab === 'controls' && <ControlsView campaigns={campaigns} toggleCampaign={toggleCampaign} />}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 z-10">
        <div className="max-w-3xl mx-auto px-2 py-2 flex items-center justify-around">
          <NavButton icon={Inbox} label="Queue" active={tab === 'queue'} onClick={() => setTab('queue')} badge={highPriority} />
          <NavButton icon={Workflow} label="Pipeline" active={tab === 'pipeline'} onClick={() => setTab('pipeline')} />
          <NavButton icon={LayoutDashboard} label="Dashboard" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
          <NavButton icon={Settings} label="Controls" active={tab === 'controls'} onClick={() => setTab('controls')} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// QUEUE VIEW (inbound replies)
// ============================================================================

function QueueView({ prospects, triageStatus, onSelect }) {
  const sorted = useMemo(() => {
    return [...prospects].sort((a, b) => {
      const ta = TRIAGE_BY_PROSPECT[a.id]; const tb = TRIAGE_BY_PROSPECT[b.id];
      const priDiff = PRIORITY_ORDER[ta.priority] - PRIORITY_ORDER[tb.priority];
      if (priDiff !== 0) return priDiff;
      return ta.minutesAgo - tb.minutesAgo;
    });
  }, [prospects]);

  if (sorted.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold mb-3">Queue</h1>
        <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
          <Check size={24} className="text-green-500 mx-auto mb-2" />
          <div className="text-sm font-medium">Inbox zero</div>
          <div className="text-xs text-stone-500 mt-1">Nothing pending. Good work.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-3">Queue</h1>
      <div className="space-y-2">
        {sorted.map(p => {
          const t = TRIAGE_BY_PROSPECT[p.id];
          const cls = CLASS_STYLES[t.classification];
          const Icon = cls.icon;
          return (
            <button key={p.id} onClick={() => onSelect(p.id)} className="w-full text-left bg-white border border-stone-200 rounded-lg p-3.5 hover:border-stone-400 transition-all active:bg-stone-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`${cls.bg} ${cls.text} px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide flex items-center gap-1`}>
                    <Icon size={10} />{cls.label}
                  </div>
                  {t.priority === 'high' && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
                </div>
                <div className="text-[10px] text-stone-400">{t.channel} · {timeAgo(t.minutesAgo)}</div>
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-sm font-semibold truncate">{p.name}</div>
                <div className="text-xs text-stone-500">· {p.city}</div>
              </div>
              <div className="text-sm text-stone-700 leading-snug mb-2 line-clamp-2">"{t.summary}"</div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-stone-500">Confidence {Math.round(t.confidence * 100)}% · draft ready</span>
                <ChevronRight size={14} className="text-stone-400" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// TRIAGE DETAIL
// ============================================================================

function TriageDetail({ prospect, triage, onBack, onApprove, onReject, onOpenPipeline }) {
  const cls = CLASS_STYLES[triage.classification];
  const Icon = cls.icon;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(triage.draft || '');

  return (
    <div className="min-h-screen bg-stone-50 pb-24" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200">
        <div className="px-4 py-3 flex items-center justify-between max-w-3xl mx-auto">
          <button onClick={onBack} className="p-1.5 -ml-1.5"><ArrowLeft size={18} /></button>
          <div className={`${cls.bg} ${cls.text} px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide flex items-center gap-1`}>
            <Icon size={11} />{cls.label}
          </div>
          <button onClick={onOpenPipeline} className="p-1.5 -mr-1.5 text-stone-500 hover:text-stone-900" title="See full pipeline"><Workflow size={16} /></button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="bg-white border border-stone-200 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 size={14} className="text-stone-400" />
                <h2 className="font-semibold">{prospect.name}</h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-stone-600 ml-5">
                <span>{prospect.niche}</span>
                <span className="flex items-center gap-1"><MapPin size={10} />{prospect.city}</span>
                <span className="flex items-center gap-1"><Star size={10} fill="currentColor" />{prospect.rating}</span>
              </div>
            </div>
            <button onClick={onOpenPipeline} className="text-stone-500 hover:text-stone-900 text-[10px] font-medium uppercase tracking-wide px-2 py-1 bg-stone-100 rounded">
              View pipeline →
            </button>
          </div>
        </div>

        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1.5 ml-1 flex items-center gap-1">
            <Send size={10} /> You sent · {timeAgo(triage.minutesAgo + 2880)}
          </div>
          <div className="bg-white border border-stone-200 rounded-lg p-3.5">
            <div className="text-xs font-medium text-stone-700 mb-1">{triage.originalOutreach.subject}</div>
            <div className="text-xs text-stone-600 leading-relaxed whitespace-pre-wrap">{triage.originalOutreach.body}</div>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1.5 ml-1 flex items-center gap-1">
            <MessageSquare size={10} /> They replied · {timeAgo(triage.minutesAgo)}
          </div>
          <div className="bg-stone-900 text-stone-50 rounded-lg p-3.5">
            <div className="text-xs leading-relaxed whitespace-pre-wrap">{triage.theirReply}</div>
          </div>
        </div>

        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-700 mb-1 flex items-center gap-1 font-semibold">
            <Zap size={10} /> Claude's reasoning · {Math.round(triage.confidence * 100)}% confidence
          </div>
          <div className="text-xs text-amber-900 leading-relaxed">{triage.reasoning}</div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1.5 ml-1 flex items-center justify-between">
            <span>Proposed reply</span>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-stone-700 flex items-center gap-1 normal-case text-xs">
                <Edit3 size={10} /> Edit
              </button>
            )}
          </div>
          {editing ? (
            <textarea value={draft} onChange={e => setDraft(e.target.value)} className="w-full bg-white border border-stone-300 rounded-lg p-3.5 text-xs leading-relaxed min-h-[120px] focus:outline-none focus:border-stone-600" />
          ) : (
            <div className="bg-white border-2 border-stone-300 rounded-lg p-3.5">
              <div className="text-xs leading-relaxed whitespace-pre-wrap">{triage.draft}</div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 p-3 z-10">
        <div className="max-w-3xl mx-auto flex gap-2">
          <button onClick={() => onReject(prospect.id)} className="flex-1 bg-white border border-stone-300 text-stone-700 py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5">
            <X size={15} /> Reject
          </button>
          <button onClick={() => onApprove(prospect.id, draft)} className="flex-[2] bg-stone-900 text-stone-50 py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5">
            <Check size={15} /> {editing ? 'Save & send' : 'Approve & send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PIPELINE LIST (all prospects, any state)
// ============================================================================

function PipelineListView({ prospects, onSelect }) {
  const byState = useMemo(() => {
    const grouped = {};
    prospects.forEach(p => {
      if (!grouped[p.state]) grouped[p.state] = [];
      grouped[p.state].push(p);
    });
    return grouped;
  }, [prospects]);

  const stateOrder = ['NEW', 'ENRICHED', 'QUALIFIED', 'REDESIGNED', 'APPROVED_TO_SEND', 'SENT', 'AWAITING', 'RESPONDED', 'WON', 'LOST'];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <div className="text-[11px] text-stone-500">{prospects.length} prospects</div>
      </div>
      <p className="text-xs text-stone-500 mb-4">Tap any prospect to walk through their state machine — scrape, qualify, redesign, send, reply.</p>

      {stateOrder.map(state => {
        const items = byState[state];
        if (!items || items.length === 0) return null;
        return (
          <div key={state} className="mb-4">
            <div className="flex items-center gap-2 mb-2 ml-1">
              <div className={`${STATE_COLORS[state]} text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded`}>{state.replace(/_/g, ' ')}</div>
              <div className="text-[10px] text-stone-400">{items.length}</div>
            </div>
            <div className="space-y-1.5">
              {items.map(p => (
                <button key={p.id} onClick={() => onSelect(p.id)} className="w-full text-left bg-white border border-stone-200 rounded-lg p-3 hover:border-stone-400 active:bg-stone-50 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm truncate">{p.name}</div>
                      {p.hasReply && <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                    </div>
                    <div className="text-[11px] text-stone-500 mt-0.5 truncate">{p.niche} · {p.city} · {p.rating}★ ({p.reviews})</div>
                  </div>
                  <ChevronRight size={14} className="text-stone-400 flex-shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// PIPELINE WALKTHROUGH (the original simulator, for a specific prospect)
// ============================================================================

function PipelineView({ prospect, onBack }) {
  const [step, setStep] = useState('leads');
  const [qualifyLoading, setQualifyLoading] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [redesignLoading, setRedesignLoading] = useState(false);
  const [variantSeed, setVariantSeed] = useState(0);
  const [generatedHTML, setGeneratedHTML] = useState('');
  const [deployed, setDeployed] = useState(false);
  const iframeRef = useRef(null);

  const variant = pickVariant(prospect.id, variantSeed);
  const triage = TRIAGE_BY_PROSPECT[prospect.id];

  const handleQualify = async () => {
    setQualifyLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setVerdict({
      pass: true,
      score: 3.2,
      reasoning: `Website shows clear signs of being ${2026 - prospect.yearDetected}+ years old. ${prospect.issues.slice(0, 2).join(', ')}. High redesign value — business has strong reviews (${prospect.rating}★, ${prospect.reviews}) but visual presentation undermines credibility.`
    });
    setQualifyLoading(false);
  };
  const handleGenerate = async () => {
    setRedesignLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setGeneratedHTML(generateRedesignHTML(prospect, variant));
    setRedesignLoading(false);
  };
  const handleShuffle = () => {
    setVariantSeed(s => s + 1);
    setTimeout(() => setGeneratedHTML(generateRedesignHTML(prospect, pickVariant(prospect.id, variantSeed + 1))), 0);
  };
  const handleDeploy = async () => {
    setRedesignLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setDeployed(true);
    setRedesignLoading(false);
    setStep('deploy');
  };

  useEffect(() => {
    if (iframeRef.current && generatedHTML) iframeRef.current.srcdoc = generatedHTML;
  }, [generatedHTML]);

  const steps = [
    { id: 'leads', label: 'Lead', icon: Search },
    { id: 'qualify', label: 'Qualify', icon: Eye },
    { id: 'redesign', label: 'Redesign', icon: Sparkles },
    { id: 'deploy', label: 'Deploy', icon: Rocket },
    { id: 'outreach', label: 'Outreach', icon: Send },
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 pb-8" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200">
        <div className="px-4 py-3 flex items-center justify-between max-w-3xl mx-auto">
          <button onClick={onBack} className="p-1.5 -ml-1.5"><ArrowLeft size={18} /></button>
          <div>
            <div className="text-xs font-semibold">{prospect.name}</div>
            <div className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-block mt-0.5 ${STATE_COLORS[prospect.state]}`}>{prospect.state.replace(/_/g, ' ')}</div>
          </div>
          <div className="w-6" />
        </div>
        <div className="border-t border-stone-100 px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-1 text-xs whitespace-nowrap">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const active = s.id === step;
              return (
                <React.Fragment key={s.id}>
                  <button onClick={() => setStep(s.id)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-colors ${active ? 'bg-stone-900 text-stone-50' : 'bg-stone-100 text-stone-500'}`}>
                    <Icon size={12} /><span className="font-medium">{s.label}</span>
                  </button>
                  {i < steps.length - 1 && <ChevronRight size={12} className="text-stone-300 flex-shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {step === 'leads' && (
          <div>
            <div className="mb-4">
              <div className="text-xs text-stone-500 mb-1 tracking-wide uppercase">Step 1 · Scrape</div>
              <h1 className="text-xl font-semibold mb-2">Lead record</h1>
              <p className="text-sm text-stone-600">How this prospect entered the system — via Google Places API, then enriched with Hunter + Firecrawl.</p>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={14} className="text-stone-400" />
                <h3 className="font-semibold">{prospect.name}</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><div className="text-stone-400 uppercase text-[9px] tracking-wider mb-0.5">Niche</div><div>{prospect.niche}</div></div>
                <div><div className="text-stone-400 uppercase text-[9px] tracking-wider mb-0.5">City</div><div>{prospect.city}</div></div>
                <div><div className="text-stone-400 uppercase text-[9px] tracking-wider mb-0.5">Website</div><div className="truncate flex items-center gap-1"><Globe size={10} />{prospect.website}</div></div>
                <div><div className="text-stone-400 uppercase text-[9px] tracking-wider mb-0.5">Email</div><div className="truncate">{prospect.email}</div></div>
                <div><div className="text-stone-400 uppercase text-[9px] tracking-wider mb-0.5">Rating</div><div>{prospect.rating}★ ({prospect.reviews})</div></div>
                <div><div className="text-stone-400 uppercase text-[9px] tracking-wider mb-0.5">Site age est.</div><div>~{prospect.yearDetected}</div></div>
              </div>
              <div className="mt-3 pt-3 border-t border-stone-100">
                <div className="text-stone-400 uppercase text-[9px] tracking-wider mb-1.5">Detected issues</div>
                <div className="flex flex-wrap gap-1.5">
                  {prospect.issues.map(issue => <span key={issue} className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full">{issue}</span>)}
                </div>
              </div>
            </div>
            <button onClick={() => { setStep('qualify'); if (!verdict) handleQualify(); }} className="mt-4 w-full bg-stone-900 text-stone-50 py-3 rounded-md font-medium text-sm flex items-center justify-center gap-2">
              Run qualification <ChevronRight size={14} />
            </button>
          </div>
        )}

        {step === 'qualify' && (
          <div>
            <div className="mb-4">
              <div className="text-xs text-stone-500 mb-1 tracking-wide uppercase">Step 2 · Qualify</div>
              <h1 className="text-xl font-semibold mb-2">Vision check</h1>
              <p className="text-sm text-stone-600">Playwright screenshots the site, Claude vision model returns a structured verdict.</p>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden mb-4">
              <div className="bg-stone-100 px-3 py-2 flex items-center gap-2 border-b border-stone-200">
                <div className="flex gap-1"><div className="w-2.5 h-2.5 rounded-full bg-stone-300" /><div className="w-2.5 h-2.5 rounded-full bg-stone-300" /><div className="w-2.5 h-2.5 rounded-full bg-stone-300" /></div>
                <div className="text-[10px] text-stone-500 font-mono">{prospect.website}</div>
              </div>
              <div className="aspect-[4/3] bg-gradient-to-br from-red-100 via-yellow-50 to-stone-200 p-4">
                <div className="text-xl font-bold text-red-700 italic mb-2" style={{ fontFamily: 'Times, serif' }}>{prospect.name}</div>
                <div className="text-xs text-stone-600 mb-4">{prospect.niche.toUpperCase()} · EST. {prospect.yearDetected}</div>
                <div className="h-24 bg-stone-300/50 rounded mb-3" />
                <div className="flex gap-2"><div className="flex-1 h-8 bg-yellow-200 rounded" /><div className="w-20 h-8 bg-red-400 rounded" /></div>
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg p-4">
              <div className="text-xs font-medium text-stone-500 mb-3 uppercase tracking-wide">Vision model output</div>
              {qualifyLoading ? (
                <div className="py-6 flex flex-col items-center gap-2 text-stone-500"><Loader2 className="animate-spin" size={18} /><div className="text-xs">Analyzing...</div></div>
              ) : verdict ? (
                <>
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-md bg-green-50 text-green-800">
                    <Check size={16} /><span className="font-medium text-sm">Qualifies for redesign</span>
                  </div>
                  <div className="mb-3">
                    <div className="text-xs text-stone-500 mb-1">Priority score</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden"><div className="h-full bg-stone-900" style={{ width: `${(verdict.score / 5) * 100}%` }} /></div>
                      <span className="text-sm font-medium">{verdict.score}/5</span>
                    </div>
                  </div>
                  <div className="text-xs text-stone-600 leading-relaxed p-3 bg-stone-50 rounded-md">
                    <div className="text-stone-400 text-[10px] uppercase tracking-wide mb-1">Reasoning</div>{verdict.reasoning}
                  </div>
                </>
              ) : (
                <button onClick={handleQualify} className="w-full bg-stone-900 text-stone-50 py-2.5 rounded-md font-medium text-sm">Run vision check</button>
              )}
            </div>
            {verdict && (
              <button onClick={() => { setStep('redesign'); if (!generatedHTML) handleGenerate(); }} className="mt-4 w-full bg-stone-900 text-stone-50 py-3 rounded-md font-medium text-sm flex items-center justify-center gap-2">
                Generate redesign <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}

        {step === 'redesign' && (
          <div>
            <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <div className="text-xs text-stone-500 mb-1 tracking-wide uppercase">Step 3 · Redesign</div>
                <h1 className="text-xl font-semibold mb-2">Generated preview</h1>
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="bg-stone-900 text-stone-50 px-2 py-1 rounded-full"><strong>{prospect.niche}</strong></span>
                  <span className="bg-stone-100 px-2 py-1 rounded-full">{variant.palette.name}</span>
                  <span className="bg-stone-100 px-2 py-1 rounded-full">{variant.fonts.heading}</span>
                  <span className="bg-stone-100 px-2 py-1 rounded-full">{variant.layout.name}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleShuffle} className="text-xs bg-white border border-stone-300 px-3 py-2 rounded-md flex items-center gap-1.5 flex-1 sm:flex-none justify-center">
                  <Shuffle size={12} /> Shuffle
                </button>
                <button onClick={handleDeploy} disabled={redesignLoading || !generatedHTML} className="text-xs bg-stone-900 text-stone-50 px-3 py-2 rounded-md disabled:opacity-50 flex items-center gap-1.5 flex-1 sm:flex-none justify-center">
                  <Rocket size={12} /> Deploy
                </button>
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              {redesignLoading ? (
                <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-stone-500">
                  <Loader2 className="animate-spin" size={20} /><div className="text-sm">Generating HTML...</div>
                </div>
              ) : (
                <iframe ref={iframeRef} className="w-full h-[500px] sm:h-[720px] border-0" title="Preview" sandbox="allow-same-origin allow-scripts" />
              )}
            </div>
          </div>
        )}

        {step === 'deploy' && deployed && (
          <div>
            <div className="mb-4">
              <div className="text-xs text-stone-500 mb-1 tracking-wide uppercase">Step 4 · Deploy</div>
              <h1 className="text-xl font-semibold mb-2">Live on Vercel</h1>
              <p className="text-sm text-stone-600">Unique URL ready to drop into the outreach email.</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 text-green-800 font-medium text-sm mb-2"><Check size={14} /> Deployed</div>
              <div className="text-xs text-green-700 font-mono bg-white px-2 py-1.5 rounded border border-green-200 flex items-center justify-between gap-2">
                <span className="truncate">{prospect.name.toLowerCase().replace(/\s+/g, '-')}-redesign.vercel.app</span>
                <Copy size={12} className="flex-shrink-0" />
              </div>
            </div>
            <button onClick={() => setStep('outreach')} className="w-full bg-stone-900 text-stone-50 py-3 rounded-md font-medium text-sm flex items-center justify-center gap-2">
              Next: outreach message <ChevronRight size={14} />
            </button>
          </div>
        )}

        {step === 'outreach' && (
          <div>
            <div className="mb-4">
              <div className="text-xs text-stone-500 mb-1 tracking-wide uppercase">Step 5 · Outreach</div>
              <h1 className="text-xl font-semibold mb-2">Personalized email</h1>
              <p className="text-sm text-stone-600">Generated with vertical-aware prompt. Awaits your approval before Instantly sends it.</p>
            </div>
            {triage ? (
              <div className="bg-white border border-stone-200 rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">Subject</div>
                <div className="text-sm font-medium mb-3">{triage.originalOutreach.subject}</div>
                <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">Body</div>
                <div className="text-xs leading-relaxed whitespace-pre-wrap text-stone-700">{triage.originalOutreach.body}</div>
                {prospect.hasReply && (
                  <div className="mt-4 pt-3 border-t border-stone-200 flex items-center gap-2 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    <span className="text-stone-600">Reply received — see queue for triage</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-lg p-4">
                <div className="text-xs text-stone-500">This prospect hasn't hit the outreach step yet. Once deployed + approved, Claude will draft a personalized email here.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================

function DashboardView({ campaigns }) {
  const totals = campaigns.reduce((acc, c) => ({
    sent: acc.sent + c.stats.sent, awaiting: acc.awaiting + c.stats.awaiting, won: acc.won + c.stats.won, lost: acc.lost + c.stats.lost, cost: acc.cost + c.cost,
  }), { sent: 0, awaiting: 0, won: 0, lost: 0, cost: 0 });
  const replyRate = totals.sent > 0 ? ((totals.awaiting + totals.won + totals.lost) / totals.sent * 100) : 0;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">This week</h1>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <MetricCard label="Sent" value={totals.sent} sublabel="messages" />
        <MetricCard label="Reply rate" value={`${replyRate.toFixed(1)}%`} sublabel={`${totals.awaiting + totals.won + totals.lost} replies`} highlight />
        <MetricCard label="Booked" value={totals.won} sublabel="became customers" />
        <MetricCard label="Spend" value={`$${totals.cost.toFixed(0)}`} sublabel="Claude + APIs" />
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-4 mb-4">
        <div className="text-xs font-medium text-stone-500 mb-3 uppercase tracking-wide">Funnel · all campaigns</div>
        <FunnelBar label="Scraped" value={220} max={220} color="bg-stone-400" />
        <FunnelBar label="Qualified" value={145} max={220} color="bg-stone-500" />
        <FunnelBar label="Redesigned" value={112} max={220} color="bg-stone-600" />
        <FunnelBar label="Sent" value={totals.sent} max={220} color="bg-stone-800" />
        <FunnelBar label="Replied" value={totals.awaiting + totals.won + totals.lost} max={220} color="bg-orange-500" />
        <FunnelBar label="Won" value={totals.won} max={220} color="bg-emerald-500" last />
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 uppercase tracking-wide ml-1">Campaigns</div>
      <div className="space-y-2">
        {campaigns.map(c => (
          <div key={c.id} className="bg-white border border-stone-200 rounded-lg p-3.5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className={`${c.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-600'} text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded`}>{c.status}</div>
                </div>
                <div className="text-[11px] text-stone-500 mt-0.5">{c.channel === 'both' ? 'Email + LinkedIn' : c.channel} {c.autoSend && '· auto-send on'}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{c.stats.won}</div>
                <div className="text-[10px] text-stone-500">won</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-stone-600 pt-2 border-t border-stone-100">
              <span>{c.stats.sent} sent</span><span>·</span>
              <span>{c.stats.awaiting + c.stats.won + c.stats.lost} replies</span><span>·</span>
              <span>${c.cost.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sublabel, highlight }) {
  return (
    <div className={`rounded-lg p-3.5 border ${highlight ? 'bg-stone-900 text-stone-50 border-stone-900' : 'bg-white border-stone-200'}`}>
      <div className={`text-[10px] uppercase tracking-wide mb-1 ${highlight ? 'text-stone-400' : 'text-stone-500'}`}>{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className={`text-[11px] mt-0.5 ${highlight ? 'text-stone-400' : 'text-stone-500'}`}>{sublabel}</div>
    </div>
  );
}

function FunnelBar({ label, value, max, color, last }) {
  const pct = (value / max) * 100;
  return (
    <div className={`flex items-center gap-2 ${last ? '' : 'mb-2'}`}>
      <div className="w-20 text-[11px] text-stone-600 flex-shrink-0">{label}</div>
      <div className="flex-1 h-6 bg-stone-100 rounded overflow-hidden"><div className={`${color} h-full`} style={{ width: `${pct}%` }} /></div>
      <div className="w-8 text-[11px] font-semibold text-right">{value}</div>
    </div>
  );
}

// ============================================================================
// CONTROLS
// ============================================================================

function ControlsView({ campaigns, toggleCampaign }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Controls</h1>
        <button className="bg-stone-900 text-stone-50 px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1">
          <Plus size={12} /> New campaign
        </button>
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 uppercase tracking-wide ml-1">Active campaigns</div>
      <div className="space-y-2 mb-5">
        {campaigns.map(c => (
          <div key={c.id} className="bg-white border border-stone-200 rounded-lg p-3.5">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm mb-0.5">{c.name}</div>
                <div className="text-[11px] text-stone-500">{c.stats.sent} / {c.maxProspects} sent · {c.channel === 'both' ? 'Email + LI' : c.channel}</div>
              </div>
              <button onClick={() => toggleCampaign(c.id)} className={`ml-2 p-2 rounded-md ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                {c.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
              </button>
            </div>
            {c.autoSend && (
              <div className="mt-2 pt-2 border-t border-stone-100 flex items-center gap-1 text-[11px] text-blue-700">
                <Zap size={10} /> Auto-send enabled for unsub + not-now
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 uppercase tracking-wide ml-1">Prompts</div>
      <div className="space-y-2 mb-5">
        {[
          { name: 'Qualification (vision check)', version: 'v2.1', edited: '3 days ago' },
          { name: 'Redesign generation', version: 'v1.4', edited: '1 week ago' },
          { name: 'Initial outreach', version: 'v3.0', edited: 'yesterday' },
          { name: 'Followup 1 & 2', version: 'v1.2', edited: '2 weeks ago' },
          { name: 'Reply triage', version: 'v2.0', edited: '5 days ago' },
        ].map(p => (
          <button key={p.name} className="w-full bg-white border border-stone-200 rounded-lg p-3 flex items-center justify-between text-left">
            <div>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">{p.version} · edited {p.edited}</div>
            </div>
            <ChevronRight size={14} className="text-stone-400" />
          </button>
        ))}
      </div>

      <div className="text-xs font-medium text-stone-500 mb-2 uppercase tracking-wide ml-1">Trust ladder</div>
      <div className="bg-white border border-stone-200 rounded-lg divide-y divide-stone-100">
        {[
          { cat: 'Unsubscribe', auto: true, threshold: 0.95 },
          { cat: 'Not now', auto: true, threshold: 0.90 },
          { cat: 'Objection', auto: false, threshold: 0.85 },
          { cat: 'Warm interest', auto: false, threshold: 0.85 },
          { cat: 'Hot lead', forceManual: true },
          { cat: 'Booking', forceManual: true },
        ].map(r => (
          <div key={r.cat} className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{r.cat}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {r.forceManual ? 'Always human approved' : r.auto ? `Auto above ${r.threshold}` : `Manual (threshold ${r.threshold})`}
              </div>
            </div>
            {r.forceManual ? <Shield size={14} className="text-stone-400" /> : (
              <div className={`w-10 h-5 rounded-full relative transition-colors ${r.auto ? 'bg-green-500' : 'bg-stone-300'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${r.auto ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-stone-500 mt-3 px-1 leading-relaxed">Hot leads and bookings always go to you. Never auto-sent.</div>
    </div>
  );
}

// ============================================================================
// NAV
// ============================================================================

function NavButton({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button onClick={onClick} className="flex-1 py-2 flex flex-col items-center gap-0.5 relative">
      <div className={`relative ${active ? 'text-stone-900' : 'text-stone-400'}`}>
        <Icon size={20} />
        {badge > 0 && (
          <div className="absolute -top-1 -right-2 bg-orange-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-1">{badge}</div>
        )}
      </div>
      <div className={`text-[10px] font-medium ${active ? 'text-stone-900' : 'text-stone-400'}`}>{label}</div>
    </button>
  );
}
