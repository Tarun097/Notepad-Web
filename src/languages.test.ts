import { describe, it, expect } from "vitest";
import { inferLanguage, hasKnownExtension, defaultExtensionForLanguage, languageLabels } from "./languages";

describe("inferLanguage", () => {
  const cases: [string, string][] = [
    ["app.js", "javascript"],
    ["component.jsx", "javascript"],
    ["server.mjs", "javascript"],
    ["config.cjs", "javascript"],
    ["index.ts", "typescript"],
    ["App.tsx", "typescript"],
    ["page.html", "html"],
    ["page.htm", "html"],
    ["config.xml", "html"],
    ["styles.css", "css"],
    ["theme.scss", "css"],
    ["vars.less", "css"],
    ["data.json", "json"],
    ["README.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["script.py", "python"],
    ["query.sql", "sql"],
    ["Main.java", "java"],
    ["algo.cpp", "cpp"],
    ["algo.cc", "cpp"],
    ["algo.cxx", "cpp"],
    ["header.hpp", "cpp"],
    ["Program.cs", "csharp"],
    ["Build.groovy", "groovy"],
    ["unknown.xyz", "plaintext"],
    ["noextension", "plaintext"],
    ["Makefile", "plaintext"],
  ];

  it.each(cases)("infers %s as %s", (filename, expected) => {
    expect(inferLanguage(filename)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(inferLanguage("FILE.JS")).toBe("javascript");
    expect(inferLanguage("DATA.JSON")).toBe("json");
    expect(inferLanguage("Style.CSS")).toBe("css");
  });
});

describe("hasKnownExtension", () => {
  it("returns true for known extensions", () => {
    expect(hasKnownExtension("file.txt")).toBe(true);
    expect(hasKnownExtension("app.log")).toBe(true);
    expect(hasKnownExtension("index.ts")).toBe(true);
    expect(hasKnownExtension("style.scss")).toBe(true);
  });

  it("returns false for unknown extensions", () => {
    expect(hasKnownExtension("image.png")).toBe(false);
    expect(hasKnownExtension("archive.zip")).toBe(false);
    expect(hasKnownExtension("binary.exe")).toBe(false);
    expect(hasKnownExtension("noext")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasKnownExtension("FILE.TXT")).toBe(true);
    expect(hasKnownExtension("Code.JS")).toBe(true);
  });
});

describe("defaultExtensionForLanguage", () => {
  it("returns correct extension for each language", () => {
    expect(defaultExtensionForLanguage("plaintext")).toBe(".txt");
    expect(defaultExtensionForLanguage("javascript")).toBe(".js");
    expect(defaultExtensionForLanguage("typescript")).toBe(".ts");
    expect(defaultExtensionForLanguage("html")).toBe(".html");
    expect(defaultExtensionForLanguage("css")).toBe(".css");
    expect(defaultExtensionForLanguage("json")).toBe(".json");
    expect(defaultExtensionForLanguage("markdown")).toBe(".md");
    expect(defaultExtensionForLanguage("python")).toBe(".py");
    expect(defaultExtensionForLanguage("sql")).toBe(".sql");
    expect(defaultExtensionForLanguage("java")).toBe(".java");
    expect(defaultExtensionForLanguage("cpp")).toBe(".cpp");
    expect(defaultExtensionForLanguage("csharp")).toBe(".cs");
    expect(defaultExtensionForLanguage("groovy")).toBe(".groovy");
  });
});

describe("languageLabels", () => {
  it("has a label for every language", () => {
    const languages = ["plaintext", "javascript", "typescript", "html", "css", "json", "markdown", "python", "sql", "java", "cpp", "csharp", "groovy"];
    for (const lang of languages) {
      expect(languageLabels[lang as keyof typeof languageLabels]).toBeDefined();
      expect(languageLabels[lang as keyof typeof languageLabels].length).toBeGreaterThan(0);
    }
  });
});
