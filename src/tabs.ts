import { LineEnding } from "./types";

export function inferLineEnding(content: string): LineEnding {
  return content.includes("\r\n") ? "CRLF" : "LF";
}

export function nextUntitledName(existingNames: string[]): string {
  const names = new Set(existingNames);
  let index = 1;
  while (names.has(`new${index}.txt`)) {
    index += 1;
  }
  return `new${index}.txt`;
}
