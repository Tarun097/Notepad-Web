/**
 * Code Runner - frontend module for compiling/running code via local runner server.
 */

const RUNNER_URL = "/api";

export type RunnerLanguage = "java" | "cpp" | "csharp" | "groovy" | "python";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  phase: "compile" | "run" | "error";
}

export interface RunChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface RunSessionResult {
  sessionId?: string;
  chunks: RunChunk[];
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
  running: boolean;
  phase: "compile" | "run" | "error";
}

/** Map from editor language IDs to runner language IDs. */
const LANGUAGE_MAP: Record<string, RunnerLanguage> = {
  java: "java",
  cpp: "cpp",
  csharp: "csharp",
  groovy: "groovy",
  python: "python",
};

let availableCompilers: Record<string, string> = {};
let detected = false;

/** Probe the runner server for available compilers. */
export async function detectCompilers(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${RUNNER_URL}/compilers`);
    if (res.ok) {
      availableCompilers = await res.json();
      detected = true;
    }
  } catch {
    // server not running
    availableCompilers = {};
    detected = true;
  }
  return availableCompilers;
}

/** Check if a language can be run. */
export function canRun(language: string, fileName?: string): boolean {
  const runnerLang = resolveLanguage(language, fileName);
  return runnerLang !== null && runnerLang in availableCompilers;
}

/** Check if runner server has been detected. */
export function isRunnerAvailable(): boolean {
  return detected && Object.keys(availableCompilers).length > 0;
}

/** Resolve editor language to runner language, also checking file name. */
export function resolveLanguage(language: string, fileName?: string): RunnerLanguage | null {
  if (language in LANGUAGE_MAP) return LANGUAGE_MAP[language];
  // Check by file extension
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "java") return "java";
    if (ext === "cpp" || ext === "cc" || ext === "cxx") return "cpp";
    if (ext === "cs") return "csharp";
    if (ext === "groovy") return "groovy";
    if (ext === "py") return "python";
  }
  return null;
}

/** Run code on the runner server. */
export async function runCode(language: RunnerLanguage, code: string, stdin = ""): Promise<RunResult> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, code, stdin }),
  });
  return res.json();
}

/** Start a live runner session that accepts stdin after launch. */
export async function startRunSession(language: RunnerLanguage, code: string): Promise<RunSessionResult> {
  const res = await fetch(`${RUNNER_URL}/run-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, code }),
  });
  return res.json();
}

/** Poll and drain output from a live runner session. */
export async function pollRunSession(sessionId: string): Promise<RunSessionResult> {
  const res = await fetch(`${RUNNER_URL}/run-session/${encodeURIComponent(sessionId)}`);
  return res.json();
}

/** Send stdin to a live runner session. */
export async function sendRunInput(sessionId: string, input: string): Promise<void> {
  await fetch(`${RUNNER_URL}/run-session/${encodeURIComponent(sessionId)}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

/** Stop a live runner session. */
export async function stopRunSession(sessionId: string): Promise<void> {
  await fetch(`${RUNNER_URL}/run-session/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
}

/** Get setup instructions for a missing compiler. */
export function getSetupInstructions(language: RunnerLanguage): string {
  const instructions: Record<RunnerLanguage, string> = {
    java: `Java compiler not found.\n\nTo install:\n  • macOS: brew install openjdk\n  • Ubuntu: sudo apt install default-jdk\n  • Windows: Download from https://adoptium.net\n\nEnsure "javac" is available in your PATH.`,
    cpp: `C++ compiler not found.\n\nTo install:\n  • macOS: xcode-select --install\n  • Ubuntu: sudo apt install g++\n  • Windows: Install MinGW or MSYS2\n\nEnsure "g++" is available in your PATH.`,
    csharp: `C# / .NET SDK not found.\n\nTo install:\n  • macOS: brew install dotnet\n  • Ubuntu: See https://learn.microsoft.com/dotnet/core/install/linux\n  • Windows: Download from https://dotnet.microsoft.com\n\nEnsure "dotnet" is available in your PATH.`,
    groovy: `Groovy not found.\n\nTo install:\n  • macOS: brew install groovy\n  • Ubuntu: sudo apt install groovy\n  • Or via SDKMAN: sdk install groovy\n\nGroovy 4+ requires Java 11+. Set JAVA17_HOME env var if needed.\nEnsure "groovy" is available in your PATH.`,
    python: `Python not found.\n\nTo install:\n  • macOS: brew install python\n  • Ubuntu: sudo apt install python3\n  • Windows: Download from https://python.org\n\nEnsure "python3" is available in your PATH, or set the PYTHON environment variable.`,
  };
  return instructions[language] || `Compiler for "${language}" not found.`;
}
