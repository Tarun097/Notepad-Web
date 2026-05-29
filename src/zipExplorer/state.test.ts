import { describe, it, expect } from "vitest";
import { buildTree, isZipPath } from "./state";
import type { ZipEntry } from "./types";

describe("buildTree", () => {
  it("builds a flat list of files", () => {
    const entries: ZipEntry[] = [
      { path: "a.txt", name: "a.txt", dir: false },
      { path: "b.txt", name: "b.txt", dir: false },
    ];
    const tree = buildTree(entries);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe("a.txt");
    expect(tree.children[0].dir).toBe(false);
  });

  it("builds nested directory structure", () => {
    const entries: ZipEntry[] = [
      { path: "src/", name: "src/", dir: true },
      { path: "src/index.ts", name: "index.ts", dir: false },
      { path: "src/utils/helper.ts", name: "helper.ts", dir: false },
    ];
    const tree = buildTree(entries);
    expect(tree.children).toHaveLength(1);
    const src = tree.children[0];
    expect(src.name).toBe("src");
    expect(src.dir).toBe(true);
    expect(src.children).toHaveLength(2);
  });

  it("sorts directories before files", () => {
    const entries: ZipEntry[] = [
      { path: "z.txt", name: "z.txt", dir: false },
      { path: "a-dir/", name: "a-dir/", dir: true },
      { path: "a-dir/file.txt", name: "file.txt", dir: false },
    ];
    const tree = buildTree(entries);
    expect(tree.children[0].name).toBe("a-dir");
    expect(tree.children[0].dir).toBe(true);
    expect(tree.children[1].name).toBe("z.txt");
  });

  it("sorts alphabetically within same type", () => {
    const entries: ZipEntry[] = [
      { path: "c.txt", name: "c.txt", dir: false },
      { path: "a.txt", name: "a.txt", dir: false },
      { path: "b.txt", name: "b.txt", dir: false },
    ];
    const tree = buildTree(entries);
    expect(tree.children.map((c) => c.name)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("handles empty entries", () => {
    const tree = buildTree([]);
    expect(tree.children).toHaveLength(0);
    expect(tree.path).toBe("");
  });

  it("creates intermediate directories implicitly", () => {
    const entries: ZipEntry[] = [
      { path: "a/b/c.txt", name: "c.txt", dir: false },
    ];
    const tree = buildTree(entries);
    expect(tree.children[0].name).toBe("a");
    expect(tree.children[0].dir).toBe(true);
    expect(tree.children[0].children[0].name).toBe("b");
    expect(tree.children[0].children[0].dir).toBe(true);
    expect(tree.children[0].children[0].children[0].name).toBe("c.txt");
  });
});

describe("isZipPath", () => {
  it("detects .zip files", () => {
    expect(isZipPath("archive.zip")).toBe(true);
    expect(isZipPath("path/to/file.ZIP")).toBe(true);
  });

  it("detects .jar, .war, .ear, .apk, .epub", () => {
    expect(isZipPath("app.jar")).toBe(true);
    expect(isZipPath("deploy.war")).toBe(true);
    expect(isZipPath("enterprise.ear")).toBe(true);
    expect(isZipPath("mobile.apk")).toBe(true);
    expect(isZipPath("book.epub")).toBe(true);
  });

  it("rejects non-zip extensions", () => {
    expect(isZipPath("file.txt")).toBe(false);
    expect(isZipPath("image.png")).toBe(false);
    expect(isZipPath("script.js")).toBe(false);
    expect(isZipPath("archive.tar.gz")).toBe(false);
  });
});
