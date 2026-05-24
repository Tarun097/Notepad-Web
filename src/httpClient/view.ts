import { formatResponseBody, sendHttpRequest } from "./client";
import { exportPostmanCollection, importPostmanCollection } from "./postman";
import {
  activeEnvironment,
  cloneRequest,
  createCollection,
  createRequest,
  createRow,
  clampResponseHeight,
  clampResponseWidth,
  findRequest,
  flattenRequests,
  persistHttpWorkspace,
  upsertRequest,
  variablesForEnvironment,
} from "./state";
import {
  HttpClientCallbacks,
  HttpClientState,
  HttpCollection,
  HttpEnvironment,
  HttpMethod,
  HttpRequestItem,
  KeyValueRow,
  isHttpFolder,
} from "./types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export class HttpClientView {
  private readonly fileInput: HTMLInputElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly state: HttpClientState,
    private readonly callbacks: HttpClientCallbacks,
  ) {
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".json,application/json";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => void this.importSelectedFiles());
    root.append(this.fileInput);
    root.addEventListener("click", (event) => void this.handleClick(event));
    root.addEventListener("change", (event) => this.handleChange(event));
    root.addEventListener("input", (event) => this.handleInput(event));
    root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
  }

  render(): void {
    this.root.className = "http-client-view";
    this.state.ui ??= { historyVisible: false, responseWidth: 50, responseHeight: 52, requestPanel: "params", responsePanel: "body" };
    this.root.classList.toggle("history-hidden", !this.state.ui.historyVisible);
    this.root.style.setProperty("--http-response-width", `${this.state.ui.responseWidth}%`);
    this.root.style.setProperty("--http-response-height", `${this.state.ui.responseHeight}%`);
    const activeRequest = this.activeRequest();
    const response = this.state.response;
    this.root.innerHTML = `
      <aside class="http-sidebar">
        <details class="http-sidebar-section" open>
          <summary>COLLECTIONS <button class="mini-button" data-http-action="new-collection" title="New Collection">+</button><button class="mini-button" data-http-action="import-postman" title="Import">⌁</button></summary>
          <div class="http-collection-list">${this.renderCollections()}</div>
        </details>
        <details class="http-sidebar-section">
          <summary>ENVIRONMENTS</summary>
          <div class="http-env-panel">
            <div class="http-sidebar-actions">
              ${this.renderEnvironmentPicker()}
              <button class="mini-button" data-http-action="add-env-row">Add</button>
            </div>
            ${this.renderEnvironmentRows()}
          </div>
        </details>
        <details class="http-sidebar-section" ${this.state.ui.historyVisible ? "open" : ""}>
          <summary>HISTORY</summary>
          <div class="http-history-inline">
            <button class="mini-button" data-http-action="clear-history">Clear</button>
            ${this.renderHistoryItems()}
          </div>
        </details>
      </aside>
      <section class="http-workbench">
        <div class="http-top-strip">
          ${this.renderOpenTabs(activeRequest)}
          <button class="http-plus-tab" data-http-action="new-request">+</button>
          <div class="http-env-top">${this.renderEnvironmentPicker()}</div>
        </div>
        ${this.hasOpenTabs() ? `<div class="http-title-row">
          <span class="http-protocol-badge">HTTP</span>
          <input class="http-request-name-input" data-http-field="name" value="${escapeAttr(activeRequest.name)}" spellcheck="false" />
          <button class="mini-button" data-http-action="save-request">Save</button>
        </div>
        <div class="http-request-bar">
          <select data-http-field="method">${METHODS.map((method) => `<option value="${method}" ${method === activeRequest.method ? "selected" : ""}>${method}</option>`).join("")}</select>
          <input class="http-url-input" data-http-field="url" value="${escapeAttr(activeRequest.url)}" spellcheck="false" />
          <button class="mini-button primary" data-http-action="send">Send</button>
        </div>
        <div class="http-main-split">
          <section class="http-request-editor">
            <div class="http-tabs">
              ${this.renderRequestTab("params", "Params")}
              ${this.renderRequestTab("auth", "Authorization")}
              ${this.renderRequestTab("headers", `Headers ${activeRequest.headers.filter((row) => row.enabled && row.key).length || ""}`)}
              ${this.renderRequestTab("body", "Body")}
              ${this.renderRequestTab("scripts", "Scripts")}
              ${this.renderRequestTab("settings", "Settings")}
              <a>Cookies</a>
            </div>
            <div class="http-request-panel">${this.renderActiveRequestPanel(activeRequest)}</div>
          </section>
          <div class="http-response-resize" data-http-resize="response-height"></div>
          <section class="http-response">
            <div class="http-response-meta">
              <div class="http-tabs response-tabs">
                ${this.renderResponseTab("body", "Body")}
                ${this.renderResponseTab("cookies", "Cookies")}
                ${this.renderResponseTab("headers", `Headers ${response?.headers.length ?? ""}`)}
                ${this.renderResponseTab("tests", "Test Results")}
              </div>
              ${
                response
                  ? `<div class="http-response-stats"><span class="status-ok">${response.status} ${escapeHtml(response.statusText)}</span><span>${response.durationMs} ms</span><span>${formatBytes(response.sizeBytes)}</span></div>`
                  : `<div class="http-response-stats"><span>No response yet</span></div>`
              }
            </div>
            <div class="http-response-body">${this.renderActiveResponsePanel(response)}</div>
          </section>
        </div>` : `<div class="http-empty-state">Select a request from the sidebar or create a new one.</div>`}
      </section>
    `;
    this.root.append(this.fileInput);
  }

  destroy(): void {
    this.root.replaceChildren();
  }

  private activeRequest(): HttpRequestItem {
    const saved = findRequest(this.state.collections, this.state.activeRequestId ?? "");
    if (saved && saved.id !== this.state.draft.id) {
      this.state.draft = cloneRequest(saved);
    }
    return this.state.draft;
  }

  private ensureOpenTabs(): string[] {
    if (!this.state.ui) return [];
    if (!this.state.ui.openTabs) this.state.ui.openTabs = [];
    // Don't auto-add if tabs were explicitly closed (empty array means user closed all)
    if (this.state.ui.openTabs.length === 0 && !this.state.activeRequestId) return [];
    const id = this.state.activeRequestId ?? this.state.draft.id;
    if (id && !this.state.ui.openTabs.includes(id)) {
      this.state.ui.openTabs.push(id);
    }
    return this.state.ui.openTabs;
  }

  private hasOpenTabs(): boolean {
    return (this.state.ui?.openTabs ?? []).length > 0;
  }

  private renderOpenTabs(activeRequest: HttpRequestItem): string {
    const openTabs = this.ensureOpenTabs();
    return openTabs.map((tabId) => {
      const req = findRequest(this.state.collections, tabId);
      const name = req ? `${req.method} ${req.url || req.name}` : `${activeRequest.method} ${activeRequest.url || activeRequest.name}`;
      const isActive = tabId === (this.state.activeRequestId ?? this.state.draft.id);
      const dirty = isActive && this.isRequestDirty();
      return `<div class="http-request-tab${isActive ? " active" : ""}" data-http-switch-tab="${tabId}"><span>${escapeHtml(name)}</span>${dirty ? ` <i></i>` : ``}<button class="http-tab-close" data-http-action="close-request:${tabId}" title="Close">&times;</button></div>`;
    }).join("");
  }

  private isRequestDirty(): boolean {
    const saved = findRequest(this.state.collections, this.state.draft.id);
    if (!saved) return true;
    return JSON.stringify(saved) !== JSON.stringify(this.state.draft);
  }

  private persistAndRender(message?: string): void {
    persistHttpWorkspace(this.state);
    this.callbacks.onChange();
    if (message) this.callbacks.onNotify(message);
    this.render();
  }

  private captureForm(): void {
    const request = this.state.draft;
    request.name = this.inputValue("[data-http-field='name']") || request.name || "Untitled Request";
    request.method = this.inputValue("[data-http-field='method']") as HttpMethod;
    request.url = this.inputValue("[data-http-field='url']");
    this.captureCollectionNames();
    request.headers = this.captureRows("headers") ?? request.headers;
    request.params = this.captureRows("params") ?? request.params;
    const environment = activeEnvironment(this.state);
    if (environment) environment.variables = this.captureRows("env") ?? environment.variables;
    const bodyMode = this.inputValue("[data-http-field='body-mode']");
    if (bodyMode) request.body.mode = bodyMode as HttpRequestItem["body"]["mode"];
    const bodyRaw = this.root.querySelector<HTMLTextAreaElement>("[data-http-field='body-raw']");
    if (bodyRaw) request.body.raw = bodyRaw.value;
    if (this.root.querySelector("[data-http-row-group='body']")) request.body.form = this.captureRows("body") ?? request.body.form;
    const authType = this.inputValue("[data-http-field='auth-type']");
    if (authType === "bearer") {
      request.auth = { type: "bearer", token: this.inputValue("[data-http-field='auth-token']") };
    } else if (authType === "basic") {
      request.auth = {
        type: "basic",
        username: this.inputValue("[data-http-field='auth-username']"),
        password: this.inputValue("[data-http-field='auth-password']"),
      };
    } else if (authType === "api-key") {
      request.auth = {
        type: "api-key",
        key: this.inputValue("[data-http-field='auth-key']"),
        value: this.inputValue("[data-http-field='auth-value']"),
        target: this.inputValue("[data-http-field='auth-target']") === "query" ? "query" : "header",
      };
    } else {
      request.auth = { type: "none" };
    }
  }

  private async handleClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const requestId = target.closest<HTMLElement>("[data-http-request]")?.dataset.httpRequest;
    const collectionId = target.closest<HTMLElement>("[data-http-collection]")?.dataset.httpCollection;
    const action = target.closest<HTMLElement>("[data-http-action]")?.dataset.httpAction;
    const switchTab = target.closest<HTMLElement>("[data-http-switch-tab]")?.dataset.httpSwitchTab;

    if (action?.startsWith("close-request:")) {
      this.captureForm();
      this.closeRequest(action.replace("close-request:", ""));
      return;
    }

    if (action?.startsWith("delete-request:")) {
      this.captureForm();
      this.deleteRequest(action.replace("delete-request:", ""));
      return;
    }

    if (switchTab && switchTab !== (this.state.activeRequestId ?? this.state.draft.id)) {
      this.captureForm();
      const request = findRequest(this.state.collections, switchTab);
      if (request) {
        this.state.activeRequestId = request.id;
        this.state.draft = cloneRequest(request);
        this.state.response = undefined;
        this.persistAndRender();
      }
      return;
    }

    if (requestId) {
      this.captureForm();
      const request = findRequest(this.state.collections, requestId);
      if (request) {
        this.state.activeRequestId = request.id;
        this.state.draft = cloneRequest(request);
        this.ensureOpenTabs();
        this.persistAndRender();
      }
      return;
    }

    if (collectionId && !action) {
      this.state.activeCollectionId = this.state.activeCollectionId === collectionId ? undefined : collectionId;
      this.persistAndRender();
      return;
    }

    if (!action) return;
    this.captureForm();

    if (action === "send") await this.send();
    else if (action === "save-request") this.saveRequest();
    else if (action === "new-request") this.newRequest();
    else if (action === "new-collection") this.newCollection();
    else if (action.startsWith("add-request:")) this.newRequest(action.replace("add-request:", ""));
    else if (action.startsWith("delete-collection:")) this.deleteCollection(action.replace("delete-collection:", ""));
    else if (action.startsWith("delete-request:")) this.deleteRequest(action.replace("delete-request:", ""));
    else if (action === "import-postman") this.fileInput.click();
    else if (action === "export-postman") this.exportActiveCollection();
    else if (action.startsWith("export-collection:")) this.exportCollection(action.replace("export-collection:", ""));
    else if (action === "toggle-history") this.toggleHistory();
    else if (action === "clear-history") this.clearHistory();
    else if (action.startsWith("request-panel:")) this.setRequestPanel(action.replace("request-panel:", "") as NonNullable<HttpClientState["ui"]>["requestPanel"]);
    else if (action.startsWith("response-panel:")) this.setResponsePanel(action.replace("response-panel:", "") as NonNullable<HttpClientState["ui"]>["responsePanel"]);
    else if (action.startsWith("toggle-json-fold:")) this.toggleJsonFold(Number(action.replace("toggle-json-fold:", "")));
    else if (action.startsWith("body-mode:")) this.setBodyMode(action.replace("body-mode:", "") as HttpRequestItem["body"]["mode"]);
    else if (action === "format-body-json") this.formatBodyJson();
    else if (action === "add-param-row") this.state.draft.params.push(createRow());
    else if (action === "add-header-row") this.state.draft.headers.push(createRow());
    else if (action === "add-body-row") this.state.draft.body.form.push(createRow());
    else if (action === "add-env-row") activeEnvironment(this.state)?.variables.push(createRow());

    if (!["send", "save-request", "new-request", "new-collection", "import-postman", "export-postman"].includes(action) && !action.startsWith("delete-") && !action.startsWith("close-request:") && !action.startsWith("export-collection:")) {
      this.persistAndRender();
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    const resizeKind = target.dataset.httpResize;
    if (!resizeKind) return;
    event.preventDefault();
    this.captureForm();
    this.state.ui ??= { historyVisible: false, responseWidth: 50, responseHeight: 52, requestPanel: "params", responsePanel: "body" };
    target.setPointerCapture(event.pointerId);
    this.root.classList.add("resizing-response");

    const onMove = (moveEvent: PointerEvent): void => {
      const split = this.root.querySelector<HTMLElement>(".http-main-split");
      if (!split) return;
      const rect = split.getBoundingClientRect();
      if (resizeKind === "response-height") {
        const height = ((rect.bottom - moveEvent.clientY) / rect.height) * 100;
        this.state.ui!.responseHeight = clampResponseHeight(height);
        this.root.style.setProperty("--http-response-height", `${this.state.ui!.responseHeight}%`);
      } else {
        const width = ((rect.right - moveEvent.clientX) / rect.width) * 100;
        this.state.ui!.responseWidth = clampResponseWidth(width);
        this.root.style.setProperty("--http-response-width", `${this.state.ui!.responseWidth}%`);
      }
    };

    const onUp = (): void => {
      this.root.classList.remove("resizing-response");
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      persistHttpWorkspace(this.state);
      this.callbacks.onChange();
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.matches("[data-http-field='environment']")) {
      this.captureForm();
      this.state.activeEnvironmentId = (target as HTMLSelectElement).value;
      this.persistAndRender();
      return;
    }
    this.captureForm();
    persistHttpWorkspace(this.state);
  }

  private handleInput(event: Event): void {
    if (!(event.target as HTMLElement).matches("input, textarea, select")) return;
    this.captureForm();
    persistHttpWorkspace(this.state);
    this.updateDirtyDot();
  }

  private updateDirtyDot(): void {
    const tab = this.root.querySelector<HTMLElement>(".http-request-tab");
    if (!tab) return;
    const dot = tab.querySelector("i");
    if (this.isRequestDirty()) {
      if (!dot) tab.insertAdjacentHTML("beforeend", ` <i></i>`);
    } else {
      if (dot) dot.remove();
    }
  }

  private async send(): Promise<void> {
    const request = this.state.draft;
    const saved = findRequest(this.state.collections, request.id);
    if (request.url && /^(Request \d+|Untitled Request)$/.test(request.name) && (!saved || !saved.url)) {
      try {
        const parsed = new URL(request.url);
        request.name = parsed.pathname === "/" ? parsed.hostname : `${parsed.hostname}${parsed.pathname}`;
      } catch { /* keep existing name if URL is invalid */ }
    }
    try {
      this.callbacks.onNotify("Sending request...");
      const response = await sendHttpRequest(request, variablesForEnvironment(activeEnvironment(this.state)));
      this.state.response = response;
      if (this.state.ui) this.state.ui.jsonCollapsed = [];
      this.state.history.unshift({
        id: crypto.randomUUID(),
        requestName: request.name,
        method: request.method,
        url: request.url,
        status: response.status,
        durationMs: response.durationMs,
        sentAt: Date.now(),
      });
      this.persistAndRender(`HTTP ${response.status} in ${response.durationMs} ms.`);
    } catch (error) {
      this.callbacks.onNotify(error instanceof Error ? error.message : "Request failed.");
    }
  }

  private saveRequest(): void {
    if (this.state.collections.length === 0) {
      const collection = createCollection("My Requests");
      this.state.collections = [collection];
      this.state.activeCollectionId = collection.id;
    }
    this.state.collections = upsertRequest(this.state.collections, this.state.activeCollectionId, this.state.draft);
    this.state.activeRequestId = this.state.draft.id;
    this.callbacks.onRenameTab(`HTTP: ${this.state.draft.name}`);
    this.persistAndRender("Request saved.");
  }

  private closeRequest(tabId: string): void {
    const openTabs = this.state.ui?.openTabs ?? [];
    const index = openTabs.indexOf(tabId);
    if (index === -1) return;

    // Remove from open tabs
    openTabs.splice(index, 1);
    if (this.state.ui) this.state.ui.openTabs = openTabs;

    if (openTabs.length === 0) {
      // No tabs left — clear the view
      this.state.activeRequestId = undefined;
      this.state.response = undefined;
      this.persistAndRender();
    } else {
      // Switch to another tab
      const nextId = openTabs[Math.min(index, openTabs.length - 1)];
      const request = findRequest(this.state.collections, nextId);
      if (request) {
        this.state.activeRequestId = request.id;
        this.state.draft = cloneRequest(request);
      }
      this.state.response = undefined;
      this.persistAndRender();
    }
  }

  private newRequest(collectionId = this.state.activeCollectionId): void {
    const count = this.state.collections.flatMap((collection) => flattenRequests(collection.items)).length + 1;
    const request = createRequest(`Request ${count}`);
    this.state.collections = this.state.collections.map((collection) =>
      collection.id === collectionId ? { ...collection, items: [...collection.items, request] } : collection,
    );
    this.state.activeCollectionId = collectionId;
    this.state.draft = cloneRequest(request);
    this.state.activeRequestId = request.id;
    this.state.response = undefined;
    this.persistAndRender();
  }

  private newCollection(): void {
    const collection = createCollection(`Collection ${this.state.collections.length + 1}`);
    this.state.collections.push(collection);
    this.state.activeCollectionId = collection.id;
    this.persistAndRender();
  }

  private deleteCollection(collectionId: string): void {
    const collection = this.state.collections.find((c) => c.id === collectionId);
    if (!collection || !confirm(`Delete collection "${collection.name}"?`)) return;
    const remaining = this.state.collections.filter((c) => c.id !== collectionId);
    this.state.collections = remaining;
    this.state.activeCollectionId = remaining.length ? remaining[0].id : undefined;
    this.state.activeRequestId = undefined;
    if (this.state.ui) this.state.ui.openTabs = [];
    if (remaining.length) {
      const active = findRequest(remaining, "") ?? flattenRequests(remaining[0].items)[0];
      if (active) {
        this.state.activeRequestId = active.id;
        this.state.draft = cloneRequest(active);
      }
    }
    this.persistAndRender("Collection deleted.");
  }

  private deleteRequest(requestId: string): void {
    const request = findRequest(this.state.collections, requestId);
    if (!request || !confirm(`Delete request "${request.name}"?`)) return;
    this.state.collections = this.state.collections.map((collection) => ({
      ...collection,
      items: removeRequestFromItems(collection.items, requestId),
    }));
    if (this.state.activeRequestId === requestId) {
      const next = this.state.collections.flatMap((collection) => flattenRequests(collection.items))[0];
      if (next) {
        this.state.activeRequestId = next.id;
        this.state.draft = cloneRequest(next);
      } else {
        this.newRequest(this.state.activeCollectionId);
        return;
      }
    }
    this.persistAndRender("Request deleted.");
  }

  private toggleHistory(): void {
    this.state.ui ??= { historyVisible: false, responseWidth: 50, responseHeight: 52, requestPanel: "params", responsePanel: "body" };
    this.state.ui.historyVisible = !this.state.ui.historyVisible;
  }

  private clearHistory(): void {
    this.state.history = [];
  }

  private setBodyMode(mode: HttpRequestItem["body"]["mode"]): void {
    this.state.draft.body.mode = mode;
  }

  private formatBodyJson(): void {
    try {
      this.state.draft.body.raw = JSON.stringify(JSON.parse(this.state.draft.body.raw || "{}"), null, 2);
      this.state.draft.body.mode = "json";
      this.callbacks.onNotify("Formatted request JSON.");
    } catch (error) {
      this.callbacks.onNotify(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.");
    }
  }

  private setRequestPanel(panel: NonNullable<HttpClientState["ui"]>["requestPanel"]): void {
    this.state.ui ??= { historyVisible: false, responseWidth: 50, responseHeight: 52, requestPanel: "params", responsePanel: "body" };
    this.state.ui.requestPanel = panel;
  }

  private setResponsePanel(panel: NonNullable<HttpClientState["ui"]>["responsePanel"]): void {
    this.state.ui ??= { historyVisible: false, responseWidth: 50, responseHeight: 52, requestPanel: "params", responsePanel: "body" };
    this.state.ui.responsePanel = panel;
  }

  private toggleJsonFold(lineNumber: number): void {
    if (!Number.isInteger(lineNumber)) return;
    this.state.ui ??= { historyVisible: false, responseWidth: 50, responseHeight: 52, requestPanel: "params", responsePanel: "body" };
    const collapsed = new Set(this.state.ui.jsonCollapsed ?? []);
    if (collapsed.has(lineNumber)) collapsed.delete(lineNumber);
    else collapsed.add(lineNumber);
    this.state.ui.jsonCollapsed = Array.from(collapsed).sort((a, b) => a - b);
  }

  private async importSelectedFiles(): Promise<void> {
    const files = Array.from(this.fileInput.files ?? []);
    this.fileInput.value = "";
    for (const file of files) {
      const collection = importPostmanCollection(JSON.parse(await file.text()));
      this.state.collections.push(collection);
      this.state.activeCollectionId = collection.id;
      const first = flattenRequests(collection.items)[0];
      if (first) {
        this.state.activeRequestId = first.id;
        this.state.draft = cloneRequest(first);
      }
      this.callbacks.onRenameTab(`HTTP: ${collection.name}`);
      this.callbacks.onNotify(`Imported ${collection.name}.`);
    }
    this.persistAndRender();
  }

  private exportActiveCollection(): void {
    const collection = this.state.collections.find((candidate) => candidate.id === this.state.activeCollectionId) ?? this.state.collections[0];
    if (!collection) {
      this.callbacks.onNotify("No collection to export.");
      return;
    }
    this.exportCollection(collection.id);
  }

  private exportCollection(collectionId: string): void {
    const collection = this.state.collections.find((c) => c.id === collectionId);
    if (!collection) {
      this.callbacks.onNotify("Collection not found.");
      return;
    }
    const json = JSON.stringify(exportPostmanCollection(collection), null, 2);
    this.callbacks.onDownload(`${safeFilename(collection.name)}.postman_collection.json`, json, "application/json;charset=utf-8");
    this.callbacks.onNotify(`Exported ${collection.name}.`);
  }

  private renderRequestTab(panel: NonNullable<HttpClientState["ui"]>["requestPanel"], label: string): string {
    const active = this.state.ui?.requestPanel === panel;
    return `<button class="${active ? "active" : ""}" data-http-action="request-panel:${panel}">${escapeHtml(label)}</button>`;
  }

  private renderResponseTab(panel: NonNullable<HttpClientState["ui"]>["responsePanel"], label: string): string {
    const active = this.state.ui?.responsePanel === panel;
    return `<button class="${active ? "active" : ""}" data-http-action="response-panel:${panel}">${escapeHtml(label)}</button>`;
  }

  private renderActiveRequestPanel(request: HttpRequestItem): string {
    switch (this.state.ui?.requestPanel) {
      case "auth":
        return this.renderAuth(request);
      case "headers":
        return this.renderRows("headers", request.headers);
      case "body":
        return this.renderBody(request);
      case "scripts":
        return `<div class="http-empty-panel">Pre-request and test scripts are not configured for this request.</div>`;
      case "settings":
        return `<div class="http-empty-panel">Request settings use the local HTTP proxy defaults.</div>`;
      case "params":
      default:
        return this.renderRows("params", request.params);
    }
  }

  private renderActiveResponsePanel(response: HttpClientState["response"]): string {
    if (!response) return `<div class="http-empty-panel">Send a request to view the response.</div>`;
    switch (this.state.ui?.responsePanel) {
      case "headers":
        return this.renderReadonlyRows(response.headers);
      case "cookies":
        return `<div class="http-empty-panel">No response cookies were captured.</div>`;
      case "tests":
        return `<div class="http-empty-panel">No test results.</div>`;
      case "body":
      default:
        return renderJsonResponse(formatResponseBody(response), this.state.ui?.jsonCollapsed ?? []);
    }
  }

  private renderHistoryItems(): string {
    if (this.state.history.length === 0) return `<div class="http-empty-panel compact">No history</div>`;
    return this.state.history
      .slice(0, 25)
      .map(
        (entry) => `
          <button class="http-history-item" data-http-history="${entry.id}">
            <span>${entry.method} ${escapeHtml(entry.requestName)}</span>
            <small>${entry.status ?? "-"} ${entry.durationMs ? `${entry.durationMs} ms` : ""}</small>
          </button>
        `,
      )
      .join("");
  }

  private renderCollections(): string {
    return this.state.collections
      .map(
        (collection) => `
          <section class="http-collection ${collection.id === this.state.activeCollectionId ? "active" : ""}">
            <div class="http-collection-row">
              <button class="http-collection-toggle ${collection.id === this.state.activeCollectionId ? "open" : ""}" data-http-collection="${collection.id}">›</button>
              <input data-http-collection-name="${collection.id}" value="${escapeAttr(collection.name)}" spellcheck="false" />
              <button class="mini-button" title="Add request" data-http-action="add-request:${collection.id}">+</button>
              <button class="mini-button" title="Export" data-http-action="export-collection:${collection.id}">⤓</button>
              <button class="mini-button danger" title="Delete collection" data-http-action="delete-collection:${collection.id}">×</button>
            </div>
            ${collection.id === this.state.activeCollectionId ? `<div class="http-items">${collection.items.map((item) => this.renderCollectionItem(item)).join("")}</div>` : ""}
          </section>
        `,
      )
      .join("");
  }

  private renderCollectionItem(item: HttpCollection["items"][number], depth = 0): string {
    const indent = `style="padding-left:${8 + depth * 14}px"`;
    if (isHttpFolder(item)) {
      return `
        <details class="http-folder" open>
          <summary ${indent}>${escapeHtml(item.name)}</summary>
          ${item.items.map((child) => this.renderCollectionItem(child, depth + 1)).join("")}
        </details>
      `;
    }
    return `
      <button class="http-request-item ${item.id === this.state.activeRequestId ? "active" : ""}" ${indent} data-http-request="${item.id}">
        <span>${item.method}</span>
        <span>${escapeHtml(item.name)}</span>
        <small data-http-action="delete-request:${item.id}" title="Delete request">×</small>
      </button>
    `;
  }

  private renderEnvironmentPicker(): string {
    return `
      <select data-http-field="environment" class="http-env-select">
        ${this.state.environments
          .map((env) => `<option value="${env.id}" ${env.id === this.state.activeEnvironmentId ? "selected" : ""}>${escapeHtml(env.name)}</option>`)
          .join("")}
      </select>
    `;
  }

  private renderEnvironmentRows(): string {
    const environment = activeEnvironment(this.state);
    return environment ? this.renderRows("env", environment.variables, false) : "";
  }

  private renderRows(group: "params" | "headers" | "body" | "env", rows: KeyValueRow[], addButton = true): string {
    const action = group === "params" ? "add-param-row" : group === "headers" ? "add-header-row" : group === "body" ? "add-body-row" : "add-env-row";
    return `
      <div class="http-kv-table" data-http-row-group="${group}">
        ${rows
          .map(
            (row) => `
              <label class="http-kv-enabled"><input type="checkbox" data-row-enabled="${row.id}" ${row.enabled ? "checked" : ""} /></label>
              <input data-row-key="${row.id}" value="${escapeAttr(row.key)}" placeholder="Key" spellcheck="false" />
              <input data-row-value="${row.id}" value="${escapeAttr(row.value)}" placeholder="Value" spellcheck="false" />
            `,
          )
          .join("")}
      </div>
      ${addButton ? `<button class="mini-button" data-http-action="${action}">Add row</button>` : ""}
    `;
  }

  private renderReadonlyRows(rows: KeyValueRow[]): string {
    return `<div class="http-readonly-rows">${rows.map((row) => `<span>${escapeHtml(row.key)}</span><code>${escapeHtml(row.value)}</code>`).join("")}</div>`;
  }

  private renderAuth(request: HttpRequestItem): string {
    const auth = request.auth;
    return `
      <select data-http-field="auth-type">
        <option value="none" ${auth.type === "none" ? "selected" : ""}>No Auth</option>
        <option value="bearer" ${auth.type === "bearer" ? "selected" : ""}>Bearer Token</option>
        <option value="basic" ${auth.type === "basic" ? "selected" : ""}>Basic Auth</option>
        <option value="api-key" ${auth.type === "api-key" ? "selected" : ""}>API Key</option>
      </select>
      <div class="http-auth-grid">
        <input data-http-field="auth-token" value="${escapeAttr(auth.type === "bearer" ? auth.token : "")}" placeholder="Token" />
        <input data-http-field="auth-username" value="${escapeAttr(auth.type === "basic" ? auth.username : "")}" placeholder="Username" />
        <input data-http-field="auth-password" value="${escapeAttr(auth.type === "basic" ? auth.password : "")}" placeholder="Password" type="password" />
        <input data-http-field="auth-key" value="${escapeAttr(auth.type === "api-key" ? auth.key : "")}" placeholder="API key name" />
        <input data-http-field="auth-value" value="${escapeAttr(auth.type === "api-key" ? auth.value : "")}" placeholder="API key value" />
        <select data-http-field="auth-target">
          <option value="header" ${auth.type === "api-key" && auth.target === "header" ? "selected" : ""}>Header</option>
          <option value="query" ${auth.type === "api-key" && auth.target === "query" ? "selected" : ""}>Query</option>
        </select>
      </div>
    `;
  }

  private renderBody(request: HttpRequestItem): string {
    const mode = request.body.mode;
    const modeLabels: Array<[HttpRequestItem["body"]["mode"], string]> = [
      ["none", "none"],
      ["raw", "raw"],
      ["json", "JSON"],
      ["form-urlencoded", "x-www-form-urlencoded"],
      ["multipart", "form-data"],
    ];
    return `
      <input type="hidden" data-http-field="body-mode" value="${escapeAttr(mode)}" />
      <div class="http-body-composer">
        <div class="http-body-modebar">
          ${modeLabels
            .map(
              ([value, label]) => `
                <button class="${mode === value ? "active" : ""}" data-http-action="body-mode:${value}">
                  <span></span>${escapeHtml(label)}
                </button>
              `,
            )
            .join("")}
        </div>
        ${this.renderBodyModeContent(request)}
      </div>
    `;
  }

  private renderBodyModeContent(request: HttpRequestItem): string {
    if (request.body.mode === "none") {
      return `
        <div class="http-body-empty">
          <strong>No request body</strong>
          <span>Choose JSON, raw text, or a form body when this request needs payload data.</span>
        </div>
      `;
    }

    if (request.body.mode === "raw" || request.body.mode === "json") {
      return `
        <div class="http-body-editor-shell">
          <div class="http-body-editor-toolbar">
            <span>${request.body.mode === "json" ? "application/json" : "text/plain"}</span>
            <button class="mini-button" data-http-action="format-body-json">Format JSON</button>
          </div>
          <textarea
            class="http-body-editor"
            data-http-field="body-raw"
            spellcheck="false"
            placeholder="${request.body.mode === "json" ? '{\n  \"name\": \"value\"\n}' : "Type raw request body"}"
          >${escapeHtml(request.body.raw)}</textarea>
        </div>
      `;
    }

    return `
      <div class="http-body-table-shell">
        <div class="http-body-table-head">
          <span></span>
          <span>Key</span>
          <span>Value</span>
        </div>
        ${this.renderRows("body", request.body.form)}
      </div>
    `;
  }

  private captureRows(group: "params" | "headers" | "body" | "env"): KeyValueRow[] | undefined {
    const table = this.root.querySelector<HTMLElement>(`[data-http-row-group='${group}']`);
    if (!table) return undefined;
    const keys = Array.from(table.querySelectorAll<HTMLInputElement>("[data-row-key]"));
    const rows = keys.map((keyInput) => {
      const id = keyInput.dataset.rowKey ?? crypto.randomUUID();
      const valueInput = table.querySelector<HTMLInputElement>(`[data-row-value='${CSS.escape(id)}']`);
      const enabledInput = table.querySelector<HTMLInputElement>(`[data-row-enabled='${CSS.escape(id)}']`);
      return { id, key: keyInput.value, value: valueInput?.value ?? "", enabled: enabledInput?.checked ?? true };
    });
    return rows.length ? rows : [createRow()];
  }

  private inputValue(selector: string): string {
    const element = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
    return element?.value ?? "";
  }

  private captureCollectionNames(): void {
    this.state.collections = this.state.collections.map((collection) => {
      const input = this.root.querySelector<HTMLInputElement>(`[data-http-collection-name='${CSS.escape(collection.id)}']`);
      return input ? { ...collection, name: input.value.trim() || "Untitled Collection" } : collection;
    });
  }
}

function safeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "collection";
}

function removeRequestFromItems(items: HttpCollection["items"], requestId: string): HttpCollection["items"] {
  return items
    .map((item) => {
      if (!isHttpFolder(item)) return item.id === requestId ? undefined : item;
      return { ...item, items: removeRequestFromItems(item.items, requestId) };
    })
    .filter((item): item is HttpCollection["items"][number] => Boolean(item));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface JsonFoldRange {
  start: number;
  end: number;
  opener: "{" | "[";
  openerColumn: number;
}

function renderJsonResponse(value: string, collapsedLines: number[]): string {
  try {
    const pretty = JSON.stringify(JSON.parse(value), null, 2);
    const lines = pretty.split("\n");
    const ranges = buildJsonFoldRanges(lines);
    const rangeByStart = new Map(ranges.map((range) => [range.start, range]));
    const collapsed = new Set(collapsedLines.filter((line) => rangeByStart.has(line)));
    const hiddenLines = new Set<number>();
    for (const line of collapsed) {
      const range = rangeByStart.get(line);
      if (!range) continue;
      for (let index = range.start + 1; index <= range.end; index += 1) {
        hiddenLines.add(index);
      }
    }

    const rows = lines
      .map((line, index) => {
        const lineNumber = index + 1;
        if (hiddenLines.has(lineNumber)) return "";
        const range = rangeByStart.get(lineNumber);
        const folded = range ? collapsed.has(lineNumber) : false;
        const displayLine = folded && range ? compactJsonLine(line, lines[range.end - 1], range) : line;
        return `
          <div class="http-json-line">
            ${
              range
                ? `<button class="http-json-fold" data-http-action="toggle-json-fold:${lineNumber}" title="${folded ? "Expand" : "Collapse"}">${folded ? "▸" : "▾"}</button>`
                : `<span class="http-json-fold-spacer"></span>`
            }
            <span class="http-json-line-number">${lineNumber}</span>
            <code class="http-json-code">${highlightJsonLine(displayLine || " ")}</code>
          </div>
        `;
      })
      .join("");

    return `<div class="http-json-lines">${rows}</div>`;
  } catch {
    return renderTextResponse(value);
  }
}

function renderTextResponse(value: string): string {
  const rows = value.split("\n").map(
    (line, index) => `
      <div class="http-response-line">
        <span>${index + 1}</span>
        <code>${escapeHtml(line || " ")}</code>
      </div>
    `,
  );
  return `<div class="http-response-lines">${rows.join("")}</div>`;
}

function buildJsonFoldRanges(lines: string[]): JsonFoldRange[] {
  const stack: JsonFoldRange[] = [];
  const ranges: JsonFoldRange[] = [];

  lines.forEach((line, index) => {
    let inString = false;
    let escaped = false;

    for (let column = 0; column < line.length; column += 1) {
      const char = line[column];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        stack.push({ start: index + 1, end: index + 1, opener: char, openerColumn: column });
      } else if (char === "}" || char === "]") {
        const matchIndex = findMatchingOpener(stack, char);
        if (matchIndex === -1) continue;
        const [range] = stack.splice(matchIndex, 1);
        range.end = index + 1;
        if (range.end > range.start) ranges.push(range);
      }
    }
  });

  return ranges;
}

