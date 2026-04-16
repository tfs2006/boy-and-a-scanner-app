import React, { useState } from 'react';
import { Share2, Copy, CheckCircle2, Radio, Flame, Trophy, Sparkles } from 'lucide-react';
import { buildPermalink, shareOrCopy } from '../utils/sharing';

export type ShareKind = 'scan' | 'streak' | 'badge' | 'achievement';

export interface ShareCardProps {
  kind: ShareKind;
  /** Headline text, e.g. "Davidson County, TN — 47 freqs" */
  headline: string;
  /** Optional stat line under the headline. */
  subline?: string;
  /** Used to build the ?q= permalink. Omit for non-location cards. */
  query?: string;
  /** Optional inviter ref to chain referrals. */
  ref?: string;
  /** A short pre-filled share text; URL is appended automatically. */
  shareText?: string;
  /** Compact variant renders without the big logo block. */
  compact?: boolean;
}

const ICONS: Record<ShareKind, React.ReactNode> = {
  scan:        <Radio className="w-5 h-5" />,
  streak:      <Flame className="w-5 h-5" />,
  badge:       <Trophy className="w-5 h-5" />,
  achievement: <Sparkles className="w-5 h-5" />,
};

const TITLES: Record<ShareKind, string> = {
  scan:        'Scan Complete',
  streak:      'Streak Update',
  badge:       'Badge Unlocked',
  achievement: 'Achievement',
};

export const ShareCard: React.FC<ShareCardProps> = ({
  kind,
  headline,
  subline,
  query,
  ref,
  shareText,
  compact,
}) => {
  const [status, setStatus] = useState<'idle' | 'shared' | 'copied' | 'error'>('idle');

  const url = buildPermalink({ query: query ?? '', ref });
  const defaultText =
    kind === 'scan'     ? `Just scanned ${headline} on Boy & A Scanner.` :
    kind === 'streak'   ? `${headline} scanning streak on Boy & A Scanner!` :
    kind === 'badge'    ? `Unlocked ${headline} on Boy & A Scanner.` :
                          `${headline} on Boy & A Scanner.`;

  const handleShare = async () => {
    const outcome = await shareOrCopy({
      title: `Boy & A Scanner — ${TITLES[kind]}`,
      text: shareText || defaultText,
      url,
    });
    if (outcome === 'shared')   setStatus('shared');
    else if (outcome === 'copied') setStatus('copied');
    else if (outcome === 'error')  setStatus('error');
    // cancelled = no visible change
    if (outcome === 'shared' || outcome === 'copied') {
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  return (
    <div
      className={`rounded-xl border border-cyan-500/40 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 ${
        compact ? 'p-3' : 'p-4'
      } shadow-lg`}
    >
      <div className="flex items-center gap-3">
        <div className={`rounded-lg border border-cyan-500/50 bg-cyan-950/40 p-2 text-cyan-300`}>
          {ICONS[kind]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-cyan-400/80 font-mono-tech">
            {TITLES[kind]}
          </div>
          <div className="text-sm md:text-base font-semibold text-slate-100 truncate">{headline}</div>
          {subline && <div className="text-xs text-slate-400 truncate">{subline}</div>}
        </div>
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-1 rounded border border-cyan-500/50 bg-cyan-950/50 px-2.5 py-1.5 text-xs font-mono-tech uppercase tracking-wider text-cyan-200 hover:bg-cyan-900/60"
          aria-label="Share"
        >
          {status === 'shared' || status === 'copied' ? (
            <>
              <CheckCircle2 className="w-3 h-3" />
              {status === 'copied' ? 'Copied' : 'Shared'}
            </>
          ) : (
            <>
              <Share2 className="w-3 h-3" />
              Share
            </>
          )}
        </button>
      </div>

      {!compact && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono-tech">
          <span className="truncate">boyandascanner.com</span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setStatus('copied');
                setTimeout(() => setStatus('idle'), 2000);
              } catch {
                setStatus('error');
              }
            }}
            className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300"
            aria-label="Copy link"
          >
            <Copy className="w-3 h-3" /> copy link
          </button>
        </div>
      )}
    </div>
  );
};

export default ShareCard;
