// content/whatiiif.toml: what the site's owner wrote, checked and turned into settings with every default applied.
// Its readers are not programmers, so every mistake is explained in a sentence that says what to write instead.
import { parse } from 'smol-toml';
import { closest } from './spelling.js';

export const VIEWERS = ['openseadragon', 'mirador'];
// A BCP 47 language tag (en, cy, de-CH, zh-Hant), or IIIF's "none" for text in no particular language.
const LANGUAGE = /^(none|[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*)$/;
export const LANGUAGE_EXAMPLE = 'a language code such as en, cy or de-CH';
const TILE_SIZES = [64, 4096];

// The settings each part of the file may hold.
const SETTINGS = {
  '': ['language', 'title', 'summary', 'creator', 'date', 'attribution', 'alt', 'rights', 'dimensions', 'picture', 'viewer', 'base_url', 'metadata', 'tiles', 'publish', 'colours'],
  tiles: ['size', 'quality'],
  publish: ['full', 'original', 'footer'],
  metadata: ['label', 'value'],
  // The page's colours, named as in engine/client/src/colours.css.
  colours: ['paper', 'ink', 'error', 'viewer'],
};

// CSS colour names; a colour's value is written into the page, so nothing but a colour may get through.
const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue
  chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey
  darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
  darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen
  lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
  limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver
  skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/),
);
const COLOUR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([\w\s.,%/+-]*\))$/i;

const fail = (message) => {
  throw new Error(`content/whatiiif.toml: ${message}`);
};

/** A value as it was written in the file: text in quotes, a number or date as it is. */
const written = (value) => (typeof value === 'string' ? `"${value}"` : value instanceof Date ? value.toISOString() : String(value));
const unquoted = (value) => (value instanceof Date ? value.toISOString() : String(value));
/** `text` as a URL, or null if it is not one. (URL.parse would do, but Safari has had it only since version 18.) */
function parseUrl(text) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
const isTable = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function checkKeys(table, part) {
  for (const key of Object.keys(table)) {
    if (SETTINGS[part].includes(key)) continue;
    const meant = closest(key, SETTINGS[part]);
    fail(`unknown setting "${part ? `${part}.` : ''}${key}"${meant ? `; did you mean "${meant}"?` : '.'} Valid settings here: ${SETTINGS[part].join(', ')}`);
  }
}

/** A [section] of the file, such as [tiles]: absent means empty. */
function section(raw, name) {
  const table = raw[name] ?? {};
  if (!isTable(table)) fail(`"${name}" must be a section, [${name}], not a single value`);
  checkKeys(table, name);
  return table;
}

/** `tag` as BCP 47 writes it (cy-GB, zh-Hant), so that EN and en are the same; undefined if it is not a language code. */
export function languageCode(tag) {
  if (typeof tag !== 'string' || !LANGUAGE.test(tag)) return undefined;
  if (tag.toLowerCase() === 'none') return 'none';
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

const languageTag = (tag, problem) => languageCode(tag) ?? fail(problem);

/**
 * A text setting as a language map, `{ en: "Harbour", cy: "Harbwr" }`: plain text is in the site's `language`, a
 * table gives the text in each language it was written in. Blank texts count as not given.
 */
function text(value, setting, language) {
  if (value === undefined) return undefined;
  const words = (given, name, otherwise = '') => {
    if (typeof given !== 'string') fail(`"${name}" must be text in double quotes, like "${unquoted(given)}"${otherwise}`);
    return given.trim();
  };
  if (!isTable(value)) {
    const plain = words(value, setting, ', or a table of texts by language such as { en = "Harbour", cy = "Harbwr" }');
    return plain ? { [language]: plain } : undefined;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) fail(`"${setting}" is an empty table; give the text, or one entry per language`);
  const map = {};
  const seen = new Set();
  for (const [typed, given] of entries) {
    const tag = languageTag(typed, `"${setting}" has "${typed}", which is not ${LANGUAGE_EXAMPLE}`);
    if (seen.has(tag)) fail(`"${setting}" gives "${tag}" twice; keep one`);
    seen.add(tag);
    const trimmed = words(given, `${setting}.${typed}`);
    if (trimmed) map[tag] = trimmed;
  }
  return Object.keys(map).length ? map : undefined;
}

function metadata(raw, language) {
  const entries = raw ?? [];
  const malformed = () => fail('"metadata" must be a list of [[metadata]] entries, each with a "label" and a "value"');
  if (!Array.isArray(entries)) malformed();
  return entries.map((entry, i) => {
    if (!isTable(entry)) malformed();
    checkKeys(entry, 'metadata');
    const label = text(entry.label, 'metadata.label', language);
    const value = text(entry.value, 'metadata.value', language);
    if (!label || !value) fail(`each [[metadata]] entry needs a "label" and a "value" (entry ${i + 1})`);
    return { label, value };
  });
}

/**
 * IIIF only accepts Creative Commons and RightsStatements.org URIs as `rights`, in the http:// form they are
 * defined with. People copy the address of the page they read, so a licence's deed or legal code, a
 * statement's page, and any query are taken back to the URI they describe.
 */
function rights(value) {
  if (value === undefined) return undefined;
  const url = typeof value === 'string' ? parseUrl(value) : null;
  const host = url && ['http:', 'https:'].includes(url.protocol) && url.hostname.replace(/^www\./, '');
  const path = url?.pathname.split('/').filter(Boolean) ?? [];
  if (host === 'creativecommons.org' && ['licenses', 'publicdomain'].includes(path[0]) && path.length >= 3) {
    while (/^(deed|legalcode)/.test(path.at(-1))) path.pop();
    if (path.length >= 3) return `http://creativecommons.org/${path.join('/')}/`;
  }
  if (host === 'rightsstatements.org' && ['vocab', 'page'].includes(path[0]) && path.length === 3) {
    return `http://rightsstatements.org/vocab/${path[1]}/${path[2]}/`;
  }
  return fail(
    `"rights" must be a Creative Commons or RightsStatements.org URL, for example https://creativecommons.org/licenses/by/4.0/ (got ${written(value)}). Describe any other terms in "attribution" instead.`,
  );
}

/** An address on the web, without the slashes it may end in; `example` and `otherwise` explain a wrong one. */
function webAddress(value, setting, example, otherwise = '') {
  if (value === undefined) return undefined;
  const url = typeof value === 'string' ? parseUrl(value) : null;
  if (!url || !['http:', 'https:'].includes(url.protocol)) fail(`"${setting}" must be ${example} (got ${written(value)})${otherwise}`);
  return value.replace(/\/+$/, '');
}

// The original's width and height, the unit after the second: 120 × 80 cm, 420mm x 297mm, 47,5 x 31,25 in.
const DIMENSIONS = /^\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|in)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|in)\s*$/i;

