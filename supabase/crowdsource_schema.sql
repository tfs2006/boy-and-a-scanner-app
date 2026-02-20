-- =============================================================================
-- Boy & A Scanner — Crowdsource Feature Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profiles table (public display names, linked to auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   TEXT NOT NULL DEFAULT 'Anonymous',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. frequency_reports — "Heard It" confirmations + user submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frequency_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type    TEXT NOT NULL CHECK (report_type IN ('confirmation', 'submission')),
  frequency      TEXT NOT NULL,
  location_query TEXT NOT NULL,
  agency_name    TEXT,
  description    TEXT,
  mode           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_frequency     ON public.frequency_reports (frequency, location_query);
CREATE INDEX IF NOT EXISTS idx_reports_user          ON public.frequency_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_reports_type          ON public.frequency_reports (report_type);
CREATE INDEX IF NOT EXISTS idx_reports_created       ON public.frequency_reports (created_at DESC);

ALTER TABLE public.frequency_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reports are viewable by everyone"
  ON public.frequency_reports FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert reports"
  ON public.frequency_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own reports"
  ON public.frequency_reports FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. user_stats — leaderboard data, updated by the app service layer
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username            TEXT NOT NULL DEFAULT 'Anonymous',
  avatar_url          TEXT,
  total_points        INTEGER NOT NULL DEFAULT 0,
  confirmations_count INTEGER NOT NULL DEFAULT 0,
  submissions_count   INTEGER NOT NULL DEFAULT 0,
  streak_days         INTEGER NOT NULL DEFAULT 0,
  last_activity       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stats_points ON public.user_stats (total_points DESC);

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stats are viewable by everyone"
  ON public.user_stats FOR SELECT USING (true);

CREATE POLICY "Users can insert their own stats"
  ON public.user_stats FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stats"
  ON public.user_stats FOR UPDATE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. (Optional) Sync username from profiles into user_stats automatically
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_username_to_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.user_stats
  SET username = NEW.username
  WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_username ON public.profiles;
CREATE TRIGGER sync_username
  AFTER UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_username_to_stats();
