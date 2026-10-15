// Checks a site that is already built or already live, as a visitor's browser would find it:
//
//   E2E_SITE_URL=https://you.github.io/your-image node --test engine/test/e2e/check-site.js
//
// E2E_SITE_URL is the address the site was built for. Add E2E_DIST=dist to have every request answered
// from that folder instead of the network, for a site that is built but not yet deployed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expectedRequests } from '../../lib/service.js';
import { schemaProblems, schemaUnavailable } from '../support/schema.js';
import { browse, until, zoomToFullResolution } from '../support/harness.js';
import { published as onSite } from '../support/published.js';

const siteUrl = process.env.E2E_SITE_URL?.replace(/\/+$/, '');
const dist = process.env.E2E_DIST;
if (!siteUrl) throw new Error('Set E2E_SITE_URL to the address of the site to check.');

const fileFor = dist && ((path) => join(dist, path));
const json = async (path) => JSON.parse(dist ? await readFile(join(dist, path), 'utf8') : await (await fetch(`${siteUrl}/${path}`)).text());

/** Whether a file is published: in the folder, or on the live site, asked again as support/published.js says. */
const published = (path) => (dist ? readFile(join(dist, path)).then(() => true, () => false) : onSite(`${siteUrl}/${path}`));

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser?.close());

test('the page opens and is titled after the image', async () => {
  const titles = Object.values((await json('site.json')).title); // in whichever of its languages the browser gets
  const { page, problems, close } = await browse(browser, { siteUrl, fileFor });
  await page.locator('h1').waitFor();
  assert.ok(titles.includes(await page.locator('h1').textContent()), `the heading is one of ${titles}`);
  assert.equal(await page.title(), await page.locator('h1').textContent());
  assert.deepEqual(problems, []);
  await close();
});

for (const [viewer, label] of [['openseadragon', 'OpenSeadragon'], ['mirador', 'Mirador']]) {
  test(`${label} zooms to full resolution without asking for anything that is not there`, async () => {
    const site = await browse(browser, { siteUrl, fileFor, query: `?viewer=${viewer}` });
    await zoomToFullResolution(site);
    assert.deepEqual(site.problems, []);
    await site.close();
  });
}

test('notes, where a site has them, are numbered on the picture and listed, and the tour takes the viewer to each', async (t) => {
  const { notes, width, height } = await json('site.json');
  if (!notes) return t.skip('this site has no notes');
  const { page, problems, close } = await browse(browser, { siteUrl, fileFor, query: '?viewer=openseadragon' });
  const count = notes.items.length;
  await until(async () => (await page.locator('.note-marker').count()) === count, `${count} markers on the picture`);
  assert.equal(await page.locator('.notes li').count(), count, 'as many notes listed');
  // The part of the picture in view, as the address gives it: none given is the whole picture.
  const shows = ({ x, y, w, h }) => async () => {
    const [vx, vy, vw, vh] = new URL(page.url()).hash.match(/^#xywh=(\d+),(\d+),(\d+),(\d+)$/)?.slice(1).map(Number) ?? [0, 0, width, height];
    return vx <= x + 2 && vy <= y + 2 && vx + vw >= x + w - 2 && vy + vh >= y + h - 2;
  };
  await page.getByRole('button', { name: 'Take the tour' }).click();
  const tour = page.getByRole('region', { name: 'Tour' });
  for (const [i, { region }] of notes.items.entries()) {
    assert.equal(await tour.locator('.tour-step').textContent(), `Note ${i + 1} of ${count}`);
    await until(shows(region), `the viewer to show note ${i + 1}`);
    await tour.getByRole('button', { name: i === count - 1 ? 'End the tour' : 'Next' }).first().click();
  }
  assert.equal(await tour.count(), 0, 'the tour has ended');
  assert.deepEqual(problems, []);
  await close();
});

test('a shared link shows a picture that is published', async () => {
  const html = dist ? await readFile(join(dist, 'index.html'), 'utf8') : await (await fetch(`${siteUrl}/`)).text();
  const picture = html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
  assert.ok(picture?.startsWith(`${siteUrl}/`), `og:image is ${picture}`);
  assert.equal(await published(picture.slice(siteUrl.length + 1)), true);
  assert.equal(await published('icon.png'), true, 'the icon browsers show for the page');
});

test('the notes helper opens with the site\'s notes, or none, ready to change', async () => {
  const { notes } = await json('site.json');
  const { page, problems, close } = await browse(browser, { siteUrl, fileFor, query: 'notes.html' });
  await page.getByRole('textbox', { name: 'notes.md', includeHidden: true }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('.notes-list > li').count(), notes?.items.length ?? 0);
  if (notes) assert.equal(await page.locator('.note-problems, .notes-publish .problem').count(), 0, 'the notes as they are have nothing wrong with them');
  assert.deepEqual(problems, []);
  await close();
});

test('the page previews the notes being written in the notes helper', async () => {
  const { page, problems, close } = await browse(browser, { siteUrl, fileFor, query: '?notes-draft' });
  await page.locator('.preview-banner').waitFor();
  await page.locator('.viewer').waitFor();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(problems, []);
  await close();
});

test('the settings helper opens with the site\'s settings, ready to copy', async () => {
  const { page, problems, close } = await browse(browser, { siteUrl, fileFor, query: 'settings.html' });
  const file = page.getByRole('textbox', { name: 'whatiiif.toml' });
  await file.waitFor();
  assert.match(await file.inputValue(), /^# Made with the settings helper/);
  assert.equal(await page.getByRole('alert').count(), 0, 'the settings as they are have nothing wrong with them');
  assert.deepEqual(problems, []);
  await close();
});

test('without JavaScript the page shows the picture, with alt text', async () => {
  const { page, problems, close } = await browse(browser, { siteUrl, fileFor, javaScriptEnabled: false });
  const picture = page.locator('.fallback img');
  await picture.waitFor();
  await page.waitForLoadState('networkidle');
  assert.ok((await picture.getAttribute('alt'))?.trim(), 'the picture is described');
  assert.equal(await picture.evaluate((img) => img.complete && img.naturalWidth > 0), true, 'the picture loads');
  assert.deepEqual(problems, []);
  await close();
});

test('the embedded view shows the picture and its credit, and nothing else', async () => {
  const { page, fetched, problems, close } = await browse(browser, { siteUrl, fileFor, query: '?embed' });
  await page.locator('.credit').waitFor();
  assert.equal(await page.locator('.masthead').count(), 0);
  await zoomToFullResolution({ page, fetched }, { holding: 'Control' });
  assert.deepEqual(problems, []);
  await close();
});

test('the image service is where it says it is, with every file a viewer could ask for', async () => {
  const info = await json('iiif/image/info.json');
  assert.equal(info.id, `${siteUrl}/iiif/image`);
  const missing = [];
  for (const path of expectedRequests(info)) {
    if (!(await published(`iiif/image/${path}`))) missing.push(path);
  }
  assert.deepEqual(missing, []);
});

test('the manifest is where it says it is and paints that image service', async () => {
  const manifest = await json('iiif/manifest.json');
  assert.equal(manifest.id, `${siteUrl}/iiif/manifest.json`);
  assert.equal(manifest.items[0].items[0].items[0].body.service[0].id, `${siteUrl}/iiif/image`);
});

test('the manifest is valid IIIF Presentation 3.0', { skip: schemaUnavailable }, async () => {
  assert.deepEqual(schemaProblems(await json('iiif/manifest.json')), []);
});
