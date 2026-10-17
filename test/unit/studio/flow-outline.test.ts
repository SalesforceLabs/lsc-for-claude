import { describe, it, expect } from "vitest";
import { describeFlow, outlineText } from "../../../src/studio/flow-outline.js";

type El = Record<string, unknown>;

function flow(start: El, elements: El = {}): El {
  return { label: "Test flow", processType: "AutoLaunchedFlow", start, ...elements };
}

const afterSave = (object: string, connector?: string, over: El = {}): El => ({
  object,
  triggerType: "RecordAfterSave",
  recordTriggerType: "Create",
  ...(connector ? { connector: { targetReference: connector } } : {}),
  ...over,
});

const titles = (meta: El) => describeFlow(meta).findings.map((f) => f.title);

describe("describeFlow — outline", () => {
  it("describes a before-save flow that sets fields on the record", () => {
    const { outline, findings } = describeFlow(
      flow(
        {
          object: "Account",
          triggerType: "RecordBeforeSave",
          recordTriggerType: "Update",
          doesRequireRecordChangedToMeetCriteria: true,
          filterLogic: "and",
          filters: [{ field: "Plan__c", operator: "IsNull", value: { booleanValue: false } }],
          connector: { targetReference: "Tick" },
        },
        {
          recordUpdates: [
            { name: "Tick", label: "Tick the box", inputReference: "$Record", inputAssignments: [{ field: "Filled__c", value: { booleanValue: true } }] },
          ],
        }
      )
    );
    expect(outline.trigger).toBe("Before an Account is saved — when it's updated");
    expect(outline.conditions).toEqual(["Plan__c is set"]);
    expect(outline.conditionLogic).toBeNull();
    expect(outline.onlyWhenChanged).toBe(true);
    expect(outline.effects).toEqual(["Sets Filled__c on the record before it's saved"]);
    expect(findings).toEqual([]);
  });

  it("nests decision outcomes and marks where branches stop or rejoin", () => {
    const { outline } = describeFlow(
      flow(afterSave("Visit", "Check"), {
        decisions: [
          {
            name: "Check",
            label: "Is it submitted?",
            defaultConnectorLabel: "No",
            rules: [
              {
                name: "Yes",
                label: "Yes",
                conditionLogic: "and",
                conditions: [{ leftValueReference: "$Record.Status", operator: "EqualTo", rightValue: { stringValue: "Submitted" } }],
                connector: { targetReference: "Notify" },
              },
              {
                name: "Maybe",
                label: "Changed",
                conditionLogic: "1 AND NOT 2",
                conditions: [
                  { leftValueReference: "$Record.Status", operator: "IsChanged", rightValue: { booleanValue: true } },
                  { leftValueReference: "$Record__Prior.Status", operator: "IsNull", rightValue: {} },
                ],
                connector: { targetReference: "Notify" },
              },
            ],
          },
        ],
        actionCalls: [{ name: "Notify", label: "Notify", actionType: "emailAlert", actionName: "Visit.Done", faultConnector: { targetReference: "Oops" } }],
        customErrors: [{ name: "Oops", label: "Oops", customErrorMessages: [{ errorMessage: "Couldn't notify" }] }],
      })
    );
    expect(outline.steps).toEqual([
      { depth: 0, kind: "decision", text: "Is it submitted?" },
      { depth: 1, kind: "outcome", text: 'Yes — when Status = "Submitted"' },
      { depth: 2, kind: "action", text: "Notify: sends email alert Visit.Done" },
      { depth: 3, kind: "outcome", text: "If it fails" },
      { depth: 4, kind: "error", text: 'Oops: stops the save with an error: "Couldn\'t notify"' },
      { depth: 1, kind: "outcome", text: "Changed — when 1 AND NOT 2, where 1: Status changed; 2: previous Status is empty" },
      { depth: 2, kind: "goto", text: 'Continues at "Notify"' },
      { depth: 1, kind: "outcome", text: "Otherwise (No) — stops" },
    ]);
    expect(outline.effects).toEqual(["Sends email alert Visit.Done", 'Stops the save with an error: "Couldn\'t notify"']);
  });

  it("walks loop bodies and scheduled paths", () => {
    const { outline } = describeFlow(
      flow(
        afterSave("Visit", "Each", {
          scheduledPaths: [{ name: "Later", pathType: "AsyncAfterCommit", connector: { targetReference: "Mail" } }],
        }),
        {
          loops: [{ name: "Each", label: "Each attendee", collectionReference: "Attendees", nextValueConnector: { targetReference: "Skip" } }],
          decisions: [{ name: "Skip", label: "Skip?", defaultConnector: { targetReference: "Each" }, rules: [] }],
          actionCalls: [{ name: "Mail", label: "Mail", actionType: "createThing", actionName: "createThing" }],
        }
      )
    );
    expect(outline.steps).toEqual([
      { depth: 0, kind: "loop", text: "Each attendee: for each item in Attendees" },
      { depth: 1, kind: "decision", text: "Skip?" },
      { depth: 2, kind: "outcome", text: "Otherwise (default) — next item" },
      { depth: 0, kind: "path", text: "Afterwards, separately (run asynchronously)" },
      { depth: 1, kind: "action", text: "Mail: runs action createThing" },
    ]);
  });

  it("renders the outline as text for Ask Claude", () => {
    const { outline } = describeFlow(
      flow(afterSave("Visit", "Make", { filters: [{ field: "Status", operator: "EqualTo", value: { stringValue: "Done" } }] }), {
        recordCreates: [{ name: "Make", label: "Make task", object: "Task", inputAssignments: [{ field: "Subject" }], faultConnector: { targetReference: "x" } }],
      })
    );
    expect(outlineText(outline)).toBe(
      [
        "After a Visit is saved — when it's created",
        "Entry conditions (and):",
        '  - Status = "Done"',
        "Steps:",
        "  - Make task: creates a Task (sets Subject)",
        "    - If it fails",
        "What it changes:",
        "  - Creates a Task (sets Subject)",
      ].join("\n")
    );
  });
});

