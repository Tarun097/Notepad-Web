export interface SearchRange {
  from: number;
  to: number;
  text: string;
  match?: RegExpExecArray;
}

export function findRanges(
  text: string,
  query: string,
  options: { matchCase?: boolean; regex?: boolean } = {},
  limit = Number.POSITIVE_INFINITY,
  skip = 0,
): SearchRange[] {
  if (!query) return [];

  if (options.regex) {
    const flags = options.matchCase ? "g" : "gi";
    let re: RegExp;
    try { re = new RegExp(query, flags); } catch { return []; }
    const ranges: SearchRange[] = [];
    let match: RegExpExecArray | null;
    let skipped = 0;
    while ((match = re.exec(text))) {
      if (skipped < skip) { skipped++; if (match[0].length === 0) re.lastIndex += 1; continue; }
      if (ranges.length >= limit) break;
      ranges.push({ from: match.index, to: match.index + match[0].length, text: match[0], match });
      if (match[0].length === 0) re.lastIndex += 1;
    }
    return ranges;
  }

  const haystack = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
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

export function countMatches(text: string, query: string, options: { matchCase?: boolean; regex?: boolean } = {}): number {
  if (!query) return 0;

  if (options.regex) {
    const flags = options.matchCase ? "g" : "gi";
    let re: RegExp;
    try { re = new RegExp(query, flags); } catch { return 0; }
    let count = 0;
    while (re.exec(text)) { count++; if (re.lastIndex === re.lastIndex) { /* prevent infinite on zero-width */ } }
    return count;
  }

  const haystack = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return count;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
