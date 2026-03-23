import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildExport, parseExportJobPayload } from "../../../utils/sds100";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = parseExportJobPayload(req.body);
  if ("issues" in parsed) {
    return res.status(400).json({
      ok: false,
      message: "Invalid payload",
      issues: parsed.issues,
    });
  }

  try {
    const built = buildExport(parsed.data);
    return res.status(200).json({
      ok: true,
      fileCount: built.files.length,
      files: built.files.map((x) => x.path),
      warnings: built.warnings,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Build failed",
    });
  }
}
