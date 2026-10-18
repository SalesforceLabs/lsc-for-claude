/**
 * Names for "Make a copy just for this profile". Copied from `src/studio/metadata/copy.ts`
 * (the server checks them again) and kept equal by `test/unit/studio/copy-names.test.ts`.
 */

const LAYOUT_NAME_MAX = 80;
const FLEXIPAGE_NAME_MAX = 80;
const LABEL_MAX = 80;

const safeProfile = (profile: string) => profile.replace(/[^\w .-]/g, "").replace(/\s+/g, " ").trim() || "profile";

/** "Account-HCP Layout" + "LS Rep" → "Account-HCP Layout - LS Rep" and its label. */
export function layoutCopyName(source: string, profile: string): { fullName: string; label: string } {
  const dash = source.indexOf("-");
  if (dash < 1) throw new Error(`Invalid layout name: ${source}`);
  const object = source.slice(0, dash);
  const suffix = ` - ${safeProfile(profile)}`;
  let rest = source.slice(dash + 1);
  if (rest.length + suffix.length > LAYOUT_NAME_MAX) {
    // Don't cut through a percent-escape such as %28.
    rest = rest.slice(0, Math.max(1, LAYOUT_NAME_MAX - suffix.length)).replace(/%[0-9A-Fa-f]?$/, "").trimEnd();
  }
  let label: string;
  try {
    label = decodeURIComponent(rest);
  } catch {
    label = rest;
  }
  return { fullName: `${object}-${rest}${suffix}`, label: `${label}${suffix}` };
}

/** "Account_HCP_Page" + "LS Rep" → "Account_HCP_Page_LS_Rep" (a valid developer name) and a label from the page's own. */
export function flexiPageCopyName(source: string, profile: string, label: string): { fullName: string; label: string } {
  const slug = profile.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "profile";
  const base = source.replace(/__/g, "_");
  const fullName = `${base}_${slug}`.replace(/_+/g, "_").slice(0, FLEXIPAGE_NAME_MAX).replace(/_+$/, "");
  const suffix = ` (${profile})`;
  return { fullName, label: `${label.slice(0, Math.max(1, LABEL_MAX - suffix.length))}${suffix}` };
}
