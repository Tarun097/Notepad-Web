import "./styles.css";

import { buildLineDiff, summarizeDiff } from "./diffEngine";
import { editorTheme, visibleWhitespace } from "./editorExtensions";
import { HttpClientView } from "./httpClient/view";
import { createInitialHttpState, normalizeState, persistHttpWorkspace, restoreHttpWorkspace } from "./httpClient/state";
import { HttpClientState } from "./httpClient/types";
import { ZipExplorerView } from "./zipExplorer/view";
import { DrawView } from "./drawTool/view";
import { searchAllZipFiles, searchSingleZipFile } from "./zipExplorer/state";
import { inferLineEnding, nextUntitledName } from "./tabs";
import { escapeHtml } from "./search";
import { defaultExtensionForLanguage, hasKnownExtension, inferLanguage, languageExtension, languageLabels } from "./languages";
import { addRecentFile, getRecentFiles, removeRecentFileAt } from "./recentFiles";
import {
  detectCompilers,
  canRun,
  resolveLanguage,
  startRunSession,
  pollRunSession,
  sendRunInput,
  stopRunSession,
  isRunnerAvailable,
  getSetupInstructions,
  RunChunk,
} from "./runner";
import {
  SESSION_STORAGE_KEY,
  clampFontSize,
  clampSplitSize,
  createInitialState,
  initFromUrlParams,
  restoreSession,
  serializableSession,
} from "./session";
import {
  AppState,
  CommandDefinition,
  DiffRow,
  DiffState,
  DocumentTab,
  FileHandle,
  LanguageId,
  LineEnding,
  SearchMode,
  SearchScope,
} from "./types";
import { byId, renderAppShell } from "./ui/appShell";

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Line } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  ViewUpdate,
} from "@codemirror/view";

const STORAGE_KEY = SESSION_STORAGE_KEY;
const FILE_HANDLE_DB = "notepad-plus-web-file-handles";
const FILE_HANDLE_STORE = "handles";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

renderAppShell(app);

const elements = {
  tabs: byId<HTMLDivElement>("tabs"),
  splitTabControls: byId<HTMLDivElement>("splitTabControls"),
  editorSplit: byId<HTMLDivElement>("editorSplit"),
  editor: byId<HTMLDivElement>("editor"),
  splitResize: byId<HTMLDivElement>("splitResize"),
  splitPane: byId<HTMLElement>("splitPane"),
  splitEditor: byId<HTMLDivElement>("splitEditor"),
  splitTitle: byId<HTMLSpanElement>("splitTitle"),
  splitSelect: byId<HTMLSelectElement>("splitSelect"),
  diffView: byId<HTMLDivElement>("diffView"),
  httpClientView: byId<HTMLDivElement>("httpClientView"),
  zipExplorerView: byId<HTMLDivElement>("zipExplorerView"),
  drawView: byId<HTMLDivElement>("drawView"),
  openInput: byId<HTMLInputElement>("openInput"),
  languageSelect: byId<HTMLSelectElement>("languageSelect"),
  findInput: byId<HTMLInputElement>("findInput"),
  replaceInput: byId<HTMLInputElement>("replaceInput"),
  matchCaseInput: byId<HTMLInputElement>("matchCaseInput"),
  regexInput: byId<HTMLInputElement>("regexInput"),
  searchMessage: byId<HTMLSpanElement>("searchMessage"),
  findDialog: byId<HTMLDivElement>("findDialog"),
  findModeButton: byId<HTMLButtonElement>("findModeButton"),
  replaceModeButton: byId<HTMLButtonElement>("replaceModeButton"),
  replaceField: byId<HTMLLabelElement>("replaceField"),
  searchResults: byId<HTMLDivElement>("searchResults"),
  searchPanel: byId<HTMLDivElement>("searchPanel"),
  diffLeftSelect: byId<HTMLSelectElement>("diffLeftSelect"),
  diffRightSelect: byId<HTMLSelectElement>("diffRightSelect"),
  diffSummary: byId<HTMLDivElement>("diffSummary"),
  diffResults: byId<HTMLDivElement>("diffResults"),
  statusDocument: byId<HTMLSpanElement>("statusDocument"),
  statusCursor: byId<HTMLSpanElement>("statusCursor"),
  statusEnding: byId<HTMLSpanElement>("statusEnding"),
  statusFontSize: byId<HTMLSpanElement>("statusFontSize"),
  statusLength: byId<HTMLSpanElement>("statusLength"),
  outputPanel: byId<HTMLDivElement>("outputPanel"),
  outputContent: byId<HTMLDivElement>("outputContent"),
  outputText: byId<HTMLPreElement>("outputText"),
  runCodeBtn: byId<HTMLButtonElement>("runCodeBtn"),
  fileMenuBtn: byId<HTMLButtonElement>("fileMenuBtn"),
  fileMenu: byId<HTMLDivElement>("fileMenu"),
  fileMenuContainer: byId<HTMLDivElement>("fileMenuContainer"),
  toolsMenuBtn: byId<HTMLButtonElement>("toolsMenuBtn"),
  toolsMenu: byId<HTMLDivElement>("toolsMenu"),
  toolsMenuContainer: byId<HTMLDivElement>("toolsMenuContainer"),
  commandPalette: byId<HTMLDivElement>("commandPalette"),
  commandInput: byId<HTMLInputElement>("commandInput"),
  goToLineDialog: byId<HTMLDivElement>("goToLineDialog"),
  goToLineInput: byId<HTMLInputElement>("goToLineInput"),
  commandList: byId<HTMLDivElement>("commandList"),
};

for (const [language, label] of Object.entries(languageLabels)) {
  const option = document.createElement("option");
  option.value = language;
  option.textContent = label;
  elements.languageSelect.append(option);
}

let state: AppState = initFromUrlParams() ?? restoreSession() ?? createInitialState();
let editorView: EditorView | undefined;
let splitEditorView: EditorView | undefined;
let lastFocusedSplit = false;
let httpClientView: HttpClientView | undefined;
let zipExplorerView: ZipExplorerView | undefined;
let drawView: DrawView | undefined;
let languageCompartment = new Compartment();
let wrapCompartment = new Compartment();
let whitespaceCompartment = new Compartment();
let themeCompartment = new Compartment();
let splitLanguageCompartment = new Compartment();
let splitWrapCompartment = new Compartment();
let splitWhitespaceCompartment = new Compartment();
let splitThemeCompartment = new Compartment();
let persistTimer: number | undefined;
let searchMode: SearchMode = "find";
let searchResults: SearchResult[] = [];
let searchResultsVisiblePerFileLimit = 500;
let findDialogPosition: { left: number; top: number } | undefined;
let commandResults: CommandDefinition[] = [];
let commandSelectionIndex = 0;
let renderedDiffRows: DiffRow[] = [];
let allDiffRows: DiffRow[] = [];
let diffRowsVisibleLimit = 5000;
let activeDiffRowIndex = -1;
let activeRunSessionId: string | undefined;
let runPollTimer: number | undefined;
let outputBuffer = "";
let pendingRunnerInput = "";
let tabDrag:
  | {
      id: string;
    }
  | undefined;
const DIFF_ROW_HEIGHT = 27;
const DIFF_OVERSCAN = 24;
const DIFF_PAGE_SIZE = 5000;
const SEARCH_RESULTS_PAGE_SIZE = 500;

type SearchRange = { from: number; to: number; text: string; match?: RegExpExecArray };
type SearchResult = { tabId: string; from: number; to: number; line: number; column: number; preview: string; zipPath?: string };
interface SearchResultSet {
  results: SearchResult[];
  total: number;
  perTabCounts: Map<string, number>;
}

mountEditor();
render();
attachEvents();
void restorePersistedHandles();

function persistSession(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableSession(state)));
    } catch {
      setSearchMessage("Session could not be saved locally.");
    }
  }, 250);
}

function toggleFileMenu(): void {
  if (elements.fileMenu.hidden) {
    showFileMenu();
  } else {
    hideFileMenu();
  }
}

function showFileMenu(): void {
  elements.fileMenu.hidden = false;
  hideRecentFilesSubmenu();

  const recentItem = elements.fileMenu.querySelector('[data-file-action="show-recent"]') as HTMLElement | null;
  if (recentItem) {
    const recent = getRecentFiles();
    if (recent.length === 0) {
      recentItem.classList.add("disabled");
      recentItem.classList.remove("has-submenu");
    } else {
      recentItem.classList.remove("disabled");
      recentItem.classList.add("has-submenu");
    }
  }

  const dismiss = (e: MouseEvent) => {
    if (!elements.fileMenuContainer.contains(e.target as Node) && !document.getElementById("recentFilesSubmenu")?.contains(e.target as Node)) {
      hideFileMenu();
      document.removeEventListener("mousedown", dismiss);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
}

function hideFileMenu(): void {
  elements.fileMenu.hidden = true;
  hideRecentFilesSubmenu();
}

function toggleToolsMenu(): void {
  if (elements.toolsMenu.hidden) {
    showToolsMenu();
  } else {
    hideToolsMenu();
  }
}

function showToolsMenu(): void {
  elements.toolsMenu.hidden = false;
  hideJsonSubmenu();
  const dismiss = (e: MouseEvent) => {
    if (!elements.toolsMenuContainer.contains(e.target as Node) && !document.getElementById("jsonSubmenu")?.contains(e.target as Node)) {
      hideToolsMenu();
      document.removeEventListener("mousedown", dismiss);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
}

function hideToolsMenu(): void {
  elements.toolsMenu.hidden = true;
  hideJsonSubmenu();
}

function showJsonSubmenu(): void {
  hideJsonSubmenu();
  const submenu = document.createElement("div");
  submenu.id = "jsonSubmenu";
  submenu.className = "recent-files-menu";
  const items = [
    { label: "Format JSON", action: "format-json" },
    { label: "Flatten JSON", action: "flatten-json" },
  ];
  items.forEach(({ label, action }) => {
    const item = document.createElement("div");
    item.className = "recent-files-item";
    item.textContent = label;
    item.dataset.toolsAction = action;
    item.addEventListener("click", () => {
      hideToolsMenu();
      if (action === "format-json") formatJson();
      else if (action === "flatten-json") flattenJson();
    });
    submenu.appendChild(item);
  });
  const anchor = elements.toolsMenu.querySelector('[data-tools-action="show-json"]');
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    submenu.style.position = "absolute";
    submenu.style.top = `${rect.top}px`;
    submenu.style.left = `${rect.right + 4}px`;
  }
  document.body.appendChild(submenu);
}

function hideJsonSubmenu(): void {
  document.getElementById("jsonSubmenu")?.remove();
}

function showRecentFilesSubmenu(): void {
  hideRecentFilesSubmenu();
  const recent = getRecentFiles();
  if (recent.length === 0) return;

  const submenu = document.createElement("div");
  submenu.id = "recentFilesSubmenu";
  submenu.className = "recent-files-menu";
  recent.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "recent-files-item";
    const nameEl = document.createElement("span");
    nameEl.className = "recent-files-name";
    nameEl.textContent = f.name;
    nameEl.addEventListener("click", () => {
      const existing = state.tabs.find((t) => t.name === f.name);
      if (existing) {
        switchToTab(existing.id);
      } else {
        newTab(f.content, f.name);
        activeTab().language = f.language as LanguageId;
        addRecentFile(f.name, f.content, f.language);
        render();
      }
      hideFileMenu();
    });
    const delBtn = document.createElement("button");
    delBtn.className = "recent-files-delete";
    delBtn.textContent = "🗑";
    delBtn.title = "Remove from recent";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRecentFileAt(i);
      row.remove();
      if (submenu.querySelectorAll(".recent-files-item").length === 0) hideRecentFilesSubmenu();
    });
    row.appendChild(nameEl);
    row.appendChild(delBtn);
    submenu.appendChild(row);
  });

  const recentItem = elements.fileMenu.querySelector('[data-file-action="show-recent"]') as HTMLElement;
  const rect = recentItem.getBoundingClientRect();
  submenu.style.top = `${rect.top}px`;
  submenu.style.left = `${rect.right}px`;
  document.body.appendChild(submenu);
}

function hideRecentFilesSubmenu(): void {
  document.getElementById("recentFilesSubmenu")?.remove();
}

function activeTab(): DocumentTab {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeId);
  if (!tab) {
    throw new Error("No active tab");
  }
  return tab;
}

function hasActiveTab(): boolean {
  return state.tabs.length > 0 && state.tabs.some((t) => t.id === state.activeId);
}

