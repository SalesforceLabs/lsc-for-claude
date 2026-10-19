import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "child_process";
import {
  createMockChildProcess,
  simulateSfSuccess,
  simulateSfError,
  simulateSfJsonError,
  simulateSpawnError,
} from "../../helpers/mock-spawn.js";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// Mock util.promisify to return a mockable execAsync
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("util")>();
  return {
    ...actual,
    promisify: vi.fn((fn: any) => {
      // Return a function that delegates to the mocked exec
      return vi.fn();
    }),
  };
});

// These tests cover the sf CLI path; the direct REST fast path has its own (direct.test.ts).
process.env.LSC_SF_DIRECT = "0";

const { spawn, exec } = await import("child_process");
const mockSpawn = vi.mocked(spawn);

// We need to re-import cli after mocks are set up
// But cli.ts uses promisify(exec) at module level for execAsync
// We'll test spawn-based functions primarily

const {
  execSfCommand,
  listOrgs,
  runSoqlQuery,
  runToolingQuery,
  createRecord,
  updateRecord,
  deleteRecord,
  describeSObject,
  getRecord,
  getLoginCommand,
  apiRequest,
  getOrgCredentials,
  createBulkPresentation,
  generateMobileMetadataCache,
  createToolingRecord,
  updateToolingRecord,
  deleteToolingRecord,
  deployMetadata,
  deployOutcome,
  ensureTmpSfdxProject,
  retrieveMetadata,
  listMetadata,
} = await import("../../../src/salesforce/cli.js");

