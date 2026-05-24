import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { StreamLanguage } from "@codemirror/language";
import { Extension } from "@codemirror/state";
import { LanguageId } from "./types";

export const languageLabels: Record<LanguageId, string> = {
  plaintext: "Plain text",
  javascript: "JavaScript",
  typescript: "TypeScript",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  markdown: "Markdown",
  python: "Python",
  sql: "SQL",
  java: "Java",
  cpp: "C++",
  csharp: "C#",
  groovy: "Groovy",
};

export function languageExtension(language: LanguageId): Extension {
  switch (language) {
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true, jsx: true });
    case "html":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "python":
      return python();
    case "sql":
      return sql();
    case "cpp":
      return cpp();
    case "java":
      return java();
    case "csharp":
      return StreamLanguage.define(csharp);
    case "groovy":
      return StreamLanguage.define(groovy);
    case "plaintext":
      return [];
  }
}

export function inferLanguage(name: string): LanguageId {
  const lower = name.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xml")) return "html";
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) return "css";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx") || lower.endsWith(".hpp")) return "cpp";
  if (lower.endsWith(".cs")) return "csharp";
  if (lower.endsWith(".groovy")) return "groovy";
  return "plaintext";
}

export function hasKnownExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return [
    ".txt",
    ".log",
    ".md",
    ".markdown",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".json",
    ".html",
    ".htm",
    ".xml",
    ".css",
    ".scss",
    ".less",
    ".py",
    ".sql",
    ".java",
    ".cpp",
    ".cc",
    ".cxx",
    ".hpp",
    ".cs",
    ".groovy",
  ].some((extension) => lower.endsWith(extension));
}

export function defaultExtensionForLanguage(language: LanguageId): string {
  const extensions: Record<LanguageId, string> = {
    plaintext: ".txt",
    javascript: ".js",
    typescript: ".ts",
    html: ".html",
    css: ".css",
    json: ".json",
    markdown: ".md",
    python: ".py",
    sql: ".sql",
    java: ".java",
    cpp: ".cpp",
    csharp: ".cs",
    groovy: ".groovy",
  };
  return extensions[language];
}
