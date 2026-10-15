// The notes helper rewrites an owner's notes files whenever they change one note. Whatever else they wrote, by hand
// or in the helper, must come out of the build as it went in: this tries hundreds of files made of the Markdown most
// likely to be mangled, and some that is merely odd, read and written back as the helper does it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asShown, combineNotes, parseNotes } from '../lib/notes.js';
import { readNotes, writeNotes } from '../client/src/notes/draft.ts';

const PAGE = 'https://gjh.github.io/harbour/';

// Blocks of a note's text, or of the introduction.
const BLOCKS = [
  'A plain paragraph.',
  'Two lines\nof one paragraph.',
  'A hard  \nbreak, by two spaces.',
  'A hard\\\nbreak, by a backslash.',
  'Opening hours:\n- Mon 9-5\n- Tue 9-5',
  'Steps:\n1. one\n2. two',
  '- a list\n\n  with a paragraph in an item\n- and another',
  '* nested\n  * deeper\n    * deepest',
  'Text\n### A heading straight after\nMore text',
  '### A heading\n\nText under it.',
  'Setext one\n===',
  'Underlined with dashes\n---',
  '> A quotation\n> on two lines',
  'Said:\n> quoted at once',
  '```\ncode\n\n  indented in it\n```',
  'Code:\n```js\nlet a = 1;\n```',
  '    indented code\n    on two lines',
  'Above a rule\n***',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  'A table straight after:\n| a | b |\n|---|---|\n| 1 | 2 |',
  '<div>An HTML block</div>',
  '<!-- a comment -->',
  'A [link](https://example.org) and an ![image](https://example.org/i.png).',
  'A [reference][r] link.\n\n[r]: https://example.org/ref',
  '*Emphasis across\ntwo lines*',
  'Trailing spaces   ',
  'Tabs\tin\ttext',
  '\\## not a heading',
  '#hashtag, not a heading',
  'Entities: &amp; &copy; &#169;',
  'A URL with_underscores https://example.org/a_b_c',
  'Ünïcödé — “quotes” and ’apostrophes’ 🙂',
  'A paragraph\n\n\n\nafter many blank lines',
  'Ends with a hard break  ',
  'Line one\n  indented continuation\n    more indented',
  'A line\n+ that starts a list',
  'Number line\n1986. was a year',
  '<span>inline HTML\nover lines</span>',
  'Backtick `code\nover lines`',
  '<div>\n\nAn HTML block with blank lines\n\n</div>',
  '###### The deepest heading',
  'Para\n+ plus list\n+ again',
  'Para\n* star list',
  'Para\n2. a list not at 1',
  '> quote\nlazy continuation',
  '- item\nlazy continuation',
  'A footnote[^1].\n\n[^1]: The note.',
  'Autolink <https://example.org>',
  '~~struck~~ text',
  '- [ ] a task\n- [x] done',
];

// Titles, and the headings that carry them in the site's own file.
const TITLES = ['The lighthouse', 'With *stars*', 'Brackets [x]', 'Back\\slash', 'Under_scores', '`code`', 'Amp & co', 'Emoji 🙂', 'Quote "x"', 'Title (parens)', 'Ends with #'];
const HEADINGS = [
  (title, r) => `## [${title}](${PAGE}?viewer=openseadragon#xywh=${r})`,
  (title, r) => `## [${title}](#xywh=pixel:${r})`,
  (title, r) => `## [${title}](./?lang=en#xywh=${r})`,
  (title, r) => `##   [${title}](#xywh=${r})   `,
  (title, r) => `## [${title}](#xywh=${r}) ##`,
  (title, r) => `## [${title}](#xywh=${r} "a tooltip")`,
];