function mountEditor(): void {
  editorView?.destroy();
  splitEditorView?.destroy();
  httpClientView?.destroy();
  httpClientView = undefined;
  splitEditorView = undefined;

  if (!hasActiveTab()) {
    editorView = undefined;
    elements.editor.hidden = true;
    elements.editorSplit.hidden = true;
    elements.diffView.hidden = true;
    elements.httpClientView.hidden = true;
    elements.zipExplorerView.hidden = true;
    elements.drawView.hidden = true;
    elements.outputPanel.hidden = true;
    hideSplitChrome();
    return;
  }

  const tab = activeTab();
  if (isDiffTab(tab)) {
    editorView = undefined;
    elements.editor.hidden = true;
    elements.editorSplit.hidden = true;
    elements.diffView.hidden = false;
    elements.httpClientView.hidden = true;
    elements.zipExplorerView.hidden = true;
    elements.drawView.hidden = true;
    hideSplitChrome();
    renderDiffTab(tab);
    return;
  }

  if (isHttpTab(tab)) {
    editorView = undefined;
    elements.editor.hidden = true;
    elements.editorSplit.hidden = true;
    elements.diffView.hidden = true;
    elements.httpClientView.hidden = false;
    elements.zipExplorerView.hidden = true;
    elements.drawView.hidden = true;
    hideSplitChrome();
    renderHttpClientTab(tab);
    return;
  }

  if (isZipTab(tab)) {
    editorView = undefined;
    elements.editor.hidden = true;
    elements.editorSplit.hidden = true;
    elements.diffView.hidden = true;
    elements.httpClientView.hidden = true;
    elements.zipExplorerView.hidden = false;
    elements.drawView.hidden = true;
    hideSplitChrome();
    renderZipExplorerTab();
    return;
  }

  if (isDrawTab(tab)) {
    editorView = undefined;
    elements.editor.hidden = true;
    elements.editorSplit.hidden = true;
    elements.diffView.hidden = true;
    elements.httpClientView.hidden = true;
    elements.zipExplorerView.hidden = true;
    elements.drawView.hidden = false;
    hideSplitChrome();
    renderDrawTab();
    return;
  }

  elements.editor.hidden = false;
  elements.editorSplit.hidden = false;
  elements.diffView.hidden = true;
  elements.httpClientView.hidden = true;
  elements.zipExplorerView.hidden = true;
  elements.drawView.hidden = true;
  languageCompartment = new Compartment();
  wrapCompartment = new Compartment();
  whitespaceCompartment = new Compartment();
  themeCompartment = new Compartment();

  const selection = tab.selection
    ? EditorSelection.single(
        Math.min(tab.selection.anchor, tab.content.length),
        Math.min(tab.selection.head, tab.content.length),
      )
    : undefined;

  editorView = new EditorView({
    parent: elements.editor,
    state: EditorState.create({
      doc: tab.content,
      selection,
      extensions: [
        lineNumbers({
          domEventHandlers: {
            mousedown: handleLineNumberMouseDown,
          },
        }),
        foldGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        placeholder("Start typing, paste text, or open a file."),
        EditorView.updateListener.of(handleEditorUpdate),
        keymap.of([
          {
            key: "Mod-Shift-l",
            run: createColumnSelection,
          },
          {
            key: "Alt-Shift-i",
            run: createColumnSelection,
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        languageCompartment.of(languageExtension(tab.language)),
        wrapCompartment.of(state.wrap ? EditorView.lineWrapping : []),
        whitespaceCompartment.of(state.showWhitespace ? visibleWhitespace() : []),
        themeCompartment.of(editorTheme(state.theme, state.fontSize)),
      ],
    }),
  });

  mountSplitEditor();
}

function hideSplitChrome(): void {
  elements.splitPane.hidden = true;
  elements.splitResize.hidden = true;
  elements.splitTabControls.hidden = true;
  elements.editorSplit.classList.remove("has-split");
  elements.editorSplit.style.removeProperty("--split-size");
}

function mountSplitEditor(): void {
  splitEditorView?.destroy();
  splitEditorView = undefined;

  const splitTab = splitTabForView();
  if (!splitTab) {
    hideSplitChrome();
    return;
  }

  elements.splitPane.hidden = false;
  elements.splitResize.hidden = false;
  elements.splitTabControls.hidden = false;
  elements.editorSplit.classList.add("has-split");
  elements.editorSplit.style.setProperty("--split-size", `${state.splitSize}%`);
  elements.splitTitle.textContent = `${splitTab.name}${isDirty(splitTab) ? " *" : ""}`;
  renderSplitSelect();

  splitLanguageCompartment = new Compartment();
  splitWrapCompartment = new Compartment();
  splitWhitespaceCompartment = new Compartment();
  splitThemeCompartment = new Compartment();

  const selection = splitTab.selection
    ? EditorSelection.single(
        Math.min(splitTab.selection.anchor, splitTab.content.length),
        Math.min(splitTab.selection.head, splitTab.content.length),
      )
    : undefined;

  splitEditorView = new EditorView({
    parent: elements.splitEditor,
    state: EditorState.create({
      doc: splitTab.content,
      selection,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.updateListener.of(handleSplitEditorUpdate),
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        splitLanguageCompartment.of(languageExtension(splitTab.language)),
        splitWrapCompartment.of(state.wrap ? EditorView.lineWrapping : []),
        splitWhitespaceCompartment.of(state.showWhitespace ? visibleWhitespace() : []),
        splitThemeCompartment.of(editorTheme(state.theme, state.fontSize)),
      ],
    }),
  });
}

function splitTabForView(): DocumentTab | undefined {
  if (!state.splitId || state.splitId === state.activeId) {
    return undefined;
  }
  const tab = state.tabs.find((candidate) => candidate.id === state.splitId);
  return tab && isTextTab(tab) ? tab : undefined;
}

function renderSplitSelect(): void {
  const options = textTabs()
    .filter((tab) => tab.id !== state.activeId)
    .map((tab) => {
      const option = document.createElement("option");
      option.value = tab.id;
      option.textContent = `${tab.name}${isDirty(tab) ? " *" : ""}`;
      return option;
    });
  elements.splitSelect.replaceChildren(...options);
  elements.splitSelect.value = state.splitId ?? "";
}

function handleEditorUpdate(update: ViewUpdate): void {
  if (!editorView) {
    return;
  }

  const tab = activeTab();
  const selection = update.state.selection.main;
  tab.selection = { anchor: selection.anchor, head: selection.head };

  if (update.docChanged) {
    tab.content = update.state.doc.toString();
    renderTabs();
    persistSession();
  }

  if (update.docChanged || update.selectionSet) {
    renderColumnState();
    renderStatus();
  }
}

function handleSplitEditorUpdate(update: ViewUpdate): void {
  if (!splitEditorView || !state.splitId) {
    return;
  }

  const tab = splitTabForView();
  if (!tab) {
    return;
  }

  const selection = update.state.selection.main;
  tab.selection = { anchor: selection.anchor, head: selection.head };

  if (update.docChanged) {
    tab.content = update.state.doc.toString();
    elements.splitTitle.textContent = `${tab.name}${isDirty(tab) ? " *" : ""}`;
    renderTabs();
    renderSplitSelect();
    persistSession();
  }
}

function render(): void {
  document.documentElement.dataset.theme = state.theme;
  renderTabs();
  renderControls();
  renderStatus();
  updateRunButton();
  persistSession();
}

function renderTabs(): void {
  const newTabBtn = document.createElement("button");
  newTabBtn.className = "tab new-tab-btn";
  newTabBtn.type = "button";
  newTabBtn.title = "New file (Cmd/Ctrl+N)";
  newTabBtn.dataset.action = "new";
  newTabBtn.textContent = "+";
  elements.tabs.replaceChildren(
    ...state.tabs.map((tab) => {
      const button = document.createElement("button");
      button.className = `tab ${tab.id === state.activeId ? "active" : ""} ${isDirty(tab) ? "dirty" : ""}`;
      button.type = "button";
      button.role = "tab";
      button.draggable = true;
      button.ariaSelected = String(tab.id === state.activeId);
      button.dataset.tabId = tab.id;
      button.title = tab.name;
      button.innerHTML = `<span>${escapeHtml(tab.name)}</span><span class="dirty-dot" aria-hidden="true"></span><span class="tab-duplicate" data-duplicate-tab="${tab.id}" title="Duplicate">&#10697;</span><span class="tab-close" data-close-tab="${tab.id}" title="Close">&times;</span>`;
      return button;
    }),
    newTabBtn,
  );
}

function renderControls(): void {
  if (!hasActiveTab()) {
    elements.languageSelect.value = "plaintext";
    elements.languageSelect.disabled = true;
    return;
  }
  const tab = activeTab();
  const splitTab = splitTabForView();
  const displayTab = (lastFocusedSplit && splitTab) ? splitTab : tab;
  elements.languageSelect.value = isTextTab(displayTab) ? displayTab.language : "plaintext";
  elements.languageSelect.disabled = !isTextTab(displayTab);
  elements.findInput.value = state.search.query;
  elements.replaceInput.value = state.search.replacement;
  elements.matchCaseInput.checked = state.search.matchCase;
  elements.regexInput.checked = state.search.regex;
  renderFindMode();
  renderColumnState();
  document.querySelector<HTMLButtonElement>('[data-action="wrap"]')?.classList.toggle("active", state.wrap);
  document.querySelector<HTMLButtonElement>('[data-action="whitespace"]')?.classList.toggle("active", state.showWhitespace);
  document.querySelector<HTMLButtonElement>('[data-action="theme"]')?.classList.toggle("active", state.theme === "dark");
  document.querySelector<HTMLButtonElement>('[data-action="split"]')?.classList.toggle("active", Boolean(splitTabForView()));
  const themeBtn = document.querySelector<HTMLButtonElement>("#themeBtn");
  if (themeBtn) themeBtn.innerHTML = state.theme === "dark" ? "☀️" : "<b>&#9790;</b>";
  renderDiffSelectors();
}

function renderDiffSelectors(): void {
  const candidates = textTabs();
  const currentLeft = elements.diffLeftSelect.value || (isDiffTab(activeTab()) ? activeTab().diff?.leftId : state.activeId) || candidates[0]?.id || "";
  const currentRight =
    elements.diffRightSelect.value ||
    (isDiffTab(activeTab()) ? activeTab().diff?.rightId : undefined) ||
    candidates.find((tab) => tab.id !== currentLeft)?.id ||
    currentLeft;

  const options = candidates.map((tab) => {
    const option = document.createElement("option");
    option.value = tab.id;
    option.textContent = `${tab.name}${isDirty(tab) ? " *" : ""}`;
    return option;
  });

  elements.diffLeftSelect.replaceChildren(...options.map((option) => option.cloneNode(true)));
  elements.diffRightSelect.replaceChildren(...options.map((option) => option.cloneNode(true)));
  elements.diffLeftSelect.value = candidates.some((tab) => tab.id === currentLeft) ? currentLeft : candidates[0]?.id || "";
  elements.diffRightSelect.value = candidates.some((tab) => tab.id === currentRight)
    ? currentRight
    : candidates.find((tab) => tab.id !== elements.diffLeftSelect.value)?.id || elements.diffLeftSelect.value;
}

function renderFindMode(): void {
  const replaceMode = searchMode === "replace";
  elements.findModeButton.classList.toggle("active", !replaceMode);
  elements.replaceModeButton.classList.toggle("active", replaceMode);
  elements.findModeButton.ariaSelected = String(!replaceMode);
  elements.replaceModeButton.ariaSelected = String(replaceMode);
  elements.replaceField.hidden = !replaceMode;
  document.querySelectorAll<HTMLElement>(".replace-only").forEach((element) => {
    element.hidden = !replaceMode;
  });
}

function renderStatus(): void {
  if (!hasActiveTab()) {
    elements.statusDocument.textContent = "";
    elements.statusCursor.textContent = "";
    elements.statusEnding.textContent = "";
    elements.statusFontSize.textContent = `${state.fontSize}px`;
    elements.statusLength.textContent = "";
    return;
  }
  const tab = activeTab();
  if (isHttpTab(tab)) {
    elements.statusDocument.textContent = tab.name;
    elements.statusCursor.textContent = "HTTP client";
    elements.statusEnding.textContent = "-";
    elements.statusFontSize.textContent = `${state.fontSize}px`;
    elements.statusLength.textContent = `${tab.http?.collections.length ?? 0} collections`;
    return;
  }
  if (isDiffTab(tab)) {
    const rows = tab.diff?.rows.length ?? 0;
    elements.statusDocument.textContent = tab.name;
    elements.statusCursor.textContent = "Diff view";
    elements.statusEnding.textContent = "-";
    elements.statusFontSize.textContent = `${state.fontSize}px`;
    elements.statusLength.textContent = `${rows} rows`;
    return;
  }

  if (!editorView) {
    return;
  }
  const selection = editorView.state.selection.main;
  const line = editorView.state.doc.lineAt(selection.head);
  const col = selection.head - line.from + 1;
  const selected = Math.abs(selection.head - selection.anchor);
  const selectionCount = editorView.state.selection.ranges.length;

  elements.statusDocument.textContent = `${tab.name}${isDirty(tab) ? " *" : ""}`;
  elements.statusCursor.textContent = `Ln ${line.number}, Col ${col}${selected ? `, Sel ${selected}` : ""}${
    selectionCount > 1 ? `, ${selectionCount} cursors` : ""
  }`;
  elements.statusEnding.textContent = tab.lineEnding;
  elements.statusFontSize.textContent = `${state.fontSize}px`;
  elements.statusLength.textContent = `${tab.content.length} chars`;
}

function renderColumnState(): void {
  const isActive = (editorView?.state.selection.ranges.length ?? 0) > 1;
  const button = document.querySelector<HTMLButtonElement>('[data-action="column"]');
  button?.classList.toggle("active", isActive);
  button?.setAttribute("aria-pressed", String(isActive));
}

function attachEvents(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    const tabId = target.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
    const resultIndex = target.closest<HTMLElement>("[data-result-index]")?.dataset.resultIndex;
    const commandIndex = target.closest<HTMLElement>("[data-command-index]")?.dataset.commandIndex;

    if (commandIndex !== undefined) {
      commandSelectionIndex = Number(commandIndex);
      void runSelectedCommand();
      return;
    }

    if (resultIndex !== undefined) {
      return;
    }

    if (tabId) {
      const duplicateTabId = target.closest<HTMLElement>("[data-duplicate-tab]")?.dataset.duplicateTab;
      if (duplicateTabId) {
        event.stopPropagation();
        duplicateTab(duplicateTabId);
        return;
      }
      const closeTabId = target.closest<HTMLElement>("[data-close-tab]")?.dataset.closeTab;
      if (closeTabId) {
        event.stopPropagation();
        closeTab(closeTabId);
        return;
      }
      switchToTab(tabId);
      return;
    }

    if (!action) {
      return;
    }

    void handleAction(action);
  });

  elements.tabs.addEventListener("dblclick", (event) => {
    const target = event.target as HTMLElement;
    const tabEl = target.closest<HTMLElement>("[data-tab-id]");
    const tabId = tabEl?.dataset.tabId;
    if (!tabId || !tabEl) return;
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || !isTextTab(tab)) return;
    const nameSpan = tabEl.querySelector("span:first-child") as HTMLElement;
    if (!nameSpan) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tab-rename-input";
    input.value = tab.name;
    input.style.cssText = "width:100%;border:none;outline:none;background:var(--surface);color:inherit;font:inherit;padding:0;margin:0;";
    nameSpan.textContent = "";
    nameSpan.appendChild(input);
    input.select();
    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== tab.name) {
        if (tab.handle) {
          tab._renamedFrom = tab.handle.name;
        }
        tab.name = newName;
        tab.language = inferLanguage(tab.name);
        tab.handle = undefined;
        tab.savedContent = "";
        void removePersistedHandle(tab.id);
        mountEditor();
      }
      render();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { input.value = tab.name; input.blur(); }
    });
    input.focus();
  });

  elements.tabs.addEventListener("dragstart", (event) => {
    const target = event.target as HTMLElement;
    const tabId = target.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
    if (!tabId) {
      event.preventDefault();
      return;
    }
    captureActiveEditor();
    tabDrag = { id: tabId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab) {
        const params = new URLSearchParams({ name: tab.name, content: tab.content, language: tab.language });
        event.dataTransfer.setData("text/uri-list", window.location.origin + window.location.pathname + "?" + params.toString());
        event.dataTransfer.setData("text/plain", window.location.origin + window.location.pathname + "?" + params.toString());
      }
    }
    requestAnimationFrame(() => {
      elements.tabs.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)?.classList.add("dragging");
    });
  });

  elements.tabs.addEventListener("dragover", (event) => {
    if (!tabDrag) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    renderTabDropMarker(event.clientX);
  });

  elements.tabs.addEventListener("dragleave", (event) => {
    if (!tabDrag) {
      return;
    }
    const related = event.relatedTarget as HTMLElement | null;
    if (!related || !elements.tabs.contains(related)) {
      elements.tabs.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
        tab.classList.remove("drop-before");
      });
    }
  });

  elements.tabs.addEventListener("drop", (event) => {
    if (!tabDrag) {
      return;
    }
    event.preventDefault();
    const drag = tabDrag;
    const insertionIndex = tabInsertionIndexAt(event.clientX, drag.id);
    clearTabDragState();
    if (insertionIndex < 0) {
      return;
    }
    reorderTab(drag.id, insertionIndex);
  });

  elements.tabs.addEventListener("dragend", () => {
    clearTabDragState();
  });

  elements.languageSelect.addEventListener("change", () => {
    if (!hasActiveTab()) return;
    const language = elements.languageSelect.value as LanguageId;
    if (lastFocusedSplit && splitEditorView) {
      const splitTab = splitTabForView();
      if (splitTab) {
        splitTab.language = language;
        splitEditorView.dispatch({ effects: splitLanguageCompartment.reconfigure(languageExtension(language)) });
      }
    } else {
      const tab = activeTab();
      tab.language = language;
      editorView?.dispatch({ effects: languageCompartment.reconfigure(languageExtension(language)) });
    }
    render();
  });

  elements.fileMenuBtn.addEventListener("click", () => {
    toggleFileMenu();
  });

  elements.fileMenu.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-file-action]")?.dataset.fileAction;
    if (!action) return;
    if (action === "show-recent") {
      showRecentFilesSubmenu();
      return;
    }
    hideFileMenu();
    void handleAction(action);
  });

  elements.toolsMenuBtn.addEventListener("click", () => {
    toggleToolsMenu();
  });

  elements.toolsMenu.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-tools-action]")?.dataset.toolsAction;
    if (!action) return;
    if (action === "show-json") {
      showJsonSubmenu();
      return;
    }
    hideToolsMenu();
    if (action === "diff") openDiffDialog();
    else if (action === "draw") openDrawTab();
    else if (action === "http-client") openHttpClientTab();
    else if (action === "zip-explorer") openZipExplorerTab();
    else if (action === "format-json") formatJson();
    else if (action === "flatten-json") flattenJson();
  });

  elements.splitSelect.addEventListener("change", () => {
    captureSplitEditor();
    state.splitId = elements.splitSelect.value || undefined;
    mountSplitEditor();
    render();
  });

  elements.commandInput.addEventListener("input", () => {
    renderCommandList();
  });

  elements.commandInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCommandSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCommandSelection(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void runSelectedCommand();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    }
  });

  elements.openInput.addEventListener("change", async () => {
    const files = Array.from(elements.openInput.files ?? []);
    elements.openInput.value = "";
    await openFiles(files);
  });

  elements.findInput.addEventListener("input", () => {
    state.search.query = elements.findInput.value;
    persistSession();
  });

  elements.replaceInput.addEventListener("input", () => {
    state.search.replacement = elements.replaceInput.value;
    persistSession();
  });

  elements.matchCaseInput.addEventListener("change", () => {
    state.search.matchCase = elements.matchCaseInput.checked;
    persistSession();
  });

  elements.regexInput.addEventListener("change", () => {
    state.search.regex = elements.regexInput.checked;
    persistSession();
  });

  elements.goToLineInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commitGoToLine(); }
    if (event.key === "Escape") { event.preventDefault(); closeGoToLine(); editorView?.focus(); }
  });

  elements.goToLineDialog.addEventListener("click", (event) => {
    if (event.target === elements.goToLineDialog) { closeGoToLine(); editorView?.focus(); }
  });

  document.querySelector<HTMLElement>(".search-panel-resize")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const panel = elements.searchPanel;
    const startY = (event as PointerEvent).clientY;
    const startHeight = panel.offsetHeight;
    const onMove = (e: PointerEvent): void => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(80, Math.min(window.innerHeight * 0.95, startHeight + delta));
      panel.style.height = `${newHeight}px`;
    };
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove as EventListener);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove as EventListener);
    document.addEventListener("pointerup", onUp);
  });

  elements.searchResults.addEventListener("dblclick", (event) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>("[data-result-index]")?.dataset.resultIndex;
    if (index !== undefined) jumpToSearchResult(Number(index));
  });

  elements.searchResults.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>(".zip-load-more-file");
    if (!btn) return;
    event.stopPropagation();
    event.preventDefault();
    const path = btn.dataset.zipLoadMorePath;
    const shown = Number(btn.dataset.zipLoadMoreShown || 0);
    if (!path) return;
    btn.textContent = "Loading...";
    btn.setAttribute("disabled", "");
    searchSingleZipFile(path, state.search.query, state.search.matchCase, state.search.regex, shown, 500).then((newHits) => {
      const group = btn.closest(".result-file-group");
      if (!group) return;
      group.setAttribute("open", "");
      const tab = activeTab();
      for (const item of newHits) {
        const idx = searchResults.length;
        searchResults.push({ tabId: tab.id, from: item.from, to: item.to, line: item.line, column: item.column, preview: item.preview, zipPath: item.path });
        const div = document.createElement("div");
        div.className = "result-item";
        div.dataset.resultIndex = String(idx);
        div.innerHTML = `<span class="result-location">Ln ${item.line}, Col ${item.column}</span><span class="result-preview">${escapeHtml(item.preview)}</span>`;
        group.appendChild(div);
      }
      const newShown = shown + newHits.length;
      const summary = group.querySelector(".result-file-header");
      const totalMatch = summary?.textContent?.match(/of (\d+)/);
      const fileTotal = totalMatch ? Number(totalMatch[1]) : newShown;
      if (newShown >= fileTotal || newHits.length === 0) {
        btn.remove();
        if (summary) summary.textContent = `${path} (${newShown} of ${fileTotal})`;
      } else {
        btn.dataset.zipLoadMoreShown = String(newShown);
        btn.textContent = `Load more (${fileTotal - newShown} remaining)`;
        btn.removeAttribute("disabled");
        if (summary) summary.innerHTML = `${escapeHtml(path)} (${newShown} of ${fileTotal})`;
        summary?.appendChild(btn);
      }
    });
  });

  elements.searchResults.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>(".tab-load-more-file");
    if (!btn) return;
    event.stopPropagation();
    event.preventDefault();
    const tabId = btn.dataset.tabLoadMoreId;
    const shown = Number(btn.dataset.tabLoadMoreShown || 0);
    if (!tabId) return;
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    btn.textContent = "Loading...";
    btn.setAttribute("disabled", "");
    const ranges = rangesInText(tab.content, 500, shown);
    const group = btn.closest(".result-file-group");
    if (!group) return;
    group.setAttribute("open", "");
    for (const range of ranges) {
      const result = rangeToSearchResult(tab, tab.content, range);
      const idx = searchResults.length;
      searchResults.push(result);
      const div = document.createElement("div");
      div.className = "result-item";
      div.dataset.resultIndex = String(idx);
      div.innerHTML = `<span class="result-location">Ln ${result.line}, Col ${result.column}</span><span class="result-preview">${escapeHtml(result.preview)}</span>`;
      group.appendChild(div);
    }
    const newShown = shown + ranges.length;
    const tabTotal = countRangesInText(tab.content);
    const summary = group.querySelector(".result-file-header");
    const displayName = isZipTab(tab) && zipExplorerView?.selectedPath ? zipExplorerView.selectedPath : tab.name;
    if (newShown >= tabTotal || ranges.length === 0) {
      btn.remove();
      if (summary) summary.innerHTML = `<span>${escapeHtml(displayName)} (${newShown} of ${tabTotal} hits)</span>`;
    } else {
      btn.dataset.tabLoadMoreShown = String(newShown);
      btn.textContent = `Load more (${tabTotal - newShown} remaining)`;
      btn.removeAttribute("disabled");
      const span = summary?.querySelector("span");
      if (span) span.textContent = `${displayName} (${newShown} of ${tabTotal} hits)`;
    }
  });

  elements.searchResults.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "a") {
      event.preventDefault();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(elements.searchResults);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });

  document.querySelector<HTMLElement>(".output-panel-resize")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const panel = elements.outputPanel;
    const startY = (event as PointerEvent).clientY;
    const startHeight = panel.offsetHeight;
    const onMove = (e: PointerEvent): void => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(80, Math.min(window.innerHeight * 0.9, startHeight + delta));
      panel.style.height = `${newHeight}px`;
    };
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove as EventListener);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove as EventListener);
    document.addEventListener("pointerup", onUp);
  });

  elements.splitResize.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const pointerEvent = event as PointerEvent;
    elements.splitResize.setPointerCapture(pointerEvent.pointerId);
    elements.editorSplit.classList.add("resizing");

    const onMove = (e: PointerEvent): void => {
      const rect = elements.editorSplit.getBoundingClientRect();
      const stacked = window.matchMedia("(max-width: 920px)").matches;
      const size = stacked
        ? ((rect.bottom - e.clientY) / rect.height) * 100
        : ((rect.right - e.clientX) / rect.width) * 100;
      state.splitSize = clampSplitSize(size);
      elements.editorSplit.style.setProperty("--split-size", `${state.splitSize}%`);
    };

    const onUp = (): void => {
      elements.editorSplit.classList.remove("resizing");
      elements.splitResize.removeEventListener("pointermove", onMove);
      elements.splitResize.removeEventListener("pointerup", onUp);
      elements.splitResize.removeEventListener("pointercancel", onUp);
      persistSession();
    };

    elements.splitResize.addEventListener("pointermove", onMove);
    elements.splitResize.addEventListener("pointerup", onUp);
    elements.splitResize.addEventListener("pointercancel", onUp);
  });


  document.querySelector<HTMLElement>("#findDialog .dialog-header")?.addEventListener("pointerdown", (event) => {
    startFloatingDialogDrag(event, elements.findDialog, (position) => {
      findDialogPosition = position;
    });
  });

  elements.findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findText(event.shiftKey ? -1 : 1);
    }
  });

  elements.replaceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      replaceOne();
    }
  });

  elements.outputContent.addEventListener("keydown", (event) => {
    void handleRunnerConsoleKeydown(event);
  });

  elements.outputContent.addEventListener("paste", (event) => {
    handleRunnerConsolePaste(event);
  });

  elements.editor.addEventListener("focusin", () => { lastFocusedSplit = false; renderControls(); });
  elements.splitEditor.addEventListener("focusin", () => { lastFocusedSplit = true; renderControls(); });

  elements.editor.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      zoomEditor(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (!elements.commandPalette.hidden) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (!mod) {
      return;
    }

    if (event.key.toLowerCase() === "p" && event.shiftKey) {
      event.preventDefault();
      openCommandPalette();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      newTab();
    } else if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      void openFromPicker();
    } else if (event.key.toLowerCase() === "s" && event.shiftKey) {
      event.preventDefault();
      void saveActiveAs();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveActive();
    } else if (event.key.toLowerCase() === "w") {
      event.preventDefault();
      closeActiveTab();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFindDialog("find");
    } else if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      openFindDialog("replace");
    } else if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      goToLine();
    } else if (event.key.toLowerCase() === "j" && event.shiftKey) {
      event.preventDefault();
      formatJson();
    } else if (event.key.toLowerCase() === "d" && event.shiftKey) {
      event.preventDefault();
      openDiffDialog();
    } else if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      zoomEditor(1);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomEditor(-1);
    } else if (event.key === "0") {
      event.preventDefault();
      setEditorFontSize(13);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.commandPalette.hidden) {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === "Escape" && !elements.findDialog.hidden) {
      event.preventDefault();
      closeFindDialog();
    }
  });
}

