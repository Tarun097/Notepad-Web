import { createInitialHttpState, normalizeState, restoreHttpWorkspace } from "./httpClient/state";
import { AppState } from "./types";

export const SESSION_STORAGE_KEY = "notepad-plus-web-session";

export function initFromUrlParams(): AppState | undefined {
  const params = new URLSearchParams(window.location.search);
  const content = params.get("content");
  const name = params.get("name");
  if (content === null || !name) {
    return undefined;
  }
  const language = params.get("language") ?? "plaintext";
  const id = crypto.randomUUID();
  window.history.replaceState({}, "", window.location.pathname);
  return {
    tabs: [{ id, name, content, savedContent: "", language: language as AppState["tabs"][number]["language"], lineEnding: "LF" }],
    activeId: id,
    splitId: undefined,
    splitSize: 42,
    theme: "light",
    wrap: false,
    showWhitespace: false,
    fontSize: 13,
    search: { query: "", replacement: "", matchCase: false, regex: false },
  };
}

export function createInitialState(): AppState {
  const id = crypto.randomUUID();
  return {
    tabs: [
      {
        id,
        name: "new 1.txt",
        content: "",
        savedContent: "",
        language: "plaintext",
        lineEnding: "LF",
      },
    ],
    activeId: id,
    splitId: undefined,
    splitSize: 42,
    theme: "light",
    wrap: false,
    showWhitespace: false,
    fontSize: 13,
    search: {
      query: "",
      replacement: "",
      matchCase: false,
      regex: false,
    },
  };
}

export function restoreSession(): AppState | undefined {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.tabs)) {
      return undefined;
    }
    parsed.tabs = parsed.tabs
      .filter((tab) => tab.kind !== "diff")
      .map((tab) =>
        tab.kind === "http"
          ? { ...tab, http: normalizeState(tab.http ?? restoreHttpWorkspace() ?? createInitialHttpState()), handle: undefined }
          : tab.kind === "zip"
          ? { ...tab, handle: undefined }
          : tab.kind === "draw"
          ? { ...tab, handle: undefined }
          : { ...tab, kind: "text", handle: undefined },
      );
    parsed.activeId = parsed.tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId : (parsed.tabs[0]?.id ?? "");
    parsed.splitId =
      parsed.splitId && parsed.tabs.some((tab) => tab.id === parsed.splitId && tab.id !== parsed.activeId)
        ? parsed.splitId
        : undefined;
    parsed.splitSize = clampSplitSize(Number(parsed.splitSize) || 42);
    parsed.fontSize = clampFontSize(Number(parsed.fontSize) || 13);
    return parsed;
  } catch {
    return undefined;
  }
}

export function serializableSession(state: AppState): AppState {
  return {
    ...state,
    tabs: state.tabs.filter((tab) => tab.kind !== "diff").map(({ handle: _handle, ...tab }) => tab),
  };
}

export function clampFontSize(fontSize: number): number {
  return Math.min(72, Math.max(8, Math.round(fontSize)));
}

export function clampSplitSize(size: number): number {
  return Math.min(70, Math.max(25, Math.round(size)));
}
