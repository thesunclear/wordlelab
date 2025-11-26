#!/usr/bin/env node
// dp_top200.js
//
// Exact hard-mode E[steps] for top-entropy first guesses.
//
// - Answers (and guesses) = the same word list (hard mode: guess ∈ candidate set)
// - We precompute the full pattern table PAT[i][j]
// - For each word we compute entropy over the full set
// - Take top K by entropy (default 200)
// - For each such word g, we compute the exact E[steps] if we FORCE the first guess to be g,
//   and then always play optimally afterward (hard mode).
//
// Usage:
//   node dp_top200.js words_2309.txt 200
//   node dp_top200.js words_3200.txt        (defaults to top 200)
//
// Output: prints a table "WORD ENTROPY E[STEPS]" and also writes a JSON summary file.

const fs = require('fs');
const path = require('path');

// -----------------------------
// 0. Small utilities
// -----------------------------
function timeStr() {
  return new Date().toISOString();
}

// -----------------------------
// 1. Parse CLI arguments
// -----------------------------
const WORD_FILE = process.argv[2] || 'words_2309.txt';
const TOP_K = Number(process.argv[3] || '200');

if (!fs.existsSync(WORD_FILE)) {
  console.error(`Usage: node dp_top200.js <word_list_file> [TOP_K]`);
  console.error(`File not found: ${WORD_FILE}`);
  process.exit(1);
}

// -----------------------------
// 2. Load words
// -----------------------------
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

// Map word -> index (not strictly needed here, but useful)
const indexByWord = new Map();
WORDS.forEach((w, i) => indexByWord.set(w, i));

// -----------------------------
// 3. Pattern function
// patternFor(guess, answer) -> '0','1','2' * 5
// -----------------------------
function patternFor(guess, answer) {
  const g = guess;
  const a = answer;
  const res = Array(5).fill('0');
  const used = Array(5).fill(false);

  // Greens
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = '2';
      used[i] = true;
    }
  }
  // Yellows
  for (let i = 0; i < 5; i++) {
    if (res[i] === '2') continue;
    const ch = g[i];
    for (let j = 0; j < 5; j++) {
      if (!used[j] && a[j] === ch) {
        used[j] = true;
        res[i] = '1';
        break;
      }
    }
  }
  return res.join('');
}

// -----------------------------
// 4. Precompute full pattern table PAT[i][j]
// -----------------------------
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

// -----------------------------
// 5. Entropy for each word over full set
// H(g) = - Σ_p (|S_p|/N) log2(|S_p|/N)
// -----------------------------
function entropyForIndex(idx) {
  // count patterns in this row
  const counts = new Map();
  for (let j = 0; j < N; j++) {
    const pat = PAT[idx][j];
    const c = counts.get(pat) || 0;
    counts.set(pat, c + 1);
  }
  let H = 0;
  for (const count of counts.values()) {
    const p = count / N;
    H += -p * Math.log2(p);
  }
  return H;
}

console.log(`[${timeStr()}] Computing entropy for all words...`);

const entropyList = [];
for (let i = 0; i < N; i++) {
  const H = entropyForIndex(i);
  entropyList.push({ index: i, word: WORDS[i], entropy: H });
  if ((i + 1) % 200 === 0) {
    console.log(`[${timeStr()}]  entropy row ${i + 1} / ${N}`);
  }
}

// Sort descending by entropy, pick top K
entropyList.sort((a, b) => b.entropy - a.entropy);
const topK = entropyList.slice(0, Math.min(TOP_K, N));

console.log(`[${timeStr()}] Selected top ${topK.length} words by entropy as root candidates.`);

// -----------------------------
// 6. DP over candidate sets (hard mode)
// State S = sorted array of indices
// Key = indices.join(',')
// solveState(S) returns exact E[steps] for optimal play
//  - guesses restricted to S
//  - pattern '22222' buckets are treated as solved (additional cost 0)
// -----------------------------
const memo = new Map();   // key -> E(S)
const choice = new Map(); // key -> best guess index
let statesEvaluated = 0;

/**
 * Compute optimal expected steps for candidate set cands (array of indices).
 * This is hard-mode DP:
 *   E(S) = 1 + min_g Σ_{patterns != '22222'} ( |S_p| / |S| ) * E(S_p )
 * Base:
 *   |S| = 1 → E(S) = 1 (one final guess).
 */
