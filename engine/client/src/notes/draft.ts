// The notes helper's notes, apart from React and the picture: read from the notes files the site was built from,
// written back to them, checked as the build will check them, and kept in the browser until they are published.
import { asShown, combineNotes, linkNames, parseNotes, readNotesSource, startsNotes, writeNotesSource } from '../../../lib/notes.js';
import type { Region } from '../address';
import type { Site } from '../site';

const names = new Intl.DisplayNames(['en'], { type: 'language' });
/** A language's name in English, the helper's own language, such as Welsh for cy. */
export function languageName(language: string): string {
  try {
    return names.of(language) ?? language;
  } catch {
    return language;
  }
}

/** One text in each language the notes are written in, in Markdown. */
export type Words = Record<string, string>;

/** A note being written; `key` stays with it as notes are added, moved and removed. */
export interface Note {
  key: number;
  region?: Region;
  title: Words;
  text: Words;
}

export interface Notes {
  intro: Words;
  items: Note[];
}

/** A notes file as the site was built from it: notes.md in the site's own language, or a translation. */
export interface NotesFile {
  file: string;
  language: string;
  text: string;
  /** Where to change it on GitHub. */
  url?: string;
}

/** A notes file written from the notes, and whether its notes differ from those the site has. */
export interface Written extends NotesFile {
  changed: boolean;
}

/** Something the build would refuse, and the note it is about, if any, so the helper can take the owner there. */
export interface Problem {
  key?: number | 'intro';
  message: string;
}

let keys = 0;

/** The notes in `files`, the site's own first: each note's part comes from it, and its words from every file. */
export function readNotes(files: NotesFile[]): Notes {
  const read = files.map(({ language, text }) => ({ language, ...readNotesSource(text) }));
  const [own] = read;
  const each = (pick: (notes: (typeof read)[number]) => string | undefined): Words => Object.fromEntries(read.map((notes) => [notes.language, pick(notes) ?? '']));
  return {
    intro: each((notes) => notes.intro),
    items: own.items.map(({ region }, i) => ({
      key: keys++,
      region,
      title: each((notes) => notes.items[i]?.title),
      text: each((notes) => notes.items[i]?.text),
    })),
  };
}

/** A note with nothing in it yet, but the part of the picture it was given, if any. */
export const newNote = (region?: Region): Note => ({ key: keys++, region, title: {}, text: {} });

/** The notes as the files the build reads, each heading of the site's own linking to its part on the page at `pageUrl`. */
function sourceOf(notes: Notes, language: string, own: boolean, pageUrl: string): string {
  const items = notes.items.map(({ region, title, text }) => ({ region: own ? region : undefined, title: title[language] ?? '', text: text[language] ?? '' }));
  return writeNotesSource({ intro: notes.intro[language] ?? '', items }, pageUrl);
}

/**
 * What visitors would see of a notes file, as the build reads it (its HTML, spaces aside, which a browser shows
 * alike); undefined if the build would not read it. A translation's parts are the site's own, so they are left out.
 */
function shown(text: string, own: boolean): string | undefined {
  const flat = (html?: string) => html && asShown(html);
  try {
    const { intro, items } = parseNotes(text, 'notes.md', { linked: false });
    return JSON.stringify({ intro: flat(intro), items: items.map(({ title, region, text: html }) => ({ title, text: flat(html), ...(own && { region }) })) });
  } catch {
    return undefined;
  }
}

// What the build makes of each file is remembered, as the site's files are read again at every key pressed.
const remembered = new Map<string, string | undefined>();
function seen(text: string, own: boolean): string | undefined {
  const key = `${own}${text}`;
  if (!remembered.has(key)) {
    if (remembered.size > 100) remembered.clear();
    remembered.set(key, shown(text, own));
  }
  return remembered.get(key);
}

/**
 * Whether two notes files hold the same notes however they are written, judged by what the build makes of them, not
 * by the helper's own reading, so that anything lost in reading and writing them shows as a change.
 */
function same(a: string, b: string, own: boolean): boolean {
  const [x, y] = [seen(a, own), seen(b, own)];
  return x === undefined || y === undefined ? a.trim() === b.trim() : x === y;
}

/** Whether the site's notes `files` are the notes in `texts`, file by file, however each was written and saved. */
export function sameFiles(files: NotesFile[], texts: string[]): boolean {
  return files.length === texts.length && files.every(({ text }, i) => same(text, texts[i], i === 0));
}

/** Every file, written from `notes`, and which of them differ from what the site has. */
export function writeNotes(notes: Notes, files: NotesFile[], pageUrl: string): Written[] {
  return files.map((file, i) => {
    const text = sourceOf(notes, file.language, i === 0, pageUrl);
    return { ...file, text, changed: !same(text, file.text, i === 0) };
  });
}


/**
 * What the build would refuse in the notes, in the order the owner meets it on the page; `written` is the files as
 * writeNotes writes them, if they are to hand.
 */