async function handleAction(action: string): Promise<void> {
  switch (action) {
    case "new":
      newTab();
      break;
    case "open":
      await openFromPicker();
      break;
    case "save":
      await saveActive();
      break;
    case "save-as":
      await saveActiveAs();
      break;
    case "duplicate":
      duplicateActive();
      break;
    case "format-json":
      formatJson();
      break;
    case "diff":
      openDiffDialog();
      break;
    case "draw":
      openDrawTab();
      break;
    case "http-client":
      openHttpClientTab();
      break;
    case "zip-explorer":
      openZipExplorerTab();
      break;
    case "close":
      closeActiveTab();
      break;
    case "wrap":
      toggleWrap();
      break;
    case "whitespace":
      toggleWhitespace();
      break;
    case "theme":
      toggleTheme();
      break;
    case "column":
      createColumnSelection();
      break;
    case "split":
      toggleSplitEditor();
      break;
    case "close-split":
      closeSplitEditor();
      break;
    case "command-palette":
      openCommandPalette();
      break;
    case "close-find":
      closeFindDialog();
      break;
    case "close-search-panel":
      closeSearchPanel();
      break;
    case "load-more-search-results":
      loadMoreSearchResults();
      break;
    case "load-more-diff-rows":
      loadMoreDiffRows();
      break;
    case "find-mode":
      openFindDialog("find");
      break;
    case "replace-mode":
      openFindDialog("replace");
      break;
    case "find-next":
      findText(1);
      break;
    case "find-prev":
      findText(-1);
      break;
    case "find-all":
      findAll();
      break;
    case "replace-one":
      replaceOne();
      break;
    case "replace-all":
      replaceAllMatches();
      break;
    case "compare-diff":
      compareSelectedTabs();
      break;
    case "swap-diff":
      swapDiffSides();
      break;
    case "prev-diff":
      navigateDiff(-1);
      break;
    case "next-diff":
      navigateDiff(1);
      break;
    case "run-code":
      executeCode();
      break;
    case "close-output-panel":
      closeOutputPanel();
      break;
  }
}

