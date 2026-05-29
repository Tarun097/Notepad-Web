import { HttpAuth, HttpBody, HttpCollection, HttpFolder, HttpMethod, HttpRequestItem, KeyValueRow, isHttpFolder } from "./types";
import { cloneCollection, createCollection, createId, createRequest, createRow } from "./state";

const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

type PostmanItem = {
  name?: string;
  item?: PostmanItem[];
  event?: Array<{ listen?: string; script?: { exec?: string[] | string } }>;
  request?: {
    method?: string;
    url?: string | { raw?: string; query?: Array<{ key?: string; value?: string; disabled?: boolean }> };
    header?: Array<{ key?: string; value?: string; disabled?: boolean }>;
    auth?: Record<string, unknown>;
    body?: {
      mode?: string;
      raw?: string;
      urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
      formdata?: Array<{ key?: string; value?: string; disabled?: boolean }>;
    };
  };
};

type PostmanUrl = NonNullable<PostmanItem["request"]>["url"];
type PostmanBody = NonNullable<PostmanItem["request"]>["body"];

export function importPostmanCollection(value: unknown): HttpCollection {
  if (!value || typeof value !== "object") {
    throw new Error("Postman collection must be a JSON object.");
  }
  const raw = value as { info?: { name?: string; schema?: string }; item?: PostmanItem[] };
  if (!Array.isArray(raw.item)) {
    throw new Error("Postman collection is missing the item array.");
  }

  const collection = createCollection(raw.info?.name || "Imported Collection");
  collection.schema = raw.info?.schema;
  collection.importedAt = Date.now();
  collection.items = raw.item.map(importPostmanItem);
  return collection;
}

export function exportPostmanCollection(collection: HttpCollection): unknown {
  const copy = cloneCollection(collection);
  return {
    info: {
      _postman_id: copy.id,
      name: copy.name,
      schema: POSTMAN_SCHEMA,
    },
    item: copy.items.map(exportPostmanItem),
  };
}

function importPostmanItem(item: PostmanItem): HttpFolder | HttpRequestItem {
  if (Array.isArray(item.item)) {
    return {
      id: createId(),
      name: item.name || "Folder",
      items: item.item.map(importPostmanItem),
    };
  }

  const request = createRequest(item.name || "Request", normalizeMethod(item.request?.method), rawUrl(item.request?.url));
  request.headers = rowsFromPostman(item.request?.header);
  request.params = queryRowsFromPostmanUrl(item.request?.url);
  request.auth = authFromPostman(item.request?.auth);
  request.body = bodyFromPostman(item.request?.body);
  request.scripts = scriptsFromPostman(item.event);
  return request;
}

function exportPostmanItem(item: HttpFolder | HttpRequestItem): unknown {
  if (isHttpFolder(item)) {
    return {
      name: item.name,
      item: item.items.map(exportPostmanItem),
    };
  }

  return {
    name: item.name,
    request: {
      method: item.method,
      header: enabledRows(item.headers).map((row) => ({ key: row.key, value: row.value, type: "text" })),
      url: exportUrl(item),
      auth: exportAuth(item.auth),
      body: exportBody(item.body),
    },
    event: exportScripts(item),
  };
}

function rawUrl(url: PostmanUrl): string {
  if (typeof url === "string") return url;
  return url?.raw ?? "";
}

function queryRowsFromPostmanUrl(url: PostmanUrl): KeyValueRow[] {
  if (typeof url !== "object" || !Array.isArray(url?.query)) return [createRow()];
  const rows = url.query.map((query) => createRow(query.key ?? "", query.value ?? "", query.disabled !== true));
  return rows.length ? rows : [createRow()];
}

function rowsFromPostman(rows: Array<{ key?: string; value?: string; disabled?: boolean }> | undefined): KeyValueRow[] {
  const result = (rows ?? []).map((row) => createRow(row.key ?? "", row.value ?? "", row.disabled !== true));
  return result.length ? result : [createRow()];
}

