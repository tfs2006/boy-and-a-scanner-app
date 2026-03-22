export type OnOff = "On" | "Off";

export type ScannerModel = "BCDx36HP";
export type FormatVersion = "1.00";

export type Modulation = "AUTO" | "AM" | "FM" | "NFM" | "WFM" | "FMB";
export type ToneMode = "none" | "ctcss" | "dcs" | "nac";

export type TrunkType =
  | "P25Standard"
  | "Motorola"
  | "DmrOneFrequency"
  | "NXDN"
  | "EDACS"
  | "LTR";

export interface ExportJob {
  scannerModel: ScannerModel;
  formatVersion: FormatVersion;
  favoritesLists: FavoriteList[];
  options: {
    includeProfileChanges: boolean;
    mergeMode: "replace" | "append";
    defaultServiceType: number;
  };
}

export interface FavoriteList {
  listName: string;
  fileSlot?: number;
  monitor: boolean;
  download: boolean;
  quickKey?: number | null;
  systems: SystemRecord[];
}

export type SystemRecord = ConventionalSystem | TrunkSystem;

export interface BaseSystem {
  kind: "conventional" | "trunk";
  name: string;
  avoid: boolean;
  quickKey?: number | null;
}

export interface ConventionalSystem extends BaseSystem {
  kind: "conventional";
  departments: ConventionalDepartment[];
}

export interface ConventionalDepartment {
  id?: number;
  name: string;
  avoid: boolean;
  lat?: number;
  lon?: number;
  rangeMiles?: number;
  channels: ConventionalChannel[];
}

export interface ConventionalChannel {
  id?: number;
  name: string;
  frequencyHz: number;
  modulation: Modulation;
  toneMode: ToneMode;
  toneValue?: string;
  serviceType: number;
  avoid: boolean;
  priority: boolean;
  attenuation: boolean;
  recording: boolean;
  delaySec: number;
}

export interface TrunkSystem extends BaseSystem {
  kind: "trunk";
  trunkType: TrunkType;
  idSearch: boolean;
  sites: TrunkSite[];
  groups: TrunkGroup[];
}

export interface TrunkSite {
  id?: number;
  name: string;
  avoid: boolean;
  lat?: number;
  lon?: number;
  rangeMiles?: number;
  controlChannelsHz: number[];
  voiceChannelsHz?: number[];
}

export interface TrunkGroup {
  id?: number;
  name: string;
  avoid: boolean;
  talkgroups: Talkgroup[];
}

export interface Talkgroup {
  id?: number;
  name: string;
  tgid: number;
  serviceType: number;
  avoid: boolean;
  priority: boolean;
  alertTone: "Auto" | "Off";
  quickKey?: number | null;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface BuildFile {
  path: string;
  content: string;
}

export interface BuildOutput {
  files: BuildFile[];
  warnings: ValidationIssue[];
}
