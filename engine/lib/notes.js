// Notes on the picture, an optional extra: content/notes.md, and notes.<language>.md for other languages. Each note
// is a level-two heading that links to its part of the picture, as "Link to this view" copies it, then the note's
// text; in that order they make the tour. Anything before the first note introduces them.
import { marked } from 'marked';

const REGION = /#xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)$/;
const EXAMPLE = '## [The lighthouse](the link to it)';

/** Whether a block token starts a note: a ## heading, not words underlined with dashes, which are often an accident. */
const startsNote = (token) => token.type === 'heading' && token.depth === 2 && token.raw.startsWith('#');
const regionOf = (href) => {
  const match = REGION.exec(href ?? '');
  if (!match) return undefined;
  const [x, y, w, h] = match.slice(1).map(Number);
  return { x, y, w, h };
};

/** The words in some inline tokens, without their markup. */
const plain = (tokens = []) => tokens.map((token) => (token.tokens ? plain(token.tokens) : (token.text ?? ''))).join('');

/** HTML for some block tokens; their headings go two levels down, below "Notes" and the note's own title. */
function html(tokens) {
  for (const token of tokens) if (token.type === 'heading') token.depth = Math.min(token.depth + 2, 6);
  const written = marked.parser(tokens);
  return written.trim() ? written : undefined;
}

/**
 * One notes file, `file` being its name in content/, as `{ intro, items: [{ region, title, text }] }`, the texts as
 * HTML. With `linked`, each note's heading must link to its part of the picture; a translation's need not.
 */
export function parseNotes(text, file, { linked }) {
  const intro = [];
  const items = [];
  for (const token of marked.lexer(text)) {
    // Only a ## heading starts a note: words underlined with dashes are a heading too, but one written by accident
    // as often as not, and they stay in the note's text.
    if (!startsNote(token)) {
      (items.at(-1)?.body ?? intro).push(token);
      continue;
    }
    const link = token.tokens.find((part) => part.type === 'link');
    const title = plain(token.tokens).trim();
    if (!title) {
      const where = link ? `between the square brackets: ## [The lighthouse](${link.href})` : 'after the ##.';
      throw new Error(`content/${file}: note ${items.length + 1} has no title. Write it ${where}`);
    }
    if (link && token.tokens.some((part) => part !== link && plain([part]).trim())) {
      throw new Error(`content/${file}: the note "${title}" has words outside its link. Make the whole heading the link: ## [${title}](${link.href})`);
    }
    const region = link && regionOf(link.href);
    if (link && !region) {
      throw new Error(
        `content/${file}: the note "${title}" links to ${link.href}, which is not a part of the picture. Zoom in on that part and copy "Link to this view".`,
      );
    } else if (!link && linked) {
      throw new Error(
        `content/${file}: the note "${title}" does not say which part of the picture it is about. Make its heading a link to that part: zoom in on it, copy "Link to this view", and write ## [${title}](the link).`,
      );
    }
    items.push({ title, region, body: [] });
  }
  if (items.length === 0) {
    throw new Error(`content/${file} has no notes in it. Each note starts with a heading such as ${EXAMPLE}, its link copied from "Link to this view".`);
  }
  return { intro: html(intro), items: items.map(({ title, region, body }) => ({ title, region, text: html(body) })) };
}

/**
 * The notes in every language they are written in, `files` mapping each language to its file and text, `language`
 * being the site's: `{ intro, items: [{ region, title, text }] }`, each text a language map. The site's own file
 * gives each note its part of the picture; the others follow its order.
 */
export function combineNotes(files, language) {
  const own = files[language];
  if (!own) {
    const [name] = Object.values(files).map(({ file }) => file);
    throw new Error(`content/${name} has no notes.md to go with it: the notes in the site's own language, ${language}, give each note its part of the picture.`);
  }
  const parsed = Object.fromEntries(Object.entries(files).map(([tag, { file, text }]) => [tag, { file, ...parseNotes(text, file, { linked: tag === language }) }]));
  const count = parsed[language].items.length;
  for (const { file, items } of Object.values(parsed)) {
    if (items.length !== count) {
      const notes = (n) => `${n} note${n === 1 ? '' : 's'}`;
      throw new Error(`content/${file} has ${notes(items.length)}, and content/${own.file} has ${count}: each language needs the same notes, in the same order.`);
    }
  }
  const map = (pick) => {
    const entries = Object.entries(parsed).flatMap(([tag, notes]) => (pick(notes) === undefined ? [] : [[tag, pick(notes)]]));
    return entries.length ? Object.fromEntries(entries) : undefined;
  };
  const intro = map((notes) => notes.intro);
  return {
    ...(intro && { intro }),
    items: parsed[language].items.map(({ region }, i) => {
      const text = map((notes) => notes.items[i].text);
      return { region, title: map((notes) => notes.items[i].title), ...(text && { text }) };
    }),
  };
}

