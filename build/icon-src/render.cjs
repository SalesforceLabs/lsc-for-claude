// Renders SVGs to transparent PNGs with Chromium (Quick Look adds a white background).
// Usage: electron render.cjs <svg>:<size>:<out.png> ...
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("data:text/html,<body></body>");
  for (const job of process.argv.slice(2).filter((a) => a.includes(".svg:"))) {
    const [svg, size, out] = job.split(":");
    const src = "data:image/svg+xml;base64," + fs.readFileSync(svg).toString("base64");
    const png = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = ${Number(size)};
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/png"));
      };
      img.onerror = () => fail(new Error("could not load ${svg}"));
      img.src = ${JSON.stringify(src)};
    })`);
    fs.writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
  }
  app.quit();
});
