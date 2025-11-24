/**
 * Wordle Lab style exact-ish E[steps] table generator (Node.js)
 *
 * - Uses only the candidate list as both answers and allowed guesses
 * - Wordle feedback pattern identical to the game (with repeated letters handled properly)
 * - For each starting guess g, we compute:
 *     E_g = Expected number of guesses to solve
 *           if you *force* the first guess to be g,
 *           and for all later guesses you always choose the guess
 *           that minimizes the (approximate) expected remaining steps.
 *
 * - Depth-limited global greedy search:
 *     * Up to MAX_DEPTH levels, we recurse exactly.
 *     * Beyond that, we fall back to a leaf heuristic leafExtraGuesses(k).
 *
 * WARNING:
 *   This search is extremely expensive for large word lists and large depths.
 *   Start with:
 *       - smaller word lists (e.g. 200–500 words),
 *       - MAX_DEPTH around 6–8
 *   and then scale up carefully.
 */

const fs = require('fs');
const path = require('path');

/** ===============================
 *  Configuration
 *  =============================== */

// Word list CSV file (can be overridden by process.argv[2])
const WORDLIST_FILE = process.argv[2] || 'wordle_solutions_3200.csv';

// Maximum recursive lookahead depth
// depth ~ 8–10 is already heavy; 12+ can explode in time.
const MAX_DEPTH = Number(process.argv[3] || 8);

// Optional: limit how many starting words to evaluate (for testing)
//   0 or Infinity means "all".
const MAX_START_WORDS = Infinity; // e.g. 200 for quick tests

// Leaf heuristic: extra expected guesses when we cut off the tree
// at some bucket size k and depth limit.
// This function should return the expected number of *future* guesses
// from that state (not counting the current guess).
function leafExtraGuesses(k) {
  if (k <= 1) return 0;
  // You can tweak this formula; this is a smooth, sub-log growth.
  return 1 + 0.20 * Math.pow(k, 0.55);
}

/** ===============================
 *  Utility: Load & parse CSV word list
 *  =============================== */

function loadWordsFromCsv(filename) {
  const full = path.resolve(filename);
  const txt = fs.readFileSync(full, 'utf8');
  const lines = txt.split(/\r?\n/);
  const words = [];
  const seen = new Set();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/,|\s+/);
    for (let c of cells) {
      c = (c || '').trim().toLowerCase();
      if (/^[a-z]{5}$/.test(c) && !seen.has(c)) {
        seen.add(c);
        words.push(c);
      }
    }
  }

  return words;
}

/** ===============================
 *  Wordle feedback pattern
 *  =============================== */

/**
 * Compute Wordle-style pattern for (guess, answer).
 * Returns a string like "21001", where:
 *   "2" = green, "1" = yellow, "0" = gray.
 */
function patternFor(guess, answer) {
  const n = 5;
  const res = new Array(n).fill('0');
  const used = new Array(n).fill(false);

  // Step 1: greens
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) {
      res[i] = '2';
      used[i] = true;
    }
  }

  // Count remaining letters in answer
  const counts = {};
  for (let i = 0; i < n; i++) {
    if (!used[i]) {
      const c = answer[i];
      counts[c] = (counts[c] || 0) + 1;
    }
  }

  // Step 2: yellows
  for (let i = 0; i < n; i++) {
    if (res[i] === '0') {
      const c = guess[i];
      if (counts[c] > 0) {
        res[i] = '1';
        counts[c]--;
      }
    }
  }

  return res.join('');
}

/**
 * Partition a word set S by pattern when guessing 'guess'.
 * Returns Map(pattern => arrayOfWords).
 */
function partitionByPattern(words, guess) {
  const map = new Map();
  for (const w of words) {
    const p = patternFor(guess, w);
    let arr = map.get(p);
    if (!arr) {
      arr = [];
      map.set(p, arr);
    }
    arr.push(w);
  }
  return map;
}

/** ===============================
 *  Core DP: bestExpected(S, depth)
 *  =============================== */

