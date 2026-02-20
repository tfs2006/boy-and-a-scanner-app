import React, { useState } from 'react';
import { X, Radio, MapPin, CheckCircle2, Loader2, Zap } from 'lucide-react';
import { submitFrequency } from '../services/crowdsourceService';

interface ContributeModalProps {
  locationQuery?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const MODES = ['FM', 'AM', 'P25 Phase I', 'P25 Phase II', 'DMR', 'NXDN', 'EDACS', 'LTR', 'Other'];

export const ContributeModal: React.FC<ContributeModalProps> = ({
  locationQuery = '',
  onClose,
  onSuccess,
}) => {
  const [form, setForm] = useState({
    frequency: '',
    locationQuery,
    agencyName: '',
    description: '',
    mode: 'FM',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const validate = (): string | null => {
    const freq = parseFloat(form.frequency);
    if (isNaN(freq) || freq < 25 || freq > 3000) return 'Enter a valid frequency between 25–3000 MHz.';
    if (!form.locationQuery.trim()) return 'Location is required.';
    if (!form.agencyName.trim()) return 'Agency name is required.';
    if (!form.description.trim()) return 'Description is required.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }

    setLoading(true);
    setError(null);
    const ok = await submitFrequency(form);
    setLoading(false);

    if (ok) {
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 2000);
    } else {
      setError('Submission failed. Please try again.');
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0f172a] border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-emerald-600 to-teal-600 rounded-lg">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white font-mono-tech">SUBMIT A FREQUENCY</h2>
              <p className="text-xs text-slate-400 font-mono-tech">Earn +10 pts when your submission is verified</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white font-mono-tech mb-2">Submitted! +10 Points</h3>
            <p className="text-slate-400 text-sm">Thanks for contributing to the community database.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Frequency */}
            <div>
              <label className="block text-xs font-bold text-slate-400 font-mono-tech uppercase tracking-wider mb-1.5">
                Frequency (MHz) *
              </label>
              <div className="relative">
                <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                <input
                  type="number"
                  step="0.0001"
                  min="25"
                  max="3000"
                  placeholder="e.g. 155.4550"
                  value={form.frequency}
                  onChange={set('frequency')}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-white font-mono-tech text-sm focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            {/* Mode */}
            <div>
              <label className="block text-xs font-bold text-slate-400 font-mono-tech uppercase tracking-wider mb-1.5">
                Mode *
              </label>
              <select
                value={form.mode}
                onChange={set('mode')}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition-colors"
              >
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Location */}
            <div>
              <label className="block text-xs font-bold text-slate-400 font-mono-tech uppercase tracking-wider mb-1.5">
                Location *
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400" />
                <input
                  type="text"
                  placeholder="e.g. Davidson County, TN"
                  value={form.locationQuery}
                  onChange={set('locationQuery')}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>

            {/* Agency Name */}
            <div>
              <label className="block text-xs font-bold text-slate-400 font-mono-tech uppercase tracking-wider mb-1.5">
                Agency / System Name *
              </label>
              <input
                type="text"
                placeholder="e.g. Nashville Metro Police"
                value={form.agencyName}
                onChange={set('agencyName')}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono-tech text-sm focus:outline-none focus:border-slate-500 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-slate-400 font-mono-tech uppercase tracking-wider mb-1.5">
                Description *
              </label>
              <textarea
                placeholder="What did you hear? e.g. Dispatch channel, heard active traffic..."
                value={form.description}
                onChange={set('description')}
                required
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono-tech text-sm focus:outline-none focus:border-slate-500 transition-colors resize-none"
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-xs font-mono-tech">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-700 text-slate-400 font-mono-tech text-sm hover:text-white hover:border-slate-500 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono-tech text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                Submit (+10 pts)
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