function commandDefinitions(): CommandDefinition[] {
  const active = activeTab();
  const commands: CommandDefinition[] = [
    { id: "new", label: "New File", hint: "Cmd/Ctrl+N", run: () => newTab() },
    { id: "open", label: "Open File", hint: "Cmd/Ctrl+O", run: () => openFromPicker() },
    { id: "save", label: "Save", hint: "Cmd/Ctrl+S", run: () => saveActive() },
    { id: "save-as", label: "Save As", hint: "Cmd/Ctrl+Shift+S", run: () => saveActiveAs() },
    { id: "duplicate", label: "Duplicate Current Tab", hint: "Tab action", run: () => duplicateActive() },
    { id: "close", label: "Close Current Tab", hint: "Cmd/Ctrl+W", run: () => closeActiveTab() },
    { id: "find", label: "Find", hint: "Cmd/Ctrl+F", run: () => openFindDialog("find") },
    { id: "replace", label: "Replace", hint: "Cmd/Ctrl+H", run: () => openFindDialog("replace") },
    { id: "format-json", label: "Format JSON", hint: "Tools", run: () => formatJson() },
    { id: "flatten-json", label: "Flatten JSON", hint: "Tools", run: () => flattenJson() },
    { id: "go-to-line", label: "Go to Line", hint: "Cmd/Ctrl+G", run: () => goToLine() },
    { id: "diff", label: "Open Diff", hint: "Tools", run: () => openDiffDialog() },
    { id: "draw", label: "Open Draw", hint: "Tools", run: () => openDrawTab() },
    { id: "http-client", label: "Open HTTP Client", hint: "Tools", run: () => openHttpClientTab() },
    { id: "zip-explorer", label: "Open Zip Explorer", hint: "Tools", run: () => openZipExplorerTab() },
    { id: "split", label: splitTabForView() ? "Close Split Editor" : "Open Split Editor", hint: "View", run: () => toggleSplitEditor() },
    { id: "wrap", label: state.wrap ? "Disable Word Wrap" : "Enable Word Wrap", hint: "View", run: () => toggleWrap() },
    {
      id: "whitespace",
      label: state.showWhitespace ? "Hide Whitespace" : "Show Whitespace",
      hint: "View",
      run: () => toggleWhitespace(),
    },
    { id: "theme", label: state.theme === "dark" ? "Use Light Theme" : "Use Dark Theme", hint: "View", run: () => toggleTheme() },
    { id: "zoom-in", label: "Zoom In", hint: "Cmd/Ctrl++", run: () => zoomEditor(1) },
    { id: "zoom-out", label: "Zoom Out", hint: "Cmd/Ctrl+-", run: () => zoomEditor(-1) },
    { id: "zoom-reset", label: "Reset Zoom", hint: "Cmd/Ctrl+0", run: () => setEditorFontSize(13) },
  ];

  if (isTextTab(active) && resolveLanguage(active.language, active.name)) {
    commands.push({ id: "run-code", label: "Run Code", hint: "Runner", run: () => executeCode() });
  }

  return commands;
}

function openCommandPalette(): void {
  commandSelectionIndex = 0;
  elements.commandInput.value = "";
  elements.commandPalette.hidden = false;
  renderCommandList();
  window.setTimeout(() => {
    elements.commandInput.focus();
    elements.commandInput.select();
  });
}

function closeCommandPalette(): void {
  elements.commandPalette.hidden = true;
  editorView?.focus();
}

function renderCommandList(): void {
  const query = elements.commandInput.value.trim().toLowerCase();
  commandResults = commandDefinitions().filter((command) => {
    const haystack = `${command.label} ${command.hint}`.toLowerCase();
    return query.length === 0 || haystack.includes(query);
  });
  commandSelectionIndex = Math.min(commandSelectionIndex, Math.max(0, commandResults.length - 1));

  if (commandResults.length === 0) {
    const empty = document.createElement("div");
    empty.className = "command-empty";
    empty.textContent = "No commands";
    elements.commandList.replaceChildren(empty);
    return;
  }

  elements.commandList.replaceChildren(
    ...commandResults.map((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `command-item ${index === commandSelectionIndex ? "active" : ""}`;
      button.dataset.commandIndex = String(index);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === commandSelectionIndex));
      const label = document.createElement("span");
      label.textContent = command.label;
      const hint = document.createElement("span");
      hint.textContent = command.hint;
      button.append(label, hint);
      return button;
    }),
  );
}

function moveCommandSelection(delta: 1 | -1): void {
  if (commandResults.length === 0) {
    return;
  }
  commandSelectionIndex = (commandSelectionIndex + delta + commandResults.length) % commandResults.length;
  renderCommandList();
  elements.commandList.querySelector<HTMLElement>(".command-item.active")?.scrollIntoView({ block: "nearest" });
}

async function runSelectedCommand(): Promise<void> {
  const command = commandResults[commandSelectionIndex];
  if (!command) {
    return;
  }
  closeCommandPalette();
  await command.run();
}

function switchToTab(tabId: string): void {
  if (tabId === state.activeId) {
    editorView?.focus();
    return;
  }

  captureActiveEditor();
  captureSplitEditor();
  state.activeId = tabId;
  if (state.splitId === tabId) {
    state.splitId = firstSplitCandidateId();
  }
  mountEditor();
  render();
  editorView?.focus();
}

function captureActiveEditor(): void {
  if (!editorView || !hasActiveTab() || isDiffTab(activeTab()) || isHttpTab(activeTab())) {
    return;
  }
  const tab = activeTab();
  tab.content = editorView.state.doc.toString();
  const selection = editorView.state.selection.main;
  tab.selection = { anchor: selection.anchor, head: selection.head };
}

function captureSplitEditor(): void {
  const tab = splitTabForView();
  if (!splitEditorView || !tab) {
    return;
  }
  tab.content = splitEditorView.state.doc.toString();
  const selection = splitEditorView.state.selection.main;
  tab.selection = { anchor: selection.anchor, head: selection.head };
}

function newTab(content = "", name?: string, handle?: FileHandle): void {
  captureActiveEditor();
  captureSplitEditor();
  const id = crypto.randomUUID();
  const tab: DocumentTab = {
    id,
    name: name ?? nextUntitledName(state.tabs.map((t) => t.name)),
    content,
    savedContent: content,
    language: inferLanguage(name ?? "txt"),
    lineEnding: inferLineEnding(content),
    kind: "text",
    handle,
  };
  state.tabs.push(tab);
  state.activeId = id;
  mountEditor();
  render();
  editorView?.focus();
}

function duplicateActive(): void {
  duplicateTab(state.activeId);
}

function duplicateTab(tabId: string): void {
  captureActiveEditor();
  captureSplitEditor();
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    return;
  }
  if (isDiffTab(tab)) {
    if (tab.id !== state.activeId) {
      switchToTab(tab.id);
    }
    openDiffTab();
    return;
  }
  if (isHttpTab(tab)) {
    if (tab.id !== state.activeId) {
      switchToTab(tab.id);
    }
    openHttpClientTab(tab.http);
    return;
  }
  newTab(tab.content, `${tab.name}-copy`);
  activeTab().savedContent = "";
}

function closeTab(tabId: string): void {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (isDirty(tab) && !confirm(`Close "${tab.name}" without saving changes?`)) return;

  const index = state.tabs.findIndex((t) => t.id === tabId);
  state.tabs.splice(index, 1);

  if (!elements.searchPanel.hidden) {
    if (isZipTab(tab) || (isTextTab(tab) && textTabs().length === 0)) {
      closeSearchPanel();
    } else if (isTextTab(tab)) {
      elements.searchPanel.style.height = "";
      findAll();
    }
  }
  if (state.activeId === tabId) {
    state.activeId = state.tabs.length > 0 ? state.tabs[Math.max(0, index - 1)].id : "";
  }
  if (state.splitId === tabId || state.splitId === state.activeId) {
    state.splitId = firstSplitCandidateId();
  }
  mountEditor();
  render();
}

function closeActiveTab(): void {
  closeTab(state.activeId);
}

function reorderTab(sourceId: string, insertionIndex: number): void {
  const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceId);
  if (sourceIndex < 0 || insertionIndex < 0 || sourceIndex === insertionIndex) {
    return;
  }

  [state.tabs[sourceIndex], state.tabs[insertionIndex]] = [state.tabs[insertionIndex], state.tabs[sourceIndex]];
  renderTabs();
  persistSession();
}

function tabInsertionIndexAt(clientX: number, sourceId: string): number {
  const tabs = Array.from(elements.tabs.querySelectorAll<HTMLElement>("[data-tab-id]")).filter(
    (tab) => tab.dataset.tabId !== sourceId,
  );

  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientX >= rect.left && clientX < rect.right) {
      return state.tabs.findIndex((candidate) => candidate.id === tab.dataset.tabId);
    }
  }

  return -1;
}

function renderTabDropMarker(clientX: number): void {
  if (!tabDrag) {
    return;
  }

  elements.tabs.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.classList.remove("drop-before");
  });

  const tabs = Array.from(elements.tabs.querySelectorAll<HTMLElement>("[data-tab-id]")).filter(
    (tab) => tab.dataset.tabId !== tabDrag?.id,
  );
  if (tabs.length === 0) {
    return;
  }

  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientX >= rect.left && clientX < rect.right) {
      tab.classList.add("drop-before");
      return;
    }
  }
}

function clearTabDragState(): void {
  tabDrag = undefined;
  elements.tabs.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.classList.remove("dragging", "drop-before");
  });
}

function toggleSplitEditor(): void {
  if (splitTabForView()) {
    closeSplitEditor();
    return;
  }

  const candidate = firstSplitCandidateId();
  if (!candidate) {
    notify("Open another text tab to split the editor.");
    return;
  }

  captureActiveEditor();
  state.splitId = candidate;
  mountSplitEditor();
  render();
}

function closeSplitEditor(): void {
  captureSplitEditor();
  state.splitId = undefined;
  mountSplitEditor();
  render();
  editorView?.focus();
}

function firstSplitCandidateId(): string | undefined {
  return textTabs().find((tab) => tab.id !== state.activeId)?.id;
}

async function openFromPicker(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Text and source files",
            accept: {
              "text/*": [
                ".txt",
                ".log",
                ".md",
                ".js",
                ".ts",
                ".json",
                ".html",
                ".css",
                ".py",
                ".sql",
                ".java",
                ".cs",
                ".cpp",
                ".c",
                ".h",
                ".groovy",
              ],
            },
          },
        ],
      });
      for (const handle of handles) {
        const file = await handle.getFile();
        await openFile(file, handle);
      }
      return;
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setSearchMessage("Native picker failed. Use the file input fallback.");
    }
  }

  elements.openInput.click();
}

async function openFiles(files: File[]): Promise<void> {
  for (const file of files) {
    await openFile(file);
  }
}