/**
 * bestExpected(words, depth, memo)
 *
 * Given a candidate set "words" and remaining lookahead depth,
 * this returns the minimum expected number of guesses required
 * to solve from this state, assuming:
 *
 *  - You are about to make a guess now.
 *  - You may choose any guess from "words" (Wordle Lab hard-mode policy).
 *  - For each pattern bucket, you then recursively continue with
 *    the same policy and one less depth.
 *
 * Conventions:
 *   - If words.length === 1: we return 1 (one more guess will solve).
 *   - If depth <= 0: we fall back to leafExtraGuesses(k).
 *
 * Memoization key is ("%sortedWords%|depth").
 */
function bestExpected(words, depth, memo) {
  const k = words.length;

  if (k === 1) {
    // One candidate left => one more guess
    return 1;
  }

  if (depth <= 0) {
    // No remaining lookahead budget: approximate from here
    return leafExtraGuesses(k);
  }

  // Build key (sorted so that set identity is order-independent)
  const sorted = words.slice().sort();
  const key = sorted.join(',') + '|' + depth;
  if (memo.has(key)) return memo.get(key);

  const N = k;
  let best = Infinity;

  // Try all possible guesses from the current candidate set
  for (const g of sorted) {
    let est = 0;
    const parts = partitionByPattern(sorted, g);

    for (const [pat, bucket] of parts.entries()) {
      const p = bucket.length / N;
      if (pat === '22222') {
        // Solved immediately by this guess
        est += p * 1;
      } else {
        // Recurse on the bucket (we still need additional guesses there)
        const sub = bestExpected(bucket, depth - 1, memo);
        // 1 for this guess, plus sub for the subtree
        est += p * (1 + sub);
      }
    }

    if (est < best) best = est;
  }

  memo.set(key, best);
  return best;
}

/**
 * evalStartingGuess(words, guess, depth, memo)
 *
 * Force the *first* guess to be `guess`, then for each resulting
 * pattern bucket, continue optimally (using bestExpected) with depth-1.
 *
 * Returns E[steps] for this starting guess under the policy described.
 */
function evalStartingGuess(words, guess, depth, memo) {
  const N = words.length;
  const parts = partitionByPattern(words, guess);
  let est = 0;

  for (const [pat, bucket] of parts.entries()) {
    const p = bucket.length / N;
    if (pat === '22222') {
      // Solved in 1 step if the answer equals guess
      est += p * 1;
    } else {
      // 1 for this forced first guess, then bestExpected on the bucket
      const sub = bestExpected(bucket, depth - 1, memo);
      est += p * (1 + sub);
    }
  }

  return est;
}

/** ===============================
 *  Main routine
 *  =============================== */

function main() {
  console.log('=== Wordle Lab exact-ish E[steps] table generator ===');
  console.log('Word list file :', WORDLIST_FILE);
  console.log('Max depth      :', MAX_DEPTH);
  console.log('Max start words:', MAX_START_WORDS === Infinity ? 'ALL' : MAX_START_WORDS);
  console.log('');

  const words = loadWordsFromCsv(WORDLIST_FILE);
  console.log(`Loaded ${words.length} candidate words.`);
  if (!words.length) {
    console.error('No words loaded. Check your CSV file.');
    process.exit(1);
  }

  const startWords = words.slice(0, Math.min(words.length, MAX_START_WORDS));
  console.log(`Evaluating ${startWords.length} starting words...`);
  console.log('');

  const memo = new Map();
  const results = [];

  const startTime = Date.now();

  startWords.forEach((w, idx) => {
    const i = idx + 1;
    const t0 = Date.now();
    const e = evalStartingGuess(words, w, MAX_DEPTH, memo);
    const t1 = Date.now();
    const elapsed = ((t1 - t0) / 1000).toFixed(2);
    console.log(`[${i}/${startWords.length}] ${w.toUpperCase()} → E[steps] ≈ ${e.toFixed(6)}  (took ${elapsed}s)`);
    results.push({ word: w, esteps: e });
  });

  // Sort by E[steps] ascending
  results.sort((a, b) => a.esteps - b.esteps);

  const outLines = ['word,esteps'];
  for (const r of results) {
    outLines.push(`${r.word},${r.esteps.toFixed(6)}`);
  }

  const outName = `first_guess_table_depth${MAX_DEPTH}.csv`;
  fs.writeFileSync(outName, outLines.join('\n'), 'utf8');

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('Done.');
  console.log('Output file:', outName);
  console.log('Total time :', totalSec, 'seconds');
}

if (require.main === module) {
  main();
}