/** A seeded random number generator (mulberry32), so a failure can be run again. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function notesFile(next, { own, count }) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  const body = () => Array.from({ length: Math.floor(next() * 3) }, () => pick(BLOCKS)).join(next() < 0.5 ? '\n\n' : '\n');
  const intro = next() < 0.5 ? body() : '';
  const notes = Array.from({ length: count }, (_, i) => {
    const region = `${10 * i},${20 * i},${100 + i},${200 + i}`;
    const heading = own ? pick(HEADINGS)(pick(TITLES), region) : `## ${pick(TITLES).replace(/[\\`*_[\]<>&#]/g, '\\$&')}`;
    return [heading, body()].filter(Boolean).join(next() < 0.8 ? '\n\n' : '\n');
  });
  let text = [intro, ...notes].filter(Boolean).join('\n\n') + (next() < 0.5 ? '\n' : '');
  if (next() < 0.2) text = text.replace(/\n/g, '\r\n'); // (a byte order mark the build takes off before the helper sees it)
  return text;
}

/** What visitors would see, by the build's own reading, spaces aside, which a browser shows alike (asShown). */
const shown = (files, language) => {
  const flat = (text) => (text === undefined ? undefined : Object.fromEntries(Object.entries(text).map(([tag, html]) => [tag, asShown(html)])));
  const { intro, items } = combineNotes(files, language);
  return { intro: flat(intro), items: items.map(({ region, title, text }) => ({ region, title, text: flat(text) })) };
};
const asFiles = (list) => Object.fromEntries(list.map(({ file, language, text }) => [language, { file, text }]));

test('any notes the build accepts come out of the build the same once the helper has read and written them back', () => {
  const next = random(14);
  let tried = 0;
  for (let i = 0; i < 400; i++) {
    const count = 1 + Math.floor(next() * 4);
    const files = [{ file: 'notes.md', language: 'en', text: notesFile(next, { own: true, count }) }];
    if (next() < 0.4) files.push({ file: 'notes.cy.md', language: 'cy', text: notesFile(next, { own: false, count }) });
    let before;
    try {
      before = shown(asFiles(files), 'en');
    } catch {
      continue; // not notes the build would publish
    }
    tried++;
    const written = writeNotes(readNotes(files), files, PAGE);
    const where = `\n--- case ${i} ---\n${files.map(({ file, text }) => `${file}:\n${JSON.stringify(text)}`).join('\n')}\n--- written ---\n${written.map(({ text }) => JSON.stringify(text)).join('\n')}`;
    assert.deepEqual(shown(asFiles(written), 'en'), before, `the build makes something else of it${where}`);
    assert.deepEqual(written.map(({ changed }) => changed), files.map(() => false), `untouched, it is not changed${where}`);
  }
  assert.ok(tried > 200, `${tried} of the files made were notes the build accepts`);
});

test('changing one note’s title changes nothing else the build makes of the notes', () => {
  const next = random(41);
  for (let i = 0; i < 200; i++) {
    const files = [{ file: 'notes.md', language: 'en', text: notesFile(next, { own: true, count: 3 }) }];
    let before;
    try {
      before = shown(asFiles(files), 'en');
    } catch {
      continue;
    }
    const notes = readNotes(files);
    if (notes.items.length < 2) continue; // a heading taken into an HTML block or code above it is no note
    notes.items[1] = { ...notes.items[1], title: { en: 'A new title' } };
    const after = shown(asFiles(writeNotes(notes, files, PAGE)), 'en');
    assert.deepEqual(after.items[1].title, { en: 'A new title' });
    after.items[1].title = before.items[1].title;
    assert.deepEqual(after, before, `case ${i}:\n${JSON.stringify(files[0].text)}`);
  }
});

test('a note’s title written by the helper is read back by the build character for character', () => {
  const next = random(7);
  const characters = 'abc XYZ *_`[]()<>&#\\!~|{}+-.:"\'’—🙂\t';
  for (let i = 0; i < 300; i++) {
    const title = Array.from({ length: 1 + Math.floor(next() * 12) }, () => characters[Math.floor(next() * characters.length)]).join('').trim();
    if (!title) continue;
    const notes = { intro: { en: '' }, items: [{ key: 1, region: { x: 1, y: 2, w: 3, h: 4 }, title: { en: title }, text: { en: '' } }] };
    const [{ text }] = writeNotes(notes, [{ file: 'notes.md', language: 'en', text: '' }], PAGE);
    assert.equal(parseNotes(text, 'notes.md', { linked: true }).items[0].title, title, JSON.stringify(text));
  }
});