async function openFile(file: File, handle?: FileHandle): Promise<void> {
  const text = await file.text();
  const existing = state.tabs.find((t) => t.name === file.name && isTextTab(t));
  if (existing && isTextTab(existing)) {
    // If the existing tab is an empty default tab, replace it with the file content
    const isEmptyDefault = existing.content === "" && existing.savedContent === "";
    existing.content = text;
    existing.savedContent = text;
    existing.language = inferLanguage(file.name);
    if (handle) {
      existing.handle = handle;
      void persistFileHandle(existing.id, handle);
    }
    if (existing.id === state.activeId) {
      mountEditor();
      render();
    } else {
      switchToTab(existing.id);
    }
    if (!isEmptyDefault) {
      addRecentFile(file.name, text, existing.language);
    }
    return;
  }
  newTab(text, file.name, handle);
  activeTab().savedContent = text;
  if (handle) {
    void persistFileHandle(activeTab().id, handle);
  }
  addRecentFile(file.name, text, activeTab().language);
}

async function saveActive(): Promise<void> {
  if (!hasActiveTab()) return;
  captureActiveEditor();
  const tab = activeTab();

  if (isHttpTab(tab)) {
    if (tab.http) persistHttpWorkspace(tab.http);
    setSearchMessage(`Saved ${tab.name}.`);
    persistSession();
    return;
  }

  const handle = tab.handle ?? (await restoreFileHandle(tab.id));
  if (handle) {
    tab.handle = handle;
    if (!(await ensureWritablePermission(handle))) {
      setSearchMessage(`Save permission denied for ${tab.name}.`);
      return;
    }
    try {
      const writable = await handle.createWritable();
      await writable.write(tab.content);
      await writable.close();
      tab.savedContent = tab.content;
      void persistFileHandle(tab.id, handle);
      const msg = tab._renamedFrom
        ? `Saved ${tab.name}. Note: old file "${tab._renamedFrom}" still exists on disk — delete it manually.`
        : `Saved ${tab.name}.`;
      if (tab._renamedFrom) tab._renamedFrom = undefined;
      setSearchMessage(msg);
      render();
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setSearchMessage(`Could not save ${tab.name}. Use Save As to reconnect the file.`);
    }
    return;
  }

  await saveActiveAs();
}

async function saveActiveAs(): Promise<void> {
  if (!hasActiveTab()) return;
  captureActiveEditor();
  const tab = activeTab();

  if (isHttpTab(tab)) {
    await saveActive();
    return;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedSaveName(tab),
        types: buildSaveFileTypes(tab.language),
      });
      const writable = await handle.createWritable();
      await writable.write(tab.content);
      await writable.close();
      tab.handle = handle;
      tab.name = handle.name;
      tab.savedContent = tab.content;
      tab.language = inferLanguage(tab.name);
      void persistFileHandle(tab.id, handle);
      setSearchMessage(`Saved ${tab.name}.`);
      mountEditor();
      render();
      return;
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setSearchMessage("Native save failed. Downloaded a copy instead.");
    }
  }

  downloadText(tab.name, tab.content);
  tab.savedContent = tab.content;
  setSearchMessage(`Downloaded ${tab.name}.`);
  render();
}

async function restorePersistedHandles(): Promise<void> {
  if (!("indexedDB" in window)) {
    return;
  }

  let restored = false;
  for (const tab of textTabs()) {
    if (tab.handle) continue;
    const handle = await restoreFileHandle(tab.id);
    if (!handle) continue;
    tab.handle = handle;
    restored = true;
  }

  if (restored) {
    render();
  }
}

async function restoreFileHandle(tabId: string): Promise<FileHandle | undefined> {
  try {
    const db = await openFileHandleDb();
    return await new Promise<FileHandle | undefined>((resolve, reject) => {
      const request = db.transaction(FILE_HANDLE_STORE, "readonly").objectStore(FILE_HANDLE_STORE).get(tabId);
      request.onsuccess = () => resolve(request.result as FileHandle | undefined);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

async function persistFileHandle(tabId: string, handle: FileHandle): Promise<void> {
  try {
    const db = await openFileHandleDb();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(FILE_HANDLE_STORE, "readwrite").objectStore(FILE_HANDLE_STORE).put(handle, tabId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // File handles are a progressive enhancement; saving still works for the current tab session.
  }
}

async function removePersistedHandle(tabId: string): Promise<void> {
  try {
    const db = await openFileHandleDb();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(FILE_HANDLE_STORE, "readwrite").objectStore(FILE_HANDLE_STORE).delete(tabId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Ignore errors.
  }
}

async function openFileHandleDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILE_HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function ensureWritablePermission(handle: FileHandle): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) {
    return true;
  }

  const descriptor = { mode: "readwrite" as const };
  if ((await handle.queryPermission(descriptor)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(descriptor)) === "granted";
}

function downloadText(filename: string, text: string, type = "text/plain;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatJson(): void {
  if (!editorView) {
    return;
  }

  captureActiveEditor();
  const tab = activeTab();

  try {
    const parsed = JSON.parse(tab.content);
    const formatted = JSON.stringify(parsed, null, 2);
    const output = tab.lineEnding === "CRLF" ? formatted.replaceAll("\n", "\r\n") : formatted;

    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: output },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });

    tab.content = output;
    tab.language = "json";
    editorView.dispatch({ effects: languageCompartment.reconfigure(languageExtension("json")) });
    render();
    notify("Formatted JSON.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    notify(`Invalid JSON: ${message}`);
  }
}

function flattenJson(): void {
  if (!editorView) return;
  captureActiveEditor();
  const tab = activeTab();
  try {
    const parsed = JSON.parse(tab.content);
    const flattened = JSON.stringify(parsed);
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: flattened },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
    tab.content = flattened;
    tab.language = "json";
    editorView.dispatch({ effects: languageCompartment.reconfigure(languageExtension("json")) });
    render();
    notify("Flattened JSON to single line.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    notify(`Invalid JSON: ${message}`);
  }
}

function isDiffTab(tab: DocumentTab): boolean {
  return tab.kind === "diff";
}

function isHttpTab(tab: DocumentTab): boolean {
  return tab.kind === "http";
}

function isZipTab(tab: DocumentTab): boolean {
  return tab.kind === "zip";
}

function isDrawTab(tab: DocumentTab): boolean {
  return tab.kind === "draw";
}

function activeEditorView(): EditorView | undefined {
  return editorView ?? zipExplorerView?.editor;
}

function isTextTab(tab: DocumentTab): boolean {
  return !isDiffTab(tab) && !isHttpTab(tab) && !isZipTab(tab) && !isDrawTab(tab);
}

function textTabs(): DocumentTab[] {
  return state.tabs.filter(isTextTab);
}

function handleLineNumberMouseDown(view: EditorView, lineBlock: { from: number }, event: Event): boolean {
  if (!(event instanceof MouseEvent)) {
    return false;
  }

  event.preventDefault();
  view.focus();

  const startLine = view.state.doc.lineAt(lineBlock.from);
  const originalSelection = view.state.selection;
  const extend = event.shiftKey;
  const multiple = event.metaKey || event.ctrlKey;

  const selectToEventLine = (currentEvent: MouseEvent): void => {
    const currentLine = lineAtMouseEvent(view, currentEvent) ?? startLine;
    const fromLine = Math.min(startLine.number, currentLine.number);
    const toLine = Math.max(startLine.number, currentLine.number);
    const from = view.state.doc.line(fromLine).from;
    const to = lineEndIncludingBreak(view, view.state.doc.line(toLine));
    const range = EditorSelection.range(from, to);

    if (multiple) {
      view.dispatch({
        selection: EditorSelection.create([...originalSelection.ranges, range], originalSelection.ranges.length),
        scrollIntoView: true,
      });
    } else if (extend) {
      const anchor = originalSelection.main.anchor;
      view.dispatch({
        selection: EditorSelection.single(anchor, to),
        scrollIntoView: true,
      });
    } else {
      view.dispatch({
        selection: EditorSelection.create([range]),
        scrollIntoView: true,
      });
    }
  };

  const onMove = (moveEvent: MouseEvent): void => {
    selectToEventLine(moveEvent);
  };

  const onUp = (): void => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  selectToEventLine(event);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp, { once: true });
  return true;
}

function lineAtMouseEvent(view: EditorView, event: MouseEvent): Line | undefined {
  const contentRect = view.contentDOM.getBoundingClientRect();
  const pos = view.posAtCoords({ x: contentRect.left + 1, y: event.clientY });
  return pos === null ? undefined : view.state.doc.lineAt(pos);
}

function lineEndIncludingBreak(view: EditorView, line: Line): number {
  return line.number < view.state.doc.lines ? line.to + 1 : line.to;
}

function goToLine(): void {
  if (!editorView) return;
  const totalLines = editorView.state.doc.lines;
  elements.goToLineInput.max = String(totalLines);
  elements.goToLineInput.placeholder = `Line (1–${totalLines})`;
  elements.goToLineInput.value = "";
  elements.goToLineDialog.hidden = false;
  elements.goToLineInput.focus();
}

function commitGoToLine(): void {
  const value = parseInt(elements.goToLineInput.value, 10);
  closeGoToLine();
  if (!editorView || isNaN(value)) return;
  const lineNumber = Math.max(1, Math.min(editorView.state.doc.lines, value));
  const line = editorView.state.doc.line(lineNumber);
  editorView.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  editorView.focus();
}

function closeGoToLine(): void {
  elements.goToLineDialog.hidden = true;
}

function zoomEditor(delta: number): void {
  setEditorFontSize(state.fontSize + delta);
}

function setEditorFontSize(fontSize: number): void {
  state.fontSize = clampFontSize(fontSize);
  editorView?.dispatch({ effects: themeCompartment.reconfigure(editorTheme(state.theme, state.fontSize)) });
  splitEditorView?.dispatch({ effects: splitThemeCompartment.reconfigure(editorTheme(state.theme, state.fontSize)) });
  renderStatus();
  persistSession();
}

function createColumnSelection(view = editorView): boolean {
  if (!view) {
    return false;
  }

  if (view.state.selection.ranges.length > 1) {
    setSearchMessage("Column edit is active. Type to edit all selections.");
    view.focus();
    return true;
  }

  const selection = view.state.selection.main;
  if (selection.empty) {
    setSearchMessage("Select text across lines, then use Column.");
    view.focus();
    return false;
  }

  const doc = view.state.doc;
  const anchorLine = doc.lineAt(selection.anchor);
  const headLine = doc.lineAt(selection.head);

  if (anchorLine.number === headLine.number) {
    setSearchMessage("Column edit needs a multi-line selection.");
    view.focus();
    return false;
  }

  const firstLine = Math.min(anchorLine.number, headLine.number);
  const lastLine = Math.max(anchorLine.number, headLine.number);
  const anchorCol = selection.anchor - anchorLine.from;
  const headCol = selection.head - headLine.from;
  const fromCol = Math.min(anchorCol, headCol);
  const toCol = Math.max(anchorCol, headCol);

  const ranges = [];
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const from = line.from + Math.min(fromCol, line.length);
    const to = line.from + Math.min(toCol, line.length);
    ranges.push(from === to ? EditorSelection.cursor(from) : EditorSelection.range(from, to));
  }

  view.dispatch({
    selection: EditorSelection.create(ranges),
    scrollIntoView: true,
  });
  view.focus();
  renderColumnState();
  renderStatus();
  setSearchMessage(`${ranges.length} column selections. Type to edit all lines.`);
  return true;
}

function toggleWrap(): void {
  state.wrap = !state.wrap;
  editorView?.dispatch({ effects: wrapCompartment.reconfigure(state.wrap ? EditorView.lineWrapping : []) });
  splitEditorView?.dispatch({ effects: splitWrapCompartment.reconfigure(state.wrap ? EditorView.lineWrapping : []) });
  render();
}

function toggleWhitespace(): void {
  state.showWhitespace = !state.showWhitespace;
  editorView?.dispatch({ effects: whitespaceCompartment.reconfigure(state.showWhitespace ? visibleWhitespace() : []) });
  splitEditorView?.dispatch({ effects: splitWhitespaceCompartment.reconfigure(state.showWhitespace ? visibleWhitespace() : []) });
  render();
}

function toggleTheme(): void {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  editorView?.dispatch({ effects: themeCompartment.reconfigure(editorTheme(state.theme, state.fontSize)) });
  splitEditorView?.dispatch({ effects: splitThemeCompartment.reconfigure(editorTheme(state.theme, state.fontSize)) });
  zipExplorerView?.updateTheme(state.theme);
  drawView?.refreshTheme();
  render();
}

function openFindDialog(mode: SearchMode): void {
  searchMode = mode;
  renderFindMode();
  elements.findDialog.hidden = false;
  const zipScopeEl = document.querySelector<HTMLElement>(".zip-scope-option");
  if (zipScopeEl) zipScopeEl.hidden = !hasActiveTab() || !isZipTab(activeTab());
  positionFindDialog();
  window.setTimeout(() => {
    elements.findInput.focus();
    elements.findInput.select();
  });
}

function closeFindDialog(): void {
  elements.findDialog.hidden = true;
  editorView?.focus();
}

function openDiffDialog(): void {
  openDiffTab();
}

function openHttpClientTab(existingState?: HttpClientState): void {
  captureActiveEditor();
  captureSplitEditor();
  const httpState = normalizeState(existingState ?? restoreHttpWorkspace() ?? createInitialHttpState());
  const id = crypto.randomUUID();
  const tab: DocumentTab = {
    id,
    name: "HTTP Client",
    content: "",
    savedContent: "",
    language: "plaintext",
    lineEnding: "LF",
    kind: "http",
    http: httpState,
  };
  state.tabs.push(tab);
  state.activeId = id;
  mountEditor();
  render();
}

function openDiffTab(): void {
  captureActiveEditor();
  const candidates = textTabs();
  if (candidates.length < 2) {
    notify("Open at least two text files to compare.");
    return;
  }

  const left = hasActiveTab() && !isDiffTab(activeTab()) ? activeTab() : candidates[0];
  const right = candidates.find((tab) => tab.id !== left.id) ?? candidates[1];
  const diffTab: DocumentTab = {
    id: crypto.randomUUID(),
    name: `Diff: ${left.name} vs ${right.name}`,
    content: "",
    savedContent: "",
    language: "plaintext",
    lineEnding: "LF",
    kind: "diff",
    diff: { leftId: left.id, rightId: right.id, summary: "Click Compare to see differences.", rows: [] },
  };
  state.tabs.push(diffTab);
  state.activeId = diffTab.id;
  mountEditor();
  render();
}

function renderHttpClientTab(tab: DocumentTab): void {
  tab.http = normalizeState(tab.http ?? restoreHttpWorkspace() ?? createInitialHttpState());
  httpClientView = new HttpClientView(elements.httpClientView, tab.http, {
    onChange: () => {
      persistHttpWorkspace(tab.http!);
      persistSession();
      renderStatus();
    },
    onClose: () => {
      closeTab(tab.id);
    },
    onRenameTab: (name) => {
      tab.name = name;
      renderTabs();
      renderStatus();
    },
    onNotify: notify,
    onDownload: downloadText,
  });
  httpClientView.render();
}

function openZipExplorerTab(): void {
  captureActiveEditor();
  captureSplitEditor();
  const id = crypto.randomUUID();
  const tab: DocumentTab = { id, name: "Zip Explorer", content: "", savedContent: "", language: "plaintext", lineEnding: "LF", kind: "zip" };
  state.tabs.push(tab);
  state.activeId = id;
  mountEditor();
  render();
}

function renderZipExplorerTab(): void {
  if (!zipExplorerView) {
    zipExplorerView = new ZipExplorerView(elements.zipExplorerView, {
      onChange: () => { persistSession(); renderStatus(); },
      onNotify: notify,
    });
    zipExplorerView.render();
  }
}

function openDrawTab(): void {
  captureActiveEditor();
  captureSplitEditor();
  const id = crypto.randomUUID();
  const tab: DocumentTab = { id, name: "Draw", content: "", savedContent: "", language: "plaintext", lineEnding: "LF", kind: "draw" };
  state.tabs.push(tab);
  state.activeId = id;
  mountEditor();
  render();
}

function renderDrawTab(): void {
  if (!drawView) {
    drawView = new DrawView(elements.drawView);
    drawView.render();
  }
}

function positionFindDialog(): void {
  if (!findDialogPosition) {
    findDialogPosition = {
      left: Math.max(16, Math.round((window.innerWidth - Math.min(760, window.innerWidth - 32)) / 2)),
      top: 72,
    };
  }

  const bounded = clampDialogPosition(findDialogPosition.left, findDialogPosition.top);
  findDialogPosition = bounded;
  elements.findDialog.style.left = `${bounded.left}px`;
  elements.findDialog.style.top = `${bounded.top}px`;
}

function clampDialogPosition(left: number, top: number): { left: number; top: number } {
  const rect = elements.findDialog.getBoundingClientRect();
  const width = rect.width || Math.min(760, window.innerWidth - 32);
  const height = rect.height || 360;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8);

  return {
    left: Math.min(Math.max(8, Math.round(left)), maxLeft),
    top: Math.min(Math.max(8, Math.round(top)), maxTop),
  };
}

