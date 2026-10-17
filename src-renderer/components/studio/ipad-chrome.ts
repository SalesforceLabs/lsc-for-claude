/**
 * Layout rules for the iPad chrome, measured on LSC Mobile (iPadOS floating
 * tab bar, `UITabBarController` in `.tabBar` mode — the app sets no metrics,
 * so these come from the device).
 */

/** Widest run of tabs one page of the floating tab bar shows, in points. */
export const TAB_PAGE_WIDTH = 525;
/** A tab is its title plus 16pt on each side. */
export const TAB_PADDING = 32;

/**
 * Splits tabs into tab bar pages: each page holds as many whole tabs as fit,
 * and the last page is filled backwards so it ends on the last tab — which is
 * why a tab can show on two pages.
 */
export function tabPages(widths: number[], max = TAB_PAGE_WIDTH): number[][] {
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    if (page.length && used + w > max) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(i);
    used += w;
  });
  if (page.length) pages.push(page);
  if (pages.length > 1) {
    const last = pages[pages.length - 1];
    let total = last.reduce((sum, i) => sum + widths[i], 0);
    for (let i = last[0] - 1; i >= 0 && total + widths[i] <= max; i--) {
      last.unshift(i);
      total += widths[i];
    }
  }
  return pages;
}

let canvas: HTMLCanvasElement | null = null;

/** A tab's width: its title in the tab bar font, plus padding. */
export function tabWidth(label: string): number {
  canvas ??= typeof document === "undefined" ? null : document.createElement("canvas");
  const ctx = canvas?.getContext("2d");
  if (!ctx) return Math.round(label.length * 8.6) + TAB_PADDING;
  ctx.font = `500 17px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
  return Math.ceil(ctx.measureText(label).width) + TAB_PADDING;
}

/** Initials for the avatar button, like the app's profile button without a photo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(-2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
