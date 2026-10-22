import { describe, it, expect } from "vitest";
import { chooseUser, findUser, resolveFeatureId } from "../../../src/studio/user-lookup.js";

const row = (Id: string, Name: string, Username: string, IsActive = true, Email = Username) => ({ Id, Name, Username, Email, IsActive, Profile: { Name: "Field Rep" } });

describe("chooseUser", () => {
  it("none, one, and an exact username among several", () => {
    expect(chooseUser("x", [])).toEqual({ kind: "none" });
    expect(chooseUser("x", [row("005A", "Carmen Diaz", "c@x.com")])).toMatchObject({ kind: "one", user: { id: "005A", profile: "Field Rep" } });
    const rows = [row("005A", "Carmen Diaz", "carmen@x.com"), row("005B", "Carmen Diaz", "carmen2@x.com")];
    expect(chooseUser("carmen2@x.com", rows)).toMatchObject({ kind: "one", user: { id: "005B" } });
  });

  it("asks which when several fit", () => {
    const rows = [row("005A", "Carmen Diaz", "a@x.com"), row("005B", "Carmen Diaz", "b@x.com")];
    const r = chooseUser("Carmen Diaz", rows);
    expect(r.kind).toBe("many");
  });

  it("picks the single active user over inactive partial matches", () => {
    const rows = [row("005A", "Carmen Diaz", "a@x.com", true), row("005B", "Carmen Dias", "b@x.com", false)];
    expect(chooseUser("carmen", rows)).toMatchObject({ kind: "one", user: { id: "005A" } });
  });
});

describe("findUser", () => {
  it("looks an Id up directly", async () => {
    const seen: string[] = [];
    await findUser("005000000000001AAA", async (q) => (seen.push(q), []));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("WHERE Id = '005000000000001AAA'");
  });

  it("tries active users first, then inactive, and escapes the term", async () => {
    const seen: string[] = [];
    const out = await findUser("O'Brien", async (q) => (seen.push(q), seen.length === 2 ? [row("005A", "Pat O'Brien", "p@x.com", false)] : []));
    expect(seen[0]).toContain("IsActive = true");
    expect(seen[0]).toContain("O\\'Brien");
    expect(seen[1]).toContain("IsActive = false");
    expect(out).toMatchObject({ kind: "one" });
  });
});

describe("resolveFeatureId", () => {
  it("resolves ids and titles, and refuses nonsense", () => {
    expect(resolveFeatureId("samples")).toBeTruthy();
    expect(resolveFeatureId("zzzz-nothing")).toBeNull();
    expect(resolveFeatureId("")).toBeNull();
  });
});
