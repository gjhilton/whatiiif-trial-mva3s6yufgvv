// content/, which belongs to the site's owner: one picture (or the link to one in whatiiif.toml), the settings in
// whatiiif.toml, descriptions in description.md and description.<language>.md, and, if its owner wants them, notes
// on the picture in notes.md and notes.<language>.md.
import { createWriteStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Marked } from 'marked';
import { LANGUAGE_EXAMPLE, languageCode, parseConfig } from './config.js';
import { combineNotes } from './notes.js';
import { cannotRead, findImage, listImages, sniff } from './source.js';
import { closest } from './spelling.js';

const DESCRIPTION = /^description(?:\.([^.]+))?\.md$/;
const NOTES = /^notes(?:\.([^.]+))?\.md$/;
const KNOWN = ['whatiiif.toml', 'description.md', 'notes.md'];

// The page's title is its one top-level heading, so a description's headings start a level below it.
const markdown = new Marked({
  walkTokens(token) {
    if (token.type === 'heading') token.depth = Math.min(token.depth + 1, 6);
  },
});

/** A text file, without the byte order mark some Windows editors start one with, which would hide its first heading. */
const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
const readOptional = (path) => readText(path).catch((error) => (error.code === 'ENOENT' ? undefined : Promise.reject(error)));

/** description.md, in the site's language, and description.<language>.md for any other, as HTML. */
async function descriptions(dir, files, language) {
  const html = {};
  const from = {};
  for (const file of files) {
    const match = DESCRIPTION.exec(file);
    const tag = match && (match[1] === undefined ? language : languageCode(match[1]));
    if (!tag) continue;
    if (from[tag]) throw new Error(`content/${from[tag]} and content/${file} are both in ${tag}; keep one`);
    from[tag] = file;
    html[tag] = await markdown.parse(await readText(join(dir, file)));
  }
  return Object.keys(html).length ? html : undefined;
}

/** The notes files in content/, by the language each is in: `{ cy: { file, text } }`; undefined when there are none. */
async function notesFiles(dir, files, language) {
  const found = {};
  for (const file of files) {
    const match = NOTES.exec(file);
    const tag = match && (match[1] === undefined ? language : languageCode(match[1]));
    if (!tag) continue;
    if (found[tag]) throw new Error(`content/${found[tag].file} and content/${file} are both in ${tag}; keep one`);
    found[tag] = { file, text: await readText(join(dir, file)) };
  }
  return Object.keys(found).length ? found : undefined;
}

/** What to tell the owner about each file in content/ that will not be published, or used to make the site. */
function unused(files, { images, unsupported }, image) {
  const told = [];
  for (const file of files) {
    if (file.startsWith('.') || file === 'whatiiif.toml' || file === image.name) continue;
    const texts = DESCRIPTION.exec(file) ?? NOTES.exec(file);
    if (texts) {
      if (texts[1] !== undefined && !languageCode(texts[1])) told.push(`content/${file} is not used: "${texts[1]}" is not ${LANGUAGE_EXAMPLE}.`);
    } else if (images.includes(file) || unsupported.includes(file)) {
      told.push(`content/${file} is not published: only ${image.name} is.`);
    } else {
      const meant = closest(file, KNOWN) ?? closest(basename(file, extname(file)), KNOWN);
      told.push(`content/${file} is not used${meant ? `; did you mean ${meant}?` : '. content/ holds one picture, whatiiif.toml, description.md and notes.md.'}`);
    }
  }
  return told;
}

/** The picture at `url`, downloaded into `dir`: where it is now, what it is called and what kind of picture it is. */
async function download(url, dir, fetch) {
  const problem = (why) => new Error(`Could not download the picture at ${url}: ${why}`);
  const response = await fetch(url).catch((error) => Promise.reject(problem(`${error.cause?.message ?? error.message}.`)));
  if (!response.ok) {
    throw problem(
      `the server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}. Check that the link is right and that anyone can open it: paste it into a private browser window.`,
    );
  }
  const path = join(dir, 'picture');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));

  const { format, name, page } = await sniff(path);
  if (page) {
    throw new Error(`${url} is a web page, not a picture. Use a link that downloads the picture itself: on GitHub, the link of the file under a release's Assets.`);
  }
  if (!format) {
    if (!name) throw new Error(`The picture at ${url} is not a TIFF, PNG, JPEG, WebP, AVIF or GIF.`);
    const told = cannotRead(`The picture at ${url}`, name);
    throw new Error(name === 'HEIC' ? told : `${told} and link to that instead.`);
  }
  return { path, name: fileName(response.headers.get('content-disposition'), url) || 'picture', format, bytes: (await stat(path)).size, url };
}

/** What a downloaded file is called: what the server says (Content-Disposition), else the last part of its address. */
function fileName(disposition, url) {
  const decoded = (text) => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(disposition ?? '');
  const given = encoded ? decoded(encoded.trim()) : (plain?.[2] ?? plain?.[1])?.trim();
  return basename(given || decoded(basename(new URL(url).pathname)));
}

/** Every language the texts are written in: the site's own first, then the rest alphabetically. */
function languagesOf(language, texts) {
  const found = new Set(texts.filter(Boolean).flatMap(Object.keys));
  found.delete(language);
  return [language, ...[...found].sort()];
}

/**
 * Everything in `dir` that the site is made from: the picture, the settings with their defaults, the description
 * as HTML (a language map, like every text), any notes on the picture (and `notesSource`, the file they are in, as
 * written), every language any of those texts is in, what is `unused` in `dir`, and the `settings` as written,
 * without the defaults that come from the picture. A
 * picture named by its link in the settings is downloaded into `downloads` with `fetch`.
 */
export async function readContent(dir, { fetch = globalThis.fetch, downloads } = {}) {
  const files = (await readdir(dir)).sort();
  const settings = parseConfig((await readOptional(join(dir, 'whatiiif.toml'))) ?? '');
  const pictures = await listImages(dir);

  let image;
  if (settings.picture) {
    const committed = [...pictures.images, ...pictures.unsupported];
    if (committed.length) {
      throw new Error(`content/ holds ${committed.join(', ')}, and whatiiif.toml names a picture at ${settings.picture}: keep one or the other.`);
    }
    image = await download(settings.picture, downloads, fetch);
  } else {
    image = await findImage(dir);
  }

  const title = settings.title ?? { [settings.language]: basename(image.name, extname(image.name)) };
  const config = { ...settings, title, alt: settings.alt ?? title };
  const description = await descriptions(dir, files, config.language);
  const written = await notesFiles(dir, files, config.language);
  const notes = written && combineNotes(written, config.language);
  // For the notes helper: the files it edits, as written, the site's own first; the translations follow its notes.
  const own = written?.[config.language];
  const notesSource = own && {
    file: own.file,
    language: config.language,
    text: own.text,
    translations: Object.entries(written).flatMap(([language, { file, text }]) => (language === config.language ? [] : [{ file, language, text }])),
  };
  const { summary, creator, date, attribution, alt, metadata } = config;
  const texts = [
    ...[title, summary, creator, date, attribution, alt, description, notes?.intro],
    ...metadata.flatMap(({ label, value }) => [label, value]),
    ...(notes?.items ?? []).flatMap((note) => [note.title, note.text]),
  ];
  return { image, config, settings, description, notes, notesSource, languages: languagesOf(config.language, texts), unused: unused(files, pictures, image) };
}
