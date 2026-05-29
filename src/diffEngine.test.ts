import { describe, it, expect } from "vitest";
import { buildLineDiff, summarizeDiff } from "./diffEngine";

describe("buildLineDiff", () => {
  it("returns all equal rows for identical text", () => {
    const rows = buildLineDiff("hello\nworld", "hello\nworld");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "equal")).toBe(true);
    expect(rows[0].leftLine).toBe(1);
    expect(rows[0].rightLine).toBe(1);
  });

  it("detects inserted lines", () => {
    const rows = buildLineDiff("a\nc", "a\nb\nc");
    const inserts = rows.filter((r) => r.kind === "insert");
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts[0].rightText).toBe("b");
  });

  it("detects deleted lines", () => {
    const rows = buildLineDiff("a\nb\nc", "a\nc");
    const deletes = rows.filter((r) => r.kind === "delete");
    expect(deletes.length).toBeGreaterThan(0);
    expect(deletes[0].leftText).toBe("b");
  });

  it("detects changed lines", () => {
    const rows = buildLineDiff("hello world", "hello earth");
    const changes = rows.filter((r) => r.kind === "change");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].leftText).toBe("hello world");
    expect(changes[0].rightText).toBe("hello earth");
  });

  it("handles empty left side", () => {
    const rows = buildLineDiff("", "new line");
    expect(rows.some((r) => r.kind === "insert" || r.kind === "change")).toBe(true);
  });

  it("handles empty right side", () => {
    const rows = buildLineDiff("old line", "");
    expect(rows.some((r) => r.kind === "delete" || r.kind === "change")).toBe(true);
  });

  it("handles both sides empty", () => {
    const rows = buildLineDiff("", "");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("equal");
  });

  it("normalizes CRLF to LF", () => {
    const rows = buildLineDiff("a\r\nb", "a\nb");
    expect(rows.every((r) => r.kind === "equal")).toBe(true);
  });

  it("handles large diff with line-by-line fallback", () => {
    // Create texts large enough to exceed maxDiffCells (1.5M)
    const left = Array.from({ length: 1300 }, (_, i) => `line ${i}`).join("\n");
    const right = Array.from({ length: 1300 }, (_, i) => `line ${i + 1}`).join("\n");
    const rows = buildLineDiff(left, right);
    expect(rows.length).toBe(1300);
  });

  it("assigns correct line numbers", () => {
    const rows = buildLineDiff("a\nb\nc", "a\nb\nc");
    expect(rows[0]).toMatchObject({ leftLine: 1, rightLine: 1 });
    expect(rows[1]).toMatchObject({ leftLine: 2, rightLine: 2 });
    expect(rows[2]).toMatchObject({ leftLine: 3, rightLine: 3 });
  });

  it("handles multi-line insertions at end", () => {
    const rows = buildLineDiff("a", "a\nb\nc");
    const equals = rows.filter((r) => r.kind === "equal");
    const inserts = rows.filter((r) => r.kind === "insert");
    expect(equals).toHaveLength(1);
    expect(inserts).toHaveLength(2);
  });
});

describe("summarizeDiff", () => {
  it("reports matching files", () => {
    const rows = buildLineDiff("same", "same");
    expect(summarizeDiff("a.txt", "b.txt", rows)).toBe("a.txt and b.txt match.");
  });

  it("reports changes count", () => {
    const rows = buildLineDiff("old", "new");
    const summary = summarizeDiff("a.txt", "b.txt", rows);
    expect(summary).toContain("a.txt vs b.txt");
    expect(summary).toMatch(/\d+ changed/);
  });

  it("reports additions", () => {
    const rows = buildLineDiff("a", "a\nb");
    const summary = summarizeDiff("left", "right", rows);
    expect(summary).toContain("1 added");
  });

  it("reports removals", () => {
    const rows = buildLineDiff("a\nb", "a");
    const summary = summarizeDiff("left", "right", rows);
    expect(summary).toContain("1 removed");
  });
});
