import { describe, it, expect, vi, beforeEach } from "vitest";

const tooling = vi.hoisted(() => ({ toolingWriteMetadata: vi.fn() }));
const direct = vi.hoisted(() => ({ directDeploy: vi.fn() }));
vi.mock("../../../src/salesforce/tooling-metadata.js", () => tooling);
vi.mock("../../../src/salesforce/direct-metadata.js", async (orig) => ({ ...(await orig<object>()), directDeploy: direct.directDeploy }));

import { deployMetadata } from "../../../src/salesforce/cli.js";

describe("deployMetadata and the Tooling write path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    direct.directDeploy.mockResolvedValue({ ok: true, data: undefined });
  });

  it("tries the Tooling API first and stops there when it saved", async () => {
    tooling.toolingWriteMetadata.mockResolvedValue({ ok: true, data: undefined });
    const res = await deployMetadata("/x/Page.flexipage-meta.xml", "org-a");
    expect(res.success).toBe(true);
    expect(tooling.toolingWriteMetadata).toHaveBeenCalledOnce();
    expect(direct.directDeploy).not.toHaveBeenCalled();
  });

  it("deploys through the Metadata API when Tooling steps aside", async () => {
    tooling.toolingWriteMetadata.mockResolvedValue(null);
    const res = await deployMetadata("/x/Page.flexipage-meta.xml", "org-a");
    expect(res.success).toBe(true);
    expect(direct.directDeploy).toHaveBeenCalledOnce();
    expect(direct.directDeploy.mock.calls[0][4]).toBeUndefined();
  });

  it("keeps check-only validation on the Metadata API", async () => {
    tooling.toolingWriteMetadata.mockResolvedValue({ ok: true, data: undefined });
    await deployMetadata("/x/Page.flexipage-meta.xml", "org-a", undefined, true);
    expect(tooling.toolingWriteMetadata).not.toHaveBeenCalled();
    expect(direct.directDeploy).toHaveBeenCalledOnce();
  });
});
