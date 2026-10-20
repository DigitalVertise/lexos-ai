import { describe, expect, it } from "vitest";
import { dubaiDate, dubaiDateToUtc, dueState } from "@/lib/dates";
import { isValidStoragePath, storagePathFor } from "@/lib/documents";

describe("dates (Dubai, UTC+4)", () => {
  it("converts local Dubai time to UTC", () => {
    expect(dubaiDateToUtc("2026-11-03T09:30")).toBe("2026-11-03T05:30:00.000Z");
    expect(dubaiDateToUtc("2026-11-03")).toBe("2026-11-03T13:00:00.000Z"); // 17:00 Dubai
  });
  it("rejects impossible dates", () => {
    expect(() => dubaiDateToUtc("2026-02-31")).toThrow();
    expect(() => dubaiDateToUtc("2026-13-01")).toThrow();
  });
  it("classifies due dates", () => {
    const now = new Date("2026-10-20T08:00:00Z"); // 12:00 Dubai
    expect(dueState(null, now)).toBe("none");
    expect(dueState("2026-10-19T10:00:00Z", now)).toBe("overdue");
    expect(dueState("2026-10-20T15:00:00Z", now)).toBe("today");
    expect(dueState("2026-10-24T10:00:00Z", now)).toBe("soon");
    expect(dueState("2026-12-01T10:00:00Z", now)).toBe("later");
    expect(dubaiDate("2026-10-20T21:00:00Z")).toBe("2026-10-21");
  });
});

describe("document storage paths", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const doc = "22222222-2222-4222-8222-222222222222";
  it("always start with the org ID and sanitise the filename", () => {
    const path = storagePathFor(org, doc, "../../etc/passwd contract (final).pdf");
    expect(path.startsWith(`${org}/${doc}/`)).toBe(true);
    expect(path.split("/")).toHaveLength(3);
    expect(path).not.toContain("..");
  });
  it("keeps Arabic filenames readable", () => {
    expect(storagePathFor(org, doc, "عقد.pdf")).toBe(`${org}/${doc}/عقد.pdf`);
  });
  it("rejects paths outside the org or document", () => {
    expect(isValidStoragePath(`${org}/${doc}/a.pdf`, org, doc)).toBe(true);
    expect(isValidStoragePath(`other-org/${doc}/a.pdf`, org, doc)).toBe(false);
    expect(isValidStoragePath(`${org}/other-doc/a.pdf`, org, doc)).toBe(false);
    expect(isValidStoragePath(`${org}/${doc}/x/../a.pdf`, org, doc)).toBe(false);
  });
});
