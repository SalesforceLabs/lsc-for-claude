import { describe, it, expect } from "vitest";
import { updateBlocker, updateErrorMessage } from "../../../src-electron/update-state.js";
import { canCheckForUpdates, updateStatusText } from "../../../src-renderer/update.js";

const installed = { packaged: true, platform: "darwin", appPath: "/Applications/Roz for LSC.app/Contents/Resources/app.asar" };

describe("updateBlocker", () => {
  it("lets the installed Mac app update", () => {
    expect(updateBlocker(installed)).toBeNull();
  });

  it("blocks dev builds, other platforms and ROZ_UPDATES=0", () => {
    expect(updateBlocker({ ...installed, packaged: false })).toMatch(/installed app/);
    expect(updateBlocker({ ...installed, platform: "win32" })).toMatch(/macOS/);
    expect(updateBlocker({ ...installed, disabled: true })).toMatch(/ROZ_UPDATES=0/);
  });

  it("asks to move the app when it runs from the disk image or a translocated copy", () => {
    expect(updateBlocker({ ...installed, appPath: "/Volumes/Roz for LSC 0.3.2/Roz for LSC.app/Contents/Resources/app.asar" })).toMatch(/Applications/);
    expect(updateBlocker({ ...installed, appPath: "/private/var/folders/x/AppTranslocation/ABC/d/Roz for LSC.app/Contents/Resources/app.asar" })).toMatch(/Applications/);
  });
});

describe("updateErrorMessage", () => {
  it("says GitHub couldn't be reached for network errors", () => {
    expect(updateErrorMessage(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe("Couldn't reach GitHub to check for updates.");
    expect(updateErrorMessage(new Error("getaddrinfo ENOTFOUND github.com"))).toBe("Couldn't reach GitHub to check for updates.");
  });

  it("explains a signature mismatch", () => {
    expect(updateErrorMessage(new Error("Code signature at URL file:///x did not pass validation"))).toMatch(/signature/);
  });

  it("keeps the first line of anything else, cut to length", () => {
    expect(updateErrorMessage(new Error("HttpError: 404\nheaders: {...}"))).toBe("HttpError: 404");
    expect(updateErrorMessage(new Error("x".repeat(300)))).toHaveLength(200);
    expect(updateErrorMessage("")).toBe("The update check failed.");
  });
});

describe("updateStatusText", () => {
  it("words every state", () => {
    expect(updateStatusText({ status: "unsupported", version: "0.3.2", reason: "Updates only run in the installed app." })).toBe("Updates only run in the installed app.");
    expect(updateStatusText({ status: "idle", version: "0.3.2" })).toMatch(/on its own/);
    expect(updateStatusText({ status: "idle", version: "0.3.2", checkedAt: Date.now() })).toMatch(/^Up to date\. Checked at /);
    expect(updateStatusText({ status: "checking", version: "0.3.2" })).toBe("Checking for updates…");
    expect(updateStatusText({ status: "downloading", version: "0.3.2", next: "0.3.3", percent: 42 })).toBe("Downloading version 0.3.3… 42%");
    expect(updateStatusText({ status: "ready", version: "0.3.2", next: "0.3.3" })).toMatch(/^Version 0\.3\.3 is ready/);
    expect(updateStatusText({ status: "error", version: "0.3.2", message: "Couldn't reach GitHub to check for updates." })).toBe("Couldn't reach GitHub to check for updates.");
  });

  it("allows a manual check only when nothing is running or waiting", () => {
    expect(canCheckForUpdates({ status: "idle", version: "0.3.2" })).toBe(true);
    expect(canCheckForUpdates({ status: "error", version: "0.3.2", message: "x" })).toBe(true);
    expect(canCheckForUpdates({ status: "checking", version: "0.3.2" })).toBe(false);
    expect(canCheckForUpdates({ status: "ready", version: "0.3.2", next: "0.3.3" })).toBe(false);
  });
});
