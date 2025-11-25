#!/usr/bin/env node
// dp_solver.js
// Exact global optimal E[steps] solver for Wordle-like game
// - Answers = candidate list from a text file (one 5-letter word per line)
// - Guesses are restricted to the current candidate set (hard-mode style)

// ============================
// 0. Small utility
// ============================
function timeStr() {
  return new Date().toISOString();
}

// ============================
// 1. Read word list
// ============================

const fs = require('fs');
const path = require('path');

const WORD_FILE = process.argv[2] || 'words_2309.txt'; // default filename

if (!fs.existsSync(WORD_FILE)) {
  console.error(`Usage: node dp_solver.js <word_list_file>`);
  console.error(`File not found: ${WORD_FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(WORD_FILE, 'utf8');
const WORDS = raw
  .split(/\r?\n/)
  .map(s => s.trim().toLowerCase())
  .filter(s => /^[a-z]{5}$/.test(s));

if (WORDS.length === 0) {
  console.error(`No valid 5-letter words in ${WORD_FILE}`);
  process.exit(1);
}

console.log(`[${timeStr()}] Loaded ${WORDS.length} words from ${WORD_FILE}`);

// Build index mapping: word -> index
const indexByWord = new Map();
WORDS.forEach((w, i) => indexByWord.set(w, i));

// ============================
// 2. Pattern function
//    pattern: guess vs answer → 5 chars in '0','1','2'
// ============================

function patternFor(guess, answer) {
  // Both guess & answer are 5-letter lowercase strings
  const g = guess;
  const a = answer;
  const res = Array(5).fill('0');
  const used = Array(5).fill(false);

  // First pass: greens
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = '2';
      used[i] = true;
    }
  }
  // Second pass: yellows
  for (let i = 0; i < 5; i++) {
    if (res[i] !== '2') {
      const ch = g[i];
      for (let j = 0; j < 5; j++) {
        if (!used[j] && a[j] === ch) {
          used[j] = true;
          res[i] = '1';
          break;
        }
      }
    }
  }
  return res.join('');
}

// ============================
// 3. Precompute pattern table
//    patterns[i][j] = pattern(WORDS[i], WORDS[j])
// ============================

console.log(`[${timeStr()}] Precomputing pattern table...`);

const N = WORDS.length;
const PAT = new Array(N);
for (let i = 0; i < N; i++) {
  PAT[i] = new Array(N);
}

for (let i = 0; i < N; i++) {
  const gi = WORDS[i];
  for (let j = 0; j < N; j++) {
    const aj = WORDS[j];
    PAT[i][j] = patternFor(gi, aj);
  }
  if ((i + 1) % 200 === 0) {
    console.log(`[${timeStr()}]  precomputed row ${i + 1} / ${N}`);
  }
}

console.log(`[${timeStr()}] Pattern table ready.`);

// ============================
// 4. DP over candidate sets
//    State = sorted array of indices
//    Key   = indices.join(',')
// ============================

const memo = new Map();     // key -> expected steps (number)
const choice = new Map();   // key -> best guess index (for policy)

// For monitoring
let statesEvaluated = 0;

/**
 * Compute expected steps E(S) for a given candidate set S (array of indices).
 * Returns a number >= 1.
 */
function solveState(cands) {
  const len = cands.length;
  if (len <= 0) return 0;        // unreachable / degenerate
  if (len === 1) return 1;       // exactly one candidate, guess now

  // Build key
  const key = cands.join(',');
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  statesEvaluated++;
  if (statesEvaluated % 1000 === 0) {
    console.log(`[${timeStr()}] statesEvaluated=${statesEvaluated}, memo.size=${memo.size}`);
  }

  const size = len;
  let bestE = Infinity;
  let bestG = -1;

  // Loop over possible guesses g ∈ S (hard-mode style)
  for (let gi = 0; gi < len; gi++) {
    const gIdx = cands[gi];

    // Partition S by patterns for guess gIdx
    const buckets = new Map(); // pattern -> array of indices
    for (let k = 0; k < len; k++) {
      const ansIdx = cands[k];
      const pat = PAT[gIdx][ansIdx];
      let arr = buckets.get(pat);
      if (!arr) {
        arr = [];
        buckets.set(pat, arr);
      }
      arr.push(ansIdx);
    }

    // Compute expected cost if we choose guess gIdx now
    // E = 1 (this guess) + Σ_p ( |S_p| / |S| ) * E(S_p )
    let expected = 0;
    for (const arr of buckets.values()) {
      const bucketSize = arr.length;
      const prob = bucketSize / size;
      const subE = solveState(arr);  // recursive call
      expected += prob * subE;

      // Small branch-and-bound: if already worse than best, break
      if (expected + 1 >= bestE) {
        break;
      }
    }
    expected = 1 + expected;

    if (expected < bestE) {
      bestE = expected;
      bestG = gIdx;
    }
  }

  memo.set(key, bestE);
  if (bestG >= 0) choice.set(key, bestG);

  return bestE;
}

// ============================
// 5. Main: root state = all candidates
// ============================

console.log(`[${timeStr()}] Starting DP solve...`);

const allCands = [];
for (let i = 0; i < N; i++) allCands.push(i);

const rootE = solveState(allCands);
const rootKey = allCands.join(',');
const rootBestIdx = choice.get(rootKey);

console.log(`\n========== RESULT ==========\n`);
console.log(`Words file  : ${WORD_FILE}`);
console.log(`Candidates  : ${N}`);
console.log(`E[steps]    : ${rootE.toFixed(6)}`);
if (rootBestIdx !== undefined) {
  console.log(`Best first guess (hard-mode optimal): ${WORDS[rootBestIdx].toUpperCase()} (index ${rootBestIdx})`);
} else {
  console.log(`No best first guess recorded (?)`);
}

console.log(`\nStates evaluated: ${statesEvaluated}`);
console.log(`Memo size       : ${memo.size}`);
console.log(`[${timeStr()}] Done.\n`);

// Optionally, dump a small JSON with root-layer info
const outJson = {
  wordsFile: path.basename(WORD_FILE),
  numCandidates: N,
  rootE,
  bestRootGuessIndex: rootBestIdx,
  bestRootGuessWord: rootBestIdx !== undefined ? WORDS[rootBestIdx] : null
};

const outName = `dp_result_${path.basename(WORD_FILE, path.extname(WORD_FILE))}.json`;
fs.writeFileSync(outName, JSON.stringify(outJson, null, 2), 'utf8');
console.log(`Saved summary JSON: ${outName}`);
