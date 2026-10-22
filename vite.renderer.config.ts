import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * The built app's Content-Security-Policy. Replies, documents and org data are rendered in this
 * window, which has the preload's API, so no script runs here but the app's own bundle. Live LWC
 * previews run in lsc-frame: documents with their own policy (src-electron/frame-docs.ts). Only the
 * build gets it: the dev server's hot reload needs inline and eval'd scripts.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.salesforce.com https://*.force.com https://*.sfdcstatic.com https://*.documentforce.com",
  "connect-src 'self'",
  "frame-src lsc-frame:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "lsc-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: APP_CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  root: path.resolve(__dirname, "src-renderer"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist-renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
