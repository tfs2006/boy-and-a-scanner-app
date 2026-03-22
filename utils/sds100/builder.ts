import JSZip from "jszip";
import type { BuildFile, BuildOutput, ExportJob } from "./types";
import { validateExportJob } from "./validation";
import { getDefaultTemplates } from "./templates";
import { IdAllocator } from "./idAllocator";
import { renderFListCfg, renderFavoritesFiles } from "./renderer";

export function buildExport(job: ExportJob): BuildOutput {
  const result = validateExportJob(job);
  const hardErrors = result.issues.filter((x) => x.severity === "error");
  if (hardErrors.length > 0) {
    const msg = hardErrors.map((x) => `${x.path}: ${x.message}`).join("; ");
    throw new Error(`Validation failed: ${msg}`);
  }

  const templates = getDefaultTemplates();
  const ids = new IdAllocator(
    job.favoritesLists.map((x) => x.fileSlot).filter((x): x is number => typeof x === "number"),
  );

  const rendered = renderFavoritesFiles(job, { templates, ids });
  const files: BuildFile[] = rendered.map((item) => ({
    path: `BCDx36HP/favorites_lists/${item.fileName}`,
    content: item.fileContent,
  }));

  files.push({
    path: "BCDx36HP/favorites_lists/f_list.cfg",
    content: renderFListCfg(rendered, templates),
  });

  files.push({
    path: "BCDx36HP/export_manifest.json",
    content: JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        scannerModel: job.scannerModel,
        formatVersion: job.formatVersion,
        listCount: job.favoritesLists.length,
        files: rendered.map((x) => x.fileName),
      },
      null,
      2,
    ),
  });

  return {
    files,
    warnings: result.issues.filter((x) => x.severity === "warning"),
  };
}

export async function buildExportZip(job: ExportJob): Promise<Buffer> {
  const output = buildExport(job);
  const zip = new JSZip();

  output.files.forEach((file) => {
    zip.file(file.path, file.content);
  });

  return zip.generateAsync({ type: "nodebuffer" });
}