/**
 * A paragraph's lines joined into one, as Markdown shows them, so that its text flows in the notes helper as it will
 * on the page; but for a line ended by two spaces or a backslash, which breaks the paragraph there.
 */
function unwrap(paragraph) {
  // The newline that ends it stays: a list, heading or code may start on the very next line.
  const [, words, end] = /^([\s\S]*?)(\n*)$/.exec(paragraph);
  const lines = words.split('\n');
  return lines.reduce((text, line) => (/ {2,}$|\\$/.test(text) ? `${text}\n${line}` : `${text.trimEnd()} ${line.trimStart()}`)) + end;
}

/**
 * notes.md as its owner wrote it, for the notes helper to edit: what introduces the notes, and each note's title, the
 * part of the picture its heading links to (if it does) and its text, in Markdown. It takes what it is given, unlike
 * parseNotes: the helper says what is missing.
 */
export function readNotesSource(text) {
  const intro = [];
  const items = [];
  for (const token of marked.lexer(text)) {
    if (!startsNote(token)) {
      (items.at(-1)?.body ?? intro).push({ raw: token.raw, joined: token.type === 'paragraph' ? unwrap(token.raw) : token.raw });
      continue;
    }
    const link = token.tokens.find((part) => part.type === 'link');
    items.push({ title: plain(token.tokens).trim(), region: regionOf(link?.href), body: [] });
  }
  // Joining a paragraph's lines can change how Markdown reads what follows it (a line underlined with dashes, say,
  // takes the whole paragraph into its heading), so they are joined only where the page would show the same.
  const markdown = (parts) => {
    const [raw, joined] = [blocks(parts.map((part) => part.raw).join('')), blocks(parts.map((part) => part.joined).join(''))];
    return joined !== raw && asShown(marked.parse(joined)) === asShown(marked.parse(raw)) ? joined : raw;
  };
  return { intro: markdown(intro), items: items.map(({ title, region, body }) => ({ title, region, text: markdown(body) })) };
}

/**
 * HTML as a browser shows it: a run of spaces as one, and none at the start or end of a block of text; but every
 * space and line in a <pre>, where they show, but for spaces at the end of a line.
 */
export const asShown = (html) =>
  html
    .split(/(<pre[\s>][\s\S]*?<\/pre>)/)
    .map((part) =>
      part.startsWith('<pre')
        ? part.replace(/[ \t]+\n/g, '\n')
        : // Only the spaces HTML collapses: a space that keeps two words together, say, shows as itself.
          part
            .replace(/[ \t\n\f\r]+/g, ' ')
            .replace(/(<(?:p|li|h[1-6]|td|th|blockquote)>) /g, '$1')
            .replace(/ (<\/(?:p|li|h[1-6]|td|th|blockquote)>)/g, '$1'),
    )
    .join('')
    .replace(/^ | $/g, '');

/** Whether Markdown has a ## heading in it, which in a notes file would start a note of its own. */
export const startsNotes = (text = '') => marked.lexer(text).some(startsNote);

/** The names of the link addresses written in Markdown as [name]: https://…, as Markdown matches them. */
export const linkNames = (text) => Object.keys(marked.lexer(text).links ?? {});

/**
 * Markdown without the blank lines before and after it, but with the spaces that start its first line, which can
 * make it code.
 */
const blocks = (text) => text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();

/** `text` escaped so Markdown shows every character of it as it is, rather than reading any as markup. */
const literal = (text) => text.replace(/[\\`*_[\]<>&~#]/g, '\\$&');

/**
 * notes.md for `notes`, as readNotesSource gives them: each note's heading links to its part of the picture on the
 * page at `pageUrl`, so it opens there from GitHub too. A note with no part yet has a plain heading, which the build
 * explains.
 */
export function writeNotesSource({ intro, items }, pageUrl) {
  const notes = items.map(({ title, region, text }) => {
    const words = literal(title.trim());
    const heading = region ? `## [${words}](${pageUrl}#xywh=${region.x},${region.y},${region.w},${region.h})` : `## ${words}`;
    return [heading, blocks(text)].filter(Boolean).join('\n\n');
  });
  return `${[blocks(intro), ...notes].filter(Boolean).join('\n\n')}\n`;
}
