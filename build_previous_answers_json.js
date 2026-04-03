const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'wordle_pa.txt');
const OUTPUT_FILE = path.join(__dirname, 'previous_answers.json');

function parsePreviousAnswers(text) {
  const lines = text.split(/\r?\n/);
  const answers = [];
  const seenNumbers = new Set();
  const seenWords = new Set();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const parts = rawLine.split(/\s+/);
    if (parts.length < 2) {
      throw new Error(`Invalid format on line ${i + 1}: "${lines[i]}"`);
    }

    const numberStr = parts[0];
    const wordStr = parts[1];

    if (!/^\d+$/.test(numberStr)) {
      throw new Error(`Invalid puzzle number on line ${i + 1}: "${numberStr}"`);
    }

    if (!/^[A-Za-z]{5}$/.test(wordStr)) {
      throw new Error(`Invalid word on line ${i + 1}: "${wordStr}"`);
    }

    const number = Number(numberStr);
    const word = wordStr.toUpperCase();

    if (seenNumbers.has(number)) {
      throw new Error(`Duplicate puzzle number found on line ${i + 1}: ${number}`);
    }

    if (seenWords.has(word)) {
      console.warn(`Warning: duplicate answer word found on line ${i + 1}: ${word}`);
    }

    seenNumbers.add(number);
    seenWords.add(word);

    answers.push({ number, word });
  }

  answers.sort((a, b) => a.number - b.number);

  for (let i = 0; i < answers.length; i++) {
    if (answers[i].number !== i) {
      console.warn(
        `Warning: puzzle numbers are not perfectly consecutive at index ${i}. ` +
        `Found ${answers[i].number} instead of ${i}.`
      );
      break;
    }
  }

  const updatedThrough = answers.length > 0 ? answers[answers.length - 1].number : null;

  return {
    updatedThrough,
    answers
  };
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const text = fs.readFileSync(INPUT_FILE, 'utf8');
  const data = parsePreviousAnswers(text);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log(`Done.`);
  console.log(`Input : ${INPUT_FILE}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Total answers: ${data.answers.length}`);
  console.log(`updatedThrough: ${data.updatedThrough}`);
}

main();