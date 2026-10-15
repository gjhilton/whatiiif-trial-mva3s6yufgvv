// What a build tells the person whose picture it is, on the page of their GitHub Actions run: annotations, which
// GitHub shows at the top of the run, and a step summary below them. Neither needs a log opened to be read.

/** Text for an annotation's message: GitHub reads %, CR and LF in it as escapes, so they are written as escapes. */
export const escapeAnnotation = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/** A workflow command that puts `message` on the run's page as an error or a warning, headed `title`. */
export const annotation = (kind, title, message) => `::${kind} title=${title}::${escapeAnnotation(message)}`;

const plain = (text) => text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const number = (n) => n.toLocaleString('en-GB');
const megabytes = (bytes) => `${number(Math.max(1, Math.round(bytes / 1024 / 1024)))} MB`;
const english = new Intl.DisplayNames(['en'], { type: 'language' });
const languageName = (tag) => (tag === 'none' ? 'no particular language' : (english.of(tag) ?? tag));

/** How many notes there are, and the languages they are written in, the site's own first: "5, in English and Welsh". */
function notesRow({ notes: { items }, languages: all }) {
  const languages = all.filter((tag) => items.some(({ title }) => tag in title)).map(languageName);
  const list = languages.length > 1 ? `${languages.slice(0, -1).join(', ')} and ${languages.at(-1)}` : languages[0];
  return `${number(items.length)}, in ${list}`;
}

/** The step summary of a build that worked: where the site will be, what was published, and anything worth a look. */
export function builtSummary({ pageUrl, manifestId, bytes, droppedFull, image, card, site }, warnings) {
  const title = site.title[site.language] ?? Object.values(site.title)[0];
  const rows = [
    ['Picture', `${plain(image.name)}, ${number(site.width)} × ${number(site.height)} pixels`],
    ['Published', `${megabytes(bytes)} of tiles${site.fullUrl ? ' and a full-size JPEG' : droppedFull ? ', without the full-size JPEG, to fit GitHub Pages' : ''}`],
    ['Notes', site.notes ? `${notesRow(site)}. [Change them with the notes helper](${pageUrl}notes.html)` : `None. [Add some with the notes helper](${pageUrl}notes.html)`],
    ['IIIF manifest', manifestId],
    ['Settings', `[Change them with the settings helper](${pageUrl}settings.html)`],
  ];
  return [
    '## Your picture is on its way',
    `When this run finishes it will be at **${pageUrl}**`,
    `![${plain(title).replace(/[[\]]/g, '')}](${card.url})`,
    ['| | |', '|---|---|', ...rows.map(([name, value]) => `| ${name} | ${value} |`)].join('\n'),
    warnings.length && ['### Worth a look', ...warnings.map((warning) => `- ${plain(warning)}`)].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The step summary of a build that stopped. */
export const failedSummary = (message) =>
  ['## Your site was not built', plain(message), 'Put that right and commit it: the site builds itself again.'].join('\n\n');
