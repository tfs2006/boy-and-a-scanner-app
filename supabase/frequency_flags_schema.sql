-- =============================================================================
-- Boy & A Scanner — Frequency Flags ("Report Wrong") schema
-- Optional additive migration. Run in the Supabase SQL Editor.
-- Safe to run multiple times (CREATE IF NOT EXISTS + DROP POLICY IF EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.frequency_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency      TEXT NOT NULL,
  location_query TEXT NOT NULL,
  agency_name    TEXT,
  reason         TEXT NOT NULL CHECK (reason IN ('wrong_frequency','off_air','bad_agency','bad_mode','outdated','other')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flags_freq_loc  ON public.frequency_flags (frequency, location_query);
CREATE INDEX IF NOT EXISTS idx_flags_created   ON public.frequency_flags (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flags_user      ON public.frequency_flags (user_id);

ALTER TABLE public.frequency_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Flags are viewable by everyone" ON public.frequency_flags;
CREATE POLICY "Flags are viewable by everyone"
  ON public.frequency_flags FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert flags" ON public.frequency_flags;
CREATE POLICY "Authenticated users can insert flags"
  ON public.frequency_flags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only the flag's author (or service role) can delete.
DROP POLICY IF EXISTS "Authors can delete their flags" ON public.frequency_flags;
CREATE POLICY "Authors can delete their flags"
  ON public.frequency_flags FOR DELETE
  USING (auth.uid() = user_id);
