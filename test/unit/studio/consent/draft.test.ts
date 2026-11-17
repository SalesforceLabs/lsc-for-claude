import { describe, expect, it } from "vitest";
import {
  globalState,
  rowKey,
  setGlobal,
} from "../../../../src-renderer/components/studio/consent/consent-logic";
import type {
  ConsentRow,
  ConsentSubscription,
} from "../../../../src-renderer/components/studio/consent/consent-types";

const row = (sct: string, state: ConsentRow["state"]): ConsentRow => ({
  title: "Email 1",
  channelId: "email",
  subscriptionChannelId: sct,
  contactPointId: "c1",
  value: "a@x.com",
  state,
});
const subs: ConsentSubscription[] = [
  { id: "s1", name: "A", rows: [row("t1", "OptIn")] },
  { id: "s2", name: "B", rows: [row("t2", "OptIn")] },
];

describe("consent draft", () => {
  it("the global row follows the subscriptions and goes Partial when they differ", () => {
    expect(globalState(subs, {}, row("g", "NotAsked"))).toBe("OptIn");
    const d = { [rowKey("s2", subs[1].rows[0])]: "OptOut" as const };
    expect(globalState(subs, d, row("g", "NotAsked"))).toBe("Partial");
  });

  it("choosing on the global row sets every subscription's value", () => {
    const d = setGlobal(subs, {}, row("g", "NotAsked"), "OptOut");
    expect(Object.values(d)).toEqual(["OptOut", "OptOut"]);
    expect(globalState(subs, d, row("g", "NotAsked"))).toBe("OptOut");
  });
});
