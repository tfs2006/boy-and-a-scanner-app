export function cleanText(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim().replace(/\s{2,}/g, " ");
}

export function boolToken(value: boolean): "On" | "Off" {
  return value ? "On" : "Off";
}

export function toneToken(mode: "none" | "ctcss" | "dcs" | "nac", value?: string): string {
  if (mode === "none" || !value) {
    return "";
  }
  if (mode === "ctcss") {
    return `TONE=C${value}`;
  }
  if (mode === "dcs") {
    return `DCS=${value}`;
  }
  return `NAC=${value}`;
}

export function linesToCrlf(lines: string[]): string {
  return lines.join("\r\n") + "\r\n";
}
