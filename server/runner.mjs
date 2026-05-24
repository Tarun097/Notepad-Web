import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.RUNNER_PORT) || 3001;
const TIMEOUT_MS = 10_000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 512 * 1024;
const HTTP_TIMEOUT_MS = 30_000;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;

const JAVA17_HOME = process.env.JAVA17_HOME || process.env.JAVA_HOME || "";
const PYTHON_COMMAND = process.env.PYTHON || "python3";
const sessions = new Map();

/** Detect available compilers by probing common commands. */
async function detectCompilers() {
  const probes = {
    java: ["javac", ["-version"]],
    cpp: ["g++", ["--version"]],
    csharp: ["dotnet", ["--version"]],
    groovy: ["groovy", ["--version"], { JAVA_HOME: JAVA17_HOME, PATH: `${JAVA17_HOME}/bin:${process.env.PATH}` }],
    python: [PYTHON_COMMAND, ["--version"]],
  };

  const available = {};
  for (const [lang, [cmd, args, env]] of Object.entries(probes)) {
    try {
      const result = await run(cmd, args, undefined, 5000, env);
      if (result.exitCode === "ENOENT" || result.exitCode === "EACCES") continue;
      available[lang] = cmd;
    } catch {
      // not available
    }
  }
  return available;
}

/** Run a command and return { stdout, stderr, exitCode }. */
function run(cmd, args, cwd, timeout = TIMEOUT_MS, env, stdin = "") {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout, stderr: `${stderr}\n[Process timed out]`, exitCode: 124 });
    }, timeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ stdout, stderr: error.message, exitCode: error.code ?? 1 });
    });
    child.on("close", (code, signal) => {
      finish({ stdout, stderr, exitCode: code ?? (signal ? 1 : 0) });
    });

    child.stdin.end(stdin);
  });
}