describe("cli.ts", () => {
  let mockProc: ChildProcess;

  beforeEach(() => {
    mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
  });

  // ==========================================================================
  // execSfCommand
  // ==========================================================================
  describe("execSfCommand()", () => {
    it("adds --json flag to args", async () => {
      const promise = execSfCommand("data", ["query"]);
      simulateSfSuccess(mockProc, { totalSize: 0 });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--json"]),
        expect.any(Object)
      );
    });

    it("adds --target-org when provided", async () => {
      const promise = execSfCommand("data", ["query"], {
        targetOrg: "my-org",
      });
      simulateSfSuccess(mockProc, {});
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--target-org", "my-org"]),
        expect.any(Object)
      );
    });

    it("parses successful JSON stdout", async () => {
      const promise = execSfCommand<{ id: string }>("data", ["query"]);
      simulateSfSuccess(mockProc, { id: "001abc" });
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: "001abc" });
    });

    it("handles JSON parse failure on success exit", async () => {
      const promise = execSfCommand("data", ["query"]);
      process.nextTick(() => {
        mockProc.stdout!.emit("data", Buffer.from("not json"));
        mockProc.emit("close", 0);
      });
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to parse");
    });

    it("returns error from JSON response message", async () => {
      const promise = execSfCommand("data", ["query"]);
      simulateSfJsonError(mockProc, "Invalid query");
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid query");
    });

    it("returns stderr on non-zero exit with non-JSON stdout", async () => {
      const promise = execSfCommand("data", ["query"]);
      process.nextTick(() => {
        mockProc.stderr!.emit("data", Buffer.from("Something broke"));
        mockProc.emit("close", 1);
      });
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("Something broke");
    });

    it("handles spawn error event", async () => {
      const promise = execSfCommand("data", ["query"]);
      simulateSpawnError(mockProc, "ENOENT");
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("ENOENT");
    });
  });

  // ==========================================================================
  // listOrgs
  // ==========================================================================
  describe("listOrgs()", () => {
    it("calls sf org list", async () => {
      const promise = listOrgs();
      simulateSfSuccess(mockProc, {
        nonScratchOrgs: [],
        scratchOrgs: [],
      });
      const result = await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["org", "list"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // runSoqlQuery
  // ==========================================================================
  describe("runSoqlQuery()", () => {
    it("passes --query argument", async () => {
      const promise = runSoqlQuery("SELECT Id FROM Account", "my-org");
      simulateSfSuccess(mockProc, { totalSize: 0, done: true, records: [] });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--query", "SELECT Id FROM Account"]),
        expect.any(Object)
      );
    });

    it("adds --use-tooling-api when requested", async () => {
      const promise = runSoqlQuery("SELECT Id FROM Account", "my-org", {
        useToolingApi: true,
      });
      simulateSfSuccess(mockProc, { totalSize: 0, done: true, records: [] });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--use-tooling-api"]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // createRecord
  // ==========================================================================
  describe("createRecord()", () => {
    it("formats values as key=value pairs", async () => {
      const promise = createRecord(
        "Account",
        { Name: "Test", Industry: "Tech" },
        "my-org"
      );
      simulateSfSuccess(mockProc, { id: "001abc" });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "create",
          "record",
          "--sobject",
          "Account",
          "--values",
          'Name="Test" Industry="Tech"',
        ]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // updateRecord
  // ==========================================================================
  describe("updateRecord()", () => {
    it("includes record ID and values", async () => {
      const promise = updateRecord(
        "Account",
        "001abc",
        { Name: "Updated" },
        "my-org"
      );
      simulateSfSuccess(mockProc, { id: "001abc" });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "update",
          "record",
          "--record-id",
          "001abc",
          "--values",
          'Name="Updated"',
        ]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // deleteRecord
  // ==========================================================================
  describe("deleteRecord()", () => {
    it("passes record ID to delete command", async () => {
      const promise = deleteRecord("Account", "001abc", "my-org");
      simulateSfSuccess(mockProc, { id: "001abc" });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["delete", "record", "--record-id", "001abc"]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // describeSObject
  // ==========================================================================
  describe("describeSObject()", () => {
    it("passes --sobject argument", async () => {
      const promise = describeSObject("Account", "my-org");
      simulateSfSuccess(mockProc, { name: "Account", fields: [] });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["describe", "--sobject", "Account"]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // apiRequest
  // ==========================================================================
  describe("apiRequest()", () => {
    it("constructs REST request with endpoint and method", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "GET",
        undefined,
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ id: "001" }))
        );
        mockProc.emit("close", 0);
      });

      const result = await promise;
      expect(result.success).toBe(true);

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "api",
          "request",
          "rest",
          "/services/data/v66.0/sobjects/Account",
          "--method",
          "GET",
        ]),
        expect.any(Object)
      );
    });

    it("adds --body for POST requests", async () => {
      const body = { Name: "Test" };
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "POST",
        body,
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ id: "001" }))
        );
        mockProc.emit("close", 0);
      });

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--body", JSON.stringify(body)]),
        expect.any(Object)
      );
    });

    it("adds dummy body for DELETE (SF CLI workaround)", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account/001",
        "DELETE",
        undefined,
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit("data", Buffer.from(""));
        mockProc.emit("close", 0);
      });

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "--body",
          JSON.stringify({ mode: "raw" }),
        ]),
        expect.any(Object)
      );
    });

    it("parses array error from API response", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "POST",
        {},
        "my-org"
      );

      const errorResponse = [
        { errorCode: "INVALID_FIELD", message: "No such column 'Foo'" },
      ];
      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify(errorResponse))
        );
        mockProc.emit("close", 1);
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("INVALID_FIELD");
      expect(result.error).toContain("No such column");
    });

    it("filters beta warnings from stderr", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "GET",
        undefined,
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stderr!.emit(
          "data",
          Buffer.from(
            "Warning: this is a beta command\nActual error message\n"
          )
        );
        mockProc.emit("close", 1);
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("Actual error message");
      expect(result.error).not.toContain("beta");
    });
  });

  // ==========================================================================
  // getLoginCommand (pure function)
  // ==========================================================================
  describe("getLoginCommand()", () => {
    it("returns base command without args", () => {
      expect(getLoginCommand()).toBe("sf org login web");
    });

    it("includes alias when provided", () => {
      expect(getLoginCommand("my-org")).toContain("--alias my-org");
    });

    it("includes instance URL when provided", () => {
      expect(
        getLoginCommand(undefined, "https://test.salesforce.com")
      ).toContain("--instance-url https://test.salesforce.com");
    });

    it("includes both alias and instance URL", () => {
      const cmd = getLoginCommand("my-sandbox", "https://test.salesforce.com");
      expect(cmd).toContain("--alias my-sandbox");
      expect(cmd).toContain("--instance-url https://test.salesforce.com");
    });
  });

  // ==========================================================================
  // runToolingQuery
  // ==========================================================================
  describe("runToolingQuery()", () => {
    it("calls runSoqlQuery with useToolingApi=true", async () => {
      const promise = runToolingQuery("SELECT Id FROM ApexClass", "my-org");
      simulateSfSuccess(mockProc, { totalSize: 0, done: true, records: [] });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--use-tooling-api"]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // getRecord
  // ==========================================================================
  describe("getRecord()", () => {
    it("passes sobject, record-id, and fields", async () => {
      const promise = getRecord(
        "Account",
        "001abc",
        ["Id", "Name"],
        "my-org"
      );
      simulateSfSuccess(mockProc, { Id: "001abc", Name: "Test" });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "get",
          "record",
          "--sobject",
          "Account",
          "--record-id",
          "001abc",
          "--fields",
          "Id,Name",
        ]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // getOrgCredentials
  // ==========================================================================
  describe("getOrgCredentials()", () => {
    it("returns credentials when org display succeeds", async () => {
      const promise = getOrgCredentials("my-org");
      simulateSfSuccess(mockProc, {
        accessToken: "00Dxx!token",
        instanceUrl: "https://example.my.salesforce.com",
      });
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.accessToken).toBe("00Dxx!token");
      expect(result.data?.instanceUrl).toBe(
        "https://example.my.salesforce.com"
      );
    });

    it("returns error when org display fails", async () => {
      const promise = getOrgCredentials("my-org");
      simulateSfJsonError(mockProc, "Org not found");
      const result = await promise;

      expect(result.success).toBe(false);
    });

    it("returns error when accessToken is missing", async () => {
      const promise = getOrgCredentials("my-org");
      simulateSfSuccess(mockProc, {
        instanceUrl: "https://example.my.salesforce.com",
      });
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing");
    });
  });

  // ==========================================================================
  // createToolingRecord
  // ==========================================================================
  describe("createToolingRecord()", () => {
    it("calls apiRequest with correct tooling endpoint", async () => {
      const promise = createToolingRecord(
        "CustomField",
        { FullName: "Account.Test__c" },
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ id: "00N001" }))
        );
        mockProc.emit("close", 0);
      });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "/services/data/v66.0/tooling/sobjects/CustomField",
          "--method",
          "POST",
        ]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // updateToolingRecord
  // ==========================================================================
  describe("updateToolingRecord()", () => {
    it("uses PATCH method with record ID in endpoint", async () => {
      const promise = updateToolingRecord(
        "CustomField",
        "00N001",
        { Metadata: { label: "Updated" } },
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit("data", Buffer.from(""));
        mockProc.emit("close", 0);
      });

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "/services/data/v66.0/tooling/sobjects/CustomField/00N001",
          "--method",
          "PATCH",
        ]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // deleteToolingRecord
  // ==========================================================================
  describe("deleteToolingRecord()", () => {
    it("uses DELETE method", async () => {
      const promise = deleteToolingRecord("CustomField", "00N001", "my-org");

      process.nextTick(() => {
        mockProc.stdout!.emit("data", Buffer.from(""));
        mockProc.emit("close", 0);
      });

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--method", "DELETE"]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // deployMetadata
  // ==========================================================================
  describe("deployMetadata()", () => {
    it("passes source-dir and uses 5-minute timeout", async () => {
      const promise = deployMetadata("/path/to/source", "my-org");
      simulateSfSuccess(mockProc, { status: "Succeeded" });
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "project",
          "deploy",
          "start",
          "--source-dir",
          "/path/to/source",
        ]),
        expect.objectContaining({ timeout: 300000 })
      );
    });
  });

  describe("ensureTmpSfdxProject()", () => {
    it("uses a source API version new enough for objects like Inquiry", () => {
      const dir = ensureTmpSfdxProject();
      const fs = require("fs");
      const proj = JSON.parse(fs.readFileSync(require("path").join(dir, "sfdx-project.json"), "utf8"));
      expect(parseFloat(proj.sourceApiVersion)).toBeGreaterThanOrEqual(66);
    });
  });

  describe("deployOutcome()", () => {
    it("turns a deploy the org rejected into a failure with the org's reason", () => {
      const r = deployOutcome({
        success: true,
        data: {
          status: "Failed",
          success: false,
          numberComponentErrors: 1,
          details: { componentFailures: [{ fullName: "Home_Page", problem: "Invalid component [flexipage:recentItems]: missing required property [entityNames]" }] },
        },
      });
      expect(r.success).toBe(false);
      expect(r.error).toBe("Home_Page: Invalid component [flexipage:recentItems]: missing required property [entityNames]");
    });

    it("accepts a single failure object and a bare Failed status", () => {
      expect(deployOutcome({ success: true, data: { details: { componentFailures: { fullName: "X", problem: "bad", lineNumber: 4 } } } }).error).toBe("X: bad (line 4)");
      expect(deployOutcome({ success: true, data: { status: "Failed" } }).error).toBe("The deploy failed.");
    });

    it("leaves a deploy that succeeded, and CLI failures, alone", () => {
      const ok = { success: true, data: { status: "Succeeded", success: true, numberComponentErrors: 0, details: { componentFailures: [] } } };
      expect(deployOutcome(ok)).toBe(ok);
      const bad = { success: false, error: "no org" };
      expect(deployOutcome(bad)).toBe(bad);
    });

    it("deployMetadata() reports a rejected deploy as failed", async () => {
      const promise = deployMetadata("/path/to/source", "my-org");
      simulateSfSuccess(mockProc, { status: "Failed", success: false, details: { componentFailures: [{ fullName: "P", problem: "nope" }] } });
      const r = await promise;
      expect(r.success).toBe(false);
      expect(r.error).toContain("nope");
    });
  });

  // ==========================================================================
  // retrieveMetadata
  // ==========================================================================
  describe("retrieveMetadata()", () => {
    it("invokes 'sf project retrieve start' with the metadata type", async () => {
      const promise = retrieveMetadata("/output", "ApexClass", "my-org");
      simulateSfSuccess(mockProc, {});
      const result = await promise;

      // Output must live inside the temp SFDX project, so the caller's path is
      // ignored and a timestamped retrieve-output subdir is used instead.
      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "project",
          "retrieve",
          "start",
          "--metadata",
          "ApexClass",
          "--output-dir",
        ]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data?.outputDir).toContain("retrieve-output");
    });

    it("gives retrieves started in the same millisecond their own folders", async () => {
      // Studio previews fixes side by side; two Lightning pages retrieved into one folder came back as each other's XML.
      const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      try {
        const first = retrieveMetadata("", "FlexiPage:A", "my-org");
        simulateSfSuccess(mockProc, {});
        const a = await first;
        const second = retrieveMetadata("", "FlexiPage:B", "my-org");
        simulateSfSuccess(mockProc, {});
        const b = await second;
        expect(a.data?.outputDir).toBeTruthy();
        expect(a.data?.outputDir).not.toBe(b.data?.outputDir);
      } finally {
        now.mockRestore();
      }
    });
  });

  // ==========================================================================
  // listMetadata
  // ==========================================================================
  describe("listMetadata()", () => {
    it("passes metadata-type argument", async () => {
      const promise = listMetadata("ApexClass", "my-org");
      simulateSfSuccess(mockProc, [
        { fullName: "MyClass", type: "ApexClass" },
      ]);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining(["--metadata-type", "ApexClass"]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // generateMobileMetadataCache
  // ==========================================================================
  describe("generateMobileMetadataCache()", () => {
    it("calls connect API with correct payload", async () => {
      const promise = generateMobileMetadataCache(
        "parentId123",
        "66.0",
        "lsc4ce",
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ success: true }))
        );
        mockProc.emit("close", 0);
      });

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "/services/data/v66.0/connect/life-sciences/commercial/metadata/actions/generate",
          "--method",
          "POST",
        ]),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // createBulkPresentation
  // ==========================================================================
  describe("createBulkPresentation()", () => {
    it("sends correct v66 payload structure", async () => {
      const payload = {
        contentType: "PRESENTATION_ZIP" as const,
        name: "Test Presentation",
        pages: [
          {
            contentDocumentId: "069xxx",
            name: "Slide 1",
            pageOrder: 1,
          },
        ],
      };

      const promise = createBulkPresentation(payload, "my-org");

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ isSuccess: true, jobId: "job123" }))
        );
        mockProc.emit("close", 0);
      });

      const result = await promise;
      expect(result.success).toBe(true);

      expect(mockSpawn).toHaveBeenCalledWith(
        "sf",
        expect.arrayContaining([
          "/services/data/v66.0/connect/life-sciences/commercial/bulk-presentation",
          "--method",
          "POST",
        ]),
        expect.any(Object)
      );

      // Verify the body structure
      const callArgs = mockSpawn.mock.calls[0][1] as string[];
      const bodyIndex = callArgs.indexOf("--body");
      const bodyJson = JSON.parse(callArgs[bodyIndex + 1]);
      expect(bodyJson.contentType).toBe("PRESENTATION_ZIP");
      expect(bodyJson.presentation.name).toBe("Test Presentation");
      expect(bodyJson.pages[0].pageNumber).toBe(1);
    });

    it("includes optional fields when provided", async () => {
      const payload = {
        contentType: "PRESENTATION_ZIP" as const,
        name: "Full Presentation",
        presentationId: "a0Kxxx",
        activationDate: "2024-01-01",
        deactivationDate: "2025-01-01",
        playerGesture: "swipe",
        enableDoubleTapZoom: true,
        enablePinchZoom: false,
        topics: ["Oncology", "Cardiology"],
        sendByEmail: true,
        pages: [
          {
            contentDocumentId: "069xxx",
            name: "Slide 1",
            pageOrder: 1,
          },
        ],
      };

      const promise = createBulkPresentation(payload, "my-org");

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ isSuccess: true }))
        );
        mockProc.emit("close", 0);
      });

      await promise;

      const callArgs = mockSpawn.mock.calls[0][1] as string[];
      const bodyIndex = callArgs.indexOf("--body");
      const bodyJson = JSON.parse(callArgs[bodyIndex + 1]);
      expect(bodyJson.presentation.presentationId).toBe("a0Kxxx");
      expect(bodyJson.presentation.activationDate).toBe("2024-01-01");
      expect(bodyJson.presentation.enableDoubleTapZoom).toBe(true);
      expect(bodyJson.presentation.enablePinchZoom).toBe(false);
      expect(bodyJson.presentation.topics).toEqual([
        "Oncology",
        "Cardiology",
      ]);
      expect(bodyJson.presentation.sendByEmail).toBe(true);
    });
  });

  // ==========================================================================
  // apiRequest — additional edge cases
  // ==========================================================================
  describe("apiRequest() edge cases", () => {
    it("handles non-JSON successful response (e.g., empty DELETE)", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account/001",
        "DELETE",
        undefined,
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit("data", Buffer.from(""));
        mockProc.emit("close", 0);
      });

      const result = await promise;
      // Non-JSON on exit code 0 is still success
      expect(result.success).toBe(true);
    });

    it("handles spawn error in apiRequest", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "GET",
        undefined,
        "my-org"
      );

      simulateSpawnError(mockProc, "ENOENT");

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("ENOENT");
    });

    it("handles JSON error with message field on failure", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "POST",
        {},
        "my-org"
      );

      process.nextTick(() => {
        mockProc.stdout!.emit(
          "data",
          Buffer.from(JSON.stringify({ message: "Session expired" }))
        );
        mockProc.emit("close", 1);
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("Session expired");
    });

    it("handles non-JSON error response with stderr fallback", async () => {
      const promise = apiRequest(
        "/services/data/v66.0/sobjects/Account",
        "GET",
        undefined,
        "my-org"
      );

      process.nextTick(() => {
        // Empty stdout, error in stderr
        mockProc.stderr!.emit("data", Buffer.from("Connection refused\n"));
        mockProc.emit("close", 1);
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });
  });
});
