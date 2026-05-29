import { describe, it, expect, beforeEach } from "vitest";
import { createInitialState, serializableSession, clampFontSize, clampSplitSize } from "./session";

describe("createInitialState", () => {
  it("creates state with one empty tab", () => {
    const state = createInitialState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].content).toBe("");
    expect(state.tabs[0].name).toBe("new 1.txt");
    expect(state.tabs[0].language).toBe("plaintext");
  });

  it("sets activeId to the tab id", () => {
    const state = createInitialState();
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it("uses default theme and settings", () => {
    const state = createInitialState();
    expect(state.theme).toBe("light");
    expect(state.wrap).toBe(false);
    expect(state.showWhitespace).toBe(false);
    expect(state.fontSize).toBe(13);
    expect(state.splitSize).toBe(42);
  });

  it("initializes search state empty", () => {
    const state = createInitialState();
    expect(state.search).toEqual({ query: "", replacement: "", matchCase: false, regex: false });
  });

  it("generates unique ids on each call", () => {
    const s1 = createInitialState();
    const s2 = createInitialState();
    expect(s1.tabs[0].id).not.toBe(s2.tabs[0].id);
  });
});

describe("serializableSession", () => {
  it("strips handle property from tabs", () => {
    const state = createInitialState();
    (state.tabs[0] as any).handle = { name: "test" };
    const serialized = serializableSession(state);
    expect((serialized.tabs[0] as any).handle).toBeUndefined();
  });

  it("filters out diff tabs", () => {
    const state = createInitialState();
    state.tabs.push({ ...state.tabs[0], id: "diff-1", kind: "diff" } as any);
    const serialized = serializableSession(state);
    expect(serialized.tabs).toHaveLength(1);
    expect(serialized.tabs.every((t) => t.kind !== "diff")).toBe(true);
  });

  it("preserves other state properties", () => {
    const state = createInitialState();
    state.theme = "dark";
    state.fontSize = 16;
    const serialized = serializableSession(state);
    expect(serialized.theme).toBe("dark");
    expect(serialized.fontSize).toBe(16);
  });
});

describe("clampFontSize", () => {
  it("clamps below minimum to 8", () => {
    expect(clampFontSize(4)).toBe(8);
    expect(clampFontSize(0)).toBe(8);
    expect(clampFontSize(-5)).toBe(8);
  });

  it("clamps above maximum to 72", () => {
    expect(clampFontSize(100)).toBe(72);
    expect(clampFontSize(73)).toBe(72);
  });

  it("rounds to nearest integer", () => {
    expect(clampFontSize(13.7)).toBe(14);
    expect(clampFontSize(13.2)).toBe(13);
  });

  it("passes through valid values", () => {
    expect(clampFontSize(13)).toBe(13);
    expect(clampFontSize(8)).toBe(8);
    expect(clampFontSize(72)).toBe(72);
  });
});

describe("clampSplitSize", () => {
  it("clamps below minimum to 25", () => {
    expect(clampSplitSize(10)).toBe(25);
    expect(clampSplitSize(0)).toBe(25);
  });

  it("clamps above maximum to 70", () => {
    expect(clampSplitSize(80)).toBe(70);
    expect(clampSplitSize(71)).toBe(70);
  });

  it("rounds to nearest integer", () => {
    expect(clampSplitSize(42.6)).toBe(43);
    expect(clampSplitSize(42.3)).toBe(42);
  });

  it("passes through valid values", () => {
    expect(clampSplitSize(25)).toBe(25);
    expect(clampSplitSize(50)).toBe(50);
    expect(clampSplitSize(70)).toBe(70);
  });
});