describe("describeFlow — health checks", () => {
  it("flags record reads and saves inside a loop", () => {
    const meta = flow(afterSave("Visit", "Each"), {
      loops: [{ name: "Each", label: "Each", collectionReference: "Items", nextValueConnector: { targetReference: "Get" } }],
      recordLookups: [{ name: "Get", label: "Get product", object: "Product2", connector: { targetReference: "Each" } }],
    });
    const [finding] = describeFlow(meta).findings;
    expect(finding).toMatchObject({ severity: "warning", title: "Reads or saves records inside a loop" });
    expect(finding.detail).toContain('"Get product"');
  });

  it("flags after-save updates to the triggering record, by $Record or by Id", () => {
    const byRecord = flow(afterSave("Visit", "U"), {
      recordUpdates: [{ name: "U", label: "U", inputReference: "$Record", inputAssignments: [{ field: "X" }], faultConnector: { targetReference: "z" } }],
    });
    const byId = flow(afterSave("Visit", "U"), {
      recordUpdates: [
        {
          name: "U",
          label: "U",
          object: "Visit",
          filters: [{ field: "Id", operator: "EqualTo", value: { elementReference: "$Record.Id" } }],
          faultConnector: { targetReference: "z" },
        },
      ],
    });
    expect(titles(byRecord)).toEqual(["Saves the record it was triggered by again"]);
    expect(titles(byId)).toEqual(["Saves the record it was triggered by again"]);
    expect(describeFlow(byId).outline.effects).toEqual(["Saves the record again"]);
  });

  it("flags update flows with no entry conditions, but not create-only ones", () => {
    expect(titles(flow(afterSave("Visit", undefined, { recordTriggerType: "CreateAndUpdate" })))).toEqual(["Runs on every save"]);
    expect(titles(flow(afterSave("Visit")))).toEqual([]);
  });

  it("notes custom errors and steps without fault paths — but not on async paths", () => {
    const meta = flow(
      afterSave("Visit", "Make", { scheduledPaths: [{ name: "Later", pathType: "AsyncAfterCommit", connector: { targetReference: "Mail" } }] }),
      {
        recordCreates: [{ name: "Make", label: "Make task", object: "Task", connector: { targetReference: "Stop" } }],
        customErrors: [{ name: "Stop", label: "Stop", customErrorMessages: [] }],
        actionCalls: [{ name: "Mail", label: "Mail", actionType: "emailSimple" }],
      }
    );
    const { findings } = describeFlow(meta);
    expect(findings.map((f) => f.title)).toEqual(["Can block the save with an error", "No error handling"]);
    expect(findings[1].detail).toContain('"Make task"');
    expect(findings[1].detail).not.toContain("Mail");
  });
});
