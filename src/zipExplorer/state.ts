import JSZip from "jszip";
import { ZipEntry, ZipExplorerState, ZipTreeNode } from "./types";

let loadedZip: JSZip | undefined;
const nestedZips = new Map<string, JSZip>();

export function buildTree(entries: ZipEntry[]): ZipTreeNode {
  const root: ZipTreeNode = { name: "/", path: "", dir: true, children: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let node = root;
    let current = "";
    for (let i = 0; i < parts.length; i++) {
      current += (current ? "/" : "") + parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === parts[i]);
      if (!child) {
        child = { name: parts[i], path: current, dir: isLast ? entry.dir : true, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  sortTree(root);
  return root;
}

function sortTree(node: ZipTreeNode): void {
  node.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  node.children.forEach(sortTree);
}

export async function loadZipFile(file: File): Promise<ZipExplorerState> {
  const zip = await JSZip.loadAsync(file);
  loadedZip = zip;
  nestedZips.clear();
  const entries: ZipEntry[] = [];
  zip.forEach((path, entry) => {
    entries.push({ path, name: entry.name, dir: entry.dir });
  });
  return { fileName: file.name, entries, tree: buildTree(entries) };
}

export async function loadZipFromBuffer(data: ArrayBuffer): Promise<ZipExplorerState> {
  const zip = await JSZip.loadAsync(data);
  loadedZip = zip;
  nestedZips.clear();
  const entries: ZipEntry[] = [];
  zip.forEach((path, entry) => {
    entries.push({ path, name: entry.name, dir: entry.dir });
  });
  return { fileName: "buffer.zip", entries, tree: buildTree(entries) };
}

export function isZipPath(path: string): boolean {
  return /\.(zip|jar|war|ear|apk|epub)$/i.test(path);
}

export async function expandNestedZip(originalPath: string): Promise<ZipEntry[]> {
  if (nestedZips.has(originalPath)) {
    const zip = nestedZips.get(originalPath)!;
    const entries: ZipEntry[] = [];
    zip.forEach((p, entry) => { entries.push({ path: originalPath + "/" + p, name: entry.name, dir: entry.dir }); });
    return entries;
  }
  if (!loadedZip) return [];
  // Determine which zip contains this file
  let zip: JSZip = loadedZip;
  let lookupPath = originalPath;
  for (const [prefix, nz] of nestedZips) {
    if (originalPath.startsWith(prefix + "/")) {
      zip = nz;
      lookupPath = originalPath.slice(prefix.length + 1);
      break;
    }
  }
  const file = zip.file(lookupPath);
  if (!file) return [];
  const data = await file.async("arraybuffer");
  const nested = await JSZip.loadAsync(data);
  nestedZips.set(originalPath, nested);
  const entries: ZipEntry[] = [];
  nested.forEach((p, entry) => { entries.push({ path: originalPath + "/" + p, name: entry.name, dir: entry.dir }); });
  return entries;
}

export async function readFileContent(path: string): Promise<string> {
  // Check nested zips first
  for (const [prefix, nz] of nestedZips) {
    if (path.startsWith(prefix + "/")) {
      const innerPath = path.slice(prefix.length + 1);
      const file = nz.file(innerPath);
      if (!file) return "";
      try { return await file.async("string"); } catch { return "[Binary file — cannot display]"; }
    }
  }
  if (!loadedZip) return "";
  const file = loadedZip.file(path);
  if (!file) return "";
  try {
    return await file.async("string");
  } catch {
    return "[Binary file — cannot display]";
  }
}

export async function searchAllZipFiles(query: string, matchCase: boolean, regex: boolean, perFileLimit = 100): Promise<{ hits: { path: string; line: number; column: number; from: number; to: number; preview: string }[]; totals: Map<string, number> }> {
  if (!loadedZip || !query) return { hits: [], totals: new Map() };
  const hits: { path: string; line: number; column: number; from: number; to: number; preview: string }[] = [];
  const totals = new Map<string, number>();
  const flags = matchCase ? "g" : "gi";
  let re: RegExp;
  try { re = regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); } catch { return { hits: [], totals: new Map() }; }

  const searchInZip = async (zip: JSZip, prefix: string) => {
    const files = zip.filter((_, entry) => !entry.dir);
    for (const file of files) {
      if (isZipPath(file.name)) {
        try {
          const data = await file.async("arraybuffer");
          const nested = await JSZip.loadAsync(data);
          await searchInZip(nested, prefix ? prefix + "/" + file.name : file.name);
        } catch { /* skip unreadable nested zips */ }
        continue;
      }
      let text: string;
      try { text = await file.async("string"); } catch { continue; }
      const filePath = prefix ? prefix + "/" + file.name : file.name;
      let match: RegExpExecArray | null;
      let fileHits = 0;
      let fileTotal = 0;
      re.lastIndex = 0;
      while ((match = re.exec(text)) !== null) {
        fileTotal++;
        if (fileHits < perFileLimit) {
          const before = text.slice(0, match.index);
          const line = before.split("\n").length;
          const lineStart = before.lastIndexOf("\n") + 1;
          const lineEnd = text.indexOf("\n", match.index);
          const preview = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
          hits.push({ path: filePath, line, column: match.index - lineStart + 1, from: match.index, to: match.index + match[0].length, preview });
          fileHits++;
        }
      }
      if (fileTotal > 0) totals.set(filePath, fileTotal);
    }
  };

  await searchInZip(loadedZip, "");
  return { hits, totals };
}

export async function searchSingleZipFile(filePath: string, query: string, matchCase: boolean, regex: boolean, skip: number, limit: number): Promise<{ path: string; line: number; column: number; from: number; to: number; preview: string }[]> {
  if (!loadedZip || !query) return [];
  const flags = matchCase ? "g" : "gi";
  let re: RegExp;
  try { re = regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); } catch { return []; }

  // Resolve file through nested zips
  let text: string | undefined;
  const segments = filePath.split("/");
  let zip: JSZip = loadedZip;
  let consumed = 0;
  for (let i = 0; i < segments.length; i++) {
    const partial = segments.slice(0, i + 1).join("/");
    if (isZipPath(partial) && i < segments.length - 1) {
      const f = zip.file(segments.slice(consumed, i + 1).join("/"));
      if (!f) break;
      try {
        const data = await f.async("arraybuffer");
        zip = await JSZip.loadAsync(data);
        consumed = i + 1;
      } catch { break; }
    }
  }
  const innerPath = segments.slice(consumed).join("/");
  const file = zip.file(innerPath);
  if (!file) return [];
  try { text = await file.async("string"); } catch { return []; }

  const hits: { path: string; line: number; column: number; from: number; to: number; preview: string }[] = [];
  let match: RegExpExecArray | null;
  let count = 0;
  re.lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    if (count >= skip && hits.length < limit) {
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineEnd = text.indexOf("\n", match.index);
      const preview = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
      hits.push({ path: filePath, line, column: match.index - lineStart + 1, from: match.index, to: match.index + match[0].length, preview });
    }
    if (hits.length >= limit) break;
    count++;
  }
  return hits;
}
