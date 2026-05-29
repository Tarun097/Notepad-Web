type ShapeTool =
  | "line"
  | "rectangle"
  | "rounded-rectangle"
  | "ellipse"
  | "diamond"
  | "parallelogram"
  | "document"
  | "cylinder"
  | "cloud"
  | "component"
  | "package"
  | "class-box"
  | "actor"
  | "lifeline"
  | "arrow"
  | "dotted-arrow"
  | "double-arrow"
  | "dependency";

type DrawTool = "select" | "pencil" | "text" | ShapeTool;

type Point = { x: number; y: number };

type DrawItem =
  | { type: "pencil"; color: string; size: number; points: Point[] }
  | { type: ShapeTool; color: string; size: number; start: Point; end: Point }
  | { type: "text"; color: string; size: number; start: Point; text: string };

const TOOL_LABELS: Record<DrawTool, string> = {
  select: "Select / move",
  pencil: "Pencil",
  text: "Text",
  line: "Line",
  rectangle: "Rectangle",
  "rounded-rectangle": "Rounded rectangle",
  ellipse: "Ellipse",
  diamond: "Decision",
  parallelogram: "Input / output",
  document: "Document",
  cylinder: "Database",
  cloud: "Cloud",
  component: "Component",
  package: "Package",
  "class-box": "Class",
  actor: "Actor",
  lifeline: "Lifeline",
  arrow: "Arrow",
  "dotted-arrow": "Dotted arrow",
  "double-arrow": "Bidirectional arrow",
  dependency: "Dependency",
};

const COLOR_SWATCHES = ["#111827", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];