function startFloatingDialogDrag(
  event: PointerEvent,
  shell: HTMLElement,
  setPosition: (position: { left: number; top: number }) => void,
): void {
  const target = event.target as HTMLElement;
  if (target.closest("button, input, select, label")) {
    return;
  }

  event.preventDefault();
  shell.setPointerCapture(event.pointerId);
  shell.classList.add("dragging");

  const rect = shell.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;

  const onMove = (moveEvent: PointerEvent): void => {
    const position = clampFloatingDialogPosition(shell, moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
    setPosition(position);
    shell.style.left = `${position.left}px`;
    shell.style.top = `${position.top}px`;
  };

  const onUp = (): void => {
    shell.classList.remove("dragging");
    shell.removeEventListener("pointermove", onMove);
    shell.removeEventListener("pointerup", onUp);
    shell.removeEventListener("pointercancel", onUp);
  };

  shell.addEventListener("pointermove", onMove);
  shell.addEventListener("pointerup", onUp);
  shell.addEventListener("pointercancel", onUp);
}

function clampFloatingDialogPosition(shell: HTMLElement, left: number, top: number): { left: number; top: number } {
  const rect = shell.getBoundingClientRect();
  const width = rect.width || Math.min(760, window.innerWidth - 16);
  const height = rect.height || 360;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8);

  return {
    left: Math.min(Math.max(8, Math.round(left)), maxLeft),
    top: Math.min(Math.max(8, Math.round(top)), maxTop),
  };
}

function createDiffTab(leftId: string, rightId: string): DocumentTab {
  const left = state.tabs.find((tab) => tab.id === leftId);
  const right = state.tabs.find((tab) => tab.id === rightId);
  const diff = buildDiffState(left, right);

  return {
    id: crypto.randomUUID(),
    name: `Diff: ${left?.name ?? "left"} vs ${right?.name ?? "right"}`,
    content: "",
    savedContent: "",
    language: "plaintext",
    lineEnding: "LF",
    kind: "diff",
    diff,
  };
}

function buildDiffState(left?: DocumentTab, right?: DocumentTab): DiffState {
  if (!left || !right || left.id === right.id) {
    return {
      leftId: left?.id ?? "",
      rightId: right?.id ?? "",
      summary: "Choose two different files.",
      rows: [],
    };
  }

  const rows = buildLineDiff(left.content, right.content);
  return {
    leftId: left.id,
    rightId: right.id,
    summary: summarizeDiff(left.name, right.name, rows),
    rows,
  };
}

function renderDiffTab(tab: DocumentTab): void {
  if (!tab.diff) {
    const candidates = textTabs();
    tab.diff = buildDiffState(candidates[0], candidates[1]);
  }

  renderDiffSelectors();
  elements.diffLeftSelect.value = tab.diff.leftId;
  elements.diffRightSelect.value = tab.diff.rightId;
  elements.diffSummary.textContent = tab.diff.summary;
  renderDiffRows(tab.diff.rows);
}

function compareSelectedTabs(): void {
  captureActiveEditor();

  const left = state.tabs.find((tab) => tab.id === elements.diffLeftSelect.value);
  const right = state.tabs.find((tab) => tab.id === elements.diffRightSelect.value);

  if (!left || !right) {
    elements.diffSummary.textContent = "Select two files to compare.";
    elements.diffResults.innerHTML = "";
    return;
  }

  if (left.id === right.id) {
    elements.diffSummary.textContent = "Choose two different files.";
    elements.diffResults.innerHTML = "";
    return;
  }

  const tab = activeTab();
  const diff = buildDiffState(left, right);
  if (isDiffTab(tab)) {
    tab.name = `Diff: ${left.name} vs ${right.name}`;
    tab.diff = diff;
    tab.content = "";
    tab.savedContent = "";
    renderTabs();
  }

  elements.diffSummary.textContent = diff.summary;
  renderDiffRows(diff.rows);
  renderStatus();
}

function swapDiffSides(): void {
  const left = elements.diffLeftSelect.value;
  elements.diffLeftSelect.value = elements.diffRightSelect.value;
  elements.diffRightSelect.value = left;
  compareSelectedTabs();
}

function navigateDiff(direction: 1 | -1): void {
  const sectionStarts: number[] = [];
  for (let i = 0; i < renderedDiffRows.length; i += 1) {
    const row = renderedDiffRows[i];
    if (row.kind !== "equal") {
      const prev = renderedDiffRows[i - 1];
      if (!prev || prev.kind === "equal") {
        sectionStarts.push(i);
      }
    }
  }
  if (sectionStarts.length === 0) return;
  let index = 0;
  if (activeDiffRowIndex >= 0) {
    let currentSection = 0;
    for (let i = 0; i < sectionStarts.length; i += 1) {
      if (sectionStarts[i] <= activeDiffRowIndex) currentSection = i;
    }
    index = currentSection + direction;
    if (index < 0) index = sectionStarts.length - 1;
    if (index >= sectionStarts.length) index = 0;
  } else {
    index = direction === 1 ? 0 : sectionStarts.length - 1;
  }
  activeDiffRowIndex = sectionStarts[index];
  const leftPane = elements.diffResults.querySelector(".diff-pane-left") as HTMLElement | null;
  const rightPane = elements.diffResults.querySelector(".diff-pane-right") as HTMLElement | null;
  const scrollTop = Math.max(0, activeDiffRowIndex * DIFF_ROW_HEIGHT - (leftPane?.clientHeight ?? elements.diffResults.clientHeight) / 2);
  if (leftPane) leftPane.scrollTop = scrollTop;
  if (rightPane) rightPane.scrollTop = scrollTop;
  renderVirtualDiffRows();
}

function inlineCharDiff(left: string, right: string, side: "left" | "right"): string {
  let prefix = 0;
  const minLen = Math.min(left.length, right.length);
  while (prefix < minLen && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < minLen - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  const text = side === "left" ? left : right;
  const end = text.length - suffix;
  const before = escapeHtml(text.slice(0, prefix));
  const mid = escapeHtml(text.slice(prefix, end));
  const after = escapeHtml(text.slice(end));
  return mid ? `${before}<mark>${mid}</mark>${after}` : `${before}${after}`;
}

function renderDiffRows(rows: DiffRow[]): void {
  allDiffRows = rows;
  diffRowsVisibleLimit = DIFF_PAGE_SIZE;
  renderedDiffRows = rows.length > diffRowsVisibleLimit ? rows.slice(0, diffRowsVisibleLimit) : rows;
  activeDiffRowIndex = -1;
  setupDiffPanes();
  renderVirtualDiffRows();
  renderDiffLoadMore();
}

function setupDiffPanes(): void {
  if (renderedDiffRows.length === 0) {
    elements.diffResults.style.display = "block";
    elements.diffResults.innerHTML = `<div class="empty-results">No diff rows.</div>`;
    return;
  }

  elements.diffResults.style.display = "";
  elements.diffResults.style.gridTemplateColumns = "";

  const leftPaneEl = document.createElement("div");
  leftPaneEl.className = "diff-pane diff-pane-left";

  const handle = document.createElement("div");
  handle.className = "diff-resize-handle";

  const rightPaneEl = document.createElement("div");
  rightPaneEl.className = "diff-pane diff-pane-right";

  // Sync vertical scroll between panes
  let syncing = false;
  leftPaneEl.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    rightPaneEl.scrollTop = leftPaneEl.scrollTop;
    syncing = false;
    renderVirtualDiffRows();
  });
  rightPaneEl.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    leftPaneEl.scrollTop = rightPaneEl.scrollTop;
    syncing = false;
    renderVirtualDiffRows();
  });

  // Resize handle drag
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const containerWidth = elements.diffResults.clientWidth;
    const startLeftWidth = leftPaneEl.clientWidth;
    const onMove = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      const newLeft = Math.max(100, Math.min(containerWidth - 106, startLeftWidth + delta));
      const pct = (newLeft / containerWidth) * 100;
      elements.diffResults.style.gridTemplateColumns = `${pct}% 6px 1fr`;
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove as EventListener);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove as EventListener);
    document.addEventListener("pointerup", onUp);
  });

  elements.diffResults.replaceChildren(leftPaneEl, handle, rightPaneEl);
}

function renderDiffLoadMore(): void {
  if (allDiffRows.length > renderedDiffRows.length) {
    const footer = document.createElement("div");
    footer.className = "empty-results";
    footer.textContent = `Showing ${renderedDiffRows.length.toLocaleString()} of ${allDiffRows.length.toLocaleString()} diff rows. `;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-button";
    button.dataset.action = "load-more-diff-rows";
    button.textContent = "Load more";
    footer.append(button);
    elements.diffResults.append(footer);
  }
}

function loadMoreDiffRows(): void {
  diffRowsVisibleLimit += DIFF_PAGE_SIZE;
  renderedDiffRows = allDiffRows.length > diffRowsVisibleLimit ? allDiffRows.slice(0, diffRowsVisibleLimit) : allDiffRows;
  renderVirtualDiffRows();
  renderDiffLoadMore();
}

