
export interface Frequency {
  freq: string;
  description: string;
  mode: string;
  tag: string;
  alphaTag?: string;
  tone?: string;
  colorCode?: string; // DMR Color Code
  ran?: string; // NXDN RAN
  nac?: string; // P25 NAC
}

export interface Agency {
  name: string;
  category: string;
  frequencies: Frequency[];
  origin?: 'RR' | 'AI'; // Track source of data
}

export interface Talkgroup {
  dec: string;
  hex?: string;
  mode: string;
  alphaTag: string;
  description: string;
  tag: string;
  colorCode?: string; // For DMR TG
}

export interface TrunkedSystemFreq {
  freq: string;
  use?: string; // e.g. "Control", "Alt", "Voice"
}

export interface TrunkedSystem {
  name: string;
  type: string;
  location: string;
  frequencies: TrunkedSystemFreq[];
  talkgroups: Talkgroup[];
  origin?: 'RR' | 'AI'; // Track source of data
}

export interface CrossRefData {
  verified: boolean;
  confidenceScore: number;
  sourcesChecked: number;
  notes: string;
}

export interface ScanResult {
  source: 'API' | 'AI' | 'Cache';
  locationName: string;
  coords?: { lat: number, lng: number };
  summary: string;
  crossRef?: CrossRefData;
  agencies: Agency[];
  trunkedSystems: TrunkedSystem[];
}

export interface TripLocation {
  locationName: string;
  data: ScanResult;
}

export interface TripResult {
  startLocation: string;
  endLocation: string;
  locations: TripLocation[];
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface SearchResponse {
  data: ScanResult | null;
  groundingChunks: GroundingChunk[] | null;
  rawText?: string;
}

export type ServiceType =
  | 'Police'
  | 'Fire'
  | 'EMS'
  | 'Federal'
  | 'Public Works'
  | 'Ham Radio'
  | 'Railroad'
  | 'Air'
  | 'Marine'
  | 'Utilities'
  | 'Military'
  | 'Transportation'
  | 'Business'
  | 'Hospitals'
  | 'Schools'
  | 'Corrections'
  | 'Security'
  | 'Multi-Dispatch';

// --- Crowdsource / Community Types ---

export type ReportType = 'confirmation' | 'submission';

/**
 * A single "Heard It" confirmation or new frequency submission logged by a user.
 */
export interface FrequencyReport {
  id: string;
  user_id: string;
  report_type: ReportType;
  frequency: string;          // e.g. "155.4550"
  location_query: string;     // e.g. "Davidson County, TN"
  agency_name?: string;
  description?: string;
  mode?: string;              // e.g. "FM", "P25", "DMR"
  created_at: string;
  username?: string;          // joined from profiles
}

/**
 * Aggregated stats per user, kept in sync by a Supabase DB function/trigger.
 */
export interface UserStats {
  user_id: string;
  username: string;
  avatar_url?: string;
  total_points: number;
  confirmations_count: number;
  submissions_count: number;
  streak_days: number;
  last_activity: string;
  badge: 'Listener' | 'Scanner' | 'Pro Scanner' | 'Regional Expert' | 'Elite';
}

/**
 * A single row on the leaderboard.
 */
export interface LeaderboardEntry extends UserStats {
  rank: number;
}

/**
 * Returned from getConfirmationCount() for a given frequency.
 */
export interface FrequencyConfirmationCount {
  frequency: string;
  location_query: string;
  count: number;
  last_heard: string | null;
}

// Manual Generator Types
export interface ManualStep {
  text: string;
  value?: string; // The dynamic value to enter (e.g., "155.450")
  subSteps?: ManualStep[];
}

export interface ManualSection {
  title: string;
  description?: string;
  steps: ManualStep[];
}

export interface GeneratedManual {
  title: string;
  sections: ManualSection[];
}
