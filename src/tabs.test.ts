import { describe, it, expect } from "vitest";
import { inferLineEnding, nextUntitledName } from "./tabs";

describe("inferLineEnding", () => {
  it("detects CRLF", () => {
    expect(inferLineEnding("hello\r\nworld")).toBe("CRLF");
  });

  it("detects LF", () => {
    expect(inferLineEnding("hello\nworld")).toBe("LF");
  });

  it("defaults to LF for no newlines", () => {
    expect(inferLineEnding("hello world")).toBe("LF");
  });

  it("defaults to LF for empty string", () => {
    expect(inferLineEnding("")).toBe("LF");
  });

  it("detects CRLF even with mixed endings", () => {
    expect(inferLineEnding("a\r\nb\nc")).toBe("CRLF");
  });
});

describe("nextUntitledName", () => {
  it("returns new1.txt when no tabs exist", () => {
    expect(nextUntitledName([])).toBe("new1.txt");
  });

  it("returns new1.txt when no conflicts", () => {
    expect(nextUntitledName(["readme.md", "app.js"])).toBe("new1.txt");
  });

  it("skips existing numbered names", () => {
    expect(nextUntitledName(["new1.txt"])).toBe("new2.txt");
    expect(nextUntitledName(["new1.txt", "new2.txt"])).toBe("new3.txt");
  });

  it("fills gaps in numbering", () => {
    expect(nextUntitledName(["new2.txt", "new3.txt"])).toBe("new1.txt");
  });

  it("handles large numbers", () => {
    const names = Array.from({ length: 100 }, (_, i) => `new${i + 1}.txt`);
    expect(nextUntitledName(names)).toBe("new101.txt");
  });
});