export function problemsOf(
  notes: Notes,
  files: NotesFile[],
  site: { width: number; height: number; pageUrl: string },
  written = writeNotes(notes, files, site.pageUrl),
): Problem[] {
  const [own, ...translations] = files;
  const problems: Problem[] = [];
  if (notes.items.length === 0) {
    // A site that has notes is told how to have none; one that never had any has nothing to publish, unless an
    // introduction has been written, which on its own is a notes.md the build refuses.
    if (own.text.trim()) problems.push({ message: `There are no notes. To have none, delete ${files.map(({ file }) => file).join(' and ')} instead.` });
    else if (Object.values(notes.intro).some((text) => text.trim())) {
      problems.push({ key: 'intro', message: 'An introduction needs notes to introduce: add a note, or leave the introduction empty.' });
    }
    return problems;
  }
  const heading = 'a heading made with ##, which would start a note of its own: use ###';
  for (const { language } of files) {
    if (startsNotes(notes.intro[language])) {
      const which = language === own.language ? 'The introduction' : `The introduction in ${languageName(language)}`;
      problems.push({ key: 'intro', message: `${which} has ${heading} for a heading within it.` });
    }
  }
  for (const [i, { key, region, title, text }] of notes.items.entries()) {
    const note = `Note ${i + 1}`;
    if (!title[own.language]?.trim()) problems.push({ key, message: `${note} needs a title.` });
    if (!region) problems.push({ key, message: `${note} needs a part of the picture.` });
    else if (region.x + region.w > site.width || region.y + region.h > site.height) problems.push({ key, message: `${note}’s part runs off the picture: mark it again.` });
    if (startsNotes(text[own.language])) problems.push({ key, message: `${note} has ${heading} for a heading within a note.` });
    for (const { file, language } of translations) {
      const name = languageName(language);
      if (!title[language]?.trim()) problems.push({ key, message: `${note} needs a title in ${name}, for ${file}.` });
      if (startsNotes(text[language])) problems.push({ key, message: `${note}’s text in ${name} has ${heading} for a heading within a note.` });
    }
  }
  if (problems.length) return problems;
  problems.push(...takenIn(notes, written), ...linksLost(notes, files, written));
  if (problems.length) return problems;
  // Anything else the build would say, in its own words.
  try {
    combineNotes(Object.fromEntries(written.map(({ file, language, text }) => [language, { file, text }])), own.language);
  } catch (error) {
    problems.push({ message: (error as Error).message });
  }
  return problems;
}

/** Every language the notes have words in, `language` (the site's) first. */
export function languagesOf(notes: Notes, language: string): string[] {
  const words = [notes.intro, ...notes.items.flatMap(({ title, text }) => [title, text])];
  return [...new Set([language, ...words.flatMap((texts) => Object.keys(texts))])];
}

/**
 * Something left open in a note's text (a code block, a comment, an HTML tag), which in the file written would take
 * in the notes after it: their headings are then read as its text, and they are lost from the site.
 */
function takenIn(notes: Notes, written: Written[]): Problem[] {
  const open = 'something left open (a ``` or ~~~ code block, a <!-- comment, or an HTML tag such as <pre>), which would take in the notes after it: close it.';
  return written.flatMap(({ text, language }, f): Problem[] => {
    const read = readNotesSource(text).items.length;
    if (read >= notes.items.length) return [];
    const where = f === 0 ? '' : ` in ${languageName(language)}`;
    // The last note read whole is the one left open; none read, the introduction.
    if (read === 0) return [{ key: 'intro' as const, message: `The introduction${where} has ${open}` }];
    const which = f === 0 ? `Note ${read} has in its text` : `Note ${read}’s text${where} has`;
    return [{ key: notes.items[read - 1].key, message: `${which} ${open}` }];
  });
}

/** A link name, as Markdown matches it: in any case, and with its spaces as one. */
const linkName = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A link whose address was written in a note removed or changed, as [name]: https://…, and so lost: the link would
 * show on the site as words in square brackets. Only names the site's files gave an address are looked for, so square
 * brackets meant as such are left alone.
 */
function linksLost(notes: Notes, files: NotesFile[], written: Written[]): Problem[] {
  return written.flatMap(({ text, language }, f): Problem[] => {
    const now = new Set(linkNames(text));
    const lost = linkNames(files[f].text).filter((name) => !now.has(name));
    if (lost.length === 0) return [];
    const uses = (words = '') => [...words.matchAll(/\[([^\]]+)\](?:\[([^\]]*)\])?/g)].map(([, label, name]) => linkName(name || label));
    const where = f === 0 ? '' : ` in ${languageName(language)}`;
    const said = (which: string, name: string) => `${which} link [${name}]${where} has lost its address, written in a note now removed or changed as [${name}]: https://…: write that into its text again.`;
    const intro = uses(notes.intro[language]).filter((name) => lost.includes(name));
    return [
      ...intro.slice(0, 1).map((name) => ({ key: 'intro' as const, message: said('The introduction’s', name) })),
      ...notes.items.flatMap(({ key, text: words }, i) => {
        const name = uses(words[language]).find((used) => lost.includes(used));
        return name ? [{ key, message: said(`Note ${i + 1}’s`, name) }] : [];
      }),
    ];
  });
}

