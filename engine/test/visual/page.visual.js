// What the page looks like in each state a visitor can meet, compared with reviewed screenshots. The sites are
// built from a template copy as the Deploy workflow builds them, with a picture drawn the same way every time.
import { test, expect } from '@playwright/test';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { browse, commit, deploy, templateCopy } from '../support/harness.js';
import { tempDir } from '../support/tmp.js';

/** Rings of flat colour: plainly a picture, identical on every run, and small as a screenshot. */
async function makePicture() {
  const [width, height] = [2400, 1600];
  const palette = [[29, 53, 87], [233, 196, 106], [42, 157, 143], [244, 162, 97], [230, 57, 70]];
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ring = Math.floor(Math.hypot(x - width / 2, y - height / 2) / 120) % palette.length;
      pixels.set(palette[ring], (y * width + x) * 3);
    }
  }
  const file = join(await tempDir('visual'), 'harbour.png');
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return file;
}

async function buildSite(picture, files) {
  const repo = await templateCopy();
  await copyFile(picture, join(repo, 'content/harbour.png'));
  for (const [name, text] of Object.entries(files)) await writeFile(join(repo, 'content', name), text);
  await commit(repo, 'A picture');
  const site = await deploy(repo, { baseUrl: 'https://example.github.io/harbour' });
  if (!site.built) throw new Error(site.log);
  return { siteUrl: site.baseUrl, fileFor: (path) => join(site.dist, path) };
}

let one; // one language, every setting
let two; // Welsh and English
let three; // with notes on the picture

test.beforeAll(async () => {
  const picture = await makePicture();
  one = await buildSite(picture, {
    'whatiiif.toml': `title = "Harbour at dusk"
summary = "The fishing fleet coming in."
attribution = "Example Museum"
alt = "Fishing boats coming into the harbour at dusk"
rights = "https://creativecommons.org/licenses/by/4.0/"
creator = "A. Painter"
date = "1890"
dimensions = "120 x 80 cm"

[tiles]
quality = 100 # fewer JPEG speckles, so much smaller screenshots
`,
    'description.md': '## About this view\n\nTaken from the *north* pier.\n',
  });
  three = await buildSite(picture, {
    'whatiiif.toml': 'title = "Harbour at dusk"\n\n[tiles]\nquality = 100\n',
    'notes.md': `Three things to look for.

## [The centre](#xywh=1000,600,400,400)

Where the rings begin.

## [A red ring](#xywh=1700,500,300,600)

## [The corner](#xywh=0,0,500,400)
`,
  });
  two = await buildSite(picture, {
    'whatiiif.toml': `language = "cy"
title = { cy = "Harbwr", en = "Harbour" }
summary = { cy = "Y llynges bysgota yn dod adref.", en = "The fishing fleet coming home." }

[tiles]
quality = 100
`,
  });
});

/** Opens a site and waits until the page, its viewer and its pictures have finished arriving. */
async function open(browser, site, { query = '', viewport, javaScriptEnabled, colorScheme, before } = {}) {
  const opened = await browse(browser, { ...site, query, javaScriptEnabled, colorScheme });
  if (viewport) await opened.page.setViewportSize(viewport);
  if (before) {
    await before(opened.page);
    await opened.page.reload();
  }
  await opened.page.waitForLoadState('networkidle');
  await opened.page.waitForTimeout(1000); // the viewer draws its tiles a moment after they arrive
  return opened;
}

test('the page, in OpenSeadragon', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { query: '?viewer=openseadragon' });
  await expect(page).toHaveScreenshot('openseadragon.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the page, in Mirador', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { query: '?viewer=mirador' });
  await page.locator('.mirador-window').waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Mirador fades its picture in
  await expect(page).toHaveScreenshot('mirador.png', { fullPage: true, maxDiffPixelRatio: 0.01 });
  expect(problems).toEqual([]);
  await close();
});