function authFromPostman(auth: Record<string, unknown> | undefined): HttpAuth {
  if (!auth || typeof auth.type !== "string") return { type: "none" };
  if (auth.type === "bearer") {
    const token = authValue(auth.bearer, "token");
    return { type: "bearer", token };
  }
  if (auth.type === "basic") {
    return { type: "basic", username: authValue(auth.basic, "username"), password: authValue(auth.basic, "password") };
  }
  if (auth.type === "apikey") {
    const target = authValue(auth.apikey, "in") === "query" ? "query" : "header";
    return { type: "api-key", key: authValue(auth.apikey, "key"), value: authValue(auth.apikey, "value"), target };
  }
  return { type: "none" };
}

function bodyFromPostman(body: PostmanBody): HttpBody {
  if (!body) return { mode: "none", raw: "", form: [createRow()] };
  if (body.mode === "raw") return { mode: looksLikeJson(body.raw ?? "") ? "json" : "raw", raw: body.raw ?? "", form: [createRow()] };
  if (body.mode === "urlencoded") return { mode: "form-urlencoded", raw: "", form: rowsFromPostman(body.urlencoded) };
  if (body.mode === "formdata") return { mode: "multipart", raw: "", form: rowsFromPostman(body.formdata) };
  return { mode: "none", raw: "", form: [createRow()] };
}

function scriptsFromPostman(events: PostmanItem["event"]): HttpRequestItem["scripts"] {
  const scriptFor = (listen: string): string => {
    const event = events?.find((candidate) => candidate.listen === listen);
    const exec = event?.script?.exec;
    return Array.isArray(exec) ? exec.join("\n") : typeof exec === "string" ? exec : "";
  };
  return {
    preRequest: scriptFor("prerequest"),
    test: scriptFor("test"),
  };
}

function exportUrl(request: HttpRequestItem): unknown {
  const query = enabledRows(request.params).map((row) => ({ key: row.key, value: row.value }));
  let protocol = "";
  let host: string[] = [];
  let path: string[] = [];
  try {
    const parsed = new URL(request.url);
    protocol = parsed.protocol.replace(":", "");
    host = parsed.hostname.split(".");
    path = parsed.pathname.split("/").filter(Boolean);
  } catch {
    // URL may not be valid; just export raw
  }
  return {
    raw: request.url,
    protocol,
    host,
    path,
    query,
  };
}

function exportAuth(auth: HttpAuth): unknown {
  if (auth.type === "bearer") return { type: "bearer", bearer: [{ key: "token", value: auth.token, type: "string" }] };
  if (auth.type === "basic") {
    return {
      type: "basic",
      basic: [
        { key: "username", value: auth.username, type: "string" },
        { key: "password", value: auth.password, type: "string" },
      ],
    };
  }
  if (auth.type === "api-key") {
    return {
      type: "apikey",
      apikey: [
        { key: "key", value: auth.key, type: "string" },
        { key: "value", value: auth.value, type: "string" },
        { key: "in", value: auth.target, type: "string" },
      ],
    };
  }
  return { type: "noauth" };
}

function exportBody(body: HttpBody): unknown {
  if (body.mode === "json" || body.mode === "raw") return { mode: "raw", raw: body.raw };
  if (body.mode === "form-urlencoded") {
    return { mode: "urlencoded", urlencoded: enabledRows(body.form).map((row) => ({ key: row.key, value: row.value, type: "text" })) };
  }
  if (body.mode === "multipart") {
    return { mode: "formdata", formdata: enabledRows(body.form).map((row) => ({ key: row.key, value: row.value, type: "text" })) };
  }
  return undefined;
}

function exportScripts(request: HttpRequestItem): unknown[] | undefined {
  const events = [];
  if (request.scripts.preRequest.trim()) {
    events.push({ listen: "prerequest", script: { type: "text/javascript", exec: request.scripts.preRequest.split("\n") } });
  }
  if (request.scripts.test.trim()) {
    events.push({ listen: "test", script: { type: "text/javascript", exec: request.scripts.test.split("\n") } });
  }
  return events.length ? events : undefined;
}

function enabledRows(rows: KeyValueRow[]): KeyValueRow[] {
  return rows.filter((row) => row.enabled && row.key);
}

function normalizeMethod(method: unknown): HttpMethod {
  const value = String(method ?? "GET").toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(value) ? (value as HttpMethod) : "GET";
}

function authValue(value: unknown, key: string): string {
  if (!Array.isArray(value)) return "";
  const row = value.find((candidate) => candidate?.key === key);
  return String(row?.value ?? "");
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}
