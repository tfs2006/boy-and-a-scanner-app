import { ScanResult, Agency, Frequency } from "../types";

/**
 * Generates a tab-delimited string compatible with Uniden Sentinel "Paste" feature.
 * Target Columns: Channel Name | Frequency | Modulation | Tone | Service Type | Delay | Lockout | Quick Key
 */
export function generateSentinelExport(data: ScanResult | null): string {
    if (!data || !data.agencies || data.agencies.length === 0) {
        return "";
    }

    let exportText = "";

    // Sentinel usually expects a header row if pasting into a grid, but often for "Paste Append" it might just take raw data.
    // Best practice for Sentinel clipboard paste is usually just the data rows if you are inside a Favorites List editor.
    // However, we will format it as standard rows.

    // Columns: Name (Alpha Tag), Frequency, Modulation, Tone, Service Type, Delay, Lockout, Quick Key, Attenuator(opt)
    // We will map our data to this.

    data.agencies.forEach((agency: Agency) => {
        // We treat the Agency Name as a potential comment or group, but Sentinel is flat list per department.
        // Ideally, user pastes this into a Department.

        agency.frequencies.forEach((freq: Frequency) => {
            // 1. Channel Name (Alpha Tag). If Alpha is missing, use Description (truncated)
            let name = freq.alphaTag || freq.description || "Unknown";
            // Sentinel Alpha Tags max 64 chars, typically shorter is better.
            name = name.substring(0, 64).replace(/\t/g, " "); // Remove tabs to avoid breaking format

            // 2. Frequency
            // Sentinel expects MHz (e.g. 155.4500)
            const frequency = freq.freq;

            // 3. Modulation
            // Map our modes to Sentinel modes: Auto, AM, FM, NFM, WFM, FMB
            // Default to 'Auto' or 'NFM' for most public safety
            let modulation = "Auto";
            const mode = (freq.mode || "").toUpperCase();
            if (mode.includes("NFM") || mode === "FMN") modulation = "NFM";
            else if (mode === "FM") modulation = "FM";
            else if (mode === "AM") modulation = "AM";

            // 4. Tone
            // Format: "Search" or "127.3 Hz" or "DCS 023"
            let tone = "Search";
            if (freq.tone) {
                // Normalize tone string
                const t = freq.tone.trim();
                // If it looks like a CTCSS (e.g. "127.3") add Hz if missing? Sentinel is picky.
                // Actually Sentinel often takes just the value. "CTCSS 127.3" or "DCS 023".
                // Let's try to pass it through, or default to "Search" if complex.
                if (t && t !== "CSQ") {
                    tone = t;
                } else if (t === "CSQ") {
                    tone = "None";
                }
            }

            // 5. Service Type
            // Map our category to Uniden Service Types
            const serviceType = mapToUnidenServiceType(agency.category);

            // 6. Delay
            const delay = "2";

            // 7. Lockout
            const lockout = "Off";

            // 8. Quick Key
            const quickKey = "None"; // or empty

            // Construct Tab-Delimited Line
            // Note: The specific column order for Sentinel Paste can vary by version, 
            // but "Name, Freq, Mod, Tone" is the core.
            // A common sequence for "Standard" paste:
            // Channel Name [TAB] Frequency [TAB] Modulation [TAB] AudioOption(Tone) [TAB] Service Type [TAB] Attenuator [TAB] Delay [TAB] Lockout [TAB] Priority [TAB] Alert Tone [TAB] Alert Light

            // Let's try a standard robust set:
            // Name\tFrequency\tModulation\tAudioOption\tServiceType
            // This is often sufficient for Sentinel to guess the columns or mapping.

            const line = `${name}\t${frequency}\t${modulation}\t${tone}\t${serviceType}\tOff\t${delay}\tOff\tOff`;

            exportText += line + "\n";
        });
    });

    return exportText;
}

function mapToUnidenServiceType(category: string): string {
    const c = category.toLowerCase();

    if (c.includes("police") || c.includes("law") || c.includes("sheriff")) return "Law Dispatch";
    if (c.includes("fire")) return "Fire Dispatch";
    if (c.includes("ems") || c.includes("medic")) return "EMS Dispatch";
    if (c.includes("public works")) return "Public Works";
    if (c.includes("multi")) return "Multi-Dispatch";
    if (c.includes("rail")) return "Railroad";
    if (c.includes("air")) return "Aviation";
    if (c.includes("marine")) return "Marine";
    if (c.includes("ham")) return "Ham Radio";
    if (c.includes("school")) return "Schools";
    if (c.includes("security")) return "Security";
    if (c.includes("utility") || c.includes("power")) return "Utilities";
    if (c.includes("hospital")) return "Hospital";
    if (c.includes("trans")) return "Transportation";
    if (c.includes("business")) return "Business";
    if (c.includes("correction")) return "Corrections";
    if (c.includes("federal")) return "Federal";
    if (c.includes("military")) return "Military";

    return "Custom 1"; // Default
}
