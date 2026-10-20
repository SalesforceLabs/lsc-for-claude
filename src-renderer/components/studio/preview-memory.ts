/** The iPad preview's last profile (and rep) per org, so Studio opens it again after a restart or an org switch. */
export interface RememberedPreview {
  profile: string;
  userId?: string;
}

const key = (org: string) => `roz.ipadPreview.${org.toLowerCase()}`;

export function recallPreview(org: string): RememberedPreview | null {
  try {
    const raw = localStorage.getItem(key(org));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedPreview>;
    if (typeof v?.profile !== "string" || !v.profile) return null;
    return { profile: v.profile, userId: typeof v.userId === "string" && v.userId ? v.userId : undefined };
  } catch {
    return null;
  }
}

export function rememberPreview(org: string, preview: RememberedPreview) {
  try {
    localStorage.setItem(key(org), JSON.stringify(preview));
  } catch {
    // Private mode or a full quota: the preview just isn't remembered
  }
}
