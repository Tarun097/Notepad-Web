export function formatRequestJson(value: string): string {
  return JSON.stringify(parseRequestJson(value), null, 2);
}

export function parseRequestJson(value: string): unknown {
  const trimmed = extractJsonCandidate(value.trim() || "{}");
  try {
    return JSON.parse(trimmed);
  } catch {
    return JSON.parse(toStrictJson(trimmed));
  }
}

function extractJsonCandidate(value: string): string {
  const withoutSemicolon = value.replace(/;\s*$/, "").trim();
  const stringifyStart = withoutSemicolon.indexOf("JSON.stringify(");
  if (stringifyStart !== -1) {
    const openIndex = withoutSemicolon.indexOf("(", stringifyStart);
    const extracted = extractParenthesized(withoutSemicolon, openIndex);
    if (extracted) return extracted.trim();
  }
  return withoutSemicolon;
}

function extractParenthesized(value: string, openIndex: number): string | undefined {
  if (openIndex < 0 || value[openIndex] !== "(") return undefined;
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return value.slice(openIndex + 1, index);
    }
  }
  return undefined;
}

function toStrictJson(value: string): string {
  return value
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content: string) => JSON.stringify(content.replace(/\\'/g, "'")))
    .replace(/,\s*([}\]])/g, "$1");
}
