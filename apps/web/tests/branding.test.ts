import { describe, expect, it } from "vitest";
import { liveTalkingBase } from "@/lib/avatars/adapters";
import { parseVoice } from "@/lib/avatars/credentials";
import { PROVIDERS, providerMeta } from "@/lib/avatars/providers";
import { brandStyle, contrast, extractColors, findLogos, inkOn, normaliseWebsite, themeAttr } from "@/lib/branding";

describe("website normalisation", () => {
  it("accepts bare domains and upgrades http", () => {
    expect(normaliseWebsite("alnoorlaw.ae").toString()).toBe("https://alnoorlaw.ae/");
    expect(normaliseWebsite("http://www.firm.com/about").toString()).toBe("https://www.firm.com/about");
  });
  it("rejects IPs, ports, credentials and junk", () => {
    expect(() => normaliseWebsite("http://127.0.0.1")).toThrow();
    expect(() => normaliseWebsite("https://firm.com:8443")).toThrow();
    expect(() => normaliseWebsite("https://user:pw@firm.com")).toThrow();
    expect(() => normaliseWebsite("localhost")).toThrow();
    expect(() => normaliseWebsite("ftp://firm.com")).toThrow();
  });
});

describe("logo detection", () => {
  const base = new URL("https://firm.com/");
  it("prefers logo images, then touch icons, then og:image", () => {
    const html = `
      <meta property="og:image" content="/social.jpg">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="/favicon.ico">
      <img class="site-logo" src="/img/logo.svg" alt="Firm">
      <img src="/hero.jpg" alt="Office">`;
    const logos = findLogos(html, base);
    expect(logos[0].url).toBe("https://firm.com/img/logo.svg");
    expect(logos.map((l) => l.source)).toEqual(["img", "apple-touch-icon", "og:image"]);
    expect(logos.some((l) => l.url.endsWith("hero.jpg"))).toBe(false);
  });
  it("ignores data URIs and upgrades http", () => {
    const logos = findLogos(`<img id="logo" src="data:image/png;base64,xx"><img alt="brand" src="http://cdn.firm.com/b.png">`, base);
    expect(logos).toEqual([{ url: "https://cdn.firm.com/b.png", source: "img", score: 90 }]);
  });
});

describe("colour extraction", () => {
  it("ranks brand colours, drops greys/white/black and near-duplicates", () => {
    const css = ".a{color:#1d3a5f}.b{background:#1d3a5f}.c{color:#1e3b60}.d{color:#ffffff}.e{color:#333}.f{color:rgb(163,128,47)}";
    const colors = extractColors(css, "#c0392b");
    expect(colors[0]).toBe("#c0392b"); // theme-color weighted first
    expect(colors).toContain("#1d3a5f");
    expect(colors).toContain("#a3802f");
    expect(colors).not.toContain("#1e3b60");
    expect(colors).not.toContain("#ffffff");
  });
});

describe("theme helpers", () => {
  it("picks readable ink and sets variables only when chosen", () => {
    expect(inkOn("#1d3a5f")).toBe("#ffffff");
    expect(inkOn("#f5d76e")).toBe("#111111");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(brandStyle({ brand_primary: "#1d3a5f", brand_accent: null })).toMatchObject({ "--accent": "#1d3a5f", "--accent-ink": "#ffffff" });
    expect(brandStyle({ brand_primary: "not-a-colour", brand_accent: null })).toEqual({});
    expect(themeAttr("auto")).toBeUndefined();
    expect(themeAttr("dark")).toBe("dark");
  });
});

describe("avatar providers", () => {
  it("has the required providers with honest capabilities", () => {
    const ids = PROVIDERS.map((p) => p.id);
    for (const id of ["builtin", "leaptalk", "heygen", "did", "simli", "livetalking", "elevenlabs"]) expect(ids).toContain(id);
    expect(providerMeta("builtin")?.credentials).toEqual([]);
    expect(providerMeta("heygen")?.credentials).toEqual(["apiKey"]);
    expect(providerMeta("livetalking")?.credentials).toEqual(["url"]);
  });
  it("parses stored voice ids", () => {
    expect(parseVoice("elevenlabs:abc")).toEqual({ provider: "elevenlabs", id: "abc" });
    expect(parseVoice("heygen:v1")).toEqual({ provider: "heygen", id: "v1" });
    expect(parseVoice("en-GB-RyanNeural")).toEqual({ provider: "builtin", id: "en-GB-RyanNeural" });
    expect(parseVoice(null)).toEqual({ provider: "builtin", id: null });
  });
  it("requires https for self-hosted real-time servers", () => {
    expect(liveTalkingBase("https://gpu.firm.com:8010").host).toBe("gpu.firm.com:8010");
    expect(() => liveTalkingBase("http://gpu.firm.com")).toThrow();
  });
});
