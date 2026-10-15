// Notes on the picture, an optional extra: content/notes.md, and notes.<language>.md for other languages. Each note
// is a level-two heading that links to its part of the picture, as "Link to this view" copies it, then the note's
// text; in that order they make the tour. Anything before the first note introduces them.
import { marked } from 'marked';

const REGION = /#xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)$/;
const EXAMPLE = '## [The lighthouse](the link to it)';

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
    if (token.type !== 'heading' || token.depth !== 2 || !token.raw.startsWith('#')) {
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
    let region;
    if (link) {
      const match = REGION.exec(link.href);
      if (!match) {
        throw new Error(
          `content/${file}: the note "${title}" links to ${link.href}, which is not a part of the picture. Zoom in on that part and copy "Link to this view".`,
        );
      }
      const [x, y, w, h] = match.slice(1).map(Number);
      region = { x, y, w, h };
    } else if (linked) {
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
