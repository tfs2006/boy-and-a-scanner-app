import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildExportZip, parseExportJobPayload } from "../../../utils/sds100";

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
    const zip = await buildExportZip(parsed.data);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=sds100-export.zip");
    return res.status(200).send(zip);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Build zip failed",
    });
  }
}
