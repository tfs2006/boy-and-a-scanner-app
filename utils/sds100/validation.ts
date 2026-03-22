import type { ExportJob, SystemRecord, ValidationIssue, ValidationResult } from "./types";

function push(
  issues: ValidationIssue[],
  severity: "error" | "warning",
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isValidLatLon(lat?: number, lon?: number): boolean {
  if (lat === undefined || lon === undefined) {
    return true;
  }
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function validateSystem(system: SystemRecord, path: string, issues: ValidationIssue[]): void {
  if (!system.name.trim()) {
    push(issues, "error", "SYSTEM_NAME_REQUIRED", `${path}.name`, "System name is required.");
  }

  if (system.kind === "conventional") {
    if (!system.departments.length) {
      push(issues, "error", "NO_DEPARTMENTS", `${path}.departments`, "Conventional system needs at least one department.");
      return;
    }

    system.departments.forEach((dept, di) => {
      const deptPath = `${path}.departments[${di}]`;
      if (!dept.name.trim()) {
        push(issues, "error", "DEPT_NAME_REQUIRED", `${deptPath}.name`, "Department name is required.");
      }
      if (!isValidLatLon(dept.lat, dept.lon)) {
        push(issues, "error", "BAD_COORDS", deptPath, "Department latitude or longitude is invalid.");
      }
      if (!dept.channels.length) {
        push(issues, "error", "NO_CHANNELS", `${deptPath}.channels`, "Department needs at least one channel.");
      }

      dept.channels.forEach((ch, ci) => {
        const chPath = `${deptPath}.channels[${ci}]`;
        if (!ch.name.trim()) {
          push(issues, "error", "CHANNEL_NAME_REQUIRED", `${chPath}.name`, "Channel name is required.");
        }
        if (!Number.isInteger(ch.frequencyHz) || ch.frequencyHz < 25_000_000 || ch.frequencyHz > 1_300_000_000) {
          push(issues, "error", "FREQ_RANGE", `${chPath}.frequencyHz`, "Frequency must be integer Hz between 25MHz and 1300MHz.");
        }
        if (ch.serviceType < 1 || ch.serviceType > 255) {
          push(issues, "warning", "SERVICE_TYPE_RANGE", `${chPath}.serviceType`, "Service type should be between 1 and 255.");
        }
        if (ch.delaySec < 0 || ch.delaySec > 30) {
          push(issues, "warning", "DELAY_RANGE", `${chPath}.delaySec`, "Delay should be between 0 and 30 seconds.");
        }
      });
    });
  }

  if (system.kind === "trunk") {
    if (!system.sites.length) {
      push(issues, "error", "NO_SITES", `${path}.sites`, "Trunk system needs at least one site.");
    }
    if (!system.groups.length) {
      push(issues, "error", "NO_GROUPS", `${path}.groups`, "Trunk system needs at least one group.");
    }

    system.sites.forEach((site, si) => {
      const sitePath = `${path}.sites[${si}]`;
      if (!site.name.trim()) {
        push(issues, "error", "SITE_NAME_REQUIRED", `${sitePath}.name`, "Site name is required.");
      }
      if (!site.controlChannelsHz.length) {
        push(issues, "error", "NO_CTRL_CHANNELS", `${sitePath}.controlChannelsHz`, "Site needs at least one control channel.");
      }
      if (!isValidLatLon(site.lat, site.lon)) {
        push(issues, "error", "BAD_COORDS", sitePath, "Site latitude or longitude is invalid.");
      }
    });

    system.groups.forEach((group, gi) => {
      const groupPath = `${path}.groups[${gi}]`;
      if (!group.name.trim()) {
        push(issues, "error", "GROUP_NAME_REQUIRED", `${groupPath}.name`, "Trunk group name is required.");
      }
      if (!group.talkgroups.length) {
        push(issues, "error", "NO_TGIDS", `${groupPath}.talkgroups`, "Trunk group needs at least one talkgroup.");
      }
      group.talkgroups.forEach((tg, ti) => {
        const tgPath = `${groupPath}.talkgroups[${ti}]`;
        if (!tg.name.trim()) {
          push(issues, "error", "TG_NAME_REQUIRED", `${tgPath}.name`, "Talkgroup name is required.");
        }
        if (!Number.isInteger(tg.tgid) || tg.tgid < 1 || tg.tgid > 16_777_215) {
          push(issues, "error", "TGID_RANGE", `${tgPath}.tgid`, "Talkgroup id must be between 1 and 16777215.");
        }
      });
    });
  }
}

export function validateExportJob(job: ExportJob): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (job.scannerModel !== "BCDx36HP") {
    push(issues, "error", "MODEL_UNSUPPORTED", "scannerModel", "Only BCDx36HP is currently supported.");
  }
  if (job.formatVersion !== "1.00") {
    push(issues, "error", "FORMAT_UNSUPPORTED", "formatVersion", "Only format version 1.00 is currently supported.");
  }
  if (!job.favoritesLists.length) {
    push(issues, "error", "NO_LISTS", "favoritesLists", "At least one favorites list is required.");
  }

  job.favoritesLists.forEach((list, li) => {
    const listPath = `favoritesLists[${li}]`;
    if (!list.listName.trim()) {
      push(issues, "error", "LIST_NAME_REQUIRED", `${listPath}.listName`, "List name is required.");
    }
    if (!list.systems.length) {
      push(issues, "error", "NO_SYSTEMS", `${listPath}.systems`, "List needs at least one system.");
    }
    if (list.quickKey !== undefined && list.quickKey !== null && (list.quickKey < 0 || list.quickKey > 99)) {
      push(issues, "warning", "QK_RANGE", `${listPath}.quickKey`, "Quick key should be between 0 and 99.");
    }

    list.systems.forEach((system, si) => {
      validateSystem(system, `${listPath}.systems[${si}]`, issues);
    });
  });

  return {
    valid: !issues.some((x) => x.severity === "error"),
    issues,
  };
}

export function parseExportJobPayload(payload: unknown): { success: true; data: ExportJob } | { success: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isObject(payload)) {
    return {
      success: false,
      issues: [{ code: "SCHEMA", severity: "error", path: "$", message: "Request body must be an object." }],
    };
  }

  const scannerModel = payload.scannerModel;
  const formatVersion = payload.formatVersion;
  const favoritesLists = payload.favoritesLists;
  const options = payload.options;

  if (scannerModel !== "BCDx36HP") {
    push(issues, "error", "SCHEMA", "scannerModel", "scannerModel must be BCDx36HP.");
  }
  if (formatVersion !== "1.00") {
    push(issues, "error", "SCHEMA", "formatVersion", "formatVersion must be 1.00.");
  }
  if (!Array.isArray(favoritesLists)) {
    push(issues, "error", "SCHEMA", "favoritesLists", "favoritesLists must be an array.");
  }
  if (!isObject(options)) {
    push(issues, "error", "SCHEMA", "options", "options must be an object.");
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, data: payload as unknown as ExportJob };
}
