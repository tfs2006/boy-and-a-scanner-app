export interface TemplateSet {
  headerTargetModel: string[];
  headerFormatVersion: string[];
  conventionalLine: string[];
  cGroupLine: string[];
  cFreqLine: string[];
  trunkLine: string[];
  siteLine: string[];
  tFreqLine: string[];
  tGroupLine: string[];
  tgidLine: string[];
  fListLine: string[];
}

const DEFAULT_TEMPLATES: TemplateSet = {
  headerTargetModel: ["TargetModel", "BCDx36HP"],
  headerFormatVersion: ["FormatVersion", "1.00"],
  conventionalLine: ["Conventional", "AgencyId=1", "StateId=1", "NEW SYSTEM", "Off", "Conventional"],
  cGroupLine: ["C-Group", "CGroupId=1", "AgencyId=1", "NEW DEPARTMENT", "Off", "0.000000", "0.000000", "0.0", "Circle", "Off", "Global"],
  cFreqLine: ["C-Freq", "CFreqId=1", "CGroupId=1", "NEW CHANNEL", "Off", "155000000", "NFM", "", "3"],
  trunkLine: ["Trunk", "", "", "NEW TRUNK", "Off", "P25Standard", "Off", "Off", "Auto", "Ignore"],
  siteLine: ["Site", "NEW SITE", "Off", "0.000000", "0.000000", "0.0", "AUTO", "Custom", "", "Circle", "Off", "400", "Auto", "8", "Off", "0", "Global"],
  tFreqLine: ["T-Freq", "", "", "Off", "770000000", "0", "Srch"],
  tGroupLine: ["T-Group", "NEW TGROUP", "Off", "0.000000", "0.000000", "0.0", "Circle", "Off"],
  tgidLine: ["TGID", "NEW TGID", "Off", "1001", "ALL", "3", "2", "0", "Off", "Auto", "Off", "On", "Off", "Off", "1"],
  fListLine: ["F-List", "NEW LIST", "f_000001.hpd", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off", "Off"],
};

export function getDefaultTemplates(): TemplateSet {
  return structuredClone(DEFAULT_TEMPLATES);
}

export function cloneTemplate(line: string[]): string[] {
  return line.slice();
}

export function joinTokens(tokens: string[]): string {
  return tokens.join("\t");
}
