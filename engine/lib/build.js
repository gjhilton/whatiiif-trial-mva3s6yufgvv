import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContent } from './content.js';
import { pictureSize, slice } from './slice.js';
import { PAGES_BUDGET_BYTES, applyBudget } from './budget.js';
import { missingFiles } from './service.js';
import { buildManifest } from './manifest.js';
import { committedToLfs, originalUrl, repositoryIsPublic } from './original.js';
import { banner, makeCard, makeIcon, personalisePage, stamp, wholeImage } from './page.js';

const LOCAL_BASE_URL = 'http://localhost:4173';
const LOWEST_QUALITY = 45; // below this, JPEG tiles look blocky up close

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** The JPEG qualities to try, best first: the one asked for, then lower ones until the site fits GitHub Pages. */
const qualities = (asked) => [asked, ...[75, 65, 55, LOWEST_QUALITY].filter((quality) => quality < asked)];

/** Where visitors can download the picture the site was made from, if they can and its owner wants them to. */
async function original(image, config, env) {
  if (!config.publish.original) return undefined;
  if (image.url) return image.url; // linked in whatiiif.toml, so it is already on the web
  if (!(await repositoryIsPublic(env))) return undefined;
  const lfs = await committedToLfs(image.path);
  return originalUrl({ repo: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF_NAME, path: `content/${image.name}`, lfs });
}

/**
 * Turns the committed content into everything in `outDir` that depends on it: the IIIF image service and
 * manifest under iiif/, site.json, which the preview page loads when it opens, an icon, and, if the page has been
 * built already, its title, colours, social-card tags, the fallback shown without JavaScript, and site.json again.
 * `warn` is told about anything the owner may want to put right that does not stop the build.
 */
