import { describe, it, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import { searchAllZipFiles, searchSingleZipFile } from "./state";

// loadZipFile expects a File, but JSZip in Node can't read File objects.
// Instead, we directly set the internal loadedZip by calling loadAsync ourselves
// and using a test helper that mirrors loadZipFile's behavior.
async function loadZipForTest(files: Record<string, string>): Promise<void> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  // Re-import state module internals via a loadZipFile that accepts ArrayBuffer
  // We'll use a workaround: generate a Uint8Array and call loadZipFile with a mock File
  const { loadZipFromBuffer } = await import("./state");
  await loadZipFromBuffer(buf);
}

describe("searchAllZipFiles", () => {
  beforeEach(async () => {
    await loadZipForTest({
      "src/main.ts": 'const hello = "world";\nconst foo = "hello";\nconst bar = "hello world";',
      "src/utils.ts": 'export function hello() { return "hello"; }',
      "README.md": "# Hello World\n\nThis is a hello world project.",
    });
  });

  it("finds matches across multiple files", async () => {
    const { hits, totals } = await searchAllZipFiles("hello", false, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(totals.size).toBeGreaterThanOrEqual(3);
  });

  it("respects case sensitivity", async () => {
    const insensitive = await searchAllZipFiles("hello", false, false);
    const sensitive = await searchAllZipFiles("hello", true, false);
    expect(insensitive.hits.length).toBeGreaterThanOrEqual(sensitive.hits.length);
  });

  it("supports regex search", async () => {
    const { hits } = await searchAllZipFiles("hel+o", false, true);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns correct line and column info", async () => {
    const { hits } = await searchAllZipFiles("foo", false, false);
    const fooHit = hits.find((h) => h.path === "src/main.ts");
    expect(fooHit).toBeDefined();
    expect(fooHit!.line).toBe(2);
    expect(fooHit!.column).toBeGreaterThan(0);
  });

  it("respects perFileLimit", async () => {
    const { hits } = await searchAllZipFiles("hello", false, false, 1);
    const perFile = new Map<string, number>();
    for (const h of hits) perFile.set(h.path, (perFile.get(h.path) ?? 0) + 1);
    for (const count of perFile.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it("counts total matches even when capped", async () => {
    const { hits, totals } = await searchAllZipFiles("hello", false, false, 1);
    for (const [path, total] of totals) {
      const shown = hits.filter((h) => h.path === path).length;
      expect(total).toBeGreaterThanOrEqual(shown);
    }
  });

  it("returns empty for no matches", async () => {
    const { hits, totals } = await searchAllZipFiles("zzzznotfound", false, false);
    expect(hits).toHaveLength(0);
    expect(totals.size).toBe(0);
  });

  it("returns empty for empty query", async () => {
    const { hits } = await searchAllZipFiles("", false, false);
    expect(hits).toHaveLength(0);
  });

  it("handles invalid regex gracefully", async () => {
    const { hits } = await searchAllZipFiles("[invalid", false, true);
    expect(hits).toHaveLength(0);
  });

  it("includes preview text", async () => {
    const { hits } = await searchAllZipFiles("foo", false, false);
    expect(hits[0].preview).toContain("foo");
  });
});

describe("searchSingleZipFile", () => {
  beforeEach(async () => {
    await loadZipForTest({
      "log.txt": "error at line 1\nwarning at line 2\nerror at line 3\nerror at line 4\nerror at line 5",
    });
  });

  it("returns matches for a specific file", async () => {
    const hits = await searchSingleZipFile("log.txt", "error", false, false, 0, 100);
    expect(hits).toHaveLength(4);
    expect(hits[0].path).toBe("log.txt");
  });

  it("respects skip parameter", async () => {
    const all = await searchSingleZipFile("log.txt", "error", false, false, 0, 100);
    const skipped = await searchSingleZipFile("log.txt", "error", false, false, 2, 100);
    expect(skipped).toHaveLength(all.length - 2);
    expect(skipped[0].from).toBe(all[2].from);
  });

  it("respects limit parameter", async () => {
    const hits = await searchSingleZipFile("log.txt", "error", false, false, 0, 2);
    expect(hits).toHaveLength(2);
  });

  it("returns empty for non-existent file", async () => {
    const hits = await searchSingleZipFile("nope.txt", "error", false, false, 0, 100);
    expect(hits).toHaveLength(0);
  });

  it("returns empty for empty query", async () => {
    const hits = await searchSingleZipFile("log.txt", "", false, false, 0, 100);
    expect(hits).toHaveLength(0);
  });
});

describe("searchAllZipFiles with nested zips", () => {
  it("searches inside nested zip files", async () => {
    const innerZip = new JSZip();
    innerZip.file("inner.txt", "inner secret content");
    const innerBuf = await innerZip.generateAsync({ type: "arraybuffer" });

    const outerZip = new JSZip();
    outerZip.file("outer.txt", "outer content");
    outerZip.file("inner.zip", innerBuf);
    const outerBuf = await outerZip.generateAsync({ type: "arraybuffer" });

    const { loadZipFromBuffer } = await import("./state");
    await loadZipFromBuffer(outerBuf);

    const { hits } = await searchAllZipFiles("secret", false, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toContain("inner.zip");
    expect(hits[0].path).toContain("inner.txt");
  });
});
