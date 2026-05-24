import { HttpAuth, HttpRequestItem, HttpResponse, HttpSendPayload, KeyValueRow } from "./types";
import { applyVariables } from "./state";

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
  const queryRows =
    request.auth.type === "api-key" && request.auth.target === "query" && request.auth.key
      ? [...request.params, { id: "auth", key: request.auth.key, value: request.auth.value, enabled: true }]
      : request.params;
  const url = appendQueryParams(applyVariables(request.url, variables), queryRows, variables);
  applyAuth(request.auth, headers, variables);
  const body = buildBody(request, headers, variables);
  return { method: request.method, url, headers, body };
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

function buildBody(request: HttpRequestItem, headers: Record<string, string>, variables: Record<string, string>): string | undefined {
  if (["GET", "HEAD"].includes(request.method) || request.body.mode === "none") return undefined;
  if (request.body.mode === "raw" || request.body.mode === "json") {
    if (request.body.mode === "json" && !hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
    return applyVariables(request.body.raw, variables);
  }
  if (request.body.mode === "form-urlencoded") {
    if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams();
    for (const row of request.body.form) {
      if (row.enabled && row.key) params.set(applyVariables(row.key, variables), applyVariables(row.value, variables));
    }
    return params.toString();
  }
  if (request.body.mode === "multipart") {
    if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams();
    for (const row of request.body.form) {
      if (row.enabled && row.key) params.set(applyVariables(row.key, variables), applyVariables(row.value, variables));
    }
    return params.toString();
  }
  return undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((header) => header.toLowerCase() === name.toLowerCase());
}