export async function build({ contentDir, outDir, env = process.env, log = () => {}, warn = log, fetch = globalThis.fetch, budgetBytes = PAGES_BUDGET_BYTES }) {
  const downloads = await mkdtemp(join(tmpdir(), 'whatiiif-picture-'));
  try {
    const { image, config, settings, description, notes, notesSource, languages, unused } = await readContent(contentDir, { fetch, downloads });
    for (const file of unused) warn(file);

    const baseUrl = (config.base_url || env.SITE_BASE_URL || LOCAL_BASE_URL).replace(/\/+$/, '');
    const pageUrl = `${baseUrl}/`;
    const imageId = `${baseUrl}/iiif/image`;
    const manifestId = `${baseUrl}/iiif/manifest.json`;
    const imageDir = join(outDir, 'iiif/image');

    // What can be checked against the picture's size is checked before it is sliced, which can take minutes.
    const size = await pictureSize(image.path);
    const pixels = `${size.width.toLocaleString('en-GB')} × ${size.height.toLocaleString('en-GB')} pixels`;
    for (const { region: { x, y, w, h }, title } of notes?.items ?? []) {
      if (w < 1 || h < 1 || x + w > size.width || y + h > size.height) {
        throw new Error(
          `content/notes.md: the note "${title[config.language]}" is about ${x},${y},${w},${h}, which runs off the picture, ${pixels}. Copy its link from "Link to this view" again.`,
        );
      }
    }
    const { dimensions } = config;
    if (dimensions && Math.abs(dimensions.width / dimensions.height / (size.width / size.height) - 1) > 0.05) {
      warn(`The dimensions, ${dimensions.text}, are not the shape of the picture, ${pixels}: is one of them wrong, or the picture cropped? Measurements follow the width.`);
    }

    // Sliced at the quality asked for, then, if the tiles are too big for GitHub Pages even without the full-size
    // JPEG, again at lower qualities until they fit.
    const { size: tileSize, quality: asked } = config.tiles;
    let info;
    let fitted;
    let quality;
    for (quality of qualities(asked)) {
      log(`Slicing ${image.name} at quality ${quality}…`);
      await rm(imageDir, { recursive: true, force: true }); // a rebuild must not inherit tiles from the previous image
      info = await slice({ source: image.path, outDir: imageDir, id: imageId, tileSize, quality, publishFull: config.publish.full });
      fitted = await applyBudget({ dir: imageDir, info, budgetBytes });
      if (fitted.fits) break;
    }
    const { bytes, droppedFull } = fitted;
    if (!fitted.fits) {
      const scale = Math.floor(Math.sqrt(budgetBytes / bytes) * 100);
      throw new Error(
        `The picture is too big for GitHub Pages: its tiles take ${megabytes(bytes)} even at quality ${quality}, and ${megabytes(budgetBytes)} fit. Make it smaller: about ${scale}% of its width and height would fit.`,
      );
    }
    if (droppedFull) warn('The site would have been too big for GitHub Pages, so the full-size JPEG was left out.');
    if (quality < asked) warn(`The tiles were too big for GitHub Pages at quality ${asked}, so they were made at quality ${quality}.`);

    const missing = await missingFiles(imageDir);
    if (missing.length) {
      throw new Error(`The generated IIIF service is incomplete, so nothing was deployed. Missing:\n - ${missing.join('\n - ')}`);
    }

    const originalLink = await original(image, config, env);
    const hasFull = config.publish.full && !droppedFull;
    const manifest = buildManifest({ manifestId, imageId, pageUrl, info, config, hasFull, notes, original: originalLink && { url: originalLink, format: image.format } });
    await writeFile(join(outDir, 'iiif/manifest.json'), JSON.stringify(manifest, null, 2));

    const site = {
      language: config.language,
      languages,
      title: config.title,
      summary: config.summary,
      creator: config.creator,
      date: config.date,
      attribution: config.attribution,
      alt: config.alt,
      rights: config.rights,
      dimensions: config.dimensions,
      metadata: config.metadata,
      description,
      notes,
      viewer: config.viewer,
      colours: config.colours,
      manifestUrl: manifestId,
      canvasId: manifest.items[0].id,
      infoUrl: `${imageId}/info.json`,
      fullUrl: hasFull ? `${imageId}/full/max/0/default.jpg` : undefined,
      fullBytes: hasFull ? (await stat(join(imageDir, 'full/max/0/default.jpg'))).size : undefined,
      originalUrl: originalLink,
      originalBytes: originalLink && image.bytes,
      originalFormat: originalLink && image.format,
      width: info.width,
      height: info.height,
      pageUrl,
    };
    await writeFile(join(outDir, 'site.json'), JSON.stringify(site, null, 2));
    // For the settings helper (settings.html) and the notes helper (notes.html): the settings and notes as written,
    // and the pages on GitHub that change them, or make notes.md where there is none yet.
    const github = env.GITHUB_REPOSITORY && `https://github.com/${env.GITHUB_REPOSITORY}`;
    const branch = env.GITHUB_REF_NAME ?? 'main';
    const editUrl = github && `${github}/edit/${branch}/content/whatiiif.toml`;
    const fileUrl = (file) => github && `${github}/edit/${branch}/content/${file}`;
    const notesUrl = github && (notesSource ? fileUrl(notesSource.file) : `${github}/new/${branch}?filename=content/notes.md`);
    const notesFiles = notesSource && { ...notesSource, translations: notesSource.translations.map((other) => ({ ...other, url: fileUrl(other.file) })) };
    // Several files changed at once are uploaded together, in one commit; Actions says why a build stopped.
    const uploadUrl = github && `${github}/upload/${branch}/content`;
    const actionsUrl = github && `${github}/actions`;
    await writeFile(join(outDir, 'settings.json'), JSON.stringify({ settings, editUrl, notes: notesFiles, notesUrl, uploadUrl, actionsUrl }, null, 2));
    // The icon and the picture a shared link shows, cut from whole-picture files already published.
    const whole = wholeImage({ info, imageId });
    await makeIcon(join(imageDir, whole.path), join(outDir, 'icon.png'));
    const card = { url: `${pageUrl}card.jpg`, ...(await makeCard(join(imageDir, wholeImage({ info, imageId, maxSide: 2000 }).path), join(outDir, 'card.jpg'))) };
    await personalisePage(join(outDir, 'index.html'), { site, image: whole, card });
    // Every page says what made it, so whoever reads its source can find WhatIIIF, and which version it was.
    const comment = await banner(env.GITHUB_REPOSITORY);
    for (const page of (await readdir(outDir)).filter((name) => name.endsWith('.html'))) await stamp(join(outDir, page), comment);

    log(`Done: ${Math.round(bytes / 1024 / 1024)} MB of IIIF files at ${baseUrl}/iiif/`);
    return { baseUrl, pageUrl, manifestId, bytes, droppedFull, image, card, site };
  } finally {
    await rm(downloads, { recursive: true, force: true });
  }
}
