/**
 * Which URLs a rendered reply may link to. Replies and the documents they cite are model output,
 * and the model reads org data, so a link is only kept when its scheme is one the app handles
 * itself: the knowledge links (lsc-file, lsc-section, lsc-pdf), web pages and mail. Anything else
 * (javascript:, data:, file:, custom app schemes) is dropped, and the link shows as plain text.
 */

const APP_LINK = /^lsc-(file|section|pdf):\/\//;
const EXTERNAL_LINK = /^(https?:\/\/|mailto:)/i;

/** True for a URL the system browser (or mail app) should open. */
export function isExternalUrl(url: string | undefined): url is string {
  return !!url && EXTERNAL_LINK.test(url);
}

/** react-markdown's `urlTransform`: keeps app links, web and mail links and in-page anchors; drops the rest. */
export function markdownUrl(url: string): string {
  if (APP_LINK.test(url) || EXTERNAL_LINK.test(url) || url.startsWith("#")) return url;
  return "";
}

/** Images a reply may show inline: only ones carried in the reply itself, never fetched from a host. */
export function isInlineImage(src: string | undefined): src is string {
  return !!src && /^(data:image\/(png|jpe?g|gif|webp);|blob:)/i.test(src);
}
