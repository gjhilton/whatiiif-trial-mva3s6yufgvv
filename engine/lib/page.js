// What a built page says about its image before any script runs: the title, icon, colours and social-card tags in
// its head, a plain fallback for browsers without JavaScript, and the site's details for the page's script. The
// page Vite builds is the same for every image; engine/build.js fills these in between marker comments afterwards.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const ENGINE = new URL('../', import.meta.url); // engine/, which holds VERSION and UPSTREAM

/** Text that can go in an HTML comment: `--` would end it, so an address's second hyphen is written %2D. */
const commentable = (text) => text.replace(/--/g, '-%2D');

/** The version of WhatIIIF making the site, and WhatIIIF's address. */
export async function whatiiif() {
  const [version, upstream] = await Promise.all(['VERSION', 'UPSTREAM'].map(async (name) => (await readFile(new URL(name, ENGINE), 'utf8')).trim()));
  return { version, url: `https://github.com/${upstream}` };
}

/**
 * The comment at the top of every published page: that WhatIIIF made it, which version, where WhatIIIF is, and, in a
 * workflow run, the repository the site is made from.
 */
export async function banner(repository) {
  const { version, url } = await whatiiif();
  const rule = `  ${'='.repeat(76)}`;
  const lines = [
    `Published with WhatIIIF ${version}`,
    url,
    '',
    'One large picture on the web, zoomable, and published as IIIF.',
    ...(repository ? ['', 'This site is made from', `https://github.com/${repository}`] : []),
  ];
  return ['<!--', rule, '', ...lines.map((line) => (line ? `    ${commentable(line)}` : '')), '', rule, '-->'].join('\n');
}

const BANNER = /<!--\n {2}=+\n[\s\S]*?Published with WhatIIIF[\s\S]*?-->\n/;

/** Writes `comment` at the top of the page in `file`, after its doctype, in place of one written before. */
export async function stamp(file, comment) {
  const html = (await readFile(file, 'utf8')).replace(BANNER, '');
  const doctype = /^\s*<!doctype html>\s*/i.exec(html)?.[0] ?? '';
  await writeFile(file, `${doctype ? `${doctype.trim()}\n` : ''}${comment}\n${html.slice(doctype.length)}`);
}

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A text in the site's own language (else any it has), with the `lang` attribute that goes with it. */
function inSiteLanguage(text, site) {
  const language = site.language in text ? site.language : Object.keys(text)[0];
  return { text: escape(text[language]), lang: language === 'none' ? '' : ` lang="${escape(language)}"` };
}

/**
 * A published file showing the whole picture: the largest listed size no longer than `maxSide` on either side,
 * else the smallest. Only an image that fits one tile lists no sizes, and that is always published as full/max.
 * (The smallest level is always listed, however long; see imageInfo in service.js.)
 * `path` is where it is in the image service.
 */
export function wholeImage({ info, imageId, maxSide = 1200 }) {
  const size = info.sizes.findLast((s) => Math.max(s.width, s.height) <= maxSide) ?? info.sizes[0];
  const [path, width, height] = size ? [`full/${size.width},${size.height}/0/default.jpg`, size.width, size.height] : ['full/max/0/default.jpg', info.width, info.height];
  return { path, url: `${imageId}/${path}`, width, height };
}

/** The site's icon, for browser tabs and home screens: the most eye-catching square of the picture in `from`. */
export async function makeIcon(from, to) {
  await sharp(from).resize(180, 180, { fit: 'cover', position: sharp.strategy.attention }).png().toFile(to);
}

/**
 * The picture a shared link shows: the most eye-catching part of the picture in `from`, in the 1.91 to 1 shape
 * social sites and chat apps show, rather than their own cut from its middle. Returns its size.
 */
export async function makeCard(from, to) {
  await sharp(from).resize(1200, 630, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 85 }).toFile(to);
  return { width: 1200, height: 630 };
}

const scriptJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

/**
 * What search engines are told the picture is (schema.org), including who to credit and its licence, which image
 * search can show beside it. A date goes in only when it is a calendar date.
 */
