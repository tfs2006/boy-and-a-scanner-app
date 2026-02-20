/**
 * Security Utilities for AI & Input Validation
 * 
 * Mitigations for:
 * - OWASP LLM-01: Prompt Injection
 * - OWASP LLM-02: Insecure Output Handling
 * - Malformed Inputs / API Abuse
 */

// Regex for strict 5-digit US ZIP code
const ZIP_REGEX = /^\d{5}$/;

// Regex for safe location inputs (City, State, GPS coordinates)
// Allows letters, numbers, spaces, commas, periods, hyphens, colons.
// Blocks symbols often used in prompt injection ({} [] < > " ' ` ; / \)
const SAFE_LOCATION_REGEX = /^[a-zA-Z0-9\s,.:-]+$/;

/**
 * Validates if the input is a strictly formatted 5-digit US ZIP code.
 * Prevents injection in numeric fields.
 */
export const isValidZipCode = (zip: string): boolean => {
  return ZIP_REGEX.test(zip);
};

/**
 * Validates that text input contains only safe characters for location names.
 * Rejects inputs containing potential injection vectors like curly braces or script tags.
 */
export const isValidLocationInput = (input: string): boolean => {
  if (!input) return true; // Allow empty (handled by required check)
  return SAFE_LOCATION_REGEX.test(input);
};

/**
 * Aggressively sanitizes input before sending to LLM.
 * Removes all non-safe characters and limits length.
 */
export const sanitizeForPrompt = (input: string): string => {
  if (!input) return "";
  // 1. Remove dangerous chars
  const safe = input.replace(/[^a-zA-Z0-9\s,.-]/g, "");
  // 2. Trim whitespace
  const trimmed = safe.trim();
  // 3. Limit length to prevent context window exhaustion attacks
  return trimmed.slice(0, 100);
};