function solveState(cands) {
  const len = cands.length;
  if (len <= 0) return 0;  // degenerate
  if (len === 1) return 1; // exactly one candidate, one guess to solve

  // Build key
  const key = cands.join(',');
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  statesEvaluated++;
  if (statesEvaluated % 1000 === 0) {
    console.log(
      `[${timeStr()}] DP statesEvaluated=${statesEvaluated}, memo.size=${memo.size}, |S|=${len}`
    );
  }

  const size = len;
  let bestE = Infinity;
  let bestG = -1;

  // Loop over possible guesses g ∈ S
  for (let gi = 0; gi < len; gi++) {
    const gIdx = cands[gi];

    // Partition S by patterns
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

    // Compute expected cost if we choose gIdx now
    // IMPORTANT: pattern === '22222' means we already solved the word,
    // so additional cost from that branch is 0 (no recursive call).
    let expectedSub = 0;
    for (const [pat, arr] of buckets.entries()) {
      const prob = arr.length / size;
      if (pat === '22222') {
        // solved branch → +0
        continue;
      }
      const subE = solveState(arr);
      expectedSub += prob * subE;

      // Simple branch-and-bound
      if (1 + expectedSub >= bestE) {
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
  if (bestG >= 0) choice.set(key, bestG);
  return bestE;
}

// -----------------------------
// 7. Expected steps if we FORCE a specific first guess g0
// E_with_root(g0):
//   S0 = all candidates
//   Partition S0 by patterns of g0
//   E = 1 + Σ_{pat != '22222'} ( |S_p| / |S0| ) * E(S_p )
// where E(S_p) is obtained from solveState (optimal afterwards).
// -----------------------------
const allCands = [];
for (let i = 0; i < N; i++) allCands.push(i);

function expectedWithRoot(rootIdx) {
  const size = allCands.length;

  // Partition allCands by patterns of rootIdx
  const buckets = new Map();
  for (let k = 0; k < size; k++) {
    const ansIdx = allCands[k];
    const pat = PAT[rootIdx][ansIdx];
    let arr = buckets.get(pat);
    if (!arr) {
      arr = [];
      buckets.set(pat, arr);
    }
    arr.push(ansIdx);
  }

  let expectedSub = 0;
  for (const [pat, arr] of buckets.entries()) {
    const prob = arr.length / size;
    if (pat === '22222') {
      // If the correct answer is exactly this root guess, no further guesses needed.
      // So additional cost is 0.
      continue;
    }
    const subE = solveState(arr);
    expectedSub += prob * subE;
  }
  return 1 + expectedSub;
}

// -----------------------------
// 8. Compute E[steps] for each top-entropy root
// -----------------------------
console.log(`[${timeStr()}] Evaluating E[steps] for top-${topK.length} entropy roots...`);

const results = [];

topK.forEach((info, idx) => {
  const rootIdx = info.index;
  const word = info.word;
  const H = info.entropy;

  console.log(
    `[${timeStr()}]  [${idx + 1}/${topK.length}] root=${word.toUpperCase()} (index ${rootIdx})...`
  );

  const E = expectedWithRoot(rootIdx);
  results.push({
    index: rootIdx,
    word,
    entropy: H,
    esteps: E
  });
});

// Sort results by E[steps] ascending (best first)
results.sort((a, b) => a.esteps - b.esteps);

console.log('\n========== TOP-K ROOT RESULTS (sorted by E[steps]) ==========');
console.log('WORD    ENTROPY     E[STEPS]');
for (const r of results) {
  console.log(
    `${r.word.toUpperCase().padEnd(6)} ${r.entropy.toFixed(3).padStart(7)}  ${r.esteps.toFixed(9)}`
  );
}
console.log('============================================================\n');

console.log(`DP states evaluated: ${statesEvaluated}`);
console.log(`DP memo size       : ${memo.size}`);
console.log(`[${timeStr()}] Done.`);

// -----------------------------
// 9. Save JSON summary
// -----------------------------
const outJson = {
  wordsFile: path.basename(WORD_FILE),
  numCandidates: N,
  topKUsed: topK.length,
  results: results.map(r => ({
    index: r.index,
    word: r.word,
    entropy: r.entropy,
    esteps: r.esteps
  }))
};

const outName = `dp_top${topK.length}_${path.basename(WORD_FILE, path.extname(WORD_FILE))}.json`;
fs.writeFileSync(outName, JSON.stringify(outJson, null, 2), 'utf8');
console.log(`Saved JSON summary: ${outName}`);
