import {
  HttpAuth,
  HttpBody,
  HttpClientState,
  HttpCollection,
  HttpEnvironment,
  HttpFolder,
  HttpMethod,
  HttpRequestItem,
  KeyValueRow,
  isHttpFolder,
} from "./types";

export const HTTP_CLIENT_STORAGE_KEY = "notepad-plus-web-http-client";
export const DEFAULT_REQUEST_HEADERS: Array<Pick<KeyValueRow, "key" | "value" | "enabled">> = [
  { key: "Accept", value: "*/*", enabled: true },
  { key: "User-Agent", value: "NotepadPlusWeb/0.1", enabled: true },
];

export function contentTypeForBodyMode(mode: HttpBody["mode"]): string | undefined {
  if (mode === "json") return "application/json; charset=UTF-8";
  if (mode === "form-urlencoded") return "application/x-www-form-urlencoded";
  if (mode === "multipart") return "multipart/form-data";
  return undefined;
}

export function isAutoContentType(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "application/json" || normalized === "application/json; charset=utf-8" || normalized === "application/x-www-form-urlencoded" || normalized === "multipart/form-data";
}

export function createId(): string {
  return crypto.randomUUID();
}

export function createRow(key = "", value = "", enabled = true): KeyValueRow {
  return { id: createId(), key, value, enabled };
}

export function createDefaultHeaderRows(): KeyValueRow[] {
  return DEFAULT_REQUEST_HEADERS.map((header) => createRow(header.key, header.value, header.enabled));
}

export function createBody(mode: HttpBody["mode"] = "none", raw = ""): HttpBody {
  return { mode, raw, form: [createRow()] };
}

export function createRequest(name = "Untitled Request", method: HttpMethod = "GET", url = ""): HttpRequestItem {
  return {
    id: createId(),
    name,
    method,
    url,
    headers: [...createDefaultHeaderRows(), createRow()],
    params: [createRow()],
    cookies: [createRow()],
    auth: { type: "none" },
    body: createBody(),
    scripts: { preRequest: "", test: "" },
  };
}

export function createCollection(name = "HTTP Collection"): HttpCollection {
  return {
    id: createId(),
    name,
    items: [],
  };
}

export function createEnvironment(name = "Local"): HttpEnvironment {
  return {
    id: createId(),
    name,
    variables: [createRow("baseUrl", "https://httpbin.org", true)],
  };
}

export function createInitialHttpState(): HttpClientState {
  const request = createRequest();
  const collection = createCollection("My Requests");
  collection.items.push(request);
  return {
    collections: [collection],
    environments: [],
    activeCollectionId: collection.id,
    activeRequestId: request.id,
    activeEnvironmentId: undefined,
    draft: cloneRequest(request),
    history: [],
    ui: {
      historyVisible: false,
      responseWidth: 42,
      responseHeight: 52,
      requestPanel: "params",
      responsePanel: "body",
    },
  };
}

