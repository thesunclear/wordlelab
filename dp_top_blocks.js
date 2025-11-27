#!/usr/bin/env node
// dp_top_blocks.js
// Exact hard-mode E[steps] for a block of high-entropy starters, with
// a bounded DP memo cache to avoid "Map maximum size exceeded".
//
// Usage:
//   node dp_top_blocks.js words_2309.txt 200 1
//     -> load words_2309.txt
//     -> compute entropy of all words as first guess
//     -> sort by entropy (desc)
//     -> take block 1 (1..200) and compute exact E[steps] for each
//
// Hard-mode definition here:
//   - Answer set S = given word list (all words in file)
//   - In all later steps, guesses are restricted to the current candidate set S'
//   - No external guess pool.
//
// We do NOT search the globally best first guess here. For each chosen
// starter g we compute E[steps] if you MUST play g first, and then play
// optimally afterwards.

const fs   = require('fs');
const path = require('path');

function timeStr() {
  return new Date().toISOString();
}

// ============================
// 1. CLI arguments
// ============================

const WORD_FILE   = process.argv[2] || 'words_2309.txt';
const BLOCK_SIZE  = parseInt(process.argv[3] || '200', 10);
const BLOCK_INDEX = parseInt(process.argv[4] || '1', 10);

if (!fs.existsSync(WORD_FILE)) {
  console.error(`Usage: node dp_top_blocks.js <word_list_file> [blockSize] [blockIndex]`);
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
//    patternFor(guess, answer) -> string of length 5 in '0','1','2'
// ============================

function patternFor(g, a) {
  // g, a: 5-letter lowercase
  const res  = Array(5).fill('0');
  const used = Array(5).fill(false);

  // Pass 1: greens
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = '2';
      used[i] = true;
    }
  }
  // Pass 2: yellows
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
//    i = guess index, j = answer index
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
// 5. Entropy of first guess (vs full set)
//    - We use H only for ranking starters
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

// sort by entropy (desc), tie-break lexicographically for stability
entropyList.sort((a, b) => {
  if (b.entropy !== a.entropy) return b.entropy - a.entropy;
  const wa = WORDS[a.idx];
  const wb = WORDS[b.idx];
  return wa < wb ? -1 : wa > wb ? 1 : 0;
});

// ============================
// 6. Select block (top K, with offset)
// ============================

const startRank = (BLOCK_INDEX - 1) * BLOCK_SIZE;   // 0-based rank index
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
// 7. DP over candidate sets (hard-mode tail)
//    State = sorted array of candidate *indices* (0..N-1)
//    Each state E(S) = optimal expected steps if we are at candidate set S,
//    and we may choose any guess from S.
// ============================

const memo = new Map();   // key: "i1,i2,...", value: expected steps
let statesEvaluated = 0;

// --- New: bounded memo to avoid Map size overflow ---
const MAX_MEMO_ENTRIES = 8_000_000;        // below engine limit
const EVICT_FRACTION   = 0.10;             // drop ~10% when over limit

function memoStore(key, value) {
  if (memo.size >= MAX_MEMO_ENTRIES) {
    // Evict some oldest entries (Map keeps insertion order)
    const toRemove = Math.max(1, Math.floor(MAX_MEMO_ENTRIES * EVICT_FRACTION));
    let removed = 0;
    for (const k of memo.keys()) {
      memo.delete(k);
      removed++;
      if (removed >= toRemove) break;
    }
    console.log(
      `[${timeStr()}] memo capacity hit: evicted ${removed} entries, ` +
      `new memo.size=${memo.size}`
    );
  }
  memo.set(key, value);
}

function solveTail(cands) {
  const len = cands.length;
  if (len <= 0) return 0;    // degenerate
  if (len === 1) return 1;   // guess that word now

  // canonical key
  const key = cands.join(',');
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  statesEvaluated++;
  if (statesEvaluated % 1000 === 0) {
    console.log(
      `[${timeStr()}] DP statesEvaluated=${statesEvaluated}, memo.size=${memo.size}`
    );
  }

  const size = len;
  let bestE = Infinity;

  // hard-mode: guesses restricted to S itself
  for (let gi = 0; gi < len; gi++) {
    const gIdx = cands[gi];

    // partition S by pattern
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

      // simple branch-and-bound
      if (1 + expectedTail >= bestE) {
        break;
      }
    }

    const totalE = 1 + expectedTail;
    if (totalE < bestE) {
      bestE = totalE;
    }
  }

  memoStore(key, bestE);
  return bestE;
}

/**
 * Compute exact E[steps] if we FORCE a specific first guess gIdx
 * at the root (S = all words).
 *
 * E = 1 (first guess) + Σ_p ( |S_p| / |S| ) * E(S_p)
 * where E(S_p) is solveTail(S_p) under optimal guessing from that point.
 */
function solveWithFixedRoot(gIdx) {
  const size = N;
  // Partition full set by patterns
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

console.log(`[${timeStr()}] Computing exact E[steps] for selected starters...`);

const results = [];
let processed = 0;

for (const item of selectedStarters) {
  const idx  = item.idx;
  const word = WORDS[idx];
  const H    = item.entropy;

  const E = solveWithFixedRoot(idx);
  processed++;

  console.log(
    `[${timeStr()}]  #${startRank + processed}  ${word.toUpperCase()}  ` +
    `H=${H.toFixed(6)}  E=${E.toFixed(6)}`
  );

  results.push({
    rank: startRank + processed,   // 1-based overall entropy rank
    word,
    entropy: H,
    E
  });
}

// sort results by E ascending (just for pretty output)
results.sort((a, b) => a.E - b.E);

// ============================
// 9. Pretty print + save JSON
// ============================

console.log(`\n========== SUMMARY (by E[steps]) ==========\n`);
for (const r of results) {
  console.log(
    `#${r.rank.toString().padStart(4, ' ')}  ` +
    `${r.word.toUpperCase().padEnd(8, ' ')}  ` +
    `H=${r.entropy.toFixed(6)}  ` +
    `E=${r.E.toFixed(6)}`
  );
}

console.log(
  `\n[${timeStr()}] DP statesEvaluated=${statesEvaluated}, memo.size=${memo.size}\n`
);

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
  dpMemoSize: memo.size
};

const outName =
  `dp_top_block_${path.basename(WORD_FILE, path.extname(WORD_FILE))}` +
  `_K${BLOCK_SIZE}_B${BLOCK_INDEX}.json`;

fs.writeFileSync(outName, JSON.stringify(outJson, null, 2), 'utf8');
console.log(`[${timeStr()}] Saved summary JSON: ${outName}`);
console.log(`[${timeStr()}] Done.`);
