import { Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, MatchDecorator, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { ThemeId } from "./types";

export function editorTheme(theme: ThemeId, fontSize: number): Extension {
  const selectionColor = theme === "dark" ? "#4f91cf" : "#6fb3ff";
  const inactiveSelectionColor = theme === "dark" ? "#3d5e7b" : "#9fc9f7";

  return EditorView.theme(
    {
      "&": {
        height: "100%",
        color: theme === "dark" ? "#e8edf4" : "#17202c",
        backgroundColor: theme === "dark" ? "#141922" : "#ffffff",
        caretColor: theme === "dark" ? "#ffffff" : "#111827",
      },
      ".cm-scroller": {
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: `${fontSize}px`,
        lineHeight: "1.55",
      },
      ".cm-gutters": {
        backgroundColor: theme === "dark" ? "#10151d" : "#f4f6fa",
        color: theme === "dark" ? "#8290a3" : "#687589",
        borderRight: `1px solid ${theme === "dark" ? "#273140" : "#dde3ed"}`,
      },
      ".cm-activeLine": {
        backgroundColor: theme === "dark" ? "rgba(67, 184, 155, 0.08)" : "rgba(22, 114, 94, 0.055)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: theme === "dark" ? "rgba(67, 184, 155, 0.12)" : "rgba(22, 114, 94, 0.095)",
      },
      ".cm-selectionBackground": {
        backgroundColor: `${inactiveSelectionColor} !important`,
      },
      "&.cm-focused .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: `${selectionColor} !important`,
      },
      ".cm-line ::selection": {
        backgroundColor: `${selectionColor} !important`,
      },
      ".cm-searchMatch": {
        backgroundColor: theme === "dark" ? "#7d5d18" : "#ffe28a",
        outline: "1px solid transparent",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: theme === "dark" ? "#a65f28" : "#f2a65a",
      },
    },
    { dark: theme === "dark" },
  );
}

export function visibleWhitespace(): Extension {
  class WhitespaceWidget extends WidgetType {
    constructor(private readonly value: string) {
      super();
    }

    eq(other: WhitespaceWidget): boolean {
      return this.value === other.value;
    }

    toDOM(): HTMLElement {
      const span = document.createElement("span");
      span.className = this.value === "\t" ? "cm-visible-tab" : "cm-visible-space";
      span.textContent = this.value === "\t" ? "→\t" : "·";
      return span;
    }
  }

  const matcher = new MatchDecorator({
    regexp: /[ \t]/g,
    decoration: (match) => Decoration.replace({ widget: new WhitespaceWidget(match[0]) }),
  });

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }

      update(update: ViewUpdate): void {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}