export function restoreHttpWorkspace(): HttpClientState | undefined {
  try {
    const raw = localStorage.getItem(HTTP_CLIENT_STORAGE_KEY);
    if (!raw) return undefined;
    return normalizeState(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function persistHttpWorkspace(state: HttpClientState): void {
  const serializable: HttpClientState = {
    ...state,
    response: undefined,
    history: state.history.slice(0, 50),
  };
  localStorage.setItem(HTTP_CLIENT_STORAGE_KEY, JSON.stringify(serializable));
}

export function normalizeState(value: unknown): HttpClientState {
  const fallback = createInitialHttpState();
  if (!value || typeof value !== "object") return fallback;
  const state = value as Partial<HttpClientState>;
  const collections = Array.isArray(state.collections) ? state.collections.map(normalizeCollection) : fallback.collections;
  const environments = Array.isArray(state.environments) ? state.environments.map(normalizeEnvironment) : fallback.environments;
  const firstRequest = collections.flatMap((collection) => flattenRequests(collection.items))[0] ?? fallback.draft;
  const activeRequestId = findRequest(collections, state.activeRequestId ?? "") ? state.activeRequestId : firstRequest.id;
  const activeCollectionId = collections.some((collection) => collection.id === state.activeCollectionId)
    ? state.activeCollectionId
    : collections[0]?.id;
  return {
    collections,
    environments,
    activeCollectionId,
    activeRequestId,
    activeEnvironmentId: environments.some((env) => env.id === state.activeEnvironmentId) ? state.activeEnvironmentId : environments[0]?.id,
    draft: normalizeRequest(state.draft ?? firstRequest),
    response: state.response,
    history: Array.isArray(state.history) ? state.history.slice(0, 50) : [],
    ui: {
      historyVisible: state.ui?.historyVisible !== false,
      responseWidth: clampResponseWidth(Number(state.ui?.responseWidth) || 42),
      responseHeight: clampResponseHeight(Number(state.ui?.responseHeight) || 52),
      requestPanel: normalizeRequestPanel(state.ui?.requestPanel),
      responsePanel: normalizeResponsePanel(state.ui?.responsePanel),
      jsonCollapsed: Array.isArray(state.ui?.jsonCollapsed) ? state.ui.jsonCollapsed.filter(Number.isInteger) : [],
    },
  };
}

export function clampResponseWidth(value: number): number {
  return Math.min(68, Math.max(28, Math.round(value)));
}

export function clampResponseHeight(value: number): number {
  return Math.min(98, Math.max(26, Math.round(value)));
}

function normalizeRequestPanel(value: unknown): NonNullable<HttpClientState["ui"]>["requestPanel"] {
  return ["params", "auth", "headers", "body", "cookies", "scripts", "settings"].includes(String(value)) ? (value as NonNullable<HttpClientState["ui"]>["requestPanel"]) : "params";
}

function normalizeResponsePanel(value: unknown): NonNullable<HttpClientState["ui"]>["responsePanel"] {
  return ["body", "cookies", "headers", "tests"].includes(String(value)) ? (value as NonNullable<HttpClientState["ui"]>["responsePanel"]) : "body";
}

export function cloneRequest(request: HttpRequestItem): HttpRequestItem {
  return JSON.parse(JSON.stringify(request)) as HttpRequestItem;
}

export function cloneCollection(collection: HttpCollection): HttpCollection {
  return JSON.parse(JSON.stringify(collection)) as HttpCollection;
}

export function findRequest(collections: HttpCollection[], requestId: string): HttpRequestItem | undefined {
  for (const collection of collections) {
    const found = findRequestInItems(collection.items, requestId);
    if (found) return found;
  }
  return undefined;
}

export function upsertRequest(collections: HttpCollection[], collectionId: string | undefined, request: HttpRequestItem): HttpCollection[] {
  let updated = false;
  const next = collections.map((collection) => {
    const items = updateRequestInItems(collection.items, request, () => {
      updated = true;
    });
    return items === collection.items ? collection : { ...collection, items };
  });
  if (updated) return next;

  const targetId = collectionId ?? next[0]?.id;
  return next.map((collection) =>
    collection.id === targetId ? { ...collection, items: [...collection.items, cloneRequest(request)] } : collection,
  );
}

export function flattenRequests(items: Array<HttpFolder | HttpRequestItem>): HttpRequestItem[] {
  return items.flatMap((item) => (isHttpFolder(item) ? flattenRequests(item.items) : [item]));
}

export function activeEnvironment(state: HttpClientState): HttpEnvironment | undefined {
  return state.environments.find((environment) => environment.id === state.activeEnvironmentId);
}

export function variablesForEnvironment(environment?: HttpEnvironment): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const row of environment?.variables ?? []) {
    if (row.enabled && row.key) variables[row.key] = row.value;
  }
  return variables;
}

export function applyVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, name: string) => variables[name] ?? "");
}

function findRequestInItems(items: Array<HttpFolder | HttpRequestItem>, requestId: string): HttpRequestItem | undefined {
  for (const item of items) {
    if (isHttpFolder(item)) {
      const found = findRequestInItems(item.items, requestId);
      if (found) return found;
    } else if (item.id === requestId) {
      return item;
    }
  }
  return undefined;
}

function updateRequestInItems(
  items: Array<HttpFolder | HttpRequestItem>,
  request: HttpRequestItem,
  markUpdated: () => void,
): Array<HttpFolder | HttpRequestItem> {
  let changed = false;
  const next = items.map((item) => {
    if (isHttpFolder(item)) {
      const childItems = updateRequestInItems(item.items, request, markUpdated);
      if (childItems !== item.items) {
        changed = true;
        return { ...item, items: childItems };
      }
      return item;
    }
    if (item.id === request.id) {
      changed = true;
      markUpdated();
      return cloneRequest(request);
    }
    return item;
  });
  return changed ? next : items;
}

