import { describe, it, expect } from "vitest";
import { findRanges, countMatches, escapeHtml } from "./search";

describe("findRanges", () => {
  it("finds literal matches case-insensitive by default", () => {
    const ranges = findRanges("Hello World hello", "hello");
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ from: 0, to: 5 });
    expect(ranges[1]).toMatchObject({ from: 12, to: 17 });
  });

  it("respects matchCase option", () => {
    const ranges = findRanges("Hello World hello", "hello", { matchCase: true });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(12);
  });

  it("supports regex mode", () => {
    const ranges = findRanges("foo123bar456", "\\d+", { regex: true });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ from: 3, to: 6, text: "123" });
    expect(ranges[1]).toMatchObject({ from: 9, to: 12, text: "456" });
  });

  it("respects limit parameter", () => {
    const text = "aaa";
    const ranges = findRanges(text, "a", {}, 2);
    expect(ranges).toHaveLength(2);
  });

  it("respects skip parameter", () => {
    const text = "a b a b a";
    const ranges = findRanges(text, "a", {}, 10, 1);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].from).toBe(4);
    expect(ranges[1].from).toBe(8);
  });

  it("returns empty for empty query", () => {
    expect(findRanges("some text", "")).toEqual([]);
  });

  it("returns empty for invalid regex", () => {
    expect(findRanges("text", "[invalid", { regex: true })).toEqual([]);
  });

  it("handles overlapping potential matches correctly", () => {
    const ranges = findRanges("aaaa", "aa");
    // Non-overlapping: positions 0 and 2
    expect(ranges).toHaveLength(2);
    expect(ranges[0].from).toBe(0);
    expect(ranges[1].from).toBe(2);
  });
});

describe("countMatches", () => {
  it("counts all occurrences", () => {
    expect(countMatches("hello world hello", "hello")).toBe(2);
  });

  it("counts case-insensitive by default", () => {
    expect(countMatches("Hello HELLO hello", "hello")).toBe(3);
  });

  it("respects matchCase", () => {
    expect(countMatches("Hello HELLO hello", "hello", { matchCase: true })).toBe(1);
  });

  it("returns 0 for empty query", () => {
    expect(countMatches("text", "")).toBe(0);
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("handles combined special chars", () => {
    expect(escapeHtml('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});