function renderVirtualDiffRows(): void {
  const rows = renderedDiffRows;
  const leftPane = elements.diffResults.querySelector(".diff-pane-left") as HTMLElement | null;
  const rightPane = elements.diffResults.querySelector(".diff-pane-right") as HTMLElement | null;
  if (!leftPane || !rightPane || rows.length === 0) return;

  const totalHeight = rows.length * DIFF_ROW_HEIGHT;
  const viewportHeight = leftPane.clientHeight || 360;
  const scrollTop = leftPane.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / DIFF_ROW_HEIGHT) - DIFF_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / DIFF_ROW_HEIGHT) + DIFF_OVERSCAN * 2;
  const end = Math.min(rows.length, start + visibleCount);

  const leftSpacer = document.createElement("div");
  leftSpacer.className = "diff-virtual-spacer";
  leftSpacer.style.height = `${totalHeight}px`;

  const rightSpacer = document.createElement("div");
  rightSpacer.className = "diff-virtual-spacer";
  rightSpacer.style.height = `${totalHeight}px`;

  for (let index = start; index < end; index += 1) {
    const row = rows[index];
    const leftHtml = row.kind === "change" ? inlineCharDiff(row.leftText, row.rightText, "left") : escapeHtml(createDiffPreview(row.leftText));
    const rightHtml = row.kind === "change" ? inlineCharDiff(row.leftText, row.rightText, "right") : escapeHtml(createDiffPreview(row.rightText));

    const leftRow = document.createElement("div");
    leftRow.className = `diff-row ${row.kind} ${index === activeDiffRowIndex ? "active" : ""}`;
    leftRow.style.transform = `translateY(${index * DIFF_ROW_HEIGHT}px)`;
    leftRow.innerHTML = `<span class="diff-line-number">${row.leftLine ?? ""}</span><code class="diff-code">${leftHtml}</code>`;
    leftSpacer.append(leftRow);

    const rightRow = document.createElement("div");
    rightRow.className = `diff-row ${row.kind} ${index === activeDiffRowIndex ? "active" : ""}`;
    rightRow.style.transform = `translateY(${index * DIFF_ROW_HEIGHT}px)`;
    rightRow.innerHTML = `<span class="diff-line-number">${row.rightLine ?? ""}</span><code class="diff-code">${rightHtml}</code>`;
    rightSpacer.append(rightRow);
  }

  const prevLeft = leftPane.scrollTop;
  const prevRight = rightPane.scrollTop;
  leftPane.replaceChildren(leftSpacer);
  rightPane.replaceChildren(rightSpacer);
  leftPane.scrollTop = prevLeft;
  rightPane.scrollTop = prevRight;
}

function createDiffPreview(value: string): string {
  const maxLength = 360;
  return value.length > maxLength ? `${value.slice(0, maxLength)} ...` : value;
}

function currentSearchScope(): SearchScope {
  const val = document.querySelector<HTMLInputElement>('input[name="searchScope"]:checked')?.value;
  return val === "all" ? "all" : val === "zip" ? "zip" : "current";
}

function findText(direction: 1 | -1): void {
  const ev = activeEditorView();
  if (!ev) {
    return;
  }

  if (currentSearchScope() === "all") {
    findAcrossTabs(direction);
    return;
  }

  const result = findRange(direction);
  if (!result) {
    setSearchMessage(state.search.query ? "No matches." : "Enter search text.");
    return;
  }

  ev.dispatch({
    selection: { anchor: result.from, head: result.to },
    scrollIntoView: true,
  });
  ev.focus();
  setSearchMessage(`Match at ${result.from + 1}.`);
}

function findAcrossTabs(direction: 1 | -1): void {
  if (!editorView || !state.search.query) {
    setSearchMessage("Enter search text.");
    return;
  }

  captureActiveEditor();
  const resultSet = collectSearchResults(searchResultsVisiblePerFileLimit);
  const results = resultSet.results;
  renderSearchResults(resultSet);
  if (results.length === 0) {
    setSearchMessage("No matches in open files.");
    return;
  }

  const activeIndex = results.findIndex(
    (result) =>
      result.tabId === state.activeId &&
      (direction === 1 ? result.from >= editorView!.state.selection.main.to : result.to <= editorView!.state.selection.main.from),
  );
  const target =
    activeIndex >= 0
      ? results[activeIndex]
      : direction === 1
        ? results.find((result) => result.tabId !== state.activeId) ?? results[0]
        : [...results].reverse().find((result) => result.tabId !== state.activeId) ?? results[results.length - 1];
  jumpToSearchResult(results.indexOf(target));
}

function findAll(): void {
  captureActiveEditor();
  searchResultsVisiblePerFileLimit = SEARCH_RESULTS_PAGE_SIZE;
  if (currentSearchScope() === "zip") {
    findAllInZip();
    return;
  }
  if (currentSearchScope() === "all" && hasActiveTab() && isZipTab(activeTab()) && zipExplorerView) {
    findAllInOpenZipTabs();
    return;
  }
  const resultSet =
    currentSearchScope() === "all"
      ? collectSearchResults(searchResultsVisiblePerFileLimit)
      : collectCurrentSearchResults(searchResultsVisiblePerFileLimit);
  renderSearchResults(resultSet);
  setSearchMessage(searchResultMessage(resultSet));
}

function findAllInOpenZipTabs(): void {
  if (!state.search.query || !zipExplorerView) { setSearchMessage("Enter search text."); return; }
  const tabs = zipExplorerView.tabs;
  if (tabs.length === 0) { setSearchMessage("No open files in zip explorer."); return; }
  const fragment = document.createDocumentFragment();
  searchResults = [];
  const mainTab = activeTab();
  let totalHits = 0;
  let shownHits = 0;
  for (const zt of tabs) {
    const ranges = rangesInText(zt.content, searchResultsVisiblePerFileLimit);
    const total = countRangesInText(zt.content);
    totalHits += total;
    if (total === 0) continue;
    shownHits += ranges.length;
    const group = document.createElement("details");
    group.className = "result-file-group";
    group.open = true;
    group.innerHTML = `<summary class="result-file-header">${escapeHtml(zt.path)} (${ranges.length} of ${total} hits)</summary>`;
    for (const range of ranges) {
      const idx = searchResults.length;
      const before = zt.content.slice(0, range.from);
      const line = before.split("\n").length;
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineEnd = zt.content.indexOf("\n", range.from);
      const preview = zt.content.slice(lineStart, lineEnd === -1 ? zt.content.length : lineEnd).trim() || "(blank line)";
      searchResults.push({ tabId: mainTab.id, from: range.from, to: range.to, line, column: range.from - lineStart + 1, preview, zipPath: zt.path });
      const div = document.createElement("div");
      div.className = "result-item";
      div.dataset.resultIndex = String(idx);
      div.innerHTML = `<span class="result-location">Ln ${line}, Col ${range.from - lineStart + 1}</span><span class="result-preview">${escapeHtml(preview)}</span>`;
      group.appendChild(div);
    }
    fragment.appendChild(group);
  }
  if (shownHits < totalHits) {
    const footer = document.createElement("div");
    footer.className = "empty-results";
    footer.textContent = `Showing ${shownHits} of ${totalHits} matches.`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-button";
    button.dataset.action = "load-more-search-results";
    button.textContent = "Load more per file";
    footer.append(" ", button);
    fragment.appendChild(footer);
  }
  elements.searchResults.replaceChildren(fragment);
  elements.searchPanel.hidden = false;
  setSearchMessage(`${totalHits} match${totalHits === 1 ? "" : "es"} in ${tabs.length} open file${tabs.length === 1 ? "" : "s"}.`);
}

async function findAllInZip(): Promise<void> {
  if (!state.search.query) { setSearchMessage("Enter search text."); return; }
  elements.findDialog.classList.add("find-dialog-loading");
  setSearchMessage("Searching zip...");
  try {
    const { hits, totals } = await searchAllZipFiles(state.search.query, state.search.matchCase, state.search.regex, 100);
    if (hits.length === 0) { setSearchMessage("No matches in zip."); elements.searchResults.replaceChildren(); return; }
  elements.searchPanel.hidden = false;
  const fragment = document.createDocumentFragment();
  const grouped = new Map<string, typeof hits>();
  for (const h of hits) { const arr = grouped.get(h.path) ?? []; arr.push(h); grouped.set(h.path, arr); }
  searchResults = [];
  const tab = activeTab();
  let totalMatches = 0;
  for (const [path, items] of grouped) {
    const fileTotal = totals.get(path) ?? items.length;
    totalMatches += fileTotal;
    const group = document.createElement("details");
    group.className = "result-file-group";
    group.open = true;
    group.innerHTML = `<summary class="result-file-header">${escapeHtml(path)} (${items.length} of ${fileTotal})${items.length < fileTotal ? `<button type="button" class="mini-button zip-load-more-file" data-zip-load-more-path="${escapeHtml(path)}" data-zip-load-more-shown="${items.length}">Load more (${fileTotal - items.length} remaining)</button>` : ""}</summary>`;
    for (const item of items) {
      const idx = searchResults.length;
      searchResults.push({ tabId: tab.id, from: item.from, to: item.to, line: item.line, column: item.column, preview: item.preview, zipPath: item.path });
      const div = document.createElement("div");
      div.className = "result-item";
      div.dataset.resultIndex = String(idx);
      div.innerHTML = `<span class="result-location">Ln ${item.line}, Col ${item.column}</span><span class="result-preview">${escapeHtml(item.preview)}</span>`;
      group.appendChild(div);
    }
    fragment.appendChild(group);
  }
  elements.searchResults.replaceChildren(fragment);
  setSearchMessage(`${totalMatches} match${totalMatches === 1 ? "" : "es"} in ${grouped.size} file${grouped.size === 1 ? "" : "s"}.`);
  } finally {
    elements.findDialog.classList.remove("find-dialog-loading");
  }
}

function replaceOne(): void {
  if (!editorView) {
    return;
  }

  const selection = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(selection.from, selection.to);

  if (!matchesQuery(selected) || selection.empty) {
    findText(1);
    return;
  }

  editorView.dispatch({
    changes: { from: selection.from, to: selection.to, insert: state.search.replacement },
    selection: { anchor: selection.from + state.search.replacement.length },
    scrollIntoView: true,
  });
  setSearchMessage("Replaced 1 match.");
}

function replaceAllMatches(): void {
  if (!editorView) {
    return;
  }

  if (currentSearchScope() === "all") {
    replaceAllInTabs();
    return;
  }

  const ranges = allRanges();
  if (ranges.length === 0) {
    setSearchMessage(state.search.query ? "No matches." : "Enter search text.");
    return;
  }

  editorView.dispatch({
    changes: ranges.map((range) => ({ from: range.from, to: range.to, insert: replacementFor(range) })),
  });
  setSearchMessage(`Replaced ${ranges.length} matches.`);
}

function replaceAllInTabs(): void {
  captureActiveEditor();

  let total = 0;
  for (const tab of textTabs()) {
    const ranges = rangesInText(tab.content);
    if (ranges.length === 0) {
      continue;
    }

    tab.content = replaceRangesInText(tab.content, ranges);
    total += ranges.length;
  }

  if (total === 0) {
    setSearchMessage(state.search.query ? "No matches in open files." : "Enter search text.");
    return;
  }

  mountEditor();
  render();
  searchResultsVisiblePerFileLimit = SEARCH_RESULTS_PAGE_SIZE;
  renderSearchResults(collectSearchResults(searchResultsVisiblePerFileLimit));
  setSearchMessage(`Replaced ${total} matches in open files.`);
}

function findRange(direction: 1 | -1): { from: number; to: number; text: string } | undefined {
  const ev = activeEditorView();
  if (!ev || !state.search.query) {
    return undefined;
  }

  const ranges = allRanges();
  if (ranges.length === 0) {
    return undefined;
  }

  const cursor = direction === 1 ? ev.state.selection.main.to : ev.state.selection.main.from;
  if (direction === 1) {
    return ranges.find((range) => range.from >= cursor) ?? ranges[0];
  }
  return [...ranges].reverse().find((range) => range.to <= cursor) ?? ranges[ranges.length - 1];
}

function allRanges(): SearchRange[] {
  const ev = activeEditorView();
  if (!ev || !state.search.query) {
    return [];
  }

  return rangesInText(ev.state.doc.toString());
}

function rangesInText(text: string, limit = Number.POSITIVE_INFINITY, skip = 0): SearchRange[] {
  if (!state.search.query) {
    return [];
  }

  if (state.search.regex) {
    try {
      const flags = state.search.matchCase ? "g" : "gi";
      const regex = new RegExp(state.search.query, flags);
      const ranges: SearchRange[] = [];
      let match: RegExpExecArray | null;
      let skipped = 0;
      while ((match = regex.exec(text))) {
        if (skipped < skip) { skipped++; if (match[0].length === 0) regex.lastIndex += 1; continue; }
        if (ranges.length >= limit) break;
        ranges.push({ from: match.index, to: match.index + match[0].length, text: match[0], match });
        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }
      return ranges;
    } catch {
      setSearchMessage("Invalid regular expression.");
      return [];
    }
  }

  const haystack = state.search.matchCase ? text : text.toLowerCase();
  const needle = state.search.matchCase ? state.search.query : state.search.query.toLowerCase();
  const ranges: SearchRange[] = [];
  let index = haystack.indexOf(needle);
  let skipped = 0;
  while (index !== -1) {
    if (skipped < skip) { skipped++; index = haystack.indexOf(needle, index + Math.max(needle.length, 1)); continue; }
    if (ranges.length >= limit) break;
    ranges.push({ from: index, to: index + needle.length, text: text.slice(index, index + needle.length) });
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return ranges;
}

function countRangesInText(text: string): number {
  if (!state.search.query) {
    return 0;
  }

  if (state.search.regex) {
    try {
      const flags = state.search.matchCase ? "g" : "gi";
      const regex = new RegExp(state.search.query, flags);
      let count = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        count += 1;
        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }
      return count;
    } catch {
      setSearchMessage("Invalid regular expression.");
      return 0;
    }
  }

  const haystack = state.search.matchCase ? text : text.toLowerCase();
  const needle = state.search.matchCase ? state.search.query : state.search.query.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return count;
}

function replaceRangesInText(text: string, ranges: SearchRange[]): string {
  let next = text;
  for (const range of [...ranges].reverse()) {
    next = `${next.slice(0, range.from)}${replacementFor(range)}${next.slice(range.to)}`;
  }
  return next;
}

function collectCurrentSearchResults(limit: number): SearchResultSet {
  const tab = activeTab();
  const text = activeEditorView()?.state.doc.toString() ?? tab.content;
  const total = countRangesInText(text);
  const ranges = rangesInText(text, limit);
  const perTabCounts = new Map<string, number>([[tab.id, total]]);
  return {
    results: ranges.map((range) => rangeToSearchResult(tab, text, range)),
    total,
    perTabCounts,
  };
}

