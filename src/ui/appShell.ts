export function renderAppShell(app: HTMLElement): void {
  app.innerHTML = `
  <main class="app-shell">
    <header class="topbar" aria-label="Application toolbar">
      <div class="brand">
        <span class="brand-mark">N+</span>
        <span class="brand-name">Notepad+ Web</span>
      </div>
      <nav class="toolbar" aria-label="File actions">
        <div class="menu-container" id="fileMenuContainer">
          <button class="tool-button" id="fileMenuBtn" title="File">File ▾</button>
          <div class="dropdown-menu" id="fileMenu" hidden>
            <div class="dropdown-item" data-file-action="new">New</div>
            <div class="dropdown-item" data-file-action="open">Open</div>
            <div class="dropdown-item" data-file-action="save">Save</div>
            <div class="dropdown-item" data-file-action="save-as">Save As</div>
            <div class="dropdown-item has-submenu" data-file-action="show-recent">Recent Files ▸</div>
          </div>
        </div>
        <div class="menu-container" id="toolsMenuContainer">
          <button class="tool-button" id="toolsMenuBtn" title="Tools">Tools ▾</button>
          <div class="dropdown-menu" id="toolsMenu" hidden>
            <div class="dropdown-item has-submenu" data-tools-action="show-json">JSON ▸</div>
            <div class="dropdown-item" data-tools-action="diff">Diff</div>
            <div class="dropdown-item" data-tools-action="http-client">HTTP Client</div>
          </div>
        </div>
        <button class="tool-button" data-action="run-code" id="runCodeBtn" title="Run code (Java/C++/C#)" hidden>&#9654; Run</button>
      </nav>
      <div class="toolbar right-tools" aria-label="Editor options">
        <select id="languageSelect" title="Language mode" aria-label="Language mode"></select>
        <button class="tool-button" data-action="column" title="Multi-cursor column edit (Cmd/Ctrl+Shift+L)">┃▌</button>
        <button class="tool-button toggle" data-action="split" title="Toggle split editor">⇄</button>
        <button class="tool-button" data-action="command-palette" title="Command palette (Cmd/Ctrl+Shift+P)">⌘</button>
        <button class="tool-button toggle" data-action="wrap" title="Toggle word wrap">↩</button>
        <button class="tool-button toggle" data-action="whitespace" title="Show whitespace">¶</button>
        <button class="tool-button toggle" data-action="theme" id="themeBtn" title="Toggle theme"><b>&#9790;</b></button>
      </div>
    </header>

    <section class="tabs-row" aria-label="Open documents">
      <div id="tabs" class="tabs" role="tablist"></div>
      <div id="splitTabControls" class="split-tab-controls" hidden>
        <span id="splitTitle"></span>
        <select id="splitSelect" title="Split editor file"></select>
        <button class="icon-button" data-action="close-split" title="Close split">x</button>
      </div>
      <input id="openInput" type="file" multiple hidden />
    </section>

    <section class="editor-area">

      <div class="editor-main">
        <div id="editorSplit" class="editor-split">
          <div id="editor" class="editor-host" aria-label="Text editor"></div>
          <div id="splitResize" class="split-resize-handle" data-action="resize-split" hidden></div>
          <aside id="splitPane" class="split-pane" hidden>
            <div id="splitEditor" class="editor-host split-editor-host" aria-label="Split text editor"></div>
          </aside>
        </div>
        <div id="diffView" class="diff-tab-view" aria-label="Diff view" hidden>
          <div class="diff-body">
            <div class="diff-controls">
              <label class="field">
                <span>Left file</span>
                <select id="diffLeftSelect"></select>
              </label>
              <label class="field">
                <span>Right file</span>
                <select id="diffRightSelect"></select>
              </label>
              <div class="diff-actions">
                <button class="mini-button" data-action="swap-diff">Swap</button>
                <button class="mini-button primary" data-action="compare-diff">Compare</button>
                <button class="mini-button" data-action="prev-diff">&#9650; Prev</button>
                <button class="mini-button" data-action="next-diff">&#9660; Next</button>
              </div>
            </div>

            <div id="diffSummary" class="diff-summary" aria-live="polite"></div>
            <div id="diffResults" class="diff-results" aria-live="polite"></div>
          </div>
        </div>
        <div id="httpClientView" class="http-client-tab-view" aria-label="HTTP client" hidden></div>
        <div id="searchPanel" class="search-panel" hidden>
          <div class="search-panel-resize" data-action="resize-search-panel"></div>
          <div class="search-panel-header">
            <span class="search-panel-title">Search Results</span>
            <button class="icon-button" data-action="close-search-panel" title="Close">x</button>
          </div>
          <div id="searchResults" class="search-results" aria-live="polite"></div>
        </div>
        <div id="outputPanel" class="output-panel" hidden>
          <div class="output-panel-resize" data-action="resize-output-panel"></div>
          <div class="output-panel-header">
            <span class="output-panel-title">Output</span>
            <button class="icon-button" data-action="close-output-panel" title="Close">x</button>
          </div>
          <div id="outputContent" class="output-content" role="log" aria-live="polite" tabindex="0"><pre id="outputText" class="output-text"></pre></div>
        </div>
      </div>
    </section>

    <footer class="statusbar" aria-label="Editor status">
      <span id="statusDocument"></span>
      <span id="statusCursor"></span>
      <span id="statusEncoding">UTF-8</span>
      <span id="statusEnding"></span>
      <span id="statusFontSize"></span>
      <span id="statusLength"></span>
    </footer>

    <div id="findDialog" class="find-dialog-shell" hidden>
      <section class="find-dialog" role="dialog" aria-modal="false" aria-labelledby="findDialogTitle">
        <header class="dialog-header">
          <div>
            <h2 id="findDialogTitle">Find and Replace</h2>
          </div>
          <button class="icon-button" data-action="close-find" title="Close">x</button>
        </header>

        <div class="dialog-tabs" role="tablist" aria-label="Find dialog mode">
          <button id="findModeButton" class="dialog-tab active" data-action="find-mode" role="tab" aria-selected="true">Find</button>
          <button id="replaceModeButton" class="dialog-tab" data-action="replace-mode" role="tab" aria-selected="false">Replace</button>
        </div>

        <div class="dialog-body">
          <label class="field">
            <span>Find what</span>
            <input id="findInput" type="search" autocomplete="off" />
          </label>
          <label id="replaceField" class="field">
            <span>Replace with</span>
            <input id="replaceInput" type="text" autocomplete="off" />
          </label>

          <fieldset class="option-group">
            <legend>Scope</legend>
            <label class="radio-control"><input name="searchScope" type="radio" value="current" checked /> Current file</label>
            <label class="radio-control"><input name="searchScope" type="radio" value="all" /> All open files</label>
          </fieldset>

          <div class="dialog-options">
            <label class="check-control"><input id="matchCaseInput" type="checkbox" /> Match case</label>
            <label class="check-control"><input id="regexInput" type="checkbox" /> Regex</label>
          </div>

          <div class="dialog-actions">
            <button class="mini-button" data-action="find-prev">Find Previous</button>
            <button class="mini-button primary" data-action="find-next">Find Next</button>
            <button class="mini-button" data-action="find-all">Find All</button>
            <button class="mini-button replace-only" data-action="replace-one">Replace</button>
            <button class="mini-button replace-only danger" data-action="replace-all">Replace All</button>
          </div>

          <span id="searchMessage" class="search-message" aria-live="polite"></span>
        </div>
      </section>
    </div>

    <div id="goToLineDialog" class="command-palette-shell" hidden>
      <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="goToLineTitle" style="max-width:320px;">
        <h2 id="goToLineTitle">Go to Line</h2>
        <input id="goToLineInput" type="number" min="1" autocomplete="off" placeholder="Line number" />
      </section>
    </div>

    <div id="commandPalette" class="command-palette-shell" hidden>
      <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="commandPaletteTitle">
        <h2 id="commandPaletteTitle">Command Palette</h2>
        <input id="commandInput" type="search" autocomplete="off" placeholder="Type a command" />
        <div id="commandList" class="command-list" role="listbox"></div>
      </section>
    </div>

  </main>
`;
}

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}
