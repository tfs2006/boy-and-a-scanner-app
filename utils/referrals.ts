// ---------------------------------------------------------------------------
// Lightweight local-first referrals.
//
// 1. Every user gets a stable 8-char ref id stored in localStorage.
// 2. Incoming visitors with `?ref=<id>` have that id captured once per browser.
// 3. On first meaningful action (scan or signup), we fire a CustomEvent so the
//    host app can award the inviter (e.g. bump a server counter) — the actual
//    write is intentionally pluggable so offline/unauthed flows still work.
// ---------------------------------------------------------------------------

const MY_REF_KEY      = 'baas_my_ref';
const INVITED_BY_KEY  = 'baas_invited_by';
const REF_AWARDED_KEY = 'baas_ref_awarded';

export interface ReferralState {
  myRef: string;
  invitedBy: string | null;
  awarded: boolean;
}

function randomId(len = 8): string {
  // Non-cryptographic, but plenty for referral codes.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function getMyRef(): string {
  let ref = safeGet(MY_REF_KEY);
  if (!ref || !/^[A-Z0-9]{6,}$/.test(ref)) {
    ref = randomId();
    safeSet(MY_REF_KEY, ref);
  }
  return ref;
}

export function getInvitedBy(): string | null {
  return safeGet(INVITED_BY_KEY);
}

/**
 * Capture `?ref=` the first time the browser visits.
 * Self-referrals are dropped. Subsequent visits do not overwrite the original
 * inviter (first-touch attribution).
 */
export function captureRefFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref) return getInvitedBy();

  const cleaned = ref.trim().toUpperCase().slice(0, 12);
  if (!cleaned) return getInvitedBy();

  const mine = getMyRef();
  if (cleaned === mine) return getInvitedBy();

  const existing = getInvitedBy();
  if (!existing) safeSet(INVITED_BY_KEY, cleaned);
  return getInvitedBy();
}

export function isReferralAwarded(): boolean {
  return safeGet(REF_AWARDED_KEY) === '1';
}

/**
 * Fires a "first meaningful action" event for the inviter.
 * The host app listens and writes the actual server-side reward.
 * No-op if there's no inviter or the award already fired.
 */
export function maybeFireReferralReward(trigger: 'scan' | 'signup' | 'confirm'): boolean {
  if (typeof window === 'undefined') return false;
  if (isReferralAwarded()) return false;
  const inviter = getInvitedBy();
  if (!inviter) return false;

  safeSet(REF_AWARDED_KEY, '1');
  window.dispatchEvent(
    new CustomEvent('baas:referral-reward', {
      detail: { inviter, trigger },
    })
  );
  return true;
}

export function buildMyShareLink(origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://boyandascanner.com');
  const url = new URL('/', base);
  url.searchParams.set('ref', getMyRef());
  return url.toString();
}

export function getReferralState(): ReferralState {
  return {
    myRef: getMyRef(),
    invitedBy: getInvitedBy(),
    awarded: isReferralAwarded(),
  };
}