const TOOL_ICONS: Record<DrawTool, string> = {
  select: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 5l14 12-8 1-3 8z"/><path d="M18 19l5 6"/></svg>`,
  pencil: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 23c4-9 8-13 16-15M6 26c3-1 5-1 7-3"/></svg>`,
  text: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 8h16M16 8v17M12 25h8"/></svg>`,
  line: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25L25 7"/></svg>`,
  arrow: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25L25 7M17 7h8v8"/></svg>`,
  "dotted-arrow": `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="dash" d="M7 25L25 7"/><path d="M17 7h8v8"/></svg>`,
  "double-arrow": `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 24L24 8M16 8h8v8M16 24H8v-8"/></svg>`,
  dependency: `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="dash" d="M7 25L25 7"/><path d="M18 7h7v7"/></svg>`,
  rectangle: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="9" width="18" height="14"/></svg>`,
  "rounded-rectangle": `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="9" width="18" height="14" rx="4"/></svg>`,
  ellipse: `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="16" rx="10" ry="7"/></svg>`,
  diamond: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6l11 10-11 10L5 16z"/></svg>`,
  parallelogram: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 8h16l-6 16H5z"/></svg>`,
  document: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7h18v15c-5 5-10-3-18 2z"/></svg>`,
  cylinder: `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="9" rx="10" ry="4"/><path d="M6 9v14c0 2 5 4 10 4s10-2 10-4V9"/><path d="M6 23c0 2 5 4 10 4s10-2 10-4"/></svg>`,
  cloud: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 23c-4 0-6-3-4-6 1-2 3-3 6-2 1-5 8-6 10-1 4-1 7 2 6 6-1 2-3 3-6 3z"/></svg>`,
  component: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="8" width="17" height="16"/><rect x="5" y="11" width="7" height="4"/><rect x="5" y="18" width="7" height="4"/></svg>`,
  package: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12V7h10l3 5h9v14H5z"/></svg>`,
  "class-box": `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="6" width="20" height="20"/><path d="M6 13h20M6 20h20"/></svg>`,
  actor: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="8" r="4"/><path d="M16 12v9M8 15h16M16 21l-7 7M16 21l7 7"/></svg>`,
  lifeline: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="8" y="5" width="16" height="7"/><path class="dash" d="M16 12v16"/></svg>`,
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizedRect(start: Point, end: Point): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function itemBounds(item: DrawItem): { x: number; y: number; width: number; height: number } {
  if (item.type === "pencil") {
    const xs = item.points.map((point) => point.x);
    const ys = item.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
  }
  if (item.type === "text") {
    const lines = item.text.split(/\n/);
    const width = Math.max(40, ...lines.map((line) => line.length * item.size * 0.62));
    return { x: item.start.x, y: item.start.y, width, height: Math.max(item.size, lines.length * item.size * 1.25) };
  }
  return normalizedRect(item.start, item.end);
}

export class DrawView {
  private canvas: HTMLCanvasElement | undefined;
  private ctx: CanvasRenderingContext2D | undefined;
  private workspace: HTMLElement | undefined;
  private textInput: HTMLTextAreaElement | undefined;
  private readonly resizeObserver = new ResizeObserver(() => this.resizeCanvas());
  private readonly items: DrawItem[] = [];
  private tool: DrawTool = "select";
  private color = "#111827";
  private strokeSize = 3;
  private zoom = 1;
  private selectedIndex = -1;
  private draft: DrawItem | undefined;
  private drawing = false;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener("click", (event) => this.handleClick(event));
    root.addEventListener("input", (event) => this.handleInput(event));
    root.addEventListener("keydown", (event) => this.handleKeyDown(event));
  }

  render(): void {
    this.root.className = "draw-view";
    this.root.innerHTML = `
      <aside class="draw-sidebar">
        <div class="draw-section">
          <strong>Sketch</strong>
          <div class="draw-tool-grid">
            ${this.renderToolButton("select")}
            ${this.renderToolButton("pencil")}
            ${this.renderToolButton("text")}
          </div>
        </div>
        <div class="draw-section">
          <strong>Connectors</strong>
          <div class="draw-tool-grid">
            ${this.renderToolButton("line")}
            ${this.renderToolButton("arrow")}
            ${this.renderToolButton("dotted-arrow")}
            ${this.renderToolButton("double-arrow")}
            ${this.renderToolButton("dependency")}
          </div>
        </div>
        <div class="draw-section">
          <strong>Flow</strong>
          <div class="draw-tool-grid">
            ${this.renderToolButton("rectangle")}
            ${this.renderToolButton("rounded-rectangle")}
            ${this.renderToolButton("ellipse")}
            ${this.renderToolButton("diamond")}
            ${this.renderToolButton("parallelogram")}
            ${this.renderToolButton("document")}
          </div>
        </div>
        <div class="draw-section">
          <strong>UML</strong>
          <div class="draw-tool-grid">
            ${this.renderToolButton("class-box")}
            ${this.renderToolButton("actor")}
            ${this.renderToolButton("lifeline")}
            ${this.renderToolButton("package")}
          </div>
        </div>
        <div class="draw-section">
          <strong>Architecture</strong>
          <div class="draw-tool-grid">
            ${this.renderToolButton("component")}
            ${this.renderToolButton("cylinder")}
            ${this.renderToolButton("cloud")}
          </div>
        </div>
        <div class="draw-section">
          <strong>Color</strong>
          <input class="draw-color-input" data-draw-color type="color" value="${escapeHtml(this.color)}" title="Color" />
          <div class="draw-swatch-row">
            ${COLOR_SWATCHES.map((color) => `<button class="draw-swatch${color === this.color ? " active" : ""}" data-draw-swatch="${color}" style="--swatch:${color}" title="${color}"></button>`).join("")}
          </div>
        </div>
        <label class="draw-section draw-size-control">
          <strong>Stroke</strong>
          <input data-draw-size type="range" min="1" max="18" value="${this.strokeSize}" />
          <span>${this.strokeSize}px</span>
        </label>
        <div class="draw-section">
          <strong>Zoom</strong>
          <div class="draw-zoom-controls">
            <button class="mini-button" data-draw-action="zoom-out">-</button>
            <span class="draw-zoom-value">${Math.round(this.zoom * 100)}%</span>
            <button class="mini-button" data-draw-action="zoom-in">+</button>
          </div>
          <button class="mini-button" data-draw-action="zoom-reset">Reset zoom</button>
        </div>
        <div class="draw-section draw-actions">
          <button class="mini-button" data-draw-action="undo">Undo</button>
          <button class="mini-button" data-draw-action="clear">Clear</button>
        </div>
      </aside>
      <section class="draw-workspace">
        <canvas class="draw-canvas" tabindex="0"></canvas>
      </section>
    `;
    this.canvas = this.root.querySelector<HTMLCanvasElement>(".draw-canvas") ?? undefined;
    this.workspace = this.root.querySelector<HTMLElement>(".draw-workspace") ?? undefined;
    this.ctx = this.canvas?.getContext("2d") ?? undefined;
    if (this.canvas) {
      this.canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    }
    if (this.workspace) this.resizeObserver.observe(this.workspace);
    this.syncControls();
    this.resizeCanvas();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.textInput?.remove();
    this.textInput = undefined;
  }

  refreshTheme(): void {
    this.redraw();
  }

  private renderToolButton(tool: DrawTool): string {
    const active = this.tool === tool ? " active" : "";
    return `<button class="draw-tool${active}" data-draw-tool="${tool}" title="${TOOL_LABELS[tool]}">${TOOL_ICONS[tool]}</button>`;
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const tool = target.closest<HTMLElement>("[data-draw-tool]")?.dataset.drawTool as DrawTool | undefined;
    if (tool) {
      this.tool = tool;
      this.syncControls();
      this.redraw();
      return;
    }

    const swatch = target.closest<HTMLElement>("[data-draw-swatch]")?.dataset.drawSwatch;
    if (swatch) {
      this.color = swatch;
      this.syncControls();
      return;
    }

    const action = target.closest<HTMLElement>("[data-draw-action]")?.dataset.drawAction;
    if (action === "undo") {
      this.undo();
    } else if (action === "clear") {
      this.items.length = 0;
      this.selectedIndex = -1;
      this.redraw();
    } else if (action === "zoom-in") {
      this.setZoom(this.zoom * 1.2);
    } else if (action === "zoom-out") {
      this.setZoom(this.zoom / 1.2);
    } else if (action === "zoom-reset") {
      this.setZoom(1);
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undo();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.selectedIndex < 0) return;
      event.preventDefault();
      this.deleteSelected();
    }
  }

  private undo(): void {
    this.items.pop();
    this.selectedIndex = Math.min(this.selectedIndex, this.items.length - 1);
    this.redraw();
  }

  private deleteSelected(): void {
    if (this.selectedIndex < 0) return;
    this.items.splice(this.selectedIndex, 1);
    this.selectedIndex = -1;
    this.redraw();
  }

  private setZoom(value: number): void {
    this.zoom = Math.min(3, Math.max(0.35, value));
    this.syncControls();
    this.redraw();
  }

  private moveItem(item: DrawItem, dx: number, dy: number): void {
    if (item.type === "pencil") {
      item.points = item.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    } else if (item.type === "text") {
      item.start = { x: item.start.x + dx, y: item.start.y + dy };
    } else {
      item.start = { x: item.start.x + dx, y: item.start.y + dy };
      item.end = { x: item.end.x + dx, y: item.end.y + dy };
    }
  }

  private hitTest(point: Point): number {
    const tolerance = 8 / this.zoom;
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const bounds = itemBounds(this.items[i]);
      if (
        point.x >= bounds.x - tolerance &&
        point.x <= bounds.x + bounds.width + tolerance &&
        point.y >= bounds.y - tolerance &&
        point.y <= bounds.y + bounds.height + tolerance
      ) {
        return i;
      }
    }
    return -1;
  }

  private handleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-draw-color]")) {
      this.color = target.value;
      this.syncControls();
    } else if (target.matches("[data-draw-size]")) {
      this.strokeSize = Number(target.value) || 3;
      this.syncControls();
    }
  }

  private syncControls(): void {
    this.root.querySelectorAll<HTMLElement>(".draw-tool").forEach((button) => {
      button.classList.toggle("active", button.dataset.drawTool === this.tool);
    });
    this.canvas?.classList.toggle("text-mode", this.tool === "text");
    this.canvas?.classList.toggle("move-mode", this.tool === "select");
    this.root.querySelector<HTMLInputElement>("[data-draw-color]")!.value = this.color;
    this.root.querySelectorAll<HTMLElement>(".draw-swatch").forEach((button) => {
      button.classList.toggle("active", button.dataset.drawSwatch === this.color);
    });
    this.root.querySelector<HTMLElement>(".draw-size-control span")!.textContent = `${this.strokeSize}px`;
    this.root.querySelector<HTMLElement>(".draw-zoom-value")!.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.canvas) return;
    this.canvas.focus();
    const start = this.pointFromEvent(event);
    if (this.tool === "select") {
      event.preventDefault();
      this.capturePointer(event);
      this.selectedIndex = this.hitTest(start);
      let last = start;
      this.redraw();

      const onMove = (moveEvent: PointerEvent): void => {
        if (this.selectedIndex < 0) return;
        const next = this.pointFromEvent(moveEvent);
        this.moveItem(this.items[this.selectedIndex], next.x - last.x, next.y - last.y);
        last = next;
        this.redraw();
      };

      const onUp = (): void => {
        this.canvas?.removeEventListener("pointermove", onMove);
        this.canvas?.removeEventListener("pointerup", onUp);
        this.canvas?.removeEventListener("pointercancel", onUp);
      };

      this.canvas.addEventListener("pointermove", onMove);
      this.canvas.addEventListener("pointerup", onUp);
      this.canvas.addEventListener("pointercancel", onUp);
      return;
    }
    if (this.tool === "text") {
      this.openTextBox(start);
      return;
    }

    event.preventDefault();
    this.capturePointer(event);
    this.drawing = true;
    this.draft = this.createDraft(start);

    const onMove = (moveEvent: PointerEvent): void => {
      if (!this.drawing || !this.draft) return;
      this.updateDraft(this.pointFromEvent(moveEvent));
      this.redraw(this.draft);
    };

    const onUp = (upEvent: PointerEvent): void => {
      if (!this.draft) return;
      this.updateDraft(this.pointFromEvent(upEvent));
      if (this.isVisibleItem(this.draft)) {
        this.items.push(this.draft);
        this.selectedIndex = this.items.length - 1;
      }
      this.draft = undefined;
      this.drawing = false;
      this.redraw();
      this.canvas?.removeEventListener("pointermove", onMove);
      this.canvas?.removeEventListener("pointerup", onUp);
      this.canvas?.removeEventListener("pointercancel", onUp);
    };

    this.canvas.addEventListener("pointermove", onMove);
    this.canvas.addEventListener("pointerup", onUp);
    this.canvas.addEventListener("pointercancel", onUp);
  }

  private capturePointer(event: PointerEvent): void {
    try {
      this.canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events and some edge cases do not have an active pointer capture target.
    }
  }

  private createDraft(start: Point): DrawItem {
    if (this.tool === "pencil") {
      return { type: "pencil", color: this.color, size: this.strokeSize, points: [start] };
    }
    if (this.tool === "text") {
      return { type: "text", color: this.color, size: Math.max(14, this.strokeSize * 5), start, text: "" };
    }
    if (this.tool === "select") {
      throw new Error("Select tool does not create draw items");
    }
    return { type: this.tool, color: this.color, size: this.strokeSize, start, end: start };
  }

  private updateDraft(point: Point): void {
    if (!this.draft) return;
    if (this.draft.type === "pencil") {
      this.draft.points.push(point);
    } else if (this.draft.type !== "text") {
      this.draft.end = point;
    }
  }

  private isVisibleItem(item: DrawItem): boolean {
    if (item.type === "pencil") return item.points.length > 1;
    if (item.type === "text") return item.text.trim().length > 0;
    return distance(item.start, item.end) > 3;
  }

  private pointFromEvent(event: PointerEvent): Point {
    const rect = this.canvas!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / this.zoom,
      y: (event.clientY - rect.top) / this.zoom,
    };
  }

  private openTextBox(point: Point): void {
    if (!this.workspace) return;
    this.textInput?.dispatchEvent(new Event("blur"));
    const input = document.createElement("textarea");
    input.className = "draw-text-input";
    input.placeholder = "Text";
    input.rows = 1;
    input.spellcheck = false;
    input.style.left = `${point.x * this.zoom}px`;
    input.style.top = `${point.y * this.zoom}px`;
    input.style.color = this.color;
    input.style.fontSize = `${Math.max(14, this.strokeSize * 5) * this.zoom}px`;
    this.workspace.append(input);
    this.textInput = input;

    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const text = input.value.trim();
      if (text) {
        this.items.push({ type: "text", color: this.color, size: Math.max(14, this.strokeSize * 5), start: point, text });
        this.selectedIndex = this.items.length - 1;
        this.redraw();
      }
      input.remove();
      if (this.textInput === input) this.textInput = undefined;
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        input.remove();
        if (this.textInput === input) this.textInput = undefined;
      }
    });
    input.addEventListener("blur", commit, { once: true });
    requestAnimationFrame(() => input.focus());
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.workspace || !this.ctx) return;
    const rect = this.workspace.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.redraw();
  }

  private redraw(draft?: DrawItem): void {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio * this.zoom, 0, 0, ratio * this.zoom, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(this.root).getPropertyValue("--draw-canvas-bg").trim() || "#ffffff";
    ctx.fillRect(0, 0, width / this.zoom, height / this.zoom);
    for (const item of this.items) this.drawItem(item);
    if (draft) this.drawItem(draft);
    this.drawSelection();
    ctx.restore();
  }

  private drawSelection(): void {
    if (this.selectedIndex < 0 || !this.items[this.selectedIndex]) return;
    const ctx = this.ctx!;
    const bounds = itemBounds(this.items[this.selectedIndex]);
    const pad = 6 / this.zoom;
    ctx.save();
    ctx.strokeStyle = "#4169d8";
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
    ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
    ctx.restore();
  }

  private drawItem(item: DrawItem): void {
    const ctx = this.ctx!;
    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (item.type === "pencil") {
      this.drawPencil(item);
    } else if (item.type === "line") {
      this.drawLine(item.start, item.end);
    } else if (item.type === "rectangle") {
      this.drawRectangle(item.start, item.end);
    } else if (item.type === "rounded-rectangle") {
      this.drawRoundedRectangle(item.start, item.end);
    } else if (item.type === "ellipse") {
      this.drawEllipse(item.start, item.end);
    } else if (item.type === "diamond") {
      this.drawDiamond(item.start, item.end);
    } else if (item.type === "parallelogram") {
      this.drawParallelogram(item.start, item.end);
    } else if (item.type === "document") {
      this.drawDocument(item.start, item.end);
    } else if (item.type === "cylinder") {
      this.drawCylinder(item.start, item.end);
    } else if (item.type === "cloud") {
      this.drawCloud(item.start, item.end);
    } else if (item.type === "component") {
      this.drawComponent(item.start, item.end);
    } else if (item.type === "package") {
      this.drawPackage(item.start, item.end);
    } else if (item.type === "class-box") {
      this.drawClassBox(item.start, item.end);
    } else if (item.type === "actor") {
      this.drawActor(item.start, item.end);
    } else if (item.type === "lifeline") {
      this.drawLifeline(item.start, item.end);
    } else if (item.type === "arrow" || item.type === "dotted-arrow" || item.type === "double-arrow" || item.type === "dependency") {
      if (item.type === "dotted-arrow" || item.type === "dependency") ctx.setLineDash([8, 8]);
      this.drawArrow(item.start, item.end, item.size, item.type === "double-arrow");
    } else if (item.type === "text") {
      this.drawText(item);
    }
    ctx.restore();
  }

  private drawPencil(item: Extract<DrawItem, { type: "pencil" }>): void {
    if (item.points.length < 2) return;
    const ctx = this.ctx!;
    ctx.beginPath();
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  private drawLine(start: Point, end: Point): void {
    const ctx = this.ctx!;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  private drawRectangle(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  private drawRoundedRectangle(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const radius = Math.min(16, rect.width / 4, rect.height / 4);
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.stroke();
  }

  private drawEllipse(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawDiamond(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.width / 2, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height / 2);
    ctx.lineTo(rect.x + rect.width / 2, rect.y + rect.height);
    ctx.lineTo(rect.x, rect.y + rect.height / 2);
    ctx.closePath();
    ctx.stroke();
  }

  private drawParallelogram(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const skew = Math.min(28, rect.width * 0.22);
    ctx.beginPath();
    ctx.moveTo(rect.x + skew, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y);
    ctx.lineTo(rect.x + rect.width - skew, rect.y + rect.height);
    ctx.lineTo(rect.x, rect.y + rect.height);
    ctx.closePath();
    ctx.stroke();
  }

  private drawDocument(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const wave = Math.min(18, rect.height * 0.22);
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height - wave);
    ctx.bezierCurveTo(rect.x + rect.width * 0.66, rect.y + rect.height + wave, rect.x + rect.width * 0.34, rect.y + rect.height - wave * 2, rect.x, rect.y + rect.height);
    ctx.closePath();
    ctx.stroke();
  }

  private drawCylinder(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const cap = Math.min(22, rect.height * 0.22);
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.width / 2, rect.y + cap, rect.width / 2, cap, 0, 0, Math.PI * 2);
    ctx.moveTo(rect.x, rect.y + cap);
    ctx.lineTo(rect.x, rect.y + rect.height - cap);
    ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height - cap, rect.width / 2, cap, 0, Math.PI, 0, true);
    ctx.lineTo(rect.x + rect.width, rect.y + cap);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.width / 2, rect.y + cap, rect.width / 2, cap, 0, 0, Math.PI);
    ctx.stroke();
  }

  private drawCloud(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const x = rect.x;
    const y = rect.y;
    const w = rect.width;
    const h = rect.height;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + h * 0.75);
    ctx.bezierCurveTo(x - w * 0.04, y + h * 0.72, x + w * 0.02, y + h * 0.35, x + w * 0.28, y + h * 0.42);
    ctx.bezierCurveTo(x + w * 0.32, y + h * 0.12, x + w * 0.68, y + h * 0.1, x + w * 0.72, y + h * 0.42);
    ctx.bezierCurveTo(x + w * 1.02, y + h * 0.34, x + w * 1.06, y + h * 0.72, x + w * 0.78, y + h * 0.75);
    ctx.closePath();
    ctx.stroke();
  }

  private drawComponent(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    const notchW = Math.min(22, rect.width * 0.2);
    const notchH = Math.min(12, rect.height * 0.16);
    ctx.strokeRect(rect.x - notchW * 0.3, rect.y + rect.height * 0.25, notchW, notchH);
    ctx.strokeRect(rect.x - notchW * 0.3, rect.y + rect.height * 0.55, notchW, notchH);
  }

  private drawPackage(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const tabW = Math.min(72, rect.width * 0.45);
    const tabH = Math.min(22, rect.height * 0.22);
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + tabH);
    ctx.lineTo(rect.x, rect.y);
    ctx.lineTo(rect.x + tabW, rect.y);
    ctx.lineTo(rect.x + tabW + 12, rect.y + tabH);
    ctx.lineTo(rect.x + rect.width, rect.y + tabH);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
    ctx.lineTo(rect.x, rect.y + rect.height);
    ctx.closePath();
    ctx.stroke();
  }

  private drawClassBox(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    const first = rect.y + rect.height * 0.32;
    const second = rect.y + rect.height * 0.66;
    ctx.beginPath();
    ctx.moveTo(rect.x, first);
    ctx.lineTo(rect.x + rect.width, first);
    ctx.moveTo(rect.x, second);
    ctx.lineTo(rect.x + rect.width, second);
    ctx.stroke();
  }

  private drawActor(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const cx = rect.x + rect.width / 2;
    const headRadius = Math.min(rect.width, rect.height) * 0.14;
    const headY = rect.y + headRadius * 1.3;
    const bodyTop = headY + headRadius;
    const bodyBottom = rect.y + rect.height * 0.68;
    ctx.beginPath();
    ctx.arc(cx, headY, headRadius, 0, Math.PI * 2);
    ctx.moveTo(cx, bodyTop);
    ctx.lineTo(cx, bodyBottom);
    ctx.moveTo(rect.x + rect.width * 0.2, rect.y + rect.height * 0.38);
    ctx.lineTo(rect.x + rect.width * 0.8, rect.y + rect.height * 0.38);
    ctx.moveTo(cx, bodyBottom);
    ctx.lineTo(rect.x + rect.width * 0.24, rect.y + rect.height);
    ctx.moveTo(cx, bodyBottom);
    ctx.lineTo(rect.x + rect.width * 0.76, rect.y + rect.height);
    ctx.stroke();
  }

  private drawLifeline(start: Point, end: Point): void {
    const ctx = this.ctx!;
    const rect = normalizedRect(start, end);
    const cx = rect.x + rect.width / 2;
    const headerH = Math.min(42, rect.height * 0.24);
    ctx.strokeRect(rect.x, rect.y, rect.width, headerH);
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(cx, rect.y + headerH);
    ctx.lineTo(cx, rect.y + rect.height);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawArrow(start: Point, end: Point, size: number, bothEnds = false): void {
    this.drawLine(start, end);
    if (bothEnds) this.drawArrowHead(end, start, size);
    this.drawArrowHead(start, end, size);
  }

  private drawArrowHead(start: Point, end: Point, size: number): void {
    const ctx = this.ctx!;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headLength = Math.max(14, size * 5);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  private drawText(item: Extract<DrawItem, { type: "text" }>): void {
    const ctx = this.ctx!;
    ctx.font = `${item.size}px "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`;
    ctx.textBaseline = "top";
    const lines = item.text.split(/\n/);
    lines.forEach((line, index) => ctx.fillText(line, item.start.x, item.start.y + index * item.size * 1.25));
  }
}
