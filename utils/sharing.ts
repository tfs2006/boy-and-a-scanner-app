// ---------------------------------------------------------------------------
// Shareable URLs and Web Share API helpers.
//
// Permalink format:   https://boyandascanner.com/?q=<encoded-location>
// Referral format:    https://boyandascanner.com/?ref=<inviter-short-id>
// (both can coexist)
// ---------------------------------------------------------------------------

export interface PermalinkOptions {
  query: string;
  /** Optional referral id to carry through. */
  ref?: string;
  /** Override the origin; useful in unit tests and non-browser contexts. */
  origin?: string;
}

export function buildPermalink({ query, ref, origin }: PermalinkOptions): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://boyandascanner.com');
  const url = new URL('/', base);
  if (query?.trim()) url.searchParams.set('q', query.trim());
  if (ref?.trim())   url.searchParams.set('ref', ref.trim());
  return url.toString();
}

export interface ShareParams {
  title: string;
  text: string;
  url: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'error';

/**
 * Try the native Web Share API first, fall back to copying to clipboard.
 * Returns an outcome so the caller can show appropriate UI feedback.
 */
export async function shareOrCopy(params: ShareParams): Promise<ShareOutcome> {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;

  if (nav?.share) {
    try {
      await nav.share(params);
      return 'shared';
    } catch (err: any) {
      // User dismissed the sheet — treat as cancelled, don't fall back to copy.
      if (err?.name === 'AbortError') return 'cancelled';
      // Any other error → fall through to clipboard copy.
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(`${params.text}\n${params.url}`);
      return 'copied';
    } catch {
      return 'error';
    }
  }

  return 'error';
}

/**
 * Read `?q=` and `?ref=` from the current URL without mutating it.
 */
export function readUrlParams(): { q: string | null; ref: string | null } {
  if (typeof window === 'undefined') return { q: null, ref: null };
  const p = new URLSearchParams(window.location.search);
  return { q: p.get('q'), ref: p.get('ref') };
}

/**
 * Update the address bar to a permalink for the given query without reloading.
 * Uses replaceState so the back button still goes to whatever the user had.
 */
export function updateAddressBarPermalink(query: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (query?.trim()) {
      url.searchParams.set('q', query.trim());
    } else {
      url.searchParams.delete('q');
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    // Ignore — some embedded contexts block history mutation.
  }
}
