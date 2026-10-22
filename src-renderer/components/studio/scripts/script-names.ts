/** Names for new custom scripts: the LWC component name follows the script's name until the admin edits it. */

/** The longest LWC bundle name the Metadata API takes. */
export const MAX_COMPONENT_NAME = 80;

/** "Visit checks (v2)" -> "visitChecksV2": words joined in camelCase, lowercase first, letters and digits only. */
export function deriveComponentName(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const joined = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join("");
  // A name can't start with a digit.
  const clean = /^[0-9]/.test(joined) ? `script${joined.charAt(0).toUpperCase()}${joined.slice(1)}` : joined;
  return clean.slice(0, MAX_COMPONENT_NAME);
}

/**
 * Why a component name can't be used, in plain words, or null when it can. `taken` are the names of the scripts
 * (and queued creates) already in the library; names compare without regard to case, as the platform does.
 */
export function componentNameProblem(name: string, taken: readonly string[] = []): string | null {
  if (!name) return "Give the component a name.";
  if (!/^[a-z]/.test(name)) return "Start with a lowercase letter.";
  if (/[^A-Za-z0-9_]/.test(name)) return "Use only letters, numbers and underscores.";
  if (name.endsWith("_")) return "Don't end with an underscore.";
  if (name.includes("__")) return "Don't use two underscores in a row.";
  if (name.length > MAX_COMPONENT_NAME) return `Keep it to ${MAX_COMPONENT_NAME} characters or fewer.`;
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return "A script already uses this component name.";
  return null;
}

/** Why a script's display name can't be used, or null. */
export function scriptNameProblem(name: string): string | null {
  if (!name.trim()) return "Give the script a name.";
  if (name.length > 255) return "Keep the name to 255 characters or fewer.";
  return null;
}
