import React, { useState } from 'react';
import { X, Flag, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { reportFrequencyWrong, FrequencyFlagReason } from '../services/crowdsourceService';

interface ReportWrongModalProps {
  open: boolean;
  onClose: () => void;
  frequency: string;
  locationQuery: string;
  agencyName?: string;
  onReported?: () => void;
}

const REASONS: Array<{ key: FrequencyFlagReason; label: string; detail: string }> = [
  { key: 'wrong_frequency', label: 'Wrong frequency',        detail: 'The number itself is incorrect.' },
  { key: 'off_air',         label: 'Off air / unused',        detail: 'Monitored and heard no traffic.' },
  { key: 'bad_agency',      label: 'Wrong agency / dept',     detail: 'Belongs to a different agency.' },
  { key: 'bad_mode',        label: 'Wrong mode (FM/P25/DMR)', detail: 'Mode or digital type is wrong.' },
  { key: 'outdated',        label: 'Outdated / moved',        detail: 'Agency has migrated or is obsolete.' },
  { key: 'other',           label: 'Other',                   detail: 'Describe in the note field.' },
];

export const ReportWrongModal: React.FC<ReportWrongModalProps> = ({
  open,
  onClose,
  frequency,
  locationQuery,
  agencyName,
  onReported,
}) => {
  const [reason, setReason] = useState<FrequencyFlagReason>('wrong_frequency');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error' | 'info'; msg: string } | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await reportFrequencyWrong({ frequency, locationQuery, agencyName, reason, note });
      if (res === 'flagged') {
        setStatus({ tone: 'success', msg: 'Thanks — your report was logged.' });
        onReported?.();
        setTimeout(() => onClose(), 1200);
      } else if (res === 'duplicate') {
        setStatus({ tone: 'info', msg: 'You already reported this with the same reason in the last 24h.' });
      } else if (res === 'unavailable') {
        setStatus({ tone: 'info', msg: 'Reporting is not enabled on this deployment yet.' });
      } else {
        setStatus({ tone: 'error', msg: 'Could not log your report. Sign in and try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-2 text-amber-300">
            <Flag className="w-4 h-4" />
            <h2 className="font-mono-tech text-sm uppercase tracking-wider">Report this frequency</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div className="rounded border border-slate-800 bg-slate-950/60 p-3 font-mono-tech">
            <div className="text-cyan-300 text-base">{frequency}</div>
            {agencyName && <div className="text-slate-400 text-xs">{agencyName}</div>}
            <div className="text-slate-500 text-xs">{locationQuery}</div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs uppercase tracking-wider text-slate-400 mb-1">Why is it wrong?</legend>
            {REASONS.map((r) => (
              <label
                key={r.key}
                className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition ${
                  reason === r.key
                    ? 'border-amber-500/60 bg-amber-950/20'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="flag-reason"
                  className="mt-1 accent-amber-500"
                  checked={reason === r.key}
                  onChange={() => setReason(r.key)}
                />
                <span className="flex-1">
                  <span className="block text-slate-100">{r.label}</span>
                  <span className="block text-xs text-slate-500">{r.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-400">Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Anything else that would help a future scanner…"
              className="mt-1 w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-cyan-500"
            />
            <span className="mt-1 block text-right text-[10px] text-slate-500">{note.length}/500</span>
          </label>

          {status && (
            <div
              className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
                status.tone === 'success'
                  ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                  : status.tone === 'error'
                  ? 'border-rose-600/50 bg-rose-950/40 text-rose-300'
                  : 'border-slate-700 bg-slate-950 text-slate-300'
              }`}
              role="status"
            >
              {status.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <span>{status.msg}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-mono-tech uppercase tracking-wider text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded border border-amber-600/60 bg-amber-950/40 px-3 py-1.5 text-xs font-mono-tech uppercase tracking-wider text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flag className="w-3 h-3" />}
            Submit report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportWrongModal;
