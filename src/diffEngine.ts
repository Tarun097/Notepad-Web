import { DiffRow } from "./types";

export function buildLineDiff(leftText: string, rightText: string): DiffRow[] {
  const leftLines = splitDiffLines(leftText);
  const rightLines = splitDiffLines(rightText);
  const maxDiffCells = 1_500_000;
  if (leftLines.length * rightLines.length > maxDiffCells) {
    return buildLineByLineDiff(leftLines, rightLines);
  }
  const ops = reorderDiffOps(buildDiffOps(leftLines, rightLines));
  const rows: DiffRow[] = [];

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];

    if (op.kind === "equal") {
      rows.push({
        kind: "equal",
        leftLine: op.leftIndex! + 1,
        rightLine: op.rightIndex! + 1,
        leftText: op.text,
        rightText: op.text,
      });
      continue;
    }

    if (op.kind === "delete") {
      const deletes = [];
      while (ops[index]?.kind === "delete") {
        deletes.push(ops[index]);
        index += 1;
      }

      const inserts = [];
      while (ops[index]?.kind === "insert") {
        inserts.push(ops[index]);
        index += 1;
      }
      index -= 1;

      const count = Math.max(deletes.length, inserts.length);
      for (let offset = 0; offset < count; offset += 1) {
        const deleted = deletes[offset];
        const inserted = inserts[offset];
        rows.push({
          kind: deleted && inserted ? "change" : deleted ? "delete" : "insert",
          leftLine: deleted?.leftIndex === undefined ? undefined : deleted.leftIndex + 1,
          rightLine: inserted?.rightIndex === undefined ? undefined : inserted.rightIndex + 1,
          leftText: deleted?.text ?? "",
          rightText: inserted?.text ?? "",
        });
      }
      continue;
    }

    rows.push({
      kind: "insert",
      rightLine: op.rightIndex! + 1,
      leftText: "",
      rightText: op.text,
    });
  }

  return rows;
}

export function summarizeDiff(leftName: string, rightName: string, rows: DiffRow[]): string {
  const added = rows.filter((row) => row.kind === "insert").length;
  const removed = rows.filter((row) => row.kind === "delete").length;
  const changed = rows.filter((row) => row.kind === "change").length;
  return added || removed || changed
    ? `${leftName} vs ${rightName}: ${changed} changed, ${added} added, ${removed} removed.`
    : `${leftName} and ${rightName} match.`;
}

function buildLineByLineDiff(leftLines: string[], rightLines: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const count = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < count; index += 1) {
    const leftText = leftLines[index];
    const rightText = rightLines[index];

    if (leftText === rightText) {
      rows.push({
        kind: "equal",
        leftLine: index + 1,
        rightLine: index + 1,
        leftText,
        rightText,
      });
    } else if (leftText === undefined) {
      rows.push({
        kind: "insert",
        rightLine: index + 1,
        leftText: "",
        rightText,
      });
    } else if (rightText === undefined) {
      rows.push({
        kind: "delete",
        leftLine: index + 1,
        leftText,
        rightText: "",
      });
    } else {
      rows.push({
        kind: "change",
        leftLine: index + 1,
        rightLine: index + 1,
        leftText,
        rightText,
      });
    }
  }
  return rows;
}

function splitDiffLines(text: string): string[] {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return normalized.length === 0 ? [""] : normalized.split("\n");
}

function reorderDiffOps(
  ops: Array<{ kind: "equal" | "delete" | "insert"; text: string; leftIndex?: number; rightIndex?: number }>,
): typeof ops {
  const result: typeof ops = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "equal") {
      result.push(ops[i]);
      i += 1;
      continue;
    }
    const deletes: typeof ops = [];
    const inserts: typeof ops = [];
    while (i < ops.length && ops[i].kind !== "equal") {
      if (ops[i].kind === "delete") deletes.push(ops[i]);
      else inserts.push(ops[i]);
      i += 1;
    }
    result.push(...deletes, ...inserts);
  }
  return result;
}

function areSimilar(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const minLen = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < minLen - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const common = prefix + suffix;
  return common / Math.max(a.length, b.length) > 0.5;
}

function buildDiffOps(
  leftLines: string[],
  rightLines: string[],
): Array<{ kind: "equal" | "delete" | "insert"; text: string; leftIndex?: number; rightIndex?: number }> {
  const rowCount = leftLines.length;
  const columnCount = rightLines.length;
  const dp = Array.from({ length: rowCount + 1 }, () => Array<number>(columnCount + 1).fill(0));

  for (let leftIndex = rowCount - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = columnCount - 1; rightIndex >= 0; rightIndex -= 1) {
      dp[leftIndex][rightIndex] =
        leftLines[leftIndex] === rightLines[rightIndex]
          ? dp[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(dp[leftIndex + 1][rightIndex], dp[leftIndex][rightIndex + 1]);
    }
  }

  const ops: Array<{ kind: "equal" | "delete" | "insert"; text: string; leftIndex?: number; rightIndex?: number }> = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < rowCount && rightIndex < columnCount) {
    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      ops.push({
        kind: "equal",
        text: leftLines[leftIndex],
        leftIndex,
        rightIndex,
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (dp[leftIndex + 1][rightIndex] > dp[leftIndex][rightIndex + 1]) {
      if (areSimilar(leftLines[leftIndex], rightLines[rightIndex])) {
        ops.push({ kind: "delete", text: leftLines[leftIndex], leftIndex });
        ops.push({ kind: "insert", text: rightLines[rightIndex], rightIndex });
        leftIndex += 1;
        rightIndex += 1;
      } else {
        ops.push({ kind: "delete", text: leftLines[leftIndex], leftIndex });
        leftIndex += 1;
      }
    } else if (dp[leftIndex + 1][rightIndex] < dp[leftIndex][rightIndex + 1]) {
      if (areSimilar(leftLines[leftIndex], rightLines[rightIndex])) {
        ops.push({ kind: "delete", text: leftLines[leftIndex], leftIndex });
        ops.push({ kind: "insert", text: rightLines[rightIndex], rightIndex });
        leftIndex += 1;
        rightIndex += 1;
      } else {
        ops.push({ kind: "insert", text: rightLines[rightIndex], rightIndex });
        rightIndex += 1;
      }
    } else {
      ops.push({ kind: "delete", text: leftLines[leftIndex], leftIndex });
      ops.push({ kind: "insert", text: rightLines[rightIndex], rightIndex });
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  while (leftIndex < rowCount) {
    ops.push({ kind: "delete", text: leftLines[leftIndex], leftIndex });
    leftIndex += 1;
  }

  while (rightIndex < columnCount) {
    ops.push({ kind: "insert", text: rightLines[rightIndex], rightIndex });
    rightIndex += 1;
  }

  return ops;
}
