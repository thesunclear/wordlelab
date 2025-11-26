#!/usr/bin/env node
// dp_top200.js
// Exact hard-mode E[steps] for top-K entropy roots in a Wordle-like game.
//
// - Answers = candidate list from a text file (one 5-letter word per line)
// - Guesses are restricted to the current candidate set (hard-mode)
// - We compute exact DP E(S) over candidate sets S
// - For a selected set of root guesses (entropy top-K), we compute
//     E_g = 1 + sum_p ( |S_p|/|S| ) * E(S_p )
//   where S_p is the bucket after first guess g with pattern p.
//
// Usage:
//   node dp_top200.js words_2309.txt 200
//     - words_2309.txt : list of 5-letter words
//     - 200 (optional) : number of top entropy roots to evaluate (default: 200)

'use strict';

const fs   = require('fs');
const path = require('path');

// ----------------------------
// Small utility
// ----------------------------
function timeStr() {
  return new Date().toISOString();
}

// ----------------------------
// CLI args
// ----------------------------
const WORD_FILE   = process.argv[2] || 'words_2309.txt';
const TOP_K_ROOTS = process.argv[3] ? Number(process.argv[3]) : 200;

if (!fs.existsSync(WORD_FILE)) {
  console.error(`Usage: node dp_top200.js <word_list_file> [top_k_roots]`);
  console.error(`File not found: ${WORD_FILE}`);
  process.exit(1);
}

if (Number.isNaN(TOP_K_ROOTS) || TOP_K_ROOTS <= 0) {
  console.error(`Invalid TOP_K_ROOTS: ${process.argv[3]}`);
  process.exit(1);
}

// ----------------------------
// 1. Load word list
// ----------------------------
const raw = fs.readFileSync(WORD_FILE, 'utf8');
const WORDS = raw
  .split(/\r?\n/)
  .map(s => s.trim().toLowerCase())
  .filter(s => /^[a-z]{5}$/.test(s));

if (WORDS.length === 0) {
  console.error(`No valid 5-letter words in ${WORD_FILE}`);
  process.exit(1);
}

const N = WORDS.length;
console.log(`[${timeStr()}] Loaded ${N} words from ${WORD_FILE}`);

// Just in case we want an index map:
const indexByWord = new Map();
WORDS.forEach((w, i) => indexByWord.set(w, i));

// ----------------------------
// 2. Pattern function
//    patternFor(guess, answer) → '0','1','2' * 5
// ----------------------------
function patternFor(guess, answer) {
  // guess, answer: 5-letter lowercase strings
  const g = guess;
  const a = answer;
  const res  = Array(5).fill('0');
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
    if (res[i] === '2') continue;
    const ch = g[i];
    for (let j = 0; j < 5; j++) {
      if (!used[j] && a[j] === ch) {
        used[j] = true;
        res[i]  = '1';
        break;
      }
    }
  }

  return res.join('');
}

// ----------------------------
// 3. Precompute pattern table PAT[i][j]
// ----------------------------
console.log(`[${timeStr()}] Precomputing pattern table...`);

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

// ----------------------------
// 4. Entropy for each word (as guess over full candidate set)
// ----------------------------
console.log(`[${timeStr()}] Computing entropies for all words...`);

const entropies = new Array(N).fill(0);

for (let i = 0; i < N; i++) {
  const counts = new Map();
  for (let j = 0; j < N; j++) {
    const pat = PAT[i][j];
    counts.set(pat, (counts.get(pat) || 0) + 1);
  }
  let H = 0;
  for (const count of counts.values()) {
    const p = count / N;
    H += -p * Math.log2(p);
  }
  entropies[i] = H;
  if ((i + 1) % 200 === 0) {
    console.log(`[${timeStr()}]  entropy for ${i + 1} / ${N}`);
  }
}

console.log(`[${timeStr()}] Entropy computation complete.`);

// Build top-K entropy root index list
const indices = Array.from({ length: N }, (_, i) => i);
indices.sort((a, b) => entropies[b] - entropies[a]); // descending
const K = Math.min(TOP_K_ROOTS, N);
const rootCandidates = indices.slice(0, K);

console.log(`[${timeStr()}] Selected top ${K} roots by entropy.`);

// ----------------------------
// 5. DP over candidate sets (hard-mode, guesses ∈ S)
// ----------------------------

// memo: key = "i1,i2,i3,...", value = E(S) (expected steps from this state)
const memo   = new Map();
// choice: same key → best guess index (index into WORDS)
const choice = new Map();

// For monitoring progress
let statesEvaluated = 0;

/**
 * solveState(cands): exact expected additional steps from state S
 *
 * - cands : array of word indices (integers in [0, N))
 * - Returns a number >= 1 when len(cands) >= 1.
 *   If len(cands) = 1 → exactly one candidate → E = 1 (guess it).
 */
