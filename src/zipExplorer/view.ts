import { ZipExplorerState, ZipTreeNode } from "./types";
import { loadZipFile, readFileContent, isZipPath, expandNestedZip, buildTree } from "./state";
import { inferLanguage, languageExtension } from "../languages";
import { editorTheme } from "../editorExtensions";
import { EditorView, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { defaultKeymap } from "@codemirror/commands";
import { ThemeId } from "../types";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ZipTab {
  path: string;
  name: string;
  content: string;
  editorView?: EditorView;
}

export class ZipExplorerView {
  private state: ZipExplorerState | undefined;
  private fileInput: HTMLInputElement;
  private readonly themeCompartment = new Compartment();
  private loading = false;
  private openTabs: ZipTab[] = [];
  private activeTabPath: string | undefined;

  get editor(): EditorView | undefined { return this.openTabs.find(t => t.path === this.activeTabPath)?.editorView; }
  get selectedPath(): string | undefined { return this.activeTabPath; }
  get tabs(): ReadonlyArray<{ path: string; name: string; content: string }> { return this.openTabs; }

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: { onChange: () => void; onNotify: (msg: string) => void },
  ) {
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".zip,.jar,.war,.ear,.apk,.ipa,.epub,.docx,.xlsx,.pptx";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => this.handleFileSelected());
    root.append(this.fileInput);
    root.addEventListener("click", (e) => this.handleClick(e));
    root.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
  }

  render(): void {
    this.destroyAllEditors();
    this.root.className = "zip-explorer-view";
    if (!this.state) {
      this.root.innerHTML = `<div class="zip-empty-state"><button class="zip-open-btn" data-zip-action="open">Open ZIP File</button></div>`;
      this.root.append(this.fileInput);
      return;
    }
    this.root.innerHTML = `
      <aside class="zip-sidebar">
        <div class="zip-sidebar-header">
          <strong title="${escapeHtml(this.state.fileName)}">${escapeHtml(this.state.fileName)}</strong>
          <button class="mini-button" data-zip-action="open" title="Open another">⌁</button>
        </div>
        <div class="zip-tree">${this.renderTree(this.state.tree.children)}</div>
      </aside>
      <div class="zip-sidebar-resize" data-zip-resize="sidebar" aria-hidden="true"></div>
      <section class="zip-workspace">
        <div class="zip-tab-bar"></div>
        <div class="zip-editor-area"><div class="zip-empty-state">Select a file from the tree</div></div>
      </section>
    `;
    this.root.append(this.fileInput);
  }

  private renderTree(nodes: ZipTreeNode[]): string {
    return nodes.map((node) => {
      if (node.dir) {
        return `<details class="zip-tree-folder" data-zip-path="${escapeHtml(node.path)}">
          <summary>${escapeHtml(node.name)}</summary>
          ${this.renderTree(node.children)}
        </details>`;
      }
      const active = this.state?.selectedPath === node.path ? " active" : "";
      return `<div class="zip-tree-file${active}" data-zip-path="${escapeHtml(node.path)}">${escapeHtml(node.name)}</div>`;
    }).join("");
  }

  private mountEditor(content: string, filePath: string): void {
    const editorArea = this.root.querySelector(".zip-editor-area");
    if (!editorArea) return;
    editorArea.innerHTML = "";
    const lang = inferLanguage(filePath);
    const theme = (document.documentElement.dataset.theme || "light") as ThemeId;
    const ev = new EditorView({
      parent: editorArea as HTMLElement,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          foldGutter(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageExtension(lang),
          this.themeCompartment.of(editorTheme(theme, 14)),
          keymap.of([...defaultKeymap, ...foldKeymap]),
          EditorState.readOnly.of(true),
        ],
      }),
    });
    const tab = this.openTabs.find(t => t.path === filePath);
    if (tab) tab.editorView = ev;
  }

  updateTheme(theme: ThemeId): void {
    for (const tab of this.openTabs) {
      tab.editorView?.dispatch({ effects: this.themeCompartment.reconfigure(editorTheme(theme, 14)) });
    }
  }

  private destroyAllEditors(): void {
    for (const tab of this.openTabs) {
      tab.editorView?.destroy();
      tab.editorView = undefined;
    }
    this.openTabs = [];
    this.activeTabPath = undefined;
  }

  private renderTabBar(): void {
    const bar = this.root.querySelector(".zip-tab-bar");
    if (!bar) return;
    bar.innerHTML = this.openTabs.map(t => {
      const active = t.path === this.activeTabPath ? " active" : "";
      return `<div class="zip-tab${active}" data-zip-tab="${escapeHtml(t.path)}" title="${escapeHtml(t.path)}"><span class="zip-tab-name">${escapeHtml(t.name)}</span><span class="zip-tab-close" data-zip-close="${escapeHtml(t.path)}">×</span></div>`;
    }).join("");
  }

  private handleClick(e: Event): void {
    const target = e.target as HTMLElement;
    const action = target.dataset.zipAction;
    if (action === "open") { if (!this.loading) this.fileInput.click(); return; }
    // Close tab
    const closePath = target.dataset.zipClose;
    if (closePath) { this.closeTab(closePath); return; }
    // Switch tab
    const tabEl = target.closest<HTMLElement>(".zip-tab");
    if (tabEl?.dataset.zipTab) { this.switchTab(tabEl.dataset.zipTab); return; }
    // Open file from tree
    const fileEl = target.closest<HTMLElement>(".zip-tree-file");
    const filePath = fileEl?.dataset.zipPath;
    if (filePath && this.state) {
      this.openFile(filePath);
    }
  }

  private switchTab(path: string): void {
    if (path === this.activeTabPath) return;
    this.activeTabPath = path;
    if (this.state) this.state.selectedPath = path;
    this.renderTabBar();
    this.mountEditor(this.openTabs.find(t => t.path === path)!.content, path);
    this.updateTreeSelection(path);
  }

  private closeTab(path: string): void {
    const idx = this.openTabs.findIndex(t => t.path === path);
    if (idx === -1) return;
    this.openTabs[idx].editorView?.destroy();
    this.openTabs.splice(idx, 1);
    if (this.activeTabPath === path) {
      const next = this.openTabs[Math.min(idx, this.openTabs.length - 1)];
      this.activeTabPath = next?.path;
      if (this.state) this.state.selectedPath = this.activeTabPath;
      if (next) {
        this.mountEditor(next.content, next.path);
      } else {
        const editorArea = this.root.querySelector(".zip-editor-area");
        if (editorArea) editorArea.innerHTML = `<div class="zip-empty-state">Select a file from the tree</div>`;
      }
    }
    this.renderTabBar();
    if (this.activeTabPath) this.updateTreeSelection(this.activeTabPath);
  }

  private updateTreeSelection(path: string): void {
    this.root.querySelector(".zip-tree-file.active")?.classList.remove("active");
    this.root.querySelector<HTMLElement>(`.zip-tree-file[data-zip-path="${CSS.escape(path)}"]`)?.classList.add("active");
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target.dataset.zipResize !== "sidebar") return;
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    this.root.classList.add("resizing-sidebar");

    const onMove = (moveEvent: PointerEvent): void => {
      const rootRect = this.root.getBoundingClientRect();
      const width = Math.max(160, Math.min(520, moveEvent.clientX - rootRect.left));
      this.root.style.setProperty("--zip-sidebar-width", `${width}px`);
    };

    const onUp = (): void => {
      this.root.classList.remove("resizing-sidebar");
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  async openFile(filePath: string): Promise<void> {
    if (!this.state) return;
    if (isZipPath(filePath)) {
      await this.expandZipInTree(filePath);
      return;
    }
    // Auto-expand any parent nested zips in the path
    const parts = filePath.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const partial = parts.slice(0, i + 1).join("/");
      if (isZipPath(partial)) {
        const node = this.findNode(this.state.tree, partial);
        if (node && !node.dir) {
          await this.expandZipInTree(partial);
        }
      }
    }
    this.state.selectedPath = filePath;
    this.root.querySelector(".zip-tree-file.active")?.classList.remove("active");
    // Open all ancestor folders in the sidebar
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join("/");
      const details = this.root.querySelector<HTMLDetailsElement>(`.zip-tree-folder[data-zip-path="${CSS.escape(ancestorPath)}"]`);
      if (details) details.open = true;
    }
    this.root.querySelector<HTMLElement>(`.zip-tree-file[data-zip-path="${CSS.escape(filePath)}"]`)?.classList.add("active");
    // If already open, just switch to it
    if (this.openTabs.find(t => t.path === filePath)) {
      this.switchTab(filePath);
      return;
    }
    const editorArea = this.root.querySelector(".zip-editor-area");
    if (editorArea) editorArea.innerHTML = `<div class="zip-empty-state">Loading...</div>`;
    const content = await readFileContent(filePath);
    if (this.state?.selectedPath === filePath) {
      this.state.fileContent = content;
      const name = filePath.split("/").pop() || filePath;
      this.openTabs.push({ path: filePath, name, content });
      this.activeTabPath = filePath;
      this.renderTabBar();
      this.mountEditor(content, filePath);
    }
  }

  private async expandZipInTree(filePath: string): Promise<void> {
    if (!this.state) return;
    const entries = await expandNestedZip(filePath);
    if (entries.length === 0) return;
    const node = this.findNode(this.state.tree, filePath);
    if (node) {
      node.dir = true;
      // entries have full paths (filePath + "/" + innerPath), buildTree needs them as-is
      // but we need to insert children relative to this node
      const subtree = buildTree(entries);
      // Navigate buildTree result to find the node matching filePath
      const subNode = this.findNode(subtree, filePath);
      node.children = subNode ? subNode.children : subtree.children;
    }
    // Capture open folders before re-render
    const openPaths = new Set<string>();
    this.root.querySelectorAll<HTMLDetailsElement>(".zip-tree-folder[open]").forEach((d) => { if (d.dataset.zipPath) openPaths.add(d.dataset.zipPath); });
    openPaths.add(filePath);
    // Re-render tree
    const treeEl = this.root.querySelector(".zip-tree");
    if (treeEl) treeEl.innerHTML = this.renderTree(this.state.tree.children);
    // Restore open state
    openPaths.forEach((p) => {
      const el = this.root.querySelector<HTMLDetailsElement>(`.zip-tree-folder[data-zip-path="${CSS.escape(p)}"]`);
      if (el) el.open = true;
    });
  }

  private findNode(tree: ZipTreeNode, path: string): ZipTreeNode | undefined {
    if (tree.path === path) return tree;
    for (const child of tree.children) {
      const found = this.findNode(child, path);
      if (found) return found;
    }
    return undefined;
  }

  private async handleFileSelected(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = "";
    if (!file) return;
    this.loading = true;
    try {
      this.state = await loadZipFile(file);
      this.render();
    } catch (err) {
      this.callbacks.onNotify(err instanceof Error ? err.message : "Failed to open ZIP");
    }
    this.loading = false;
  }
}
