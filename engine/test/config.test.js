import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../lib/config.js';

const opts = {};

test('an empty config gets defaults; the title is left to the picture to name', () => {
  const c = parseConfig('', opts);
  assert.equal(c.language, 'en');
  assert.equal(c.title, undefined);
  assert.equal(c.alt, undefined);
  assert.equal(c.picture, undefined);
  assert.equal(c.viewer, 'openseadragon');
  assert.equal(c.tiles.size, 512);
  assert.equal(c.tiles.quality, 85);
  assert.deepEqual(c.publish, { full: true, original: true, footer: true });
  assert.deepEqual(c.colours, {});
  assert.deepEqual(c.metadata, []);
  assert.equal(c.creator, undefined);
  assert.equal(c.date, undefined);
  assert.equal(c.dimensions, undefined);
});

test('who made it, when, and how big the original is', () => {
  const c = parseConfig('creator = "J. M. W. Turner"\ndate = { en = "about 1890", cy = "tua 1890" }\ndimensions = "120 x 80,5 cm"', opts);
  assert.deepEqual(c.creator, { en: 'J. M. W. Turner' });
  assert.deepEqual(c.date, { en: 'about 1890', cy: 'tua 1890' });
  assert.deepEqual(c.dimensions, { width: 120, height: 80.5, unit: 'cm', text: '120 × 80.5 cm' });
});

const dimensions = [
  ['47.5 × 31.25 in', { width: 47.5, height: 31.25, unit: 'in', text: '47.5 × 31.25 in' }],
  ['420mm x 297mm', { width: 420, height: 297, unit: 'mm', text: '420 × 297 mm' }],
  ['1.2 X 0.8 m', { width: 1.2, height: 0.8, unit: 'm', text: '1.2 × 0.8 m' }],
];
for (const [given, read] of dimensions) {
  test(`reads the dimensions ${given}`, () => {
    assert.deepEqual(parseConfig(`dimensions = "${given}"`, opts).dimensions, read);
  });
}

test('reads every documented field', () => {
  const c = parseConfig(
    `
title = "Harbour"
summary = "A view."
attribution = "Example Museum"
rights = "https://creativecommons.org/licenses/by/4.0/"
viewer = "mirador"
base_url = "https://iiif.example.org/"

[[metadata]]
label = "Date"
value = "1890"

[tiles]
size = 256
quality = 70

[publish]
full = false
original = false
footer = false

[colours]
paper = "#FDF6E3"
ink = "rgb(20 20 20 / 90%)"
viewer = "black"
`,
    opts,
  );
  assert.deepEqual(c.title, { en: 'Harbour' });
  assert.deepEqual(c.attribution, { en: 'Example Museum' });
  assert.equal(c.viewer, 'mirador');
  assert.equal(c.base_url, 'https://iiif.example.org');
  assert.deepEqual(c.metadata, [{ label: { en: 'Date' }, value: { en: '1890' } }]);
  assert.equal(c.tiles.size, 256);
  assert.deepEqual(c.publish, { full: false, original: false, footer: false });
  assert.deepEqual(c.colours, { paper: '#FDF6E3', ink: 'rgb(20 20 20 / 90%)', viewer: 'black' });
});

test('a picture too big to commit can be given by its web address instead', () => {
  const url = 'https://github.com/gjh/harbour/releases/download/picture/Harbour%20scan.tif';
  assert.equal(parseConfig(`picture = "${url}"`, opts).picture, url);
});

test('rejects a rights value that is not a URL, naming the field', () => {
  assert.throws(() => parseConfig('rights = "CC-BY"', opts), /rights.*URL/);
});

test('rejects an unknown viewer and lists the valid ones', () => {
  assert.throws(() => parseConfig('viewer = "uv"', opts), /viewer.*openseadragon, mirador/);
});

test('rejects unknown keys so typos are not silently ignored, and suggests the setting meant', () => {
  assert.throws(() => parseConfig('titel = "x"', opts), /unknown setting "titel"; did you mean "title"\? Valid settings here: language, title/);
  assert.throws(() => parseConfig('[colors]\nink = "red"', opts), /unknown setting "colors"; did you mean "colours"\?/);
  assert.throws(() => parseConfig('[tiles]\nqualty = 90', opts), /unknown setting "tiles\.qualty"; did you mean "quality"\?/);
  assert.throws(() => parseConfig('flavour = "x"', opts), /unknown setting "flavour"\. Valid settings here/);
});

test('reports TOML syntax errors in plain English', () => {
  assert.throws(() => parseConfig('title = ', opts), /whatiiif\.toml.*not valid TOML/);
});

