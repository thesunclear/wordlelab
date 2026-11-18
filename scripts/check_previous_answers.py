#!/usr/bin/env python3
"""Read-only Wordle answer verification. Never modifies repository files."""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

START = dt.date(2021, 6, 19)  # Wordle puzzle #0
NYT = 'https://www.nytimes.com/svc/wordle/v2/{date}.json'
BACKUP = 'https://wordlehints.co.uk/wp-json/wordlehint/v1/answers'


def get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'WordleLab-history-verifier/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=18) as response:
        return json.load(response)


def valid_record(number, date, word):
    if not isinstance(number, int) or isinstance(number, bool) or not isinstance(word, str):
        raise ValueError('Invalid puzzle number or word')
    parsed = dt.date.fromisoformat(date)
    if number != (parsed - START).days or not re.fullmatch(r'[A-Za-z]{5}', word):
        raise ValueError(f'Invalid puzzle/date/word: {number} {date} {word}')
    return (number, date, word.upper())


def parse_existing(path):
    records = set()
    by_day = defaultdict(set)
    duplicates = []
    for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 3:
            raise ValueError(f'Invalid TXT line {line_no}: {line!r}')
        number, word, short_date = parts
        date = dt.datetime.strptime(short_date, '%m/%d/%y').date().isoformat()
        record = valid_record(int(number), date, word)
        if record in records:
            duplicates.append((line_no, record))
        records.add(record)
        by_day[date].add(record[2])
    return records, by_day, duplicates


def nyt_record(date):
    data = get_json(NYT.format(date=date))
    if data.get('print_date') != date:
        raise ValueError('NYT print_date mismatch')
    return valid_record(data['days_since_launch'], date, data['solution'])


def backup_records(start, end):
    query = urllib.parse.urlencode({'from': start, 'to': end, 'per_page': 200, 'order': 'asc'})
    data = get_json(f'{BACKUP}?{query}')
    if not isinstance(data.get('results'), list) or data.get('has_more'):
        raise ValueError('Backup response invalid or truncated')
    result = defaultdict(set)
    for item in data['results']:
        record = valid_record(item['game'], item['date'], item['answer'])
        if start <= record[1] <= end:
            result[record[1]].add(record)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--output-dir', help='Write proposed TXT and a JSON report here, never to the repository')
    parser.add_argument('--file', default='previous_answers.txt')
    parser.add_argument('--end-date', help='YYYY-MM-DD, for repeatable offline tests')
    parser.add_argument('--fixture', help='JSON fixture for offline tests; never used in scheduled workflow')
    args = parser.parse_args()
    if not 1 <= args.days <= 180:
        parser.error('--days must be between 1 and 180')
    end = dt.date.fromisoformat(args.end_date) if args.end_date else dt.datetime.now(ZoneInfo('America/New_York')).date()
    start = max(START, end - dt.timedelta(days=args.days - 1))
    records, by_day, duplicates = parse_existing(Path(args.file))
    print(f'WORDLELAB DRY RUN | {start} to {end} | existing={len(records)} | duplicate TXT lines={len(duplicates)}')
    if duplicates:
        for line, record in duplicates:
            print(f'EXISTING_DUPLICATE line={line} record={record}')

    fixture = json.loads(Path(args.fixture).read_text()) if args.fixture else None
    if fixture is not None:
        backup = defaultdict(set)
        for date, words in fixture['backup'].items():
            for word in words:
                backup[date].add(valid_record((dt.date.fromisoformat(date) - START).days, date, word))
    else:
        try:
            backup = backup_records(start.isoformat(), end.isoformat())
            print('BACKUP API: reachable')
        except Exception as exc:
            backup = defaultdict(set)
            print(f'BACKUP API ERROR: {exc}')

    additions, conflicts, errors, matched = [], [], [], 0
    date = start
    while date <= end:
        key = date.isoformat()
        try:
            primary = (valid_record((date - START).days, key, fixture['nyt'][key])
                       if fixture is not None and key in fixture['nyt'] else
                       (_ for _ in ()).throw(KeyError('fixture missing date')) if fixture is not None else nyt_record(key))
        except Exception as exc:
            errors.append((key, str(exc)))
            print(f'ERROR {key}: {exc}')
            date += dt.timedelta(days=1)
            continue
        if primary in records:
            matched += 1
            print(f'EXISTS {key} #{primary[0]} {primary[2]}')
        elif by_day[key]:
            conflicts.append((key, primary[2], sorted(by_day[key]), 'existing differs'))
            print(f'REVIEW {key}: NYT={primary[2]} existing={sorted(by_day[key])}')
        elif backup[key] and primary in backup[key]:
            additions.append(primary)
            print(f'PROPOSE {key} #{primary[0]} {primary[2]} (NYT + backup agree)')
        else:
            conflicts.append((key, primary[2], sorted(x[2] for x in backup[key]), 'backup missing or differs'))
            print(f'REVIEW {key}: NYT={primary[2]} backup={sorted(x[2] for x in backup[key])}')
        date += dt.timedelta(days=1)

    if args.output_dir:
        output = Path(args.output_dir)
        output.mkdir(parents=True, exist_ok=True)
        # Preserve all existing records, including legitimate multi-answer puzzles.
        # Only verified missing-date answers are proposed for addition.
        proposed = records | set(additions)
        lines = [
            f"{number}\t{word}\t{dt.date.fromisoformat(date):%m/%d/%y}"
            for number, date, word in sorted(proposed)
        ]
        (output / 'previous_answers.txt').write_text(
            '\n'.join(lines) + '\n', encoding='utf-8'
        )
        report = {
            'mode': 'PREVIEW_ONLY',
            'range': {'start': start.isoformat(), 'end': end.isoformat()},
            'existing_records': len(records),
            'proposed_additions': [
                {'number': n, 'date': d, 'word': w} for n, d, w in additions
            ],
            'review': [
                {'date': d, 'nyt_word': w, 'other_words': other, 'reason': reason}
                for d, w, other, reason in conflicts
            ],
            'fetch_errors': [{'date': d, 'error': err} for d, err in errors],
            'existing_duplicate_lines': len(duplicates),
            'note': 'Proposals are not committed. Review errors and conflicts.'
        }
        (output / 'verification_report.json').write_text(
            json.dumps(report, indent=2) + '\n', encoding='utf-8'
        )
        print(f'PREVIEW FILES: {output}')
    print(f'SUMMARY matched={matched} proposed={len(additions)} review={len(conflicts)} fetch_errors={len(errors)}')
    print('DRY RUN ONLY: no files written; no commits made')
    # Nonzero exit signals the operator to inspect the run; it never changes files.
    return 1 if conflicts or errors or duplicates else 0


if __name__ == '__main__':
    sys.exit(main())