function solveState(cands) {
  const len = cands.length;
  if (len <= 0) {
    return 0; // degenerate / unreachable
  }
  if (len === 1) {
    // Exactly one candidate: we must guess it once
    return 1;
  }

  // Canonical key: indices joined by comma (cands is always sorted)
  const key = cands.join(',');
  const cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }

  statesEvaluated++;
  if (statesEvaluated % 1000 === 0) {
    console.log(
      `[${timeStr()}] statesEvaluated=${statesEvaluated}, memo.size=${memo.size}, current |S|=${len}`
    );
  }

  const size = len;
  let bestE  = Infinity;
  let bestG  = -1;

  // Try every possible guess g ∈ S (hard-mode restriction)
  for (let gi = 0; gi < len; gi++) {
    const gIdx = cands[gi];

    // Partition S by patterns under guess gIdx
    const buckets = new Map(); // pattern -> array of indices
    for (let k = 0; k < len; k++) {
      const ansIdx = cands[k];
      const pat    = PAT[gIdx][ansIdx];
      let arr = buckets.get(pat);
      if (!arr) {
        arr = [];
        buckets.set(pat, arr);
      }
      arr.push(ansIdx);
    }

    // Expected cost if we guess gIdx now:
    // E = 1 (this guess) + Σ_p ( |S_p|/|S| ) * E(S_p)
    let expectedSub = 0;
    for (const arr of buckets.values()) {
      const prob = arr.length / size;
      const subE = solveState(arr); // recursive

      expectedSub += prob * subE;

      // Simple branch-and-bound:
      // if already worse than best, stop exploring this guess
      if (expectedSub + 1 >= bestE) {
        expectedSub = Infinity;
        break;
      }
    }
    const totalE = 1 + expectedSub;
    if (totalE < bestE) {
      bestE = totalE;
      bestG = gIdx;
    }
  }

  memo.set(key, bestE);
  if (bestG >= 0) {
    choice.set(key, bestG);
  }
  return bestE;
}

// ----------------------------
// 6. For a fixed root guess g, compute:
//    E_g = 1 + Σ_p ( |S_p|/|S| ) * E(S_p )
// ----------------------------
function expectedGivenFirstGuess(rootIdx, allCands) {
  const size    = allCands.length;
  const buckets = new Map(); // pattern -> array of indices

  for (const ansIdx of allCands) {
    const pat = PAT[rootIdx][ansIdx];
    let arr   = buckets.get(pat);
    if (!arr) {
      arr = [];
      buckets.set(pat, arr);
    }
    arr.push(ansIdx);
  }

  let Esub = 0;
  for (const arr of buckets.values()) {
    const prob = arr.length / size;
    const subE = solveState(arr);
    Esub += prob * subE;
  }
  return 1 + Esub; // +1 for the first guess itself
}

// ----------------------------
// 7. Main: evaluate top-K roots
// ----------------------------
console.log(`[${timeStr()}] Starting DP evaluation for top ${K} roots...`);

const allCands = [];
for (let i = 0; i < N; i++) allCands.push(i); // 0..N-1, sorted

const results = [];

for (let idxOfList = 0; idxOfList < rootCandidates.length; idxOfList++) {
  const rootIdx = rootCandidates[idxOfList];
  const rootWord = WORDS[rootIdx];
  const rootH = entropies[rootIdx];

  console.log(
    `\n[${timeStr()}] Evaluating root #${idxOfList+1}/${K}: ${rootWord.toUpperCase()} (entropy=${rootH.toFixed(6)})`
  );

  const Eroot = expectedGivenFirstGuess(rootIdx, allCands);

  console.log(
    `[${timeStr()}]  → E[steps | first=${rootWord.toUpperCase()}] = ${Eroot.toFixed(6)}`
  );

  results.push({
    index: rootIdx,
    word: rootWord,
    entropy: rootH,
    expectedSteps: Eroot
  });
}

// Sort results by E[steps] ascending (best first); tie-break by entropy desc
results.sort((a, b) => {
  if (a.expectedSteps !== b.expectedSteps) {
    return a.expectedSteps - b.expectedSteps;
  }
  return b.entropy - a.entropy;
});

console.log(`\n========== SUMMARY (Top ${K} by entropy, sorted by exact hard-mode E[steps]) ==========\n`);
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  console.log(
    `${String(i+1).padStart(3, ' ')}. ${r.word.toUpperCase()}  |  E[steps]=${r.expectedSteps.toFixed(6)}  |  entropy=${r.entropy.toFixed(6)}`
  );
}

console.log(`\n[${timeStr()}] DP stats: statesEvaluated=${statesEvaluated}, memo.size=${memo.size}\n`);

// ----------------------------
// 8. Save JSON output
// ----------------------------
const outJson = {
  wordsFile: path.basename(WORD_FILE),
  numCandidates: N,
  topKRequested: TOP_K_ROOTS,
  topKUsed: K,
  timestamp: timeStr(),
  statesEvaluated,
  memoSize: memo.size,
  results // sorted array
};

const baseName = path.basename(WORD_FILE, path.extname(WORD_FILE));
const outName = `dp_top${K}_hard_${baseName}.json`;

fs.writeFileSync(outName, JSON.stringify(outJson, null, 2), 'utf8');
console.log(`[${timeStr()}] Saved JSON: ${outName}`);
console.log(`[${timeStr()}] Done.`);