// IIIF (and its schema) only accept these URIs in the http:// form their publishers define, but people paste https.
const rights = [
  ['https://creativecommons.org/licenses/by/4.0/', 'http://creativecommons.org/licenses/by/4.0/'],
  ['https://www.creativecommons.org/licenses/by-sa/4.0/', 'http://creativecommons.org/licenses/by-sa/4.0/'],
  ['https://creativecommons.org/publicdomain/zero/1.0/', 'http://creativecommons.org/publicdomain/zero/1.0/'],
  ['https://rightsstatements.org/vocab/InC/1.0/', 'http://rightsstatements.org/vocab/InC/1.0/'],
  ['http://creativecommons.org/licenses/by-nc/4.0/', 'http://creativecommons.org/licenses/by-nc/4.0/'],
  // What the address bar shows on those sites' own pages, which is what people copy.
  ['https://creativecommons.org/licenses/by/4.0/deed.en', 'http://creativecommons.org/licenses/by/4.0/'],
  ['https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.de', 'http://creativecommons.org/licenses/by-nc-sa/4.0/'],
  ['https://creativecommons.org/licenses/by/4.0', 'http://creativecommons.org/licenses/by/4.0/'],
  ['https://creativecommons.org/licenses/by/3.0/de/deed.de', 'http://creativecommons.org/licenses/by/3.0/de/'],
  ['https://creativecommons.org/publicdomain/zero/1.0/deed.cy', 'http://creativecommons.org/publicdomain/zero/1.0/'],
  ['https://creativecommons.org/publicdomain/mark/1.0/?ref=chooser-v1', 'http://creativecommons.org/publicdomain/mark/1.0/'],
  ['https://rightsstatements.org/page/InC/1.0/?language=en', 'http://rightsstatements.org/vocab/InC/1.0/'],
  ['https://rightsstatements.org/vocab/NoC-US/1.0', 'http://rightsstatements.org/vocab/NoC-US/1.0/'],
];

for (const [given, canonical] of rights) {
  test(`publishes the rights URL ${given} in its canonical http form`, () => {
    assert.equal(parseConfig(`rights = "${given}"`, opts).rights, canonical);
  });
}

test('rejects a rights URL IIIF viewers would not recognise and points to attribution instead', () => {
  assert.throws(
    () => parseConfig('rights = "https://example.org/terms"', opts),
    /rights.*Creative Commons.*RightsStatements\.org.*attribution/s,
  );
});

// Every text can be written once, in the site's language, or as a table with one entry per language.
test('texts can be given in several languages, and a plain one is in the site language', () => {
  const c = parseConfig(
    `
language = "cy"
title = { cy = "Harbwr", en = "Harbour" }
summary = "Golygfa o'r harbwr."

[[metadata]]
label = { cy = "Dyddiad", en = "Date" }
value = "1890"
`,
    opts,
  );
  assert.equal(c.language, 'cy');
  assert.deepEqual(c.title, { cy: 'Harbwr', en: 'Harbour' });
  assert.deepEqual(c.summary, { cy: "Golygfa o'r harbwr." });
  assert.deepEqual(c.metadata, [{ label: { cy: 'Dyddiad', en: 'Date' }, value: { cy: '1890' } }]);
});

test('language codes are written the standard way, whatever case they were typed in', () => {
  const c = parseConfig('language = "CY-gb"\ntitle = { EN = "Harbour", "zh-hant" = "港口", none = "1890" }', opts);
  assert.equal(c.language, 'cy-GB');
  assert.deepEqual(c.title, { en: 'Harbour', 'zh-Hant': '港口', none: '1890' });
});

test('text in no particular language uses the IIIF tag "none"', () => {
  assert.deepEqual(parseConfig('language = "none"\nsummary = "1890"', opts).summary, { none: '1890' });
});

test('alt text describes the image', () => {
  assert.deepEqual(parseConfig('title = "Harbour"\nalt = "Fishing boats at dusk"', opts).alt, { en: 'Fishing boats at dusk' });
});

test('blank texts count as not given, and texts lose the spaces around them', () => {
  const c = parseConfig('title = "  "\nsummary = { en = "", cy = " Golygfa " }\nattribution = """\nExample Museum\n"""', opts);
  assert.equal(c.title, undefined);
  assert.deepEqual(c.summary, { cy: 'Golygfa' });
  assert.deepEqual(c.attribution, { en: 'Example Museum' });
});

