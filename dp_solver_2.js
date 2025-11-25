// dp_solver.js
//
// Dynamic-programming Wordle solver for the full answer set.
// - Uses only the answer list as both answers & allowed guesses (hard-mode optimal).
// - Computes value(S): minimal expected number of guesses to find the answer,
//   assuming the answer is uniformly random in S and we choose guesses optimally.
//
// WARNING: This is computationally heavy. Start with a small word list first
//          (e.g., 100–300 words) before running on the full 2309-word list.

const fs = require('fs');
const path = require('path');

// ===== Config =====
const ANSWERS_FILE = path.join(__dirname, 'words_2309.txt'); // one 5-letter word per line
const MAX_STATES_LOG_INTERVAL = 1000;   // how often to log DP state count
const ENABLE_DEBUG_LOG           = true; // set false to silence progress logs

// ===== Load words =====
function loadWords(filename) {
  const txt = fs.readFileSync(filename, 'utf8');
  const words = txt
    .split(/\r?\n/)
    .map(line => line.trim().toLowerCase())
    .filter(w => /^[a-z]{5}$/.test(w));

  const seen = new Set();
  const unique = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      unique.push(w);
    }
  }
  return unique;
}

const answers = loadWords(ANSWERS_FILE);
const N = answers.length;

console.log(`Loaded ${N} candidate answers from ${ANSWERS_FILE}.`);

// ===== Wordle pattern function (0/1/2 encoding) =====
//
// We use a standard Wordle scoring:
//  - '2' = green (correct letter, correct position)
//  - '1' = yellow (letter exists but in a different position)
//  - '0' = gray (letter not in the target, or already accounted for in greens/yellows)
//
// This version works on strings.
function patternOf(guess, answer) {
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
    if (res[i] === '2') continue;
    const ch = g[i];
    for (let j = 0; j < 5; j++) {
      if (!used[j] && a[j] === ch) {
        res[i] = '1';
        used[j] = true;
        break;
      }
    }
  }
  return res.join('');
}

// ===== Precompute pattern matrix =====
//
// patternMatrix[g][a] = pattern string (e.g. "20100")
console.log('Precomputing pattern matrix...');
const patternMatrix = Array.from({ length: N }, () => new Array(N));

for (let gi = 0; gi < N; gi++) {
  const g = answers[gi];
  for (let ai = 0; ai < N; ai++) {
    const a = answers[ai];
    patternMatrix[gi][ai] = patternOf(g, a);
  }
}
console.log('Pattern matrix ready.');

// ===== Helper to partition a state S by pattern for a given guess index =====
//
// SIndices: array of answer indices (subset of [0..N-1])
// guessIdx: index of guess in [0..N-1]
function partitionState(SIndices, guessIdx) {
  const map = new Map();
  const row = patternMatrix[guessIdx];
  for (const ansIdx of SIndices) {
    const pat = row[ansIdx]; // string like "20100"
    let arr = map.get(pat);
    if (!arr) {
      arr = [];
      map.set(pat, arr);
    }
    arr.push(ansIdx);
  }
  return map;
}

// ===== DP cache =====
//
// key = sorted indices joined by comma. Example: "0,5,17"
// value = { value: number, bestGuess: number }
const dp = new Map();
let dpStateCount = 0;

function stateKey(SIndices) {
  // SIndices is assumed to be sorted; if not, sort here.
  // For safety we sort, even if caller already sorted.
  const sorted = SIndices.slice().sort((a, b) => a - b);
  return sorted.join(',');
}

// ===== Lower bound heuristic (optional) =====
//
// Very simple: at least log2(|S| + 1) guesses are needed in expectation if
// each guess was perfectly splitting the remaining possibilities.
// It is only a heuristic; we use it for debugging or pruning if desired.
function lowerBound(SSize) {
  if (SSize <= 1) return SSize; // 0 or 1
  return Math.log2(SSize); // loose bound
}

// ===== DP: compute optimal E[steps] for a state S =====
//
// value(S) = minimal expected number of guesses to solve, starting in state S,
//            assuming uniform answer in S.
//
// Recurrence: for any guess g
//   E_g(S) = sum_{patterns p} [ (|S_p| / |S|) * cost_p ]
//
// where cost_p =
//   - if p == "22222": 1 (just this guess; we are done)
//   - else:            1 + value(S_p)  (1 for this guess, plus expected steps in subproblem)
//
// We choose g that minimizes E_g(S).
//
// Implementation: we restrict guesses to S (hard mode style).
function solveState(SIndices) {
  const n = SIndices.length;

  if (n === 0) {
    // No candidates → cost 0 (degenerate, but let's define it).
    return { value: 0, bestGuess: -1 };
  }
  if (n === 1) {
    // Only one possible answer → just guess it now (1 step).
    return { value: 1, bestGuess: SIndices[0] };
  }

  const key = stateKey(SIndices);
  if (dp.has(key)) {
    return dp.get(key);
  }

  dpStateCount++;
  if (ENABLE_DEBUG_LOG && dpStateCount % MAX_STATES_LOG_INTERVAL === 0) {
    console.log(`DP states computed: ${dpStateCount}, current |S| = ${n}`);
  }

  let bestValue = Infinity;
  let bestGuess = -1;

  // For efficiency, we can precompute N as float.
  const total = n;

  // Only use SIndices as candidate guesses (hard-mode DP).
  for (const guessIdx of SIndices) {
    const parts = partitionState(SIndices, guessIdx);
    let expected = 0;

    for (const [pat, bucket] of parts.entries()) {
      const m = bucket.length;
      const p = m / total;

      if (pat === '22222') {
        // This branch: solved immediately by guessing this word.
        expected += p * 1; // just this guess
      } else {
        const sub = solveState(bucket);
        expected += p * (1 + sub.value);
      }

      // Small optimization: if expected already exceeds current bestValue, we can break early.
      if (expected >= bestValue) {
        break;
      }
    }

    if (expected < bestValue) {
      bestValue = expected;
      bestGuess = guessIdx;
    }
  }

  const result = { value: bestValue, bestGuess };
  dp.set(key, result);
  return result;
}

// ===== Top-level: solve from full state =====
function main() {
  console.log('Starting DP from full candidate set...');
  console.time('solve_full');

  const fullState = [];
  for (let i = 0; i < N; i++) fullState.push(i);

  // Solve
  const result = solveState(fullState);

  console.timeEnd('solve_full');

  const firstWord = answers[result.bestGuess];
  console.log('===== Optimal policy for full state =====');
  console.log(`Number of answers (|S0|): ${N}`);
  console.log(`Best first guess       : ${firstWord.toUpperCase()} (index ${result.bestGuess})`);
  console.log(`Expected guesses (E)   : ${result.value.toFixed(6)}`);
  console.log(`DP states explored     : ${dpStateCount}`);

  // Optional: save minimal summary to JSON
  const out = {
    wordListSize: N,
    bestFirstGuessIndex: result.bestGuess,
    bestFirstGuessWord: firstWord,
    expectedGuesses: result.value,
    dpStates: dpStateCount,
    timestamp: new Date().toISOString()
  };
  const outPath = path.join(__dirname, 'dp_full_result.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Summary written to ${outPath}`);
}

main();