/** Compile and run code for a given language. */
async function execute(language, code, stdin = "") {
  const dir = await mkdtemp(join(tmpdir(), "notepad-runner-"));
  try {
    switch (language) {
      case "java": {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : "Main";
        const file = join(dir, `${className}.java`);
        await writeFile(file, code);
        const compile = await run("javac", [file], dir);
        if (compile.exitCode !== 0) return { ...compile, phase: "compile" };
        const result = await run("java", ["-cp", dir, className], dir, TIMEOUT_MS, undefined, stdin);
        return { ...result, phase: "run" };
      }
      case "cpp": {
        const src = join(dir, "main.cpp");
        const out = join(dir, "main");
        await writeFile(src, code);
        const compile = await run("g++", ["-o", out, src], dir);
        if (compile.exitCode !== 0) return { ...compile, phase: "compile" };
        const result = await run(out, [], dir, TIMEOUT_MS, undefined, stdin);
        return { ...result, phase: "run" };
      }
      case "csharp": {
        // Create a minimal console project
        const scaffold = await run("dotnet", ["new", "console", "--force", "-o", dir], dir);
        if (scaffold.exitCode !== 0) return { ...scaffold, phase: "compile" };
        const file = join(dir, "Program.cs");
        await writeFile(file, code);
        const compile = await run("dotnet", ["build", "--nologo", dir], dir);
        if (compile.exitCode !== 0) return { ...compile, phase: "compile" };
        const result = await run("dotnet", ["run", "--no-build", "--project", dir], dir, TIMEOUT_MS, undefined, stdin);
        return { ...result, phase: "run" };
      }
      case "groovy": {
        const file = join(dir, "script.groovy");
        await writeFile(file, code);
        const groovyEnv = { JAVA_HOME: JAVA17_HOME, PATH: `${JAVA17_HOME}/bin:${process.env.PATH}` };
        const result = await run("groovy", [file], dir, TIMEOUT_MS, groovyEnv, stdin);
        return { ...result, phase: "run" };
      }
      case "python": {
        const file = join(dir, "script.py");
        await writeFile(file, code);
        const result = await run(PYTHON_COMMAND, [file], dir, TIMEOUT_MS, undefined, stdin);
        return { ...result, phase: "run" };
      }
      default:
        return { stdout: "", stderr: `Unsupported language: ${language}`, exitCode: 1, phase: "error" };
    }
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function compileForSession(language, code) {
  const dir = await mkdtemp(join(tmpdir(), "notepad-runner-"));
  try {
    switch (language) {
      case "java": {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : "Main";
        const file = join(dir, `${className}.java`);
        await writeFile(file, code);
        const compile = await run("javac", [file], dir);
        if (compile.exitCode !== 0) return { result: { ...compile, phase: "compile" }, dir };
        return { command: "java", args: ["-cp", dir, className], dir };
      }
      case "cpp": {
        const src = join(dir, "main.cpp");
        const out = join(dir, "main");
        await writeFile(src, code);
        const compile = await run("g++", ["-o", out, src], dir);
        if (compile.exitCode !== 0) return { result: { ...compile, phase: "compile" }, dir };
        return { command: out, args: [], dir };
      }
      case "csharp": {
        const scaffold = await run("dotnet", ["new", "console", "--force", "-o", dir], dir);
        if (scaffold.exitCode !== 0) return { result: { ...scaffold, phase: "compile" }, dir };
        const file = join(dir, "Program.cs");
        await writeFile(file, code);
        const compile = await run("dotnet", ["build", "--nologo", dir], dir);
        if (compile.exitCode !== 0) return { result: { ...compile, phase: "compile" }, dir };
        return { command: "dotnet", args: ["run", "--no-build", "--project", dir], dir };
      }
      case "groovy": {
        const file = join(dir, "script.groovy");
        await writeFile(file, code);
        const groovyEnv = { JAVA_HOME: JAVA17_HOME, PATH: `${JAVA17_HOME}/bin:${process.env.PATH}` };
        return { command: "groovy", args: [file], dir, env: groovyEnv };
      }
      case "python": {
        const file = join(dir, "script.py");
        await writeFile(file, code);
        return { command: PYTHON_COMMAND, args: [file], dir };
      }
      default:
        return { result: { stdout: "", stderr: `Unsupported language: ${language}`, exitCode: 1, phase: "error" }, dir };
    }
  } catch (error) {
    rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function createRunSession(language, code) {
  const compiled = await compileForSession(language, code);
  if (compiled.result) {
    rm(compiled.dir, { recursive: true, force: true }).catch(() => {});
    return { ...compiled.result, running: false, chunks: outputChunks(compiled.result) };
  }

  const id = randomUUID();
  const child = spawn(compiled.command, compiled.args, {
    cwd: compiled.dir,
    env: compiled.env ? { ...process.env, ...compiled.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session = {
    id,
    child,
    dir: compiled.dir,
    chunks: [],
    running: true,
    exitCode: null,
    phase: "run",
    cleanupTimer: undefined,
  };
  sessions.set(id, session);

  const closeSession = (exitCode) => {
    session.running = false;
    session.exitCode = exitCode;
    session.cleanupTimer = setTimeout(() => {
      sessions.delete(id);
      rm(session.dir, { recursive: true, force: true }).catch(() => {});
    }, 60_000);
  };

  child.stdout.on("data", (chunk) => {
    session.chunks.push({ stream: "stdout", text: chunk.toString() });
  });
  child.stderr.on("data", (chunk) => {
    session.chunks.push({ stream: "stderr", text: chunk.toString() });
  });
  child.on("error", (error) => {
    session.chunks.push({ stream: "stderr", text: error.message });
    closeSession(error.code ?? 1);
  });
  child.on("close", (code, signal) => {
    closeSession(code ?? (signal ? 1 : 0));
  });

  setTimeout(() => {
    if (session.running) {
      session.chunks.push({ stream: "stderr", text: "\n[Process timed out]" });
      child.kill("SIGKILL");
    }
  }, SESSION_TIMEOUT_MS);

  return drainSession(id);
}

function outputChunks(result) {
  const chunks = [];
  if (result.stdout) chunks.push({ stream: "stdout", text: result.stdout });
  if (result.stderr) chunks.push({ stream: "stderr", text: result.stderr });
  return chunks;
}

function drainSession(id) {
  const session = sessions.get(id);
  if (!session) {
    return undefined;
  }
  const chunks = session.chunks.splice(0);
  return {
    sessionId: id,
    phase: session.phase,
    chunks,
    running: session.running,
    exitCode: session.exitCode,
  };
}

function writeSessionInput(id, input) {
  const session = sessions.get(id);
  if (!session || !session.running || !session.child.stdin.writable) {
    return false;
  }
  session.child.stdin.write(input);
  return true;
}

function stopSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.running) session.child.kill("SIGKILL");
  sessions.delete(id);
  clearTimeout(session.cleanupTimer);
  rm(session.dir, { recursive: true, force: true }).catch(() => {});
  return true;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function executeHttpRequest(payload) {
  const { method, url, headers = {}, body } = payload;
  if (typeof method !== "string" || typeof url !== "string" || typeof headers !== "object" || headers === null) {
    return { status: 400, data: { error: "method, url, and headers are required" } };
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    return { status: 400, data: { error: "invalid request URL" } };
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    return { status: 400, data: { error: "only http and https URLs are supported" } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(target, {
      method,
      headers: sanitizeHttpHeaders(headers),
      body: typeof body === "string" && !["GET", "HEAD"].includes(method.toUpperCase()) ? body : undefined,
      redirect: "follow",
      signal: controller.signal,
    });
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    if (bytes.byteLength > MAX_HTTP_RESPONSE_BYTES) {
      return { status: 413, data: { error: `response exceeded ${MAX_HTTP_RESPONSE_BYTES} bytes` } };
    }
    const contentType = response.headers.get("content-type") || "";
    const textLike = /^text\//i.test(contentType) || /json|xml|javascript|x-www-form-urlencoded/i.test(contentType);
    return {
      status: 200,
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()).map(([key, value]) => ({ id: randomUUID(), key, value, enabled: true })),
        body: textLike || contentType === "" ? bytes.toString("utf8") : bytes.toString("base64"),
        bodyBase64: !(textLike || contentType === ""),
        durationMs: Math.round(performance.now() - started),
        sizeBytes: bytes.byteLength,
        redirected: response.redirected,
        url: response.url,
      },
    };
  } catch (error) {
    return { status: 502, data: { error: error?.name === "AbortError" ? "request timed out" : error?.message || "request failed" } };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeHttpHeaders(headers) {
  const blocked = new Set(["host", "connection", "content-length", "transfer-encoding"]);
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!blocked.has(key.toLowerCase()) && typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, null);
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/compilers" && req.method === "GET") {
    const compilers = await detectCompilers();
    sendJson(res, 200, compilers);
    return;
  }

  if (url.pathname === "/run" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "invalid JSON request body" });
      return;
    }
    const { language, code, stdin = "" } = body;
    if (typeof language !== "string" || typeof code !== "string" || typeof stdin !== "string") {
      sendJson(res, 400, { error: "language, code, and stdin are required" });
      return;
    }
    const result = await execute(language, code, stdin);
    sendJson(res, 200, result);
    return;
  }

  if (url.pathname === "/http/request" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "invalid JSON request body" });
      return;
    }
    const result = await executeHttpRequest(body);
    sendJson(res, result.status, result.data);
    return;
  }

  if (url.pathname === "/run-session" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "invalid JSON request body" });
      return;
    }
    const { language, code } = body;
    if (typeof language !== "string" || typeof code !== "string") {
      sendJson(res, 400, { error: "language and code are required" });
      return;
    }
    const result = await createRunSession(language, code);
    sendJson(res, 200, result);
    return;
  }

  const sessionMatch = url.pathname.match(/^\/run-session\/([^/]+)(?:\/(input|stop))?$/);
  if (sessionMatch) {
    const [, id, action] = sessionMatch;
    if (!action && req.method === "GET") {
      const result = drainSession(id);
      sendJson(res, result ? 200 : 404, result ?? { error: "session not found" });
      return;
    }
    if (action === "input" && req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "invalid JSON request body" });
        return;
      }
      if (typeof body.input !== "string") {
        sendJson(res, 400, { error: "input is required" });
        return;
      }
      const ok = writeSessionInput(id, body.input);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "session not running" });
      return;
    }
    if (action === "stop" && req.method === "POST") {
      const ok = stopSession(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "session not found" });
      return;
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[runner] Code runner server listening on http://127.0.0.1:${PORT}`);
});
