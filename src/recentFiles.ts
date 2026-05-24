import { RecentFile } from "./types";

const RECENT_FILES_KEY = "notepad-plus-web-recent";
const MAX_RECENT_FILES = 10;

export function getRecentFiles(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]") as RecentFile[];
  } catch {
    return [];
  }
}

export function addRecentFile(name: string, content: string, language: string): void {
  const recent = getRecentFiles().filter((file) => file.name !== name);
  recent.unshift({ name, content, language, openedAt: Date.now() });
  if (recent.length > MAX_RECENT_FILES) recent.length = MAX_RECENT_FILES;
  saveRecentFiles(recent);
}

export function removeRecentFileAt(index: number): void {
  const recent = getRecentFiles();
  recent.splice(index, 1);
  saveRecentFiles(recent);
}

function saveRecentFiles(recent: RecentFile[]): void {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recent));
  } catch {
    // Recent files are a convenience cache; failing to persist should not block editing.
  }
}
