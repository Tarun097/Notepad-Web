# Release Notes

## 0.5.0

File handling improvements, new tools, and UX enhancements.

### Added

- **Inline tab rename**: Double-click a tab to rename it in place. Press Enter to confirm, Escape to cancel.
- **Closeable last tab**: All tabs can now be closed, including the last one. The editor shows an empty state with no tabs.
- **New file from File menu**: "New" option added to the File dropdown.
- **Flatten JSON tool**: Minifies/flattens JSON to a single line. Available in Tools dropdown and command palette.
- **Paginated diff rows**: Large diffs are paginated with a "Load more" button instead of rendering all rows at once.
- **Paginated search results**: Find All results now paginate with "Load more" for large result sets.
- **IndexedDB file handle persistence**: File handles are stored in IndexedDB so Ctrl+S works across page reloads.
- **Permission handling for save**: Requests write permission before saving when needed.

### Changed

- Default tab names no longer contain spaces: `new1.txt`, `new2.txt`, etc.
- Duplicate tab names use hyphen: `filename.txt-copy` instead of `filename.txt copy`.
- Duplicated tabs are marked dirty (unsaved) so closing prompts to save.
- Renamed tabs show dirty dot and clear the file handle, so Ctrl+S triggers Save As with the new name.
- After saving a renamed file, a notification reminds the user to manually delete the old file on disk.
- Save no longer overwrites the tab name with the file handle name (preserves user renames).
- Session restore now supports zero-tab state.

### Fixed

- **File content not loading**: Opening a file from disk that matches an existing tab name now properly loads content and remounts the editor.
- **Ctrl+S opening Finder dialog**: Save now falls through to Save As when no file handle exists, instead of showing an error message.
- **Diff with large files**: Diff results are paginated to prevent browser rendering limits from causing blank output.

## 0.4.0

Tab drag-and-drop overhaul, recent files, and file picker improvements.

### Added

- **Open Recent Files**: File dropdown now shows the last 10 opened files, ordered most recent first. Selecting a recent file opens it in a new tab.
- **Drag tab to new window**: Dragging a tab outside the tab bar (e.g., onto the browser's tab bar) opens a fresh app instance with that file's content.
- **Native drag-and-drop for tab reordering**: Tabs can be reordered by dragging and dropping. The target tab highlights instantly during drag-over, and tabs swap positions on drop.

### Changed

- Tab reordering now swaps the dragged tab with the target tab (instead of shifting/inserting).
- File picker now accepts `.cs`, `.cpp`, `.c`, `.h`, and `.groovy` extensions in addition to previously supported types.

### Fixed

- **Tab click regression**: Clicking tabs to switch between them was broken due to `setPointerCapture` stealing click event targets. Replaced the pointer-based drag system with native HTML drag-and-drop, which does not interfere with click events.

## 0.3.1

UI polish and usability improvements.

### Added

- **+ tab button**: A "+" button after the last tab for quick new file creation.
- **Tools dropdown**: "Format JSON" and "Diff" consolidated into a "Tools ▾" dropdown for extensibility.

### Changed

- Removed "New" button from toolbar (replaced by + tab button).
- Theme toggle now shows ☾ (moon) in light mode and ☀️ (sun) in dark mode.
- Word wrap button now shows ↩ icon instead of text.
- Whitespace toggle now shows ¶ icon instead of "Invisibles" text.
- Column edit button now shows ┃▌ icon with clearer tooltip.
- Editor font zoom range expanded to 8px–72px (was 10–30px).

## 0.3.0

Major feature additions: in-editor code execution, new language modes, and UI cleanup.

### Added

- **Code Runner**: Execute code directly from the editor for Java, C++, C#, and Groovy.
  - Local runner server (`server/runner.mjs`) auto-detects installed compilers.
  - ▶ Run button appears in toolbar when a supported language is active and its compiler is available.
  - Output panel (resizable, closeable) displays stdout, stderr, compilation errors, and exit code.
  - Java: auto-detects public class name for correct filename.
  - C++: compiles with `g++` and runs the binary.
  - C#: creates a temporary `dotnet` console project and runs it.
  - Groovy: runs scripts with `groovy` using Java 17.
  - Vite proxy (`/api`) routes requests to the runner server — no CORS issues.
- **New language modes**: C++, C#, and Groovy added to the language dropdown with syntax highlighting.
- **Vite configuration**: Added `vite.config.ts` with dev server proxy.

### Changed

- Removed the redundant "Session" sidebar — tabs already show all open files.
- Editor area now uses full width (single-column grid layout).
- `run.sh` now starts both the runner server and Vite dev server, with cleanup on exit.

### Fixed

- Runner server compiler detection now correctly handles missing commands (ENOENT).
- Java runner uses the actual public class name from source code instead of hardcoded "Main".

## 0.2.0

Major feature additions: diff view, improved search, and tab management.

### Added

- **Diff view**: Side-by-side file comparison with LCS-based diff algorithm.
  - Inline character-level highlighting for changed lines (common prefix/suffix detection).
  - Similarity-based change detection (>50% common content pairs lines as changes instead of separate insert/delete).
  - Prev/Next navigation buttons to jump between diff sections.
  - Comparison only triggers on explicit "Compare" button click.
  - Swap button to reverse left/right files.
- **Search results bottom panel**: Find All results now appear in a dedicated resizable panel below the editor.
  - Results grouped by file with collapsible `<details>` sections (Notepad++ style).
  - Clicking a result navigates to the correct file and line.
  - Drag-to-resize handle for adjusting panel height.
  - Panel only spans the editor area (not the left sidebar).
  - Close button to dismiss the panel.
- **Tab close buttons**: Each file tab now has a × close button (visible on hover/active).
- Format JSON button in the toolbar.

### Changed

- Search results moved from Find/Replace dialog to bottom panel.
- Editor area restructured with flex layout for editor + search panel.
- Diff tab no longer auto-compares on open; user must click Compare.

### Fixed

- Diff algorithm now correctly detects changes when lines are similar but not identical.
- Diff navigation jumps to the beginning of each contiguous diff section (not every individual row).

## 0.1.0

Initial usable release of Notepad+ Web.

### Added

- Browser-based Notepad++-style editor built with Vite, TypeScript, and CodeMirror.
- Multi-tab editing with session restore and dirty-state indicators.
- Local file open, save, save-as, and download fallback.
- Syntax modes for common text and source formats.
- Find/Replace floating dialog with Find and Replace tabs.
- Search and replace in the current file or all open files.
- Clickable Find All results with file, line, column, and preview.
- Draggable modeless Find/Replace dialog that does not block editor interaction.
- Line-number click and drag selection.
- Rectangular/column editing and multi-cursor editing support.
- Visible selection styling for active single-line documents.
- Editor font zoom using `Cmd/Ctrl+mouse wheel` and keyboard zoom shortcuts.
- Word wrap, visible whitespace, light/dark theme, and status bar.
- `run.sh` helper script for starting the app locally.

### Verified

- Production build passes with `npm run build`.
- Browser smoke tests covered editor loading, Find/Replace popup behavior, all-open-files search/replace, draggable dialog behavior, editor interaction behind the dialog, and clean console output.
