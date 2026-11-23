// whatiiif.toml written out from settings, as config.js reads them: what the settings helper gives its owner to
// commit. Only what differs from the defaults is written, so the file says what its owner chose.

const DEFAULTS = { language: 'en', viewer: 'openseadragon', tiles: { size: 512, quality: 85 }, publish: { full: true, original: true, footer: true } };
const TEXTS = ['title', 'summary', 'creator', 'date', 'attribution', 'alt'];
const SIMPLE = ['rights', 'dimensions', 'picture', 'viewer', 'base_url'];

/** A TOML basic string: JSON's escapes are TOML's, except that TOML also wants DEL escaped. */
const quoted = (text) => JSON.stringify(text).replaceAll('\x7f', '\\u007F');
const key = (name) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : quoted(name));

/** A text: plain when it is in the site's language alone, else a table by language. Blank entries are left out. */
function text(map, language) {
  const entries = Object.entries(map ?? {})
    .map(([tag, words]) => [tag, String(words).trim()])
    .filter(([, words]) => words);
  if (entries.length === 0) return undefined;
  if (entries.length === 1 && entries[0][0] === language) return quoted(entries[0][1]);
  return `{ ${entries.map(([tag, words]) => `${key(tag)} = ${quoted(words)}`).join(', ')} }`;
}

/** `[name]` with the entries of `table` that differ from `defaults`, if any do; a number left blank in a form is NaN. */
function section(name, table = {}, defaults = {}) {
  const lines = Object.entries(table)
    .filter(([setting, value]) => value !== undefined && value !== '' && !Number.isNaN(value) && value !== defaults[setting])
    .map(([setting, value]) => `${key(setting)} = ${typeof value === 'string' ? quoted(value) : value}`);
  return lines.length ? [`[${name}]`, ...lines].join('\n') : undefined;
}

/**
 * `settings` with their texts said to be in `language`: a text in the old language moves to the new one, unless it
 * is given in that already, in which case the old one stays as a translation. What a form needs when its owner says
 * what language they wrote in, which is usually after writing.
 */
export function withLanguage(settings, language) {
  const from = settings.language ?? DEFAULTS.language;
  const move = (map) => {
    if (!map || !(from in map) || language in map) return map;
    const { [from]: words, ...rest } = map;
    return { [language]: words, ...rest };
  };
  const moved = Object.fromEntries(TEXTS.map((name) => [name, move(settings[name])]));
  const metadata = settings.metadata?.map(({ label, value }) => ({ label: move(label), value: move(value) }));
  return { ...settings, ...moved, ...(metadata && { metadata }), language };
}

/** whatiiif.toml for `settings`, which config.js's parseConfig gives, or a form fills in the same shape. */
export function writeConfig(settings) {
  const { language = DEFAULTS.language } = settings;
  const lines = [];
  if (language !== DEFAULTS.language) lines.push(`language = ${quoted(language)}`);
  for (const name of TEXTS) {
    const written = text(settings[name], language);
    if (written) lines.push(`${name} = ${written}`);
  }
  for (const name of SIMPLE) {
    const value = name === 'dimensions' ? (settings.dimensions?.text ?? settings.dimensions) : settings[name];
    if (typeof value === 'string' && value.trim() && value !== DEFAULTS[name]) lines.push(`${name} = ${quoted(value.trim())}`);
  }

  const blocks = [lines.join('\n')];
  for (const { label, value } of settings.metadata ?? []) {
    const [l, v] = [text(label, language), text(value, language)];
    if (l && v) blocks.push(`[[metadata]]\nlabel = ${l}\nvalue = ${v}`);
  }
  blocks.push(section('tiles', settings.tiles, DEFAULTS.tiles), section('publish', settings.publish, DEFAULTS.publish), section('colours', settings.colours));

  const head = '# Made with the settings helper. Every setting is explained at\n# https://github.com/gjhilton/WhatIIIF/blob/main/content/whatiiif.toml';
  return `${[head, ...blocks.filter(Boolean)].join('\n\n')}\n`;
}