function normalizeCollection(collection: Partial<HttpCollection>): HttpCollection {
  return {
    id: typeof collection.id === "string" ? collection.id : createId(),
    name: typeof collection.name === "string" ? collection.name : "Imported Collection",
    schema: typeof collection.schema === "string" ? collection.schema : undefined,
    importedAt: typeof collection.importedAt === "number" ? collection.importedAt : undefined,
    items: Array.isArray(collection.items) ? collection.items.map(normalizeCollectionItem) : [],
  };
}

function normalizeCollectionItem(item: Partial<HttpFolder & HttpRequestItem>): HttpFolder | HttpRequestItem {
  if (Array.isArray(item.items)) {
    return {
      id: typeof item.id === "string" ? item.id : createId(),
      name: typeof item.name === "string" ? item.name : "Folder",
      items: item.items.map(normalizeCollectionItem),
    };
  }
  return normalizeRequest(item);
}

function normalizeRequest(request: Partial<HttpRequestItem>): HttpRequestItem {
  const body = normalizeBody(request.body);
  return {
    id: typeof request.id === "string" ? request.id : createId(),
    name: typeof request.name === "string" ? request.name : "Untitled Request",
    method: normalizeMethod(request.method),
    url: typeof request.url === "string" ? request.url : "",
    headers: normalizeContentTypeHeader(normalizeHeaders(request.headers), body.mode),
    params: normalizeRows(request.params),
    cookies: normalizeRows(request.cookies),
    auth: normalizeAuth(request.auth),
    body,
    scripts: normalizeScripts(request.scripts),
  };
}

function normalizeEnvironment(environment: Partial<HttpEnvironment>): HttpEnvironment {
  return {
    id: typeof environment.id === "string" ? environment.id : createId(),
    name: typeof environment.name === "string" ? environment.name : "Environment",
    variables: normalizeRows(environment.variables),
  };
}

function normalizeRows(rows: unknown): KeyValueRow[] {
  const result = Array.isArray(rows)
    ? rows.map((row) => {
        const value = row as Partial<KeyValueRow>;
        return createRow(String(value.key ?? ""), String(value.value ?? ""), value.enabled !== false);
      })
    : [];
  return result.length ? result : [createRow()];
}

function normalizeHeaders(rows: unknown): KeyValueRow[] {
  const normalized = normalizeRows(rows);
  for (const header of DEFAULT_REQUEST_HEADERS) {
    if (!normalized.some((row) => row.key.toLowerCase() === header.key.toLowerCase())) {
      normalized.unshift(createRow(header.key, header.value, header.enabled));
    }
  }
  return normalized;
}

function normalizeContentTypeHeader(headers: KeyValueRow[], mode: HttpBody["mode"]): KeyValueRow[] {
  const contentType = contentTypeForBodyMode(mode);
  if (!contentType || headers.some((row) => row.key.toLowerCase() === "content-type")) return headers;
  return [...headers, createRow("Content-Type", contentType, true)];
}

function normalizeMethod(method: unknown): HttpMethod {
  const value = String(method ?? "GET").toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(value) ? (value as HttpMethod) : "GET";
}

function normalizeAuth(auth: unknown): HttpAuth {
  if (!auth || typeof auth !== "object") return { type: "none" };
  const value = auth as Partial<HttpAuth & { token: string; username: string; password: string; key: string; value: string; target: string }>;
  if (value.type === "bearer") return { type: "bearer", token: String(value.token ?? "") };
  if (value.type === "basic") return { type: "basic", username: String(value.username ?? ""), password: String(value.password ?? "") };
  if (value.type === "api-key") {
    return {
      type: "api-key",
      key: String(value.key ?? ""),
      value: String(value.value ?? ""),
      target: value.target === "query" ? "query" : "header",
    };
  }
  return { type: "none" };
}

function normalizeBody(body: unknown): HttpBody {
  if (!body || typeof body !== "object") return createBody();
  const value = body as Partial<HttpBody>;
  const mode = ["none", "raw", "json", "form-urlencoded", "multipart"].includes(String(value.mode))
    ? (value.mode as HttpBody["mode"])
    : "none";
  return {
    mode,
    raw: String(value.raw ?? ""),
    form: normalizeRows(value.form),
  };
}

function normalizeScripts(scripts: unknown): HttpRequestItem["scripts"] {
  if (!scripts || typeof scripts !== "object") return { preRequest: "", test: "" };
  const value = scripts as Partial<HttpRequestItem["scripts"]>;
  return {
    preRequest: String(value.preRequest ?? ""),
    test: String(value.test ?? ""),
  };
}
