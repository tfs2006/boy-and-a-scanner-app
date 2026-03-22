import type {
  ConventionalChannel,
  ConventionalDepartment,
  ConventionalSystem,
  ExportJob,
  FavoriteList,
  Talkgroup,
  TrunkGroup,
  TrunkSite,
  TrunkSystem,
} from "./types";
import { boolToken, cleanText, linesToCrlf, toneToken } from "./normalize";
import { cloneTemplate, joinTokens, type TemplateSet } from "./templates";
import { IdAllocator } from "./idAllocator";

export interface RenderContext {
  templates: TemplateSet;
  ids: IdAllocator;
}

function renderConventionalLine(system: ConventionalSystem, templates: TemplateSet): string {
  const row = cloneTemplate(templates.conventionalLine);
  row[3] = cleanText(system.name);
  row[4] = boolToken(system.avoid);
  return joinTokens(row);
}

function renderCGroupLine(
  systemParentRef: string,
  dept: ConventionalDepartment,
  templates: TemplateSet,
  ids: IdAllocator,
): string {
  const row = cloneTemplate(templates.cGroupLine);
  const id = dept.id ?? ids.nextCGroupId();
  dept.id = id;
  row[1] = `CGroupId=${id}`;
  row[2] = systemParentRef;
  row[3] = cleanText(dept.name);
  row[4] = boolToken(dept.avoid);
  row[5] = (dept.lat ?? 0).toFixed(6);
  row[6] = (dept.lon ?? 0).toFixed(6);
  row[7] = String(dept.rangeMiles ?? 0);
  return joinTokens(row);
}

function renderCFreqLine(channel: ConventionalChannel, dept: ConventionalDepartment, templates: TemplateSet, ids: IdAllocator): string {
  const row = cloneTemplate(templates.cFreqLine);
  const id = channel.id ?? ids.nextCFreqId();
  channel.id = id;
  row[1] = `CFreqId=${id}`;
  row[2] = `CGroupId=${dept.id ?? 0}`;
  row[3] = cleanText(channel.name);
  row[4] = boolToken(channel.avoid);
  row[5] = String(channel.frequencyHz);
  row[6] = channel.modulation;
  row[7] = toneToken(channel.toneMode, channel.toneValue);
  row[8] = String(channel.serviceType);
  return joinTokens(row);
}

function renderTrunkLine(system: TrunkSystem, templates: TemplateSet): string {
  const row = cloneTemplate(templates.trunkLine);
  row[3] = cleanText(system.name);
  row[4] = boolToken(system.avoid);
  row[5] = system.trunkType;
  return joinTokens(row);
}

function renderSiteLine(site: TrunkSite, templates: TemplateSet): string {
  const row = cloneTemplate(templates.siteLine);
  row[1] = cleanText(site.name);
  row[2] = boolToken(site.avoid);
  row[3] = (site.lat ?? 0).toFixed(6);
  row[4] = (site.lon ?? 0).toFixed(6);
  row[5] = String(site.rangeMiles ?? 0);
  return joinTokens(row);
}

function renderTFreqLine(freqHz: number, templates: TemplateSet): string {
  const row = cloneTemplate(templates.tFreqLine);
  row[4] = String(freqHz);
  return joinTokens(row);
}

function renderTGroupLine(group: TrunkGroup, templates: TemplateSet): string {
  const row = cloneTemplate(templates.tGroupLine);
  row[1] = cleanText(group.name);
  row[2] = boolToken(group.avoid);
  return joinTokens(row);
}

function renderTGIDLine(tg: Talkgroup, templates: TemplateSet): string {
  const row = cloneTemplate(templates.tgidLine);
  row[1] = cleanText(tg.name);
  row[2] = boolToken(tg.avoid);
  row[3] = String(tg.tgid);
  row[5] = String(tg.serviceType);
  row[9] = tg.alertTone;
  row[11] = boolToken(tg.priority);
  return joinTokens(row);
}

function renderOneFavorites(list: FavoriteList, ctx: RenderContext): string {
  const lines: string[] = [];
  lines.push(joinTokens(ctx.templates.headerTargetModel));
  lines.push(joinTokens(ctx.templates.headerFormatVersion));

  list.systems.forEach((system) => {
    if (system.kind === "conventional") {
      lines.push(renderConventionalLine(system, ctx.templates));
      const parentRef = "AgencyId=1";
      system.departments.forEach((dept) => {
        lines.push(renderCGroupLine(parentRef, dept, ctx.templates, ctx.ids));
        dept.channels.forEach((channel) => {
          lines.push(renderCFreqLine(channel, dept, ctx.templates, ctx.ids));
        });
      });
      return;
    }

    lines.push(renderTrunkLine(system, ctx.templates));
    system.sites.forEach((site) => {
      lines.push(renderSiteLine(site, ctx.templates));
      site.controlChannelsHz.forEach((freq) => {
        lines.push(renderTFreqLine(freq, ctx.templates));
      });
    });
    system.groups.forEach((group) => {
      lines.push(renderTGroupLine(group, ctx.templates));
      group.talkgroups.forEach((tg) => {
        lines.push(renderTGIDLine(tg, ctx.templates));
      });
    });
  });

  return linesToCrlf(lines);
}

export interface RenderedList {
  listName: string;
  fileName: string;
  fileContent: string;
  monitor: boolean;
  download: boolean;
  quickKey?: number | null;
}

export function renderFavoritesFiles(job: ExportJob, ctx: RenderContext): RenderedList[] {
  return job.favoritesLists.map((list) => {
    const slot = list.fileSlot ?? ctx.ids.nextFileSlot();
    const fileName = `f_${String(slot).padStart(6, "0")}.hpd`;
    return {
      listName: list.listName,
      fileName,
      fileContent: renderOneFavorites(list, ctx),
      monitor: list.monitor,
      download: list.download,
      quickKey: list.quickKey,
    };
  });
}

export function renderFListCfg(rendered: RenderedList[], templates: TemplateSet): string {
  const lines: string[] = [];
  lines.push(joinTokens(templates.headerTargetModel));
  lines.push(joinTokens(templates.headerFormatVersion));

  rendered.forEach((x) => {
    const row = cloneTemplate(templates.fListLine);
    row[1] = cleanText(x.listName);
    row[2] = x.fileName;
    row[3] = boolToken(x.monitor);
    row[4] = boolToken(x.download);
    row[5] = x.quickKey === undefined || x.quickKey === null ? "Off" : String(x.quickKey);
    lines.push(joinTokens(row));
  });

  return linesToCrlf(lines);
}
