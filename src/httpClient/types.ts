export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type HttpAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "api-key"; key: string; value: string; target: "header" | "query" };

export type HttpBodyMode = "none" | "raw" | "json" | "form-urlencoded" | "multipart";

export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpBody {
  mode: HttpBodyMode;
  raw: string;
  form: KeyValueRow[];
}

export interface HttpScripts {
  preRequest: string;
  test: string;
}

export interface HttpRequestItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueRow[];
  params: KeyValueRow[];
  cookies: KeyValueRow[];
  auth: HttpAuth;
  body: HttpBody;
  scripts: HttpScripts;
}

export interface HttpFolder {
  id: string;
  name: string;
  items: Array<HttpFolder | HttpRequestItem>;
}

export interface HttpCollection {
  id: string;
  name: string;
  schema?: string;
  items: Array<HttpFolder | HttpRequestItem>;
  importedAt?: number;
}

export interface HttpEnvironment {
  id: string;
  name: string;
  variables: KeyValueRow[];
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: KeyValueRow[];
  cookies: KeyValueRow[];
  body: string;
  bodyBase64?: boolean;
  durationMs: number;
  sizeBytes: number;
  redirected: boolean;
  url: string;
  tests?: HttpTestResult[];
}

export interface HttpTestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

export interface HttpHistoryEntry {
  id: string;
  requestName: string;
  method: HttpMethod;
  url: string;
  request?: HttpRequestItem;
  status?: number;
  durationMs?: number;
  sentAt: number;
}

export interface HttpClientState {
  collections: HttpCollection[];
  environments: HttpEnvironment[];
  activeCollectionId?: string;
  activeRequestId?: string;
  activeEnvironmentId?: string;
  draft: HttpRequestItem;
  response?: HttpResponse;
  history: HttpHistoryEntry[];
  ui?: HttpClientUiState;
}

export interface HttpClientUiState {
  historyVisible: boolean;
  responseWidth: number;
  responseHeight: number;
  requestPanel: "params" | "auth" | "headers" | "body" | "cookies" | "scripts" | "settings";
  responsePanel: "body" | "cookies" | "headers" | "tests";
  jsonCollapsed?: number[];
  openTabs?: string[];
}

export interface HttpSendPayload {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpClientCallbacks {
  onChange: () => void;
  onClose: () => void;
  onRenameTab: (name: string) => void;
  onNotify: (message: string) => void;
  onDownload: (filename: string, text: string, type?: string) => void;
}

export function isHttpFolder(item: HttpFolder | HttpRequestItem): item is HttpFolder {
  return "items" in item;
}
