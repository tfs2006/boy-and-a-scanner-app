// ---------------------------------------------------------------------------
// Reliability scoring
//
// Combines provenance (RadioReference vs AI), community confirmations, and
// freshness into a single, user-facing reliability level. Used to render the
// ReliabilityBadge in the frequency table and to power export filters such as
// "Smart CSV" (export only community-confirmed rows).
// ---------------------------------------------------------------------------

export type ReliabilityLevel = 'verified' | 'community' | 'ai' | 'unverified';

export interface ReliabilityInput {
  /** Provenance flag from ScanResult: 'RR' = RadioReference, 'AI' = inferred. */
  origin?: 'RR' | 'AI';
  /** Number of community "Heard It" confirmations in the last 7 days. */
  communityCount?: number;
  /** ISO timestamp of the most recent confirmation (for freshness). */
  lastHeard?: string | null;
  /** Optional per-row override — e.g. user flagged this frequency as wrong. */
  flagCount?: number;
}

export interface ReliabilityAssessment {
  level: ReliabilityLevel;
  /** 0–100 numeric score; higher = more trustworthy. */
  score: number;
  /** Short human-readable label shown in the UI. */
  label: string;
  /** Tailwind classes — keeps the badge consistent everywhere it renders. */
  badgeClass: string;
  /** Tooltip/accessibility description. */
  description: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function freshnessBoost(lastHeard?: string | null): number {
  if (!lastHeard) return 0;
  const ts = Date.parse(lastHeard);
  if (!Number.isFinite(ts)) return 0;
  const ageMs = Date.now() - ts;
  if (ageMs < 0) return 10;                        // clock-skew safety
  if (ageMs < 24 * 60 * 60 * 1000) return 10;      // < 1 day
  if (ageMs < 3 * 24 * 60 * 60 * 1000) return 6;   // < 3 days
  if (ageMs < SEVEN_DAYS_MS) return 3;             // < 7 days
  return 0;
}

export function assessReliability(input: ReliabilityInput): ReliabilityAssessment {
  const { origin, communityCount = 0, lastHeard, flagCount = 0 } = input;

  // Flagged rows drop straight to "unverified" regardless of origin.
  // Two flags = warning, three or more = downgraded.
  if (flagCount >= 3) {
    return {
      level: 'unverified',
      score: 5,
      label: 'Flagged',
      badgeClass: 'bg-rose-950/60 border-rose-500/60 text-rose-300',
      description: 'Multiple users reported this frequency may be wrong or stale.',
    };
  }

  // Base score by provenance.
  let score = origin === 'RR' ? 70 : origin === 'AI' ? 35 : 25;

  // Community boost: diminishing returns after 5 confirmations.
  if (communityCount > 0) {
    score += Math.min(25, 5 + communityCount * 3);
  }

  // Freshness boost: recent "heard it" = extra confidence.
  score += freshnessBoost(lastHeard);

  // One flag is a yellow flag — shave a bit off but don't drop the level yet.
  if (flagCount === 1) score -= 8;
  if (flagCount === 2) score -= 18;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Level buckets — ordered from best to worst.
  //   verified  = RR-backed or heavily community-confirmed
  //   community = AI-origin but community-validated
  //   ai        = AI-origin, no community signal
  //   unverified= unknown provenance
  let level: ReliabilityLevel;
  let label: string;
  let badgeClass: string;
  let description: string;

  if (origin === 'RR' || (communityCount >= 3 && score >= 75)) {
    level = 'verified';
    label = origin === 'RR' ? 'Verified' : 'Community Verified';
    badgeClass = 'bg-emerald-900/40 border-emerald-500/60 text-emerald-300';
    description = origin === 'RR'
      ? 'Confirmed against the RadioReference database.'
      : 'Validated by multiple community "Heard It" confirmations.';
  } else if (communityCount >= 1) {
    level = 'community';
    label = `${communityCount} Heard`;
    badgeClass = 'bg-cyan-900/40 border-cyan-500/50 text-cyan-300';
    description = 'At least one scanner user has confirmed this frequency was active recently.';
  } else if (origin === 'AI') {
    level = 'ai';
    label = 'AI';
    badgeClass = 'bg-slate-800 border-slate-600 text-slate-300';
    description = 'Inferred from public sources by AI. Verify on-air before relying on it.';
  } else {
    level = 'unverified';
    label = 'Unverified';
    badgeClass = 'bg-slate-900 border-slate-700 text-slate-400';
    description = 'Origin unknown. Treat as inferred data until confirmed.';
  }

  return { level, score, label, badgeClass, description };
}

/**
 * Convenience: is this row "good enough" for a Smart CSV export
 * (community-confirmed or RR-verified)?
 */
export function isReliableForExport(input: ReliabilityInput): boolean {
  const { level } = assessReliability(input);
  return level === 'verified' || level === 'community';
}