test('the page in dark mode, in OpenSeadragon', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { query: '?viewer=openseadragon', colorScheme: 'dark' });
  await expect(page).toHaveScreenshot('dark.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the page in dark mode, in Mirador', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { query: '?viewer=mirador', colorScheme: 'dark' });
  await page.locator('.mirador-window').waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Mirador fades its picture in
  await expect(page).toHaveScreenshot('dark-mirador.png', { fullPage: true, maxDiffPixelRatio: 0.01 });
  expect(problems).toEqual([]);
  await close();
});

test('the page on a phone', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { viewport: { width: 390, height: 844 } });
  await expect(page).toHaveScreenshot('phone.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('a page in two languages, with its switch', async ({ browser }) => {
  const { page, problems, close } = await open(browser, two);
  await expect(page).toHaveScreenshot('two-languages.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the picture embedded in another page', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { query: '?embed', viewport: { width: 800, height: 600 } });
  await expect(page).toHaveScreenshot('embed.png');
  expect(problems).toEqual([]);
  await close();
});

test('the page without JavaScript', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { javaScriptEnabled: false });
  await expect(page).toHaveScreenshot('no-javascript.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the viewer could not load: said in red', async ({ browser }) => {
  const { page, close } = await open(browser, one, {
    before: (p) => p.route('**/assets/openseadragon-*.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("its code did not arrive");' })),
  });
  await expect(page.locator('.viewer-error')).toHaveText('Could not load OpenSeadragon: its code did not arrive');
  await expect(page).toHaveScreenshot('viewer-error.png', { fullPage: true });
  await close();
});

test('the viewer could not load, in dark mode: said in a red that reads on black', async ({ browser }) => {
  const { page, close } = await open(browser, one, {
    colorScheme: 'dark',
    before: (p) => p.route('**/assets/openseadragon-*.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("its code did not arrive");' })),
  });
  await expect(page.locator('.viewer-error')).toHaveCSS('color', 'rgb(255, 85, 85)');
  await expect(page).toHaveScreenshot('dark-viewer-error.png', { fullPage: true });
  await close();
});

test('a page with notes, on its tour', async ({ browser }) => {
  const { page, problems, close } = await open(browser, three, { query: '?viewer=openseadragon' });
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await page.getByRole('region', { name: 'Tour' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000); // the viewer moves to the note, and its outline fades
  await expect(page).toHaveScreenshot('notes-tour.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the notes helper', async ({ browser }) => {
  const { page, problems, close } = await open(browser, three, { query: 'notes.html' });
  await expect(page.locator('.note-area')).toHaveCount(3);
  await page.getByRole('button', { name: /^Note 2: / }).click();
  await page.getByRole('button', { name: 'Show note 2' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500); // the picture moves to the note
  await page.evaluate(() => document.activeElement.blur()); // no focus ring
  await expect(page).toHaveScreenshot('notes-helper.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the page printed', async ({ browser }) => {
  // The citation gives the day the page was viewed: always the same one here.
  const { page, close } = await open(browser, one, { query: '?viewer=openseadragon', before: (p) => p.clock.setFixedTime(new Date(2026, 9, 15, 12)) });
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page).toHaveScreenshot('printed.png', { fullPage: true });
  await close();
});

test('the settings helper', async ({ browser }) => {
  const { page, problems, close } = await open(browser, one, { query: 'settings.html' });
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Harbour at dusk');
  await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
  expect(problems).toEqual([]);
  await close();
});

test('the page could not load its details: said in red', async ({ browser }) => {
  // The details are written into the page, and in site.json for a page without them: take away both.
  const without = (await readFile(one.fileFor('index.html'), 'utf8')).replace(/<script type="application\/json" id="whatiiif-site">.*?<\/script>/s, '');
  const { page, close } = await open(browser, one, {
    before: async (p) => {
      await p.route((url) => url.pathname === '/harbour/', (route) => route.fulfill({ contentType: 'text/html', body: without }));
      await p.route('**/site.json', (route) => route.fulfill({ status: 404 }));
    },
  });
  await expect(page.locator('.load-error')).toBeVisible();
  await expect(page).toHaveScreenshot('load-error.png', { fullPage: true });
  await close();
});
