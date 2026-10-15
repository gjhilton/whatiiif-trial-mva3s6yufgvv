// Notes on the picture, an optional extra: content/notes.md, each note a heading that links to its part of the
// picture, as "Link to this view" copies it, with the note's text below. In that order they make the tour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readContent } from '../lib/content.js';
import { tempDir } from './support/tmp.js';

async function content(files) {
  const dir = await tempDir('content');
  for (const [name, text] of Object.entries({ 'harbour.png': 'x', ...files })) await writeFile(join(dir, name), text);
  return dir;
}
const notesOf = async (files) => (await readContent(await content(files))).notes;

const NOTES = `This harbour was drawn for WhatIIIF.

## [The lighthouse](https://gjh.github.io/harbour/?viewer=openseadragon#xywh=1200,300,400,900)

Built in *1846*, and still lit.

## [The boats](#xywh=pixel:100,2000,3000,800)

## [A gull](./?lang=en#xywh=5,6,7,8)

### Its wings

Wide.
`;

test('notes are read from notes.md: each heading links to its part of the picture, and the text under it is the note', async () => {
  assert.deepEqual(await notesOf({ 'notes.md': NOTES }), {
    intro: { en: '<p>This harbour was drawn for WhatIIIF.</p>\n' },
    items: [
      { region: { x: 1200, y: 300, w: 400, h: 900 }, title: { en: 'The lighthouse' }, text: { en: '<p>Built in <em>1846</em>, and still lit.</p>\n' } },
      { region: { x: 100, y: 2000, w: 3000, h: 800 }, title: { en: 'The boats' } },
      { region: { x: 5, y: 6, w: 7, h: 8 }, title: { en: 'A gull' }, text: { en: '<h5>Its wings</h5>\n<p>Wide.</p>\n' } },
    ],
  });
});

test('without notes.md there are no notes, and nothing changes', async () => {
  assert.equal(await notesOf({}), undefined);
});

test('notes in another language follow the same order; their headings need no links', async () => {
  const notes = await notesOf({
    'notes.md': NOTES,
    'notes.cy.md': '## Y goleudy\n\nWedi’i adeiladu ym *1846*.\n\n## Y cychod\n\n## Gwylan\n',
  });
  assert.deepEqual(notes.items[0].title, { en: 'The lighthouse', cy: 'Y goleudy' });
  assert.deepEqual(notes.items[0].text, { en: '<p>Built in <em>1846</em>, and still lit.</p>\n', cy: '<p>Wedi’i adeiladu ym <em>1846</em>.</p>\n' });
  assert.deepEqual(notes.items[1].region, { x: 100, y: 2000, w: 3000, h: 800 });
  const { languages } = await readContent(await content({ 'notes.md': NOTES, 'notes.cy.md': '## Y goleudy\n\n## Y cychod\n\n## Gwylan\n' }));
  assert.deepEqual(languages, ['en', 'cy']);
});

test('a notes file saved with a byte order mark, as some Windows editors save it, reads the same', async () => {
  assert.deepEqual(await notesOf({ 'notes.md': `\uFEFF${NOTES}` }), await notesOf({ 'notes.md': NOTES }));
});

test('a heading underlined with dashes is part of a note’s text: only a ## heading starts a note', async () => {
  const notes = await notesOf({ 'notes.md': '## [The lighthouse](#xywh=1,2,3,4)\n\nTall\n---\n\nAnd white.\n' });
  assert.equal(notes.items.length, 1);
  assert.equal(notes.items[0].text.en, '<h4>Tall</h4>\n<p>And white.</p>\n');
});

const mistakes = [
  [
    'a note with no title',
    { 'notes.md': '## [](#xywh=1,2,3,4)\n\nTall.' },
    /content\/notes\.md: note 1 has no title\. Write it between the square brackets: ## \[The lighthouse\]\(#xywh=1,2,3,4\)/,
  ],
  [
    'a translated note with no title',
    { 'notes.md': '## [Tall](#xywh=1,2,3,4)\n', 'notes.cy.md': '##\n\nTal.' },
    /content\/notes\.cy\.md: note 1 has no title\. Write it after the ##\./,
  ],
  [
    'a note with words outside its link',
    { 'notes.md': '## [The lighthouse](#xywh=1,2,3,4) at night\n' },
    /content\/notes\.md: the note "The lighthouse at night" has words outside its link\. Make the whole heading the link: ## \[The lighthouse at night\]\(#xywh=1,2,3,4\)/,
  ],
  [
    'a note whose heading is not a link',
    { 'notes.md': '## The lighthouse\n\nTall.' },
    /content\/notes\.md: the note "The lighthouse" does not say which part of the picture it is about\. Make its heading a link to that part: zoom in on it, copy "Link to this view", and write ## \[The lighthouse\]\(the link\)\./,
  ],
  [
    'a note linking to something other than a part of the picture',
    { 'notes.md': '## [The lighthouse](https://example.org/lighthouses)\n' },
    /content\/notes\.md: the note "The lighthouse" links to https:\/\/example\.org\/lighthouses, which is not a part of the picture/,
  ],
  ['a notes file with no notes in it', { 'notes.md': 'Some words.\n' }, /content\/notes\.md has no notes in it\. Each note starts with a heading such as ## \[The lighthouse\]/],
  [
    'a translation with a note too few',
    { 'notes.md': NOTES, 'notes.cy.md': '## Y goleudy\n' },
    /content\/notes\.cy\.md has 1 note, and content\/notes\.md has 3: each language needs the same notes, in the same order/,
  ],
];

for (const [what, files, says] of mistakes) {
  test(`${what} stops the build with what to fix`, async () => {
    await assert.rejects(readContent(await content(files)), says);
  });
}

test('a file named nearly like notes.md is pointed out, and not read', async () => {
  const { notes, unused } = await readContent(await content({ 'note.md': '## [A](#xywh=1,1,1,1)' }));
  assert.equal(notes, undefined);
  assert.deepEqual(unused, ['content/note.md is not used; did you mean notes.md?']);
});

test('a description saved with a byte order mark reads the same', async () => {
  const { description } = await readContent(await content({ 'description.md': '\uFEFF# Harbour\n\nBoats.\n' }));
  assert.deepEqual(description, { en: '<h2>Harbour</h2>\n<p>Boats.</p>\n' });
});