function structuredData(site, image, card) {
  const words = (text) => text && text[site.language in text ? site.language : Object.keys(text)[0]];
  const date = words(site.date);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name: words(site.title),
    description: words(site.summary),
    url: site.pageUrl,
    contentUrl: site.fullUrl ?? image.url,
    thumbnailUrl: card.url,
    creator: site.creator && { '@type': 'Person', name: words(site.creator) },
    dateCreated: /^\d{4}(-\d\d(-\d\d)?)?$/.test(date ?? '') ? date : undefined,
    creditText: words(site.attribution),
    license: site.rights,
  };
  return `<script type="application/ld+json">${scriptJson(data)}</script>`;
}

/**
 * The <title>, icon and colours, the tags that make a shared link show the `card`, the title and summary, and what
 * search engines are told. Colours chosen in whatiiif.toml come after the page's defaults and outrank them
 * (`html:root` beats `:root`). `image` is a whole-image file, as `wholeImage` gives.
 */
export function pageHead({ site, image, card }) {
  const title = inSiteLanguage(site.title, site).text;
  const summary = site.summary && inSiteLanguage(site.summary, site).text;
  const meta = (attribute, name, content) => `<meta ${attribute}="${name}" content="${content}">`;
  const colours = Object.entries(site.colours ?? {}).map(([name, colour]) => `--${name}: ${escape(colour)};`);
  return [
    `<title>${title}</title>`,
    meta('name', 'description', summary ?? title),
    `<link rel="canonical" href="${escape(site.pageUrl)}">`,
    '<link rel="icon" href="icon.png">',
    '<link rel="apple-touch-icon" href="icon.png">',
    colours.length && `<style>html:root { ${colours.join(' ')} }</style>`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:url', escape(site.pageUrl)),
    meta('property', 'og:title', title),
    summary && meta('property', 'og:description', summary),
    meta('property', 'og:image', escape(card.url)),
    meta('property', 'og:image:width', card.width),
    meta('property', 'og:image:height', card.height),
    meta('property', 'og:image:alt', inSiteLanguage(site.alt, site).text),
    meta('name', 'twitter:card', 'summary_large_image'),
    structuredData(site, image, card),
  ]
    .filter(Boolean)
    .join('\n    ');
}

/**
 * What a browser without JavaScript shows instead of the viewer (the picture, described, and where to get more),
 * then the site's details for the page's script, so it can show them without asking for site.json. In JSON, `<`
 * is written \u003c, so no text in them can close the script element they are in.
 */
export function pageBody({ site, image }) {
  const title = inSiteLanguage(site.title, site);
  const summary = site.summary && inSiteLanguage(site.summary, site);
  const alt = inSiteLanguage(site.alt, site);
  const links = [
    `<a href="${escape(site.manifestUrl)}">IIIF manifest</a>`,
    site.fullUrl && `<a href="${escape(site.fullUrl)}">Full-size JPEG</a>`,
    site.originalUrl && `<a href="${escape(site.originalUrl)}" rel="nofollow">Original file</a>`,
  ].filter(Boolean);
  return [
    '<noscript><div class="fallback">',
    `<h1${title.lang}>${title.text}</h1>`,
    summary && `<p${summary.lang}>${summary.text}</p>`,
    `<img src="${escape(image.url)}" width="${image.width}" height="${image.height}" alt="${alt.text}"${alt.lang}>`,
    `<p>${links.join(' · ')}</p>`,
    '</div></noscript>',
    `<script type="application/json" id="whatiiif-site">${scriptJson(site)}</script>`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Writes the head and body parts into a built page, between its `<!-- whatiiif:… -->` markers, so doing it again
 * replaces them. Returns false when there is no built page to personalise.
 */
export async function personalisePage(file, parts) {
  let html;
  try {
    html = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  for (const [name, content] of [['head', pageHead(parts)], ['body', pageBody(parts)]]) {
    const marked = new RegExp(`(<!-- whatiiif:${name} -->)[\\s\\S]*?(<!-- /whatiiif:${name} -->)`);
    if (!marked.test(html)) throw new Error(`${file} has no <!-- whatiiif:${name} --> markers; build the page again`);
    html = html.replace(marked, (_, open, close) => `${open}${content}${close}`);
  }
  await writeFile(file, html);
  return true;
}
