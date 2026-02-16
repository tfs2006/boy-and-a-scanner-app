
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
