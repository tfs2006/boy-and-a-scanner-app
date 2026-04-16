import React from 'react';
import { ShieldCheck, Users, Bot, AlertTriangle } from 'lucide-react';
import { assessReliability, ReliabilityInput, ReliabilityLevel } from '../utils/reliability';

const ICONS: Record<ReliabilityLevel, React.ReactNode> = {
  verified:   <ShieldCheck className="w-3 h-3" />,
  community:  <Users className="w-3 h-3" />,
  ai:         <Bot className="w-3 h-3" />,
  unverified: <AlertTriangle className="w-3 h-3" />,
};

interface ReliabilityBadgeProps extends ReliabilityInput {
  /** Optional compact mode — icon only, used inline in dense tables. */
  compact?: boolean;
  className?: string;
}

export const ReliabilityBadge: React.FC<ReliabilityBadgeProps> = ({
  origin,
  communityCount,
  lastHeard,
  flagCount,
  compact,
  className = '',
}) => {
  const r = assessReliability({ origin, communityCount, lastHeard, flagCount });

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono-tech font-bold uppercase tracking-wider ${r.badgeClass} ${className}`}
      title={`${r.label} · score ${r.score}/100 — ${r.description}`}
      aria-label={`Reliability: ${r.label}. ${r.description}`}
    >
      {ICONS[r.level]}
      {!compact && <span>{r.label}</span>}
    </span>
  );
};

export default ReliabilityBadge;
