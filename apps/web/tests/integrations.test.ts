import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { open, seal } from "@/lib/crypto";
import { blockToText, looksLikeNotionToken, notionPageId } from "@/lib/integrations/notion";
import {
  fromBiginContact, isZohoAccountsServer, isZohoApiDomain, moduleFor, splitName, toBiginRecord, writeResult,
} from "@/lib/integrations/zoho";

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("token encryption", () => {
  it("round-trips and is bound to the firm", () => {
    const sealed = seal('{"t":"secret"}', "org-a:notion");
    expect(sealed).not.toContain("secret");
    expect(open(sealed, "org-a:notion")).toBe('{"t":"secret"}');
    expect(() => open(sealed, "org-b:notion")).toThrow();
  });
  it("rejects tampering", () => {
    const parts = seal("x", "a").split(".");
    parts[3] = Buffer.from("y").toString("base64url");
    expect(() => open(parts.join("."), "a")).toThrow();
  });
});

describe("Zoho domains", () => {
  it("accepts only Zoho's own servers", () => {
    expect(isZohoAccountsServer("https://accounts.zoho.com")).toBe(true);
    expect(isZohoAccountsServer("https://accounts.zoho.eu")).toBe(true);
    expect(isZohoAccountsServer("https://accounts.zoho.com.evil.io")).toBe(false);
    expect(isZohoAccountsServer("http://accounts.zoho.com")).toBe(false);
    expect(isZohoApiDomain("https://www.zohoapis.com")).toBe(true);
    expect(isZohoApiDomain("https://www.zohoapis.com/x")).toBe(false);
  });
});

describe("Bigin mapping", () => {
  it("maps individuals to Contacts and companies to Accounts", () => {
    expect(moduleFor({ kind: "individual" })).toBe("Contacts");
    expect(moduleFor({ kind: "organization" })).toBe("Accounts");
    expect(splitName("Ahmed Ali Hassan")).toEqual({ First_Name: "Ahmed Ali", Last_Name: "Hassan" });
    expect(splitName("Cher")).toEqual({ Last_Name: "Cher" });
    const rec = toBiginRecord({ kind: "organization", name: "Acme LLC", email: "a@b.co", phone: "+971 50 000 0000", address: null, notes: null });
    expect(rec.Account_Name).toBe("Acme LLC");
    expect(rec).not.toHaveProperty("Email");
  });
  it("imports contacts safely", () => {
    const c = fromBiginContact({ id: "77", First_Name: "Sara", Last_Name: "K", Email: " Sara@X.com ", Mobile: "not a phone" });
    expect(c).toMatchObject({ name: "Sara K", email: "sara@x.com", phone: null, crm_id: "77", kind: "individual" });
  });
  it("reads write results", () => {
    expect(writeResult({ data: [{ code: "SUCCESS", details: { id: "9" } }] })).toEqual({ ok: true, id: "9" });
    expect(writeResult({ data: [{ code: "INVALID_DATA", message: "bad email" }] })).toEqual({ ok: false, error: "INVALID_DATA: bad email" });
  });
});

describe("Notion", () => {
  it("extracts page IDs only from Notion URLs", () => {
    const id = "1a2b3c4d5e6f708192a3b4c5d6e7f809";
    expect(notionPageId(`https://www.notion.so/firm/Lease-review-${id}`)).toBe("1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809");
    expect(notionPageId(`https://firm.notion.site/Playbook-${id}?pvs=4`)).toBe("1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809");
    expect(notionPageId(`https://evil.com/${id}`)).toBeNull();
    expect(notionPageId("https://www.notion.so/no-id-here")).toBeNull();
  });
  it("recognises integration secrets", () => {
    expect(looksLikeNotionToken("ntn_" + "a".repeat(40))).toBe(true);
    expect(looksLikeNotionToken("sk_live_123")).toBe(false);
  });
  it("renders blocks as text", () => {
    const rt = (t: string) => [{ plain_text: t }];
    expect(blockToText({ id: "1", type: "heading_2", heading_2: { rich_text: rt("Terms") } })).toBe("## Terms");
    expect(blockToText({ id: "2", type: "to_do", to_do: { rich_text: rt("File claim"), checked: true } })).toBe("- [x] File claim");
    expect(blockToText({ id: "3", type: "table_row", table_row: { cells: [rt("A"), rt("B")] } })).toBe("| A | B |");
  });
});
