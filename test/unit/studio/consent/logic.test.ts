import { describe, expect, it } from "vitest";
import {
  buildConsent,
  proofMethods,
  readSettings,
  requirement,
  type ConsentInput,
} from "../../../../src/studio/screens/consent/logic";

const base = (over: Partial<ConsentInput> = {}): ConsentInput => ({
  settings: readSettings({ GlobalChannelOpt: "Channel and Topic" }),
  subscriptions: [
    { id: "s2", name: "marketing" },
    { id: "s1", name: "Cordim" },
  ],
  subscriptionChannels: [
    { id: "t1", subscriptionId: "s1", channelId: "email" },
    { id: "t2", subscriptionId: "s2", channelId: "email" },
    { id: "t3", subscriptionId: "s2", channelId: "sms" },
  ],
  channels: [
    { id: "email", name: "Email" },
    { id: "sms", name: "SMS" },
  ],
  contactPoints: {
    c1: { id: "c1", value: "a@x.com" },
    c2: { id: "c2", value: "b@x.com" },
  },
  consents: [
    { subscriptionChannelId: "t1", channelId: "email", contactPointId: "c1", status: "OptIn" },
    { subscriptionChannelId: "t2", channelId: "email", contactPointId: "c1", status: "OptOut" },
  ],
  ...over,
});

describe("settings", () => {
  it("reads every spelling of not required", () => {
    for (const v of ["Not Required", "NotRequired", "NotRequred"]) {
      expect(requirement(v, "Optional")).toBe("NotRequired");
    }
    expect(readSettings({ SignatureRequirements: "NotRequred" }).signature).toBe("NotRequired");
    expect(readSettings({}).signature).toBe("NotRequired");
    expect(readSettings({ SignatureRequirements: "Weird" }).signature).toBe("Optional");
  });

  it("defaults like OCEDBOptSettingsModel", () => {
    const s = readSettings(undefined);
    expect(s.globalChannel).toBe("Topic Only");
    expect(s.multipleChannelValueEnabled).toBe(true);
    expect(s.showRestricted).toBe(false);
  });

  it("offers the proof methods the org leaves on, in the app's order", () => {
    const s = readSettings({
      SignatureRequirements: "Required",
      MobileVerbalConsentRequirements: "Optional",
      MobileAttachmentRequirements: "Not Required",
    });
    expect(proofMethods(s)).toEqual(["DigitalSignature", "VerbalConsent"]);
  });
});

describe("buildConsent", () => {
  it("sorts subscriptions by name ignoring case and titles rows by channel position", () => {
    const { subscriptions } = buildConsent(base());
    expect(subscriptions.map((s) => s.name)).toEqual(["Cordim", "marketing"]);
    expect(subscriptions[0].rows).toEqual([
      expect.objectContaining({ title: "Email 1", value: "a@x.com", state: "OptIn" }),
    ]);
  });

  it("drops channels that have no contact point value", () => {
    const { subscriptions } = buildConsent(base());
    // marketing offers SMS too, but the account has no consent on an SMS contact point
    expect(subscriptions[1].rows.map((r) => r.title)).toEqual(["Email 1"]);
  });

  it("shows a contact point with no consent for that subscription as Not Asked", () => {
    const { subscriptions } = buildConsent(
      base({
        consents: [
          {
            subscriptionChannelId: "t1",
            channelId: "email",
            contactPointId: "c1",
            status: "OptIn",
          },
        ],
      })
    );
    expect(subscriptions[1].rows[0].state).toBe("NotAsked");
  });

  it("numbers several values on one channel by contact point id", () => {
    const { subscriptions } = buildConsent(
      base({
        consents: [
          {
            subscriptionChannelId: "t1",
            channelId: "email",
            contactPointId: "c2",
            status: "OptIn",
          },
          {
            subscriptionChannelId: "t1",
            channelId: "email",
            contactPointId: "c1",
            status: "OptOut",
          },
        ],
      })
    );
    expect(subscriptions[0].rows.map((r) => [r.title, r.value])).toEqual([
      ["Email 1", "a@x.com"],
      ["Email 2", "b@x.com"],
    ]);
  });

  it("shows a social value as Platform: handle", () => {
    const { subscriptions } = buildConsent(
      base({
        contactPoints: { c1: { id: "c1", value: "me", provider: "Facebook" } },
      })
    );
    expect(subscriptions[0].rows[0].value).toBe("Facebook: me");
  });

  it("folds the global row: one state if subscriptions agree, Partial if not", () => {
    const { global } = buildConsent(base());
    expect(global).toHaveLength(1);
    expect(global![0].state).toBe("Partial");
    const agree = buildConsent(
      base({
        consents: [
          {
            subscriptionChannelId: "t1",
            channelId: "email",
            contactPointId: "c1",
            status: "OptIn",
          },
          {
            subscriptionChannelId: "t2",
            channelId: "email",
            contactPointId: "c1",
            status: "OptIn",
          },
        ],
      })
    );
    expect(agree.global![0].state).toBe("OptIn");
  });

  it("has no global row when the setting is Topic Only", () => {
    expect(buildConsent(base({ settings: readSettings({}) })).global).toBeUndefined();
  });

  it("limits to the quick action's subscriptions", () => {
    expect(buildConsent(base({ only: ["s1"] })).subscriptions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("offers Add Channel for channels with no value, or all when several values are allowed", () => {
    const multi = buildConsent(base()).addable;
    expect(multi).toEqual(["Email", "SMS"]);
    const single = buildConsent(
      base({ settings: readSettings({ MultipleChannelValueEnabled: "false" }) })
    ).addable;
    expect(single).toEqual(["SMS"]);
  });
});
