// diff_csv_words.js
// Usage:
//   node diff_csv_words.js A.csv B.csv output.csv
//
// Assumptions:
// - Each row contains one word in the first column.
// - CSV may optionally have a header row.
// - The script computes A - B.

const fs = require("fs");

// ====== Options ======
const HAS_HEADER_A = false;
const HAS_HEADER_B = false;
const CASE_INSENSITIVE = true;
const TRIM_WHITESPACE = true;
// =====================

function normalizeWord(word) {
  let w = String(word);

  if (TRIM_WHITESPACE) {
    w = w.trim();
  }

  if (CASE_INSENSITIVE) {
    w = w.toLowerCase();
  }

  return w;
}

function parseFirstColumn(csvText, hasHeader) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== "");
  const startIndex = hasHeader ? 1 : 0;

  const words = [];
  for (let i = startIndex; i < lines.length; i++) {
    // Very simple CSV handling: take the first column only.
    // Works well if each row is just one word, or the word is in column 1.
    const firstColumn = lines[i].split(",")[0];
    if (firstColumn !== undefined) {
      words.push(firstColumn);
    }
  }

  return words;
}

function csvEscape(value) {
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function main() {
  const [, , fileA, fileB, outputFile] = process.argv;

  if (!fileA || !fileB || !outputFile) {
    console.error("Usage: node diff_csv_words.js A.csv B.csv output.csv");
    process.exit(1);
  }

  const csvA = fs.readFileSync(fileA, "utf8");
  const csvB = fs.readFileSync(fileB, "utf8");

  const rawWordsA = parseFirstColumn(csvA, HAS_HEADER_A);
  const rawWordsB = parseFirstColumn(csvB, HAS_HEADER_B);

  const normalizedB = new Set(rawWordsB.map(normalizeWord));

  // Keep original word form from A in the output,
  // but compare using normalized form.
  const result = [];
  const seen = new Set();

  for (const word of rawWordsA) {
    const normalized = normalizeWord(word);

    if (!normalized) continue;
    if (!normalizedB.has(normalized) && !seen.has(normalized)) {
      result.push(word.trim());
      seen.add(normalized);
    }
  }

  const outputLines = ["word", ...result.map(csvEscape)];
  fs.writeFileSync(outputFile, outputLines.join("\n"), "utf8");

  console.log(`Done. ${result.length} words written to ${outputFile}`);
}

main();