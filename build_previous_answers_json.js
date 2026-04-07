const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'previous_answers.txt');
const OUTPUT_JSON = path.join(__dirname, 'previous_answers.json');
const OUTPUT_REPEATED_WORDS = path.join(__dirname, 'previous_answers_repeated_words.json');
const OUTPUT_MULTI_ANSWER_NUMBERS = path.join(__dirname, 'previous_answers_multi_answer_numbers.json');
const OUTPUT_SUMMARY = path.join(__dirname, 'previous_answers_summary.json');

/**
 * Convert MM/DD/YY to YYYY-MM-DD.
 * Assumes all 2-digit years belong to 2000-2099.
 */
function normalizeDate(mmddyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(mmddyy);
  if (!m) {
    throw new Error(`Invalid date format: "${mmddyy}" (expected MM/DD/YY)`);
  }

  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);

  const iso = `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const d = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${mmddyy}"`);
  }

  return iso;
}

function parsePreviousAnswers(text) {
  const lines = text.split(/\r?\n/);
  const answers = [];
  const wordMap = new Map();
  const numberMap = new Map();

  for (let i = 0; i < lines.length; i++) {
    const originalLine = lines[i];
    const line = originalLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      throw new Error(`Invalid format on line ${i + 1}: "${originalLine}"`);
    }

    const numberStr = parts[0];
    const wordStr = parts[1];
    const dateStr = parts[2];

    if (!/^\d+$/.test(numberStr)) {
      throw new Error(`Invalid puzzle number on line ${i + 1}: "${numberStr}"`);
    }

    if (!/^[A-Za-z]{5}$/.test(wordStr)) {
      throw new Error(`Invalid word on line ${i + 1}: "${wordStr}"`);
    }

    const number = Number(numberStr);
    const word = wordStr.toUpperCase();
    const date = normalizeDate(dateStr);

    const item = { number, word, date };
    answers.push(item);

    if (!wordMap.has(word)) {
      wordMap.set(word, []);
    }
    wordMap.get(word).push(item);

    if (!numberMap.has(number)) {
      numberMap.set(number, []);
    }
    numberMap.get(number).push(item);
  }

  answers.sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.word.localeCompare(b.word);
  });

  const updatedThrough = answers.length > 0 ? Math.max(...answers.map(x => x.number)) : null;

  let updatedThroughDate = null;
  if (updatedThrough !== null) {
    const lastGroup = answers.filter(x => x.number === updatedThrough);
    if (lastGroup.length > 0) {
      updatedThroughDate = lastGroup[0].date;
    }
  }

  const repeatedWords = [];
  for (const [word, records] of wordMap.entries()) {
    if (records.length > 1) {
      const sorted = records.slice().sort((a, b) => a.number - b.number);
      repeatedWords.push({
        word,
        count: sorted.length,
        numbers: sorted.map(x => x.number),
        dates: sorted.map(x => x.date),
        records: sorted
      });
    }
  }
  repeatedWords.sort((a, b) => a.word.localeCompare(b.word));

  const multiAnswerNumbers = [];
  for (const [number, records] of numberMap.entries()) {
    if (records.length > 1) {
      const sorted = records.slice().sort((a, b) => a.word.localeCompare(b.word));
      multiAnswerNumbers.push({
        number,
        count: sorted.length,
        dateSet: Array.from(new Set(sorted.map(x => x.date))).sort(),
        words: sorted.map(x => x.word),
        records: sorted
      });
    }
  }
  multiAnswerNumbers.sort((a, b) => a.number - b.number);

  const summary = {
    totalRecords: answers.length,
    uniqueWords: wordMap.size,
    uniquePuzzleNumbers: numberMap.size,
    updatedThrough,
    updatedThroughDate,
    repeatedWordCount: repeatedWords.length,
    multiAnswerNumberCount: multiAnswerNumbers.length
  };

  return {
    previousAnswersJson: {
      updatedThrough,
      updatedThroughDate,
      answers
    },
    repeatedWords,
    multiAnswerNumbers,
    summary
  };
}

function writeJson(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const text = fs.readFileSync(INPUT_FILE, 'utf8');
  const result = parsePreviousAnswers(text);

  writeJson(OUTPUT_JSON, result.previousAnswersJson);
  writeJson(OUTPUT_REPEATED_WORDS, result.repeatedWords);
  writeJson(OUTPUT_MULTI_ANSWER_NUMBERS, result.multiAnswerNumbers);
  writeJson(OUTPUT_SUMMARY, result.summary);

  console.log('Done.');
  console.log(`Input: ${INPUT_FILE}`);
  console.log(`Main JSON: ${OUTPUT_JSON}`);
  console.log(`Repeated words JSON: ${OUTPUT_REPEATED_WORDS}`);
  console.log(`Multi-answer numbers JSON: ${OUTPUT_MULTI_ANSWER_NUMBERS}`);
  console.log(`Summary JSON: ${OUTPUT_SUMMARY}`);
  console.log(`Total records: ${result.summary.totalRecords}`);
  console.log(`Unique words: ${result.summary.uniqueWords}`);
  console.log(`Unique puzzle numbers: ${result.summary.uniquePuzzleNumbers}`);
  console.log(`updatedThrough: ${result.summary.updatedThrough}`);
  console.log(`updatedThroughDate: ${result.summary.updatedThroughDate}`);
  console.log(`Repeated words: ${result.summary.repeatedWordCount}`);
  console.log(`Multi-answer puzzle numbers: ${result.summary.multiAnswerNumberCount}`);
}

main();