/**
 * The notes as the site's page shows them (see combineNotes), made by the build's own code from the files the helper
 * would write, so the page can preview them before they are published. `language` is the site's. A note not yet
 * given a part of the picture is left out, and one without a title is called Untitled; none if no note has a part to
 * show; and if the build could not read them, the problem it would give instead.
 */
export function previewOf(notes: Notes, language: string, pageUrl: string): { notes?: Site['notes']; problem?: string } {
  const languages = languagesOf(notes, language);
  const items = notes.items
    .filter(({ region }) => region)
    .map((note) => ({ ...note, title: Object.fromEntries(languages.map((tag) => [tag, note.title[tag]?.trim() || 'Untitled'])) }));
  if (items.length === 0) return {};
  const placed = { intro: notes.intro, items };
  const file = (tag: string) => (tag === language ? 'notes.md' : `notes.${tag}.md`);
  try {
    return { notes: combineNotes(Object.fromEntries(languages.map((tag) => [tag, { file: file(tag), text: sourceOf(placed, tag, tag === language, pageUrl) }])), language) };
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

/**
 * Changes not yet published, kept in the browser: the notes, the texts of the files they began from, when the notes
 * were last changed, and the files last copied or downloaded to put on the site, and when, to watch for the site to
 * have them.
 */
export interface Draft {
  notes: Notes;
  begun: string[];
  saved?: number;
  copied?: Copied;
}

export interface Copied {
  texts: string[];
  at: number;
}

// One draft for each site: an owner's sites share their browser storage, at OWNER.github.io.
export const draftKey = (pageUrl: string) => `whatiiif notes: ${pageUrl}`;

/** A draft as it is kept, but for when, and without the keys, which are the page's own. */
const stored = ({ notes, begun, copied }: Omit<Draft, 'saved'>) => ({ notes: { intro: notes.intro, items: notes.items.map(({ key, ...note }) => note) }, begun, copied });

/** A draft as kept, apart from when: two the same need not be kept again. */
export const draftContent = (draft: Omit<Draft, 'saved'>) => JSON.stringify(stored(draft));

/** Just the notes of a draft, as kept: whether they changed decides when the draft was made. */
export const notesContent = (notes: Notes) => JSON.stringify(stored({ notes, begun: [] }).notes);

/**
 * Keeps a draft for the site at `pageUrl`, made at its `saved` time, else `now`; false if the browser will not keep
 * it (in a private window, say).
 */
export function saveDraft(storage: Pick<Storage, 'setItem'>, pageUrl: string, draft: Draft, now = Date.now()): boolean {
  const kept = { ...stored(draft), saved: draft.saved ?? now };
  try {
    storage.setItem(draftKey(pageUrl), JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

/** The changes kept for the site at `pageUrl`, if there are any that can be read. */
export function loadDraft(storage: Pick<Storage, 'getItem'>, pageUrl: string): Draft | undefined {
  try {
    const kept = JSON.parse(storage.getItem(draftKey(pageUrl)) ?? 'null');
    if (!Array.isArray(kept?.notes?.items) || !Array.isArray(kept.begun)) return undefined;
    // Kept by this page, but perhaps by an older one, or changed by hand: only what reads as a note is used.
    const words = (value: unknown): Words => (value && typeof value === 'object' ? (value as Words) : {});
    const part = (region: Region | undefined) => (region && ['x', 'y', 'w', 'h'].every((side) => Number.isInteger(region[side as keyof Region])) ? region : undefined);
    const items = kept.notes.items
      .filter((note: unknown) => note && typeof note === 'object')
      .map((note: Partial<Note>) => ({ key: keys++, region: part(note.region), title: words(note.title), text: words(note.text) }));
    const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
    const { texts, at } = kept.copied ?? {};
    const copied = Array.isArray(texts) && texts.every((text) => typeof text === 'string') && time(at) !== undefined ? { texts, at } : undefined;
    return { notes: { intro: words(kept.notes.intro), items }, begun: kept.begun, saved: time(kept.saved), copied };
  } catch {
    return undefined;
  }
}

/** The draft for the site at `pageUrl` exactly as kept, to tell when it changes; '' if there is none. */
export function draftAsKept(storage: Pick<Storage, 'getItem'>, pageUrl: string): string {
  try {
    return storage.getItem(draftKey(pageUrl)) ?? '';
  } catch {
    return '';
  }
}

export function clearDraft(storage: Pick<Storage, 'removeItem'>, pageUrl: string): void {
  try {
    storage.removeItem(draftKey(pageUrl));
  } catch {
    // Nothing was kept, then.
  }
}
