#!/usr/bin/env node
// dp_ext.js
// Exact non-hard-mode E[steps] for a block of high-entropy starters,
// using *one* word list as both answers and guess pool.
//
// Usage:
//   node dp_ext.js words_3200.txt 20 2
//
//   - Word file: words_3200.txt  (all 5-letter lowercase words)
//   - Block size: 20
//   - Block index: 2  -> entropy ranks 21..40
//
// Model:
//   - Answer set S ⊆ WORDS
//   - Guess pool G = WORDS (same list)
//   - DP state = candidate set S (indices into WORDS)
//   - For tail states, guesses can be ANY word in WORDS (non-hard-mode).
//   - For each starter g in the selected block, we compute
//       E = 1 (forced first guess) + Σ_p (|S_p|/|S|)*E(S_p)
//     where E(S_p) is tail DP with optimal policy and full guess pool.

const fs = require('fs');
const path = require('path');

function timeStr() {
  return new Date().toISOString();
}

// ============================
// 1. CLI arguments
// ============================

const WORD_FILE   = process.argv[2] || 'words_3200.txt';
const BLOCK_SIZE  = parseInt(process.argv[3] || '20', 10);
const BLOCK_INDEX = parseInt(process.argv[4] || '1', 10);

if (!fs.existsSync(WORD_FILE)) {
  console.error(`Usage: node dp_ext.js <word_list_file> [blockSize] [blockIndex]`);
  console.error(`File not found: ${WORD_FILE}`);
  process.exit(1);
}

if (!(BLOCK_SIZE > 0)) {
  console.error(`BLOCK_SIZE must be a positive integer. Got: ${BLOCK_SIZE}`);
  process.exit(1);
}
if (!(BLOCK_INDEX > 0)) {
  console.error(`BLOCK_INDEX must be a positive integer (1-based). Got: ${BLOCK_INDEX}`);
  process.exit(1);
}

console.log(`[${timeStr()}] Word file   : ${WORD_FILE}`);
console.log(`[${timeStr()}] Block size  : ${BLOCK_SIZE}`);
console.log(`[${timeStr()}] Block index : ${BLOCK_INDEX}`);

// ============================
// 2. Load words
// ============================

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
console.log(`[${timeStr()}] Loaded ${N} words.`);

// ============================
// 3. Wordle pattern function
//    patternFor(guess, answer) -> '0','1','2' x 5
// ============================

