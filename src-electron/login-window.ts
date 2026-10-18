import { BrowserWindow, WebContentsView, type WebContents } from "electron";

/**
 * A window for signing in to Salesforce: a thin toolbar (Back, Forward, Reload, the page's host, Cancel)
 * over the login page. It's an ordinary window with a close button, and Escape closes it too.
 *
 * The toolbar is a static page with no preload: its buttons set `document.title` to a numbered command,
 * which the main process reads (keeping the window's own title), and pushes state back with `executeJavaScript`.
 */

const TOOLBAR_HEIGHT = 44;

const icon = (paths: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const TOOLBAR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: light dark; --bg: #1c1c1e; --text: #f2f2f7; --muted: #8e8e93; --fill: rgba(255,255,255,0.08); --border: rgba(255,255,255,0.1); --accent: #0a84ff; }
  @media (prefers-color-scheme: light) { :root { --bg: #f6f6f7; --text: #1c1c1e; --muted: #6e6e73; --fill: rgba(15,23,42,0.06); --border: rgba(15,23,42,0.1); --accent: #0071e3; } }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; user-select: none; }
  .bar { display: flex; align-items: center; gap: 4px; height: ${TOOLBAR_HEIGHT}px; padding: 0 8px; box-sizing: border-box; border-bottom: 1px solid var(--border); }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; min-width: 28px; padding: 0 6px; border: 0; border-radius: 6px; background: none; color: var(--text); font: inherit; cursor: default; }
  button:hover:not(:disabled) { background: var(--fill); }
  button:disabled { color: var(--muted); opacity: 0.5; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .host { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; margin: 0 6px; padding: 0 10px; border-radius: 6px; background: var(--fill); color: var(--muted); }
  .host span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .host.secure span { color: var(--text); }
  .cancel { padding: 0 10px; }
</style></head>
<body><div class="bar">
  <button id="back" title="Back (⌘[)" aria-label="Back" disabled>${icon('<path d="m15 18-6-6 6-6"/>')}</button>
  <button id="forward" title="Forward (⌘])" aria-label="Forward" disabled>${icon('<path d="m9 18 6-6-6-6"/>')}</button>
  <button id="reload" title="Reload (⌘R)" aria-label="Reload">${icon('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>')}</button>
  <div class="host" id="host" title="">${icon('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')}<span id="hostname">Loading…</span></div>
  <button id="cancel" class="cancel" title="Cancel (Esc)">Cancel</button>
</div>
<script>
  let n = 0;
  const send = (name) => (document.title = "cmd:" + name + "-" + ++n);
  for (const id of ["back", "forward", "reload", "cancel"]) document.getElementById(id).onclick = () => send(id);
  window.update = (s) => {
    document.getElementById("back").disabled = !s.back;
    document.getElementById("forward").disabled = !s.forward;
    document.getElementById("hostname").textContent = s.host || "Loading…";
    const host = document.getElementById("host");
    host.title = s.url || "";
    host.classList.toggle("secure", !!s.secure);
  };
</script></body></html>`;

export interface LoginWindow {
  win: BrowserWindow;
  /** The login page's contents: load the login URL here and watch its navigations. */
  page: WebContents;
}

export function openLoginWindow({ parent, title, partition }: { parent?: BrowserWindow; title: string; partition: string }): LoginWindow {
  const win = new BrowserWindow({
    parent,
    width: 520,
    height: 760 + TOOLBAR_HEIGHT,
    minWidth: 380,
    minHeight: 480,
    title,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `${partition}-toolbar` },
  });
  const view = new WebContentsView({
    webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(view);
  const layout = () => {
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  };
  layout();
  win.on("resize", layout);
  win.once("ready-to-show", () => win.show());

  const page = view.webContents;
  const toolbar = win.webContents;
  toolbar.setWindowOpenHandler(() => ({ action: "deny" }));
  toolbar.on("will-navigate", (e) => e.preventDefault());
  toolbar.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TOOLBAR_HTML)}`);

  const push = () => {
    if (win.isDestroyed() || toolbar.isLoading()) return;
    let host = "";
    let secure = false;
    const url = page.getURL();
    try {
      const u = new URL(url);
      host = u.hostname;
      secure = u.protocol === "https:";
    } catch {
      // Not loaded yet.
    }
    const state = { back: page.navigationHistory.canGoBack(), forward: page.navigationHistory.canGoForward(), host, secure, url };
    toolbar.executeJavaScript(`window.update && window.update(${JSON.stringify(state)})`).catch(() => {});
  };
  toolbar.on("did-finish-load", push);
  for (const event of ["did-navigate", "did-navigate-in-page", "did-stop-loading"] as const) page.on(event as "did-navigate", push);

  const command = (name: string) => {
    if (name === "back" && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
    else if (name === "forward" && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
    else if (name === "reload") page.reload();
    else if (name === "cancel") win.close();
  };
  toolbar.on("page-title-updated", (e, pageTitle) => {
    e.preventDefault();
    const m = /^cmd:(back|forward|reload|cancel)-\d+$/.exec(pageTitle);
    if (m) command(m[1]);
  });

  // The usual browser keys, wherever the focus is.
  const keys = (event: { preventDefault: () => void }, input: Electron.Input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    const name =
      input.key === "Escape" ? "cancel" : mod && input.key === "[" ? "back" : mod && input.key === "]" ? "forward" : mod && input.key.toLowerCase() === "r" ? "reload" : null;
    if (!name) return;
    event.preventDefault();
    command(name);
  };
  page.on("before-input-event", keys);
  toolbar.on("before-input-event", keys);

  win.on("closed", () => {
    if (!page.isDestroyed()) page.close();
  });
  return { win, page };
}
