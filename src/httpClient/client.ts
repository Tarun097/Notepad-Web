import { HttpAuth, HttpRequestItem, HttpResponse, HttpSendPayload, KeyValueRow } from "./types";
import { DEFAULT_REQUEST_HEADERS, applyVariables, contentTypeForBodyMode } from "./state";
import { formatRequestJson } from "./jsonBody";

const HTTP_PROXY_URL = "/api/http/request";

export async function sendHttpRequest(request: HttpRequestItem, variables: Record<string, string>): Promise<HttpResponse> {
  const payload = buildPayload(request, variables);
  const response = await fetch(HTTP_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "HTTP request failed.");
  }
  return data as HttpResponse;
}

export function buildPayload(request: HttpRequestItem, variables: Record<string, string>): HttpSendPayload {
  const headers = rowsToHeaders(request.headers, variables);
  applyDefaultHeaders(headers);
  const url = buildRequestUrl(request, variables);
  applyAuth(request.auth, headers, variables);
  applyCookies(request.cookies, headers, variables);
  const body = buildBody(request, headers, variables);
  return { method: request.method, url, headers, body };
}

export function buildRequestUrl(request: HttpRequestItem, variables: Record<string, string>): string {
  const queryRows =
    request.auth.type === "api-key" && request.auth.target === "query" && request.auth.key
      ? [...request.params, { id: "auth", key: request.auth.key, value: request.auth.value, enabled: true }]
      : request.params;
  return appendQueryParams(applyVariables(request.url, variables), queryRows, variables);
}

export function formatResponseBody(response?: HttpResponse): string {
  if (!response) return "";
  const contentType = response.headers.find((header) => header.key.toLowerCase() === "content-type")?.value ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }
  return response.body;
}

function rowsToHeaders(rows: KeyValueRow[], variables: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    if (row.enabled && row.key) {
      headers[applyVariables(row.key, variables)] = applyVariables(row.value, variables);
    }
  }
  return headers;
}

function applyDefaultHeaders(headers: Record<string, string>): void {
  for (const header of DEFAULT_REQUEST_HEADERS) {
    if (!hasHeader(headers, header.key)) headers[header.key] = header.value;
  }
}

function appendQueryParams(url: string, rows: KeyValueRow[], variables: Record<string, string>): string {
  const activeRows = rows.filter((row) => row.enabled && row.key);
  if (activeRows.length === 0) return url;
  const parsed = new URL(url);
  for (const row of activeRows) {
    parsed.searchParams.set(applyVariables(row.key, variables), applyVariables(row.value, variables));
  }
  return parsed.toString();
}

function applyAuth(auth: HttpAuth, headers: Record<string, string>, variables: Record<string, string>): void {
  if (auth.type === "bearer" && auth.token) {
    headers.Authorization = `Bearer ${applyVariables(auth.token, variables)}`;
  } else if (auth.type === "basic") {
    headers.Authorization = `Basic ${btoa(`${applyVariables(auth.username, variables)}:${applyVariables(auth.password, variables)}`)}`;
  } else if (auth.type === "api-key" && auth.target === "header" && auth.key) {
    headers[applyVariables(auth.key, variables)] = applyVariables(auth.value, variables);
  }
}

function applyCookies(rows: KeyValueRow[], headers: Record<string, string>, variables: Record<string, string>): void {
  const cookies = rows
    .filter((row) => row.enabled && row.key)
    .map((row) => `${applyVariables(row.key, variables)}=${applyVariables(row.value, variables)}`);
  if (cookies.length === 0 || hasHeader(headers, "cookie")) return;
  headers.Cookie = cookies.join("; ");
}

function buildBody(request: HttpRequestItem, headers: Record<string, string>, variables: Record<string, string>): string | undefined {
  if (["GET", "HEAD"].includes(request.method) || request.body.mode === "none") return undefined;
  if (request.body.mode === "raw" || request.body.mode === "json") {
    const contentType = contentTypeForBodyMode(request.body.mode);
    if (contentType && !hasHeader(headers, "content-type")) headers["Content-Type"] = contentType;
    const raw = applyVariables(request.body.raw, variables);
    return request.body.mode === "json" ? formatRequestJson(raw) : raw;
  }
  if (request.body.mode === "form-urlencoded") {
    const contentType = contentTypeForBodyMode(request.body.mode);
    if (contentType && !hasHeader(headers, "content-type")) headers["Content-Type"] = contentType;
    const params = new URLSearchParams();
    for (const row of request.body.form) {
      if (row.enabled && row.key) params.set(applyVariables(row.key, variables), applyVariables(row.value, variables));
    }
    return params.toString();
  }
  if (request.body.mode === "multipart") {
    const boundary = `----notepadplusweb-${crypto.randomUUID()}`;
    if (!hasHeader(headers, "content-type")) headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
    return request.body.form
      .filter((row) => row.enabled && row.key)
      .map((row) => {
        const key = escapeMultipartName(applyVariables(row.key, variables));
        const value = applyVariables(row.value, variables).replace(/\r?\n/g, "\r\n");
        return `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
      })
      .join("") + `--${boundary}--\r\n`;
  }
  return undefined;
}

function escapeMultipartName(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "").replaceAll("\n", "");
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((header) => header.toLowerCase() === name.toLowerCase());
}