function patternFor(g, a) {
  // g, a: 5-letter lowercase strings
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
// 4. Precompute pattern table PAT[i][j]
//    i: guess index (0..N-1)
//    j: answer index (0..N-1)
// ============================

console.log(`[${timeStr()}] Precomputing pattern table...`);

const PAT = new Array(N);
for (let i = 0; i < N; i++) {
  PAT[i] = new Array(N);
}

for (let i = 0; i < N; i++) {
  const gi = WORDS[i];
  for (let j = 0; j < N; j++) {
    PAT[i][j] = patternFor(gi, WORDS[j]);
  }
  if ((i + 1) % 200 === 0 || i === N - 1) {
    console.log(`[${timeStr()}]  precomputed row ${i + 1} / ${N}`);
  }
}

console.log(`[${timeStr()}] Pattern table ready.`);

// ============================
// 5. Entropy of first guess vs full set
//    Used only for ranking starters
// ============================

function entropyOfFirstGuess(guessIdx) {
  const size = N;
  const counts = new Map(); // pattern -> count

  for (let j = 0; j < N; j++) {
    const pat = PAT[guessIdx][j];
    counts.set(pat, (counts.get(pat) || 0) + 1);
  }

  let H = 0;
  for (const cnt of counts.values()) {
    const p = cnt / size;
    H += -p * Math.log2(p);
  }
  return H;
}

console.log(`[${timeStr()}] Computing entropies for all words as first guess...`);

const entropyList = [];
for (let i = 0; i < N; i++) {
  const H = entropyOfFirstGuess(i);
  entropyList.push({ idx: i, entropy: H });
  if ((i + 1) % 200 === 0 || i === N - 1) {
    console.log(`[${timeStr()}]  entropy computed for ${i + 1} / ${N}`);
  }
}

// Sort by entropy descending, tie-break lexicographically
entropyList.sort((a, b) => {
  if (b.entropy !== a.entropy) return b.entropy - a.entropy;
  const wa = WORDS[a.idx];
  const wb = WORDS[b.idx];
  return wa < wb ? -1 : wa > wb ? 1 : 0;
});

// ============================
// 6. Select block (top K, with offset)
// ============================

const startRank = (BLOCK_INDEX - 1) * BLOCK_SIZE; // 0-based rank
const endRank   = Math.min(startRank + BLOCK_SIZE, entropyList.length);

if (startRank >= entropyList.length) {
  console.error(`Block index too large: startRank=${startRank+1} > total words=${entropyList.length}`);
  process.exit(1);
}

const selectedStarters = entropyList.slice(startRank, endRank);

console.log(`[${timeStr()}] Total words          : ${entropyList.length}`);
console.log(`[${timeStr()}] Selected rank range  : ${startRank + 1} .. ${endRank}`);
console.log(`[${timeStr()}] Selected starters    : ${selectedStarters.length}`);

// ============================
// 7. DP over candidate sets S (non-hard-mode tail)
//    State S = sorted array of indices (0..N-1)
//    Key      = "i1,i2,..."
//
//    For tail states, we allow guesses from the *entire* WORDS list:
//      action set G = {0..N-1}, not restricted to S.
// ============================

const memo = new Map();   // key -> E(S)
let statesEvaluated = 0;

function solveTail(cands) {
  const len = cands.length;
  if (len <= 0) return 0;    // degenerate
  if (len === 1) return 1;   // exactly one candidate: guess now

  const key = cands.join(',');
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  statesEvaluated++;
  if (statesEvaluated % 1000 === 0) {
    console.log(`[${timeStr()}] DP statesEvaluated=${statesEvaluated}, memo.size=${memo.size}`);
  }

  const size = len;
  let bestE = Infinity;

  // Non-hard-mode tail:
  // Guesses can be ANY word in WORDS (0..N-1), not just in cands.
  for (let gIdx = 0; gIdx < N; gIdx++) {
    // Partition the candidate set by patterns for guess gIdx
    const buckets = new Map();
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

    let expectedTail = 0;
    for (const arr of buckets.values()) {
      const bucketSize = arr.length;
      const prob = bucketSize / size;
      const subE = solveTail(arr);
      expectedTail += prob * subE;

      // Simple branch-and-bound: if already worse than current best, stop
      if (1 + expectedTail >= bestE) {
        break;
      }
    }

    const totalE = 1 + expectedTail;
    if (totalE < bestE) {
      bestE = totalE;
    }
  }

  memo.set(key, bestE);
  return bestE;
}

/**
 * Compute exact E[steps] if we FORCE a specific first guess gIdx at the root.
 *
 * Root state S0 = all words (0..N-1) as possible answers.
 * We do:
 *   - Partition S0 by patterns for gIdx
 *   - For each bucket S_p, cost is E(S_p) = solveTail(S_p)
 *   - Combine:
 *       E_total(gIdx) = 1 + Σ_p (|S_p| / |S0|) * E(S_p)
 */
function solveWithFixedRoot(gIdx) {
  const size = N;
  const buckets = new Map();

  for (let j = 0; j < N; j++) {
    const pat = PAT[gIdx][j];
    let arr = buckets.get(pat);
    if (!arr) {
      arr = [];
      buckets.set(pat, arr);
    }
    arr.push(j);
  }

  let expectedTail = 0;
  for (const arr of buckets.values()) {
    const bucketSize = arr.length;
    const prob = bucketSize / size;
    const subE = solveTail(arr);
    expectedTail += prob * subE;
  }

  return 1 + expectedTail;
}

// ============================
// 8. Compute E[steps] for each selected starter
// ============================

console.log(`[${timeStr()}] Computing exact E[steps] for selected starters (non-hard tail)...`);

const results = [];
let processed = 0;

for (const item of selectedStarters) {
  const idx = item.idx;
  const word = WORDS[idx];
  const H    = item.entropy;

  const E = solveWithFixedRoot(idx);
  processed++;

  console.log(
    `[${timeStr()}]  #${startRank + processed}  ${word.toUpperCase()}  ` +
    `H=${H.toFixed(6)}  E=${E.toFixed(6)}`
  );

  results.push({
    rank: startRank + processed,   // 1-based entropy rank
    word,
    entropy: H,
    E
  });
}

// 정렬: E[steps] 오름차순
results.sort((a, b) => a.E - b.E);

// ============================
// 9. Summary + JSON 저장
// ============================

console.log(`\n========== SUMMARY (by E[steps], non-hard tail) ==========\n`);
for (const r of results) {
  console.log(
    `#${r.rank.toString().padStart(4, ' ')}  ` +
    `${r.word.toUpperCase().padEnd(8, ' ')}  ` +
    `H=${r.entropy.toFixed(6)}  ` +
    `E=${r.E.toFixed(6)}`
  );
}

console.log(`\n[${timeStr()}] DP statesEvaluated=${statesEvaluated}, memo.size=${memo.size}\n`);

const outJson = {
  wordsFile: path.basename(WORD_FILE),
  numCandidates: N,
  blockSize: BLOCK_SIZE,
  blockIndex: BLOCK_INDEX,
  startRank: startRank + 1,
  endRank,
  results: results.map(r => ({
    rank: r.rank,
    word: r.word,
    entropy: r.entropy,
    E: r.E
  })),
  dpStatesEvaluated: statesEvaluated,
  dpMemoSize: memo.size,
  mode: "single-list-non-hard-tail"
};

const outName = `dp_ext_block_${path.basename(WORD_FILE, path.extname(WORD_FILE))}_K${BLOCK_SIZE}_B${BLOCK_INDEX}.json`;
fs.writeFileSync(outName, JSON.stringify(outJson, null, 2), 'utf8');
console.log(`[${timeStr()}] Saved summary JSON: ${outName}`);
console.log(`[${timeStr()}] Done.`);