// What someone might write, and the sentence that must tell them what is wrong: never a JavaScript error, and
// never a value quietly taken to mean something else.
const mistakes = [
  ['language = "English"', /"language" must be a language code such as en, cy or de-CH \(got "English"\)/],
  ['title = { english = "Harbour" }', /"title" has "english", which is not a language code such as en, cy or de-CH/],
  ['title = { en = 3 }', /"title\.en" must be text in double quotes, like "3"/],
  ['title = 3', /"title" must be text in double quotes, like "3", or a table of texts by language such as \{ en = "Harbour", cy = "Harbwr" \}/],
  ['[[metadata]]\nlabel = "Date"\nvalue = 1890-01-01', /"metadata\.value" must be text in double quotes, like "1890-01-01"/],
  ['summary = {}', /"summary" is an empty table/],
  ['[[metadata]]\nlabel = "Date"', /each \[\[metadata\]\] entry needs a "label" and a "value" \(entry 1\)/],
  ['[[metadata]]\nlabel = "Date"\nvalu = "1890"', /unknown setting "metadata\.valu"/],
  ['metadata = "Date: 1890"', /"metadata" must be a list of \[\[metadata\]\] entries, each with a "label" and a "value"/],
  ['metadata = ["Date"]', /"metadata" must be a list of \[\[metadata\]\] entries/],
  ['base_url = 3', /"base_url" must be a URL such as https:\/\/example\.org\/my-image \(got 3\)/],
  ['base_url = "example.org"', /"base_url" must be a URL/],
  ['viewer = 3', /"viewer" must be one of: openseadragon, mirador \(got 3\)/],
  ['rights = 4', /"rights" must be a Creative Commons or RightsStatements\.org URL/],
  ['tiles = 512', /"tiles" must be a section, \[tiles\], not a single value/],
  ['publish = false', /"publish" must be a section, \[publish\], not a single value/],
  ['[publish]\nfull = "no"', /"publish\.full" must be true or false, without quotes \(got "no"\)/],
  ['[tiles]\nsize = 1', /"tiles\.size" must be a whole number from 64 to 4096 \(got 1\)/],
  ['[tiles]\nsize = 10000', /"tiles\.size" must be a whole number from 64 to 4096 \(got 10000\)/],
  ['[tiles]\nsize = "512"', /"tiles\.size" must be a whole number from 64 to 4096 \(got "512"\)/],
  ['[tiles]\nquality = 85.5', /"tiles\.quality" must be a whole number from 1 to 100 \(got 85\.5\)/],
  ['[publish]\noriginal = "yes"', /"publish\.original" must be true or false, without quotes \(got "yes"\)/],
  ['[publish]\nfooter = "no"', /"publish\.footer" must be true or false, without quotes \(got "no"\)/],
  ['title = { en = "Harbour", EN = "Port" }', /"title" gives "en" twice/],
  ['picture = "Harbour.tif"', /"picture" must be the web address of a picture, starting https:\/\/ \(got "Harbour\.tif"\)\. A picture in content\/ needs no setting\./],
  ['picture = 3', /"picture" must be the web address of a picture/],
  ['colours = "red"', /"colours" must be a section, \[colours\], not a single value/],
  ['[colours]\nink = "inky black"', /"colours\.ink" must be a CSS colour, such as "#1a1a1a", "black" or "rgb\(26 26 26\)" \(got "inky black"\)/],
  ['[colours]\npaper = "red; } body { display: none"', /"colours\.paper" must be a CSS colour/],
  ['[colours]\npaper = "#12345"', /"colours\.paper" must be a CSS colour/],
  ['[colours]\npaper = 0xffffff', /"colours\.paper" must be a CSS colour, .* \(got 16777215\)/],
  ['dimensions = "120 cm"', /"dimensions" must be the width and height of the original, such as "120 × 80 cm", in mm, cm, m or in \(got "120 cm"\)/],
  ['dimensions = "120 x 80 feet"', /"dimensions" must be the width and height of the original/],
  ['dimensions = "0 x 80 cm"', /"dimensions" must be the width and height of the original/],
  ['dimensions = 120', /"dimensions" must be the width and height of the original, .* \(got 120\)/],
  ['creator = 3', /"creator" must be text in double quotes/],
];

for (const [toml, says] of mistakes) {
  test(`explains what is wrong with ${toml.replaceAll('\n', ' ')}`, () => {
    assert.throws(() => parseConfig(toml, opts), says);
  });
}

test('settings are read in browsers without URL.parse (Safari before 18), where the settings helper reads them too', () => {
  const { parse } = URL;
  delete URL.parse;
  try {
    const settings = parseConfig('rights = "https://creativecommons.org/licenses/by/4.0/"\npicture = "https://example.org/a.tif"\nbase_url = "https://example.org/"');
    assert.deepEqual([settings.rights, settings.picture, settings.base_url], ['http://creativecommons.org/licenses/by/4.0/', 'https://example.org/a.tif', 'https://example.org']);
    assert.throws(() => parseConfig('rights = "not a link"'), /"rights" must be a Creative Commons or RightsStatements\.org URL/);
  } finally {
    URL.parse = parse;
  }
});