/** How big the original is, which gives the picture a scale: `{ width, height, unit, text }`. */
function dimensions(value) {
  if (value === undefined) return undefined;
  const match = typeof value === 'string' && DIMENSIONS.exec(value);
  const number = (digits) => Number(digits.replace(',', '.'));
  const [width, height, unit] = match ? [number(match[1]), number(match[3]), match[4].toLowerCase()] : [];
  if (!match || !(width > 0 && height > 0) || (match[2] && match[2].toLowerCase() !== unit)) {
    fail(`"dimensions" must be the width and height of the original, such as "120 × 80 cm", in mm, cm, m or in (got ${written(value)})`);
  }
  return { width, height, unit, text: `${width} × ${height} ${unit}` };
}

function wholeNumber(value, setting, [min, max]) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`"${setting}" must be a whole number from ${min} to ${max} (got ${written(value)})`);
  }
  return value;
}

function yesOrNo(value, setting) {
  if (typeof value !== 'boolean') fail(`"${setting}" must be true or false, without quotes (got ${written(value)})`);
  return value;
}

function colours(table) {
  const chosen = {};
  for (const [name, value] of Object.entries(table)) {
    const colour = typeof value === 'string' && value.trim();
    if (!colour || !(COLOUR.test(colour) || NAMED_COLOURS.has(colour.toLowerCase()))) {
      fail(`"colours.${name}" must be a CSS colour, such as "#1a1a1a", "black" or "rgb(26 26 26)" (got ${written(value)})`);
    }
    chosen[name] = colour;
  }
  return chosen;
}

/**
 * Parses whatiiif.toml text into settings with defaults applied. Throws readable errors. The title and alt text
 * are left out when not given: their default comes from the picture's name, which is not known here.
 */
export function parseConfig(toml) {
  let raw;
  try {
    raw = parse(toml);
  } catch (error) {
    throw new Error(`content/whatiiif.toml is not valid TOML: ${error.message}`);
  }
  checkKeys(raw, '');
  const tiles = section(raw, 'tiles');
  const publish = section(raw, 'publish');

  const language = languageTag(raw.language ?? 'en', `"language" must be ${LANGUAGE_EXAMPLE} (got ${written(raw.language)})`);
  const viewer = raw.viewer ?? VIEWERS[0];
  if (!VIEWERS.includes(viewer)) fail(`"viewer" must be one of: ${VIEWERS.join(', ')} (got ${written(viewer)})`);

  return {
    language,
    title: text(raw.title, 'title', language),
    summary: text(raw.summary, 'summary', language),
    creator: text(raw.creator, 'creator', language),
    date: text(raw.date, 'date', language),
    attribution: text(raw.attribution, 'attribution', language),
    alt: text(raw.alt, 'alt', language),
    rights: rights(raw.rights),
    dimensions: dimensions(raw.dimensions),
    picture: webAddress(raw.picture, 'picture', 'the web address of a picture, starting https://', '. A picture in content/ needs no setting.'),
    viewer,
    base_url: webAddress(raw.base_url, 'base_url', 'a URL such as https://example.org/my-image'),
    metadata: metadata(raw.metadata, language),
    tiles: {
      size: wholeNumber(tiles.size ?? 512, 'tiles.size', TILE_SIZES),
      quality: wholeNumber(tiles.quality ?? 85, 'tiles.quality', [1, 100]),
    },
    publish: {
      full: yesOrNo(publish.full ?? true, 'publish.full'),
      original: yesOrNo(publish.original ?? true, 'publish.original'),
      footer: yesOrNo(publish.footer ?? true, 'publish.footer'),
    },
    colours: colours(section(raw, 'colours')),
  };
}
