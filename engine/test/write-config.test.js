// The settings helper writes whatiiif.toml for its owner, so what it writes must read back as the settings it was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../lib/config.js';
import { withLanguage, writeConfig } from '../lib/write-config.js';

const files = {
  'no settings at all': '',
  'every setting': `
language = "cy"
title = { cy = "Harbwr", en = "Harbour" }
summary = "Y llongau'n dod adref."
creator = "J. M. W. Turner"
date = { cy = "tua 1890", en = "about 1890" }
attribution = "Amgueddfa \\"Enghraifft\\""
alt = "Cychod pysgota"
rights = "https://creativecommons.org/licenses/by-nc/4.0/deed.cy"
dimensions = "120 x 80 cm"
picture = "https://github.com/gjh/harbour/releases/download/picture/scan.tif"
viewer = "mirador"
base_url = "https://harbour.example.org"

[[metadata]]
label = { cy = "Cyfrwng", en = "Medium" }
value = "Olew ar gynfas"

[[metadata]]
label = "Ffynhonnell"
value = """
Llinell gyntaf
Ail linell\\twedi'i thabio"""

[tiles]
size = 256
quality = 70

[publish]
full = false
original = false

[colours]
paper = "#fdf6e3"
ink = "rgb(20 20 20)"
viewer = "black"
error = "#ff5555"
`,
  'text in no particular language': 'language = "none"\nsummary = "1890"',
  'a text only in another language': 'title = { de = "Hafen" }',
};

for (const [what, toml] of Object.entries(files)) {
  test(`what it writes reads back as the same settings: ${what}`, () => {
    const settings = parseConfig(toml);
    const written = writeConfig(settings);
    assert.deepEqual(parseConfig(written), settings, written);
  });
}

test('it writes only what differs from the defaults, plain text where a text is in the site language alone', () => {
  assert.equal(
    writeConfig(parseConfig('title = "Harbour"\nviewer = "openseadragon"\n[tiles]\nquality = 85\n[publish]\nfull = true')),
    '# Made with the settings helper. Every setting is explained at\n# https://github.com/gjhilton/WhatIIIF/blob/main/content/whatiiif.toml\n\ntitle = "Harbour"\n',
  );
});

test('what a form gives it, blank texts and dimensions as typed, is written as the file would have them', () => {
  const form = { ...parseConfig(''), title: { en: 'Harbour', cy: '  ' }, summary: { en: '' }, dimensions: '120 × 80 cm' };
  assert.deepEqual(parseConfig(writeConfig(form)), { ...parseConfig(''), title: { en: 'Harbour' }, dimensions: { width: 120, height: 80, unit: 'cm', text: '120 × 80 cm' } });
});

test('a number left blank in the form is left out of the file, so the default is used', () => {
  const form = { ...parseConfig(''), tiles: { size: Number.NaN, quality: 70 } };
  assert.deepEqual(parseConfig(writeConfig(form)).tiles, { size: 512, quality: 70 });
});

test('changing the language of the texts takes them with it, except where the new language has its own already', () => {
  const settings = parseConfig('title = { en = "Harbour", cy = "Harbwr" }\nsummary = "Boats coming home."\n[[metadata]]\nlabel = "Medium"\nvalue = "Oil"');
  const welsh = withLanguage(settings, 'cy');
  assert.equal(welsh.language, 'cy');
  assert.deepEqual(welsh.title, { en: 'Harbour', cy: 'Harbwr' }, 'the Welsh title stays; the English one is a translation');
  assert.deepEqual(welsh.summary, { cy: 'Boats coming home.' });
  assert.deepEqual(welsh.metadata, [{ label: { cy: 'Medium' }, value: { cy: 'Oil' } }]);
  assert.deepEqual(withLanguage(withLanguage(settings, 'c'), 'cy').summary, { cy: 'Boats coming home.' }, 'as the code is typed, letter by letter');
});
