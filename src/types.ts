import { HttpClientState } from "./httpClient/types";

export type LanguageId =
  | "plaintext"
  | "javascript"
  | "typescript"
  | "html"
  | "css"
  | "json"
  | "markdown"
  | "python"
  | "sql"
  | "java"
  | "cpp"
  | "csharp"
  | "groovy";

export type ThemeId = "light" | "dark";

export type LineEnding = "LF" | "CRLF";
export type SearchScope = "current" | "all";
export type SearchMode = "find" | "replace";
export type DiffKind = "equal" | "insert" | "delete" | "change";

export type FileHandle = {
  name: string;
  getFile: () => Promise<File>;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileHandle>;
  }
}

export interface DocumentTab {
  id: string;
  name: string;
  content: string;
  savedContent: string;
  language: LanguageId;
  lineEnding: LineEnding;
  kind?: "text" | "diff" | "http";
  diff?: DiffState;
  http?: HttpClientState;
  handle?: FileHandle;
  selection?: { anchor: number; head: number };
  _renamedFrom?: string;
}

export interface SearchState {
  query: string;
  replacement: string;
  matchCase: boolean;
  regex: boolean;
}

export interface AppState {
  tabs: DocumentTab[];
  activeId: string;
  splitId?: string;
  splitSize: number;
  theme: ThemeId;
  wrap: boolean;
  showWhitespace: boolean;
  fontSize: number;
  search: SearchState;
}

export interface DiffRow {
  kind: DiffKind;
  leftLine?: number;
  rightLine?: number;
  leftText: string;
  rightText: string;
}

export interface DiffState {
  leftId: string;
  rightId: string;
  summary: string;
  rows: DiffRow[];
}

export interface CommandDefinition {
  id: string;
  label: string;
  hint: string;
  run: () => void | Promise<void>;
}

export interface RecentFile {
  name: string;
  content: string;
  language: string;
  openedAt: number;
}