function collectSearchResults(perFileLimit: number): SearchResultSet {
  const results: SearchResult[] = [];
  const perTabCounts = new Map<string, number>();
  let total = 0;

  for (const tab of textTabs()) {
    const tabTotal = countRangesInText(tab.content);
    perTabCounts.set(tab.id, tabTotal);
    total += tabTotal;

    if (tabTotal === 0) continue;

    const ranges = rangesInText(tab.content, perFileLimit);
    for (const range of ranges) {
      results.push(rangeToSearchResult(tab, tab.content, range));
    }
  }

  return { results, total, perTabCounts };
}

function rangeToSearchResult(
  tab: DocumentTab,
  text: string,
  range: { from: number; to: number },
): SearchResult {
  const before = text.slice(0, range.from);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEndIndex = text.indexOf("\n", range.from);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const preview = createSearchPreview(text, lineStart, lineEnd, range.from, range.to);
  return {
    tabId: tab.id,
    from: range.from,
    to: range.to,
    line,
    column: range.from - lineStart + 1,
    preview,
  };
}

function createSearchPreview(text: string, lineStart: number, lineEnd: number, _matchFrom: number, _matchTo: number): string {
  const line = text.slice(lineStart, lineEnd).trim();
  return line || "(blank line)";
}

function closeSearchPanel(): void {
  elements.searchPanel.hidden = true;
  searchResults = [];
  elements.searchResults.replaceChildren();
}

function renderSearchResults(resultSet: SearchResultSet): void {
  const { results, total, perTabCounts } = resultSet;
  searchResults = results;

  if (total === 0) {
    elements.searchResults.innerHTML = `<div class="empty-results">No results</div>`;
    elements.searchPanel.hidden = false;
    return;
  }

  const grouped = new Map<string, Array<{ index: number; result: SearchResult }>>();
  results.forEach((result, index) => {
    const list = grouped.get(result.tabId) ?? [];
    list.push({ index, result });
    grouped.set(result.tabId, list);
  });

  const matchingTabs = state.tabs.filter((tab) => (perTabCounts.get(tab.id) ?? 0) > 0);
  const fragment = document.createDocumentFragment();
  for (const tab of matchingTabs) {
    const items = grouped.get(tab.id) ?? [];
    const tabTotal = perTabCounts.get(tab.id) ?? items.length;
    const group = document.createElement("details");
    group.className = "result-file-group";
    group.open = true;
    const header = document.createElement("summary");
    header.className = "result-file-header";
    const displayName = isZipTab(tab) && zipExplorerView?.selectedPath ? zipExplorerView.selectedPath : tab.name;
    header.innerHTML = `<span>${escapeHtml(displayName)} (${items.length} of ${tabTotal} hits)</span>`;
    if (items.length < tabTotal) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-button tab-load-more-file";
      btn.dataset.tabLoadMoreId = tab.id;
      btn.dataset.tabLoadMoreShown = String(items.length);
      btn.textContent = `Load more (${tabTotal - items.length} remaining)`;
      header.appendChild(btn);
    }
    group.appendChild(header);
    for (const { index, result } of items) {
      const button = document.createElement("div");
      button.className = "result-item";
      button.dataset.resultIndex = String(index);
      button.innerHTML = `
        <span class="result-location">Ln ${result.line}, Col ${result.column}</span>
        <span class="result-preview">${escapeHtml(result.preview)}</span>
      `;
      group.appendChild(button);
    }
    fragment.appendChild(group);
  }
  elements.searchResults.replaceChildren(fragment);

  elements.searchPanel.hidden = false;
}

function searchResultMessage(resultSet: SearchResultSet): string {
  const count = resultSet.total;
  return `${count} match${count === 1 ? "" : "es"} found.`;
}

function loadMoreSearchResults(): void {
  searchResultsVisiblePerFileLimit += SEARCH_RESULTS_PAGE_SIZE;
  if (currentSearchScope() === "zip") {
    return;
  }
  if (currentSearchScope() === "all" && hasActiveTab() && isZipTab(activeTab()) && zipExplorerView) {
    findAllInOpenZipTabs();
    return;
  }
  const resultSet =
    currentSearchScope() === "all"
      ? collectSearchResults(searchResultsVisiblePerFileLimit)
      : collectCurrentSearchResults(searchResultsVisiblePerFileLimit);
  renderSearchResults(resultSet);
  setSearchMessage(`Showing ${resultSet.results.length} of ${resultSet.total} matches.`);
}

function jumpToSearchResult(index: number): void {
  const result = searchResults[index];
  if (!result) {
    return;
  }

  if (result.zipPath && zipExplorerView) {
    zipExplorerView.openFile(result.zipPath).then(() => {
      const ev = zipExplorerView?.editor;
      ev?.dispatch({ selection: { anchor: result.from, head: result.to }, scrollIntoView: true });
      ev?.focus();
    });
    return;
  }

  if (result.tabId !== state.activeId) {
    switchToTab(result.tabId);
  }

  const ev = activeEditorView();
  ev?.dispatch({
    selection: { anchor: result.from, head: result.to },
    scrollIntoView: true,
  });
  ev?.focus();
}

function matchesQuery(value: string): boolean {
  if (!state.search.query || value.length === 0) {
    return false;
  }

  if (state.search.regex) {
    try {
      const regex = new RegExp(`^(?:${state.search.query})$`, state.search.matchCase ? "" : "i");
      return regex.test(value);
    } catch {
      return false;
    }
  }

  return state.search.matchCase
    ? value === state.search.query
    : value.toLowerCase() === state.search.query.toLowerCase();
}

function replacementFor(range: SearchRange): string {
  if (!state.search.regex || !range.match) {
    return state.search.replacement;
  }

  try {
    return range.text.replace(new RegExp(state.search.query, state.search.matchCase ? "" : "i"), state.search.replacement);
  } catch {
    return state.search.replacement;
  }
}

function suggestedSaveName(tab: DocumentTab): string {
  if (hasKnownExtension(tab.name)) {
    return tab.name;
  }
  return `${tab.name}${defaultExtensionForLanguage(tab.language)}`;
}

function buildSaveFileTypes(language: LanguageId): Array<{ description: string; accept: Record<string, string[]> }> {
  const mimeMap: Record<string, { description: string; mime: string; extensions: string[] }> = {
    json: { description: "JSON", mime: "application/json", extensions: [".json"] },
    javascript: { description: "JavaScript", mime: "text/javascript", extensions: [".js"] },
    typescript: { description: "TypeScript", mime: "text/typescript", extensions: [".ts"] },
    html: { description: "HTML", mime: "text/html", extensions: [".html"] },
    css: { description: "CSS", mime: "text/css", extensions: [".css"] },
    python: { description: "Python", mime: "text/x-python", extensions: [".py"] },
    sql: { description: "SQL", mime: "text/x-sql", extensions: [".sql"] },
    markdown: { description: "Markdown", mime: "text/markdown", extensions: [".md"] },
    java: { description: "Java", mime: "text/x-java", extensions: [".java"] },
    cpp: { description: "C/C++", mime: "text/x-c++src", extensions: [".cpp", ".cc", ".cxx", ".hpp", ".h"] },
    csharp: { description: "C#", mime: "text/x-csharp", extensions: [".cs"] },
    groovy: { description: "Groovy", mime: "text/x-groovy", extensions: [".groovy"] },
  };
  const types: Array<{ description: string; accept: Record<string, string[]> }> = [];
  const entry = mimeMap[language];
  if (entry) {
    types.push({ description: entry.description, accept: { [entry.mime]: entry.extensions } });
  }
  types.push({ description: "All text files", accept: { "text/plain": [".txt", ".log"] } });
  return types;
}

function isDirty(tab: DocumentTab): boolean {
  if (isHttpTab(tab)) return false;
  return tab.content !== tab.savedContent;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function notify(message: string): void {
  if (!elements.findDialog.hidden) {
    setSearchMessage(message);
    return;
  }

  const token = crypto.randomUUID();
  elements.statusLength.dataset.messageToken = token;
  elements.statusLength.textContent = message;
  window.setTimeout(() => {
    if (elements.statusLength.dataset.messageToken === token) {
      delete elements.statusLength.dataset.messageToken;
      renderStatus();
    }
  }, 3200);
}

function setSearchMessage(message: string): void {
  elements.searchMessage.textContent = message;
  window.setTimeout(() => {
    if (elements.searchMessage.textContent === message) {
      elements.searchMessage.textContent = "";
    }
  }, 3000);
}

// --- Code Runner ---

function updateRunButton(): void {
  if (!hasActiveTab()) {
    elements.runCodeBtn.hidden = true;
    return;
  }
  const tab = activeTab();
  const lang = resolveLanguage(tab.language, tab.name);
  if (lang !== null) {
    elements.runCodeBtn.hidden = false;
    if (canRun(tab.language, tab.name)) {
      elements.runCodeBtn.classList.remove("disabled");
      elements.runCodeBtn.title = "Run code";
    } else {
      elements.runCodeBtn.classList.add("disabled");
      elements.runCodeBtn.title = `Compiler not found — click for setup instructions`;
    }
  } else {
    elements.runCodeBtn.hidden = true;
  }
}

async function executeCode(): Promise<void> {
  const tab = activeTab();
  const lang = resolveLanguage(tab.language, tab.name);
  if (!lang) return;

  await stopActiveRunSession();

  if (!canRun(tab.language, tab.name)) {
    elements.outputPanel.hidden = false;
    setOutputText(getSetupInstructions(lang));
    return;
  }

  elements.outputPanel.hidden = false;
  setOutputText("Running...\n");
  pendingRunnerInput = "";

  try {
    const result = await startRunSession(lang, tab.content);
    outputBuffer = "";
    appendRunChunks(result.chunks);

    if (!result.sessionId) {
      if (result.phase === "compile" && result.exitCode !== 0) {
        setOutputText(`Compilation failed:\n${result.stderr ?? outputBuffer}`);
      }
      appendExitCode(result.exitCode);
      return;
    }

    activeRunSessionId = result.sessionId;
    if (result.running) {
      pollActiveRunSession();
      elements.outputContent.focus();
    } else {
      appendExitCode(result.exitCode);
    }
  } catch (err) {
    setOutputText(`Error: Could not connect to runner server.\nMake sure the runner is started (node server/runner.mjs)`);
  }
}

function closeOutputPanel(): void {
  void stopActiveRunSession();
  elements.outputPanel.hidden = true;
  setOutputText("");
  pendingRunnerInput = "";
}

function setOutputText(text: string): void {
  outputBuffer = text;
  elements.outputText.textContent = outputBuffer;
  elements.outputContent.scrollTop = elements.outputContent.scrollHeight;
}

function appendOutput(text: string): void {
  outputBuffer += text;
  elements.outputText.textContent = outputBuffer;
  elements.outputContent.scrollTop = elements.outputContent.scrollHeight;
}

function appendRunChunks(chunks: RunChunk[] = []): void {
  for (const chunk of chunks) {
    appendOutput(chunk.stream === "stderr" ? `\n${chunk.text}` : chunk.text);
  }
}

function appendExitCode(exitCode: number | null): void {
  if (exitCode === null) return;
  const separator = outputBuffer.trim().length === 0 ? "" : "\n\n\n";
  appendOutput(`${separator}Exit code: ${exitCode}`);
}

async function pollActiveRunSession(): Promise<void> {
  if (!activeRunSessionId) return;
  window.clearTimeout(runPollTimer);

  try {
    const result = await pollRunSession(activeRunSessionId);
    appendRunChunks(result.chunks);

    if (result.running) {
      runPollTimer = window.setTimeout(() => {
        void pollActiveRunSession();
      }, 150);
      return;
    }

    activeRunSessionId = undefined;
    pendingRunnerInput = "";
    appendExitCode(result.exitCode);
  } catch {
    activeRunSessionId = undefined;
    pendingRunnerInput = "";
    appendOutput("\nRunner session ended.");
  }
}

async function stopActiveRunSession(): Promise<void> {
  window.clearTimeout(runPollTimer);
  runPollTimer = undefined;
  const sessionId = activeRunSessionId;
  activeRunSessionId = undefined;
  pendingRunnerInput = "";
  if (sessionId) {
    await stopRunSession(sessionId);
  }
}

async function submitRunnerInput(value: string): Promise<void> {
  if (!activeRunSessionId) return;
  await sendRunInput(activeRunSessionId, `${value}\n`);
  pollActiveRunSession();
}

async function handleRunnerConsoleKeydown(event: KeyboardEvent): Promise<void> {
  if (!activeRunSessionId) return;

  if (event.key === "Enter") {
    event.preventDefault();
    const value = pendingRunnerInput;
    pendingRunnerInput = "";
    appendOutput("\n");
    await submitRunnerInput(value);
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    if (pendingRunnerInput.length === 0) return;
    pendingRunnerInput = pendingRunnerInput.slice(0, -1);
    outputBuffer = outputBuffer.slice(0, -1);
    elements.outputText.textContent = outputBuffer;
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    pendingRunnerInput += "\t";
    appendOutput("\t");
    return;
  }

  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    pendingRunnerInput += event.key;
    appendOutput(event.key);
  }
}

function handleRunnerConsolePaste(event: ClipboardEvent): void {
  if (!activeRunSessionId) return;
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text) return;
  event.preventDefault();
  pendingRunnerInput += text;
  appendOutput(text);
}

// Initialize runner detection
detectCompilers().then(() => updateRunButton());
