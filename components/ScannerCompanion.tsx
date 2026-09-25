import React from 'react';
import { ExternalLink, Radio, ShieldCheck } from 'lucide-react';

const scannerCompanionUrl = (import.meta.env.VITE_SCANNER_COMPANION_URL as string | undefined)?.trim() || '';

export function ScannerCompanion() {
  if (!scannerCompanionUrl) {
    return (
      <section className="max-w-3xl mx-auto rounded-xl border border-slate-700 bg-slate-900/80 p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-600/20 border border-cyan-500/30">
            <Radio className="w-5 h-5 text-cyan-300" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white font-mono-tech">Scanner Companion</h2>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          The companion app URL is not configured yet. Add
          <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">VITE_SCANNER_COMPANION_URL</code>
          to load it here safely.
        </p>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400 leading-relaxed">
          <div className="flex items-center gap-2 text-emerald-300 mb-2">
            <ShieldCheck className="w-4 h-4" />
            Server-side key safety
          </div>
          Keep AI keys server-side only. The companion can call this app's
          <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300">/api/scanner-chat</code>
          endpoint to reuse the same backend key without exposing it in the browser.
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-3xl mx-auto rounded-xl border border-slate-700 bg-slate-900/80 p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-violet-600/20 border border-violet-500/30">
          <Radio className="w-5 h-5 text-violet-300" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-white font-mono-tech">Scanner Companion</h2>
      </div>

      <p className="text-sm text-slate-300 leading-relaxed">
        Launch the Uniden programming companion in a separate tab. This keeps the main app isolated and avoids changes to existing scan, trip, and community flows.
      </p>

      <div className="mt-6">
        <a
          href={scannerCompanionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-mono-tech font-bold text-sm"
        >
          Open Scanner Companion <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400 leading-relaxed">
        <div className="flex items-center gap-2 text-emerald-300 mb-2">
          <ShieldCheck className="w-4 h-4" />
          Server-side key safety
        </div>
        The companion can use this app's
        <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300">/api/scanner-chat</code>
        endpoint to reuse the same backend AI key without exposing secrets in browser code.
      </div>
    </section>
  );
}