function findMatchingOpener(stack: JsonFoldRange[], closer: string): number {
  const opener = closer === "}" ? "{" : "[";
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].opener === opener) return index;
  }
  return -1;
}

function compactJsonLine(startLine: string, endLine: string, range: JsonFoldRange): string {
  const closer = range.opener === "{" ? "}" : "]";
  const comma = endLine.trimEnd().endsWith(",") ? "," : "";
  return `${startLine.slice(0, range.openerColumn + 1)} ... ${closer}${comma}`;
}

function highlightJsonLine(line: string): string {
  let output = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] !== '"') {
      const nextString = line.indexOf('"', index);
      const segmentEnd = nextString === -1 ? line.length : nextString;
      output += highlightJsonLiteralSegment(line.slice(index, segmentEnd));
      index = segmentEnd;
      continue;
    }

    let end = index + 1;
    let escaped = false;
    while (end < line.length) {
      const char = line[end];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        end += 1;
        break;
      }
      end += 1;
    }

    const token = line.slice(index, end);
    const rest = line.slice(end);
    const isKey = /^\s*:/.test(rest);
    output += `<span class="${isKey ? "json-key" : "json-string"}">${escapeHtml(token)}</span>`;
    index = end;
  }

  return output;
}

function highlightJsonLiteralSegment(segment: string): string {
  return escapeHtml(segment).replace(
    /(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/gi,
    (match) => {
      const className = match === "true" || match === "false" ? "json-boolean" : match === "null" ? "json-null" : "json-number";
      return `<span class="${className}">${match}</span>`;
    },
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
