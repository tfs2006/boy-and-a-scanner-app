import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseExportJobPayload, validateExportJob } from "../../../utils/sds100";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = parseExportJobPayload(req.body);
  if ("issues" in parsed) {
    return res.status(400).json({
      valid: false,
      issues: parsed.issues,
    });
  }

  return res.status(200).json(validateExportJob(parsed.data));
}
