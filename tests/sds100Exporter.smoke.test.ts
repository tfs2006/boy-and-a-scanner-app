import { describe, expect, it } from "vitest";
import { buildExport, validateExportJob, type ExportJob } from "../utils/sds100";

const fixture: ExportJob = {
  scannerModel: "BCDx36HP",
  formatVersion: "1.00",
  favoritesLists: [
    {
      listName: "Demo List",
      monitor: true,
      download: true,
      quickKey: 1,
      systems: [
        {
          kind: "conventional",
          name: "Local Public Safety",
          avoid: false,
          departments: [
            {
              name: "Fire Dispatch",
              avoid: false,
              channels: [
                {
                  name: "Main Dispatch",
                  frequencyHz: 154430000,
                  modulation: "NFM",
                  toneMode: "ctcss",
                  toneValue: "100.0",
                  serviceType: 3,
                  avoid: false,
                  priority: false,
                  attenuation: false,
                  recording: false,
                  delaySec: 2,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  options: {
    includeProfileChanges: false,
    mergeMode: "append",
    defaultServiceType: 3,
  },
};

describe("SDS100 scaffold integration", () => {
  it("validates fixture as valid", () => {
    const result = validateExportJob(fixture);
    expect(result.valid).toBe(true);
  });

  it("creates favorites file plus index and manifest", () => {
    const output = buildExport(fixture);
    expect(output.files.length).toBe(3);
    expect(output.files.some((x) => x.path.endsWith("f_list.cfg"))).toBe(true);
    expect(output.files.some((x) => x.path.endsWith("export_manifest.json"))).toBe(true);
  });

  it("writes CRLF endings for generated hpd", () => {
    const output = buildExport(fixture);
    const hpd = output.files.find((x) => x.path.endsWith(".hpd"));
    expect(hpd).toBeDefined();
    expect(hpd?.content.includes("\r\n")).toBe(true);
    expect(Boolean(hpd?.content.includes("\n") && !hpd?.content.includes("\r\n"))).toBe(false);
  });
});
