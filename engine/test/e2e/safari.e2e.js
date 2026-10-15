// The journeys most likely to differ in Safari, in WebKit, the engine Safari is built on: on a Mac, and on an
// iPhone, where touch, full screen and the space a page has all work differently. The rest of the end-to-end tests
// run in Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { devices, webkit } from 'playwright';
import { makeImage } from '../support/fixtures.js';
import { browse, commit, deploy, templateCopy, until, zoomToFullResolution } from '../support/harness.js';

let browser;
let site;

before(async () => {
  browser = await webkit.launch();
  const repo = await templateCopy();
  await copyFile(await makeImage(4000, 3000), join(repo, 'content/harbour.tif'));
  await writeFile(join(repo, 'content/whatiiif.toml'), 'title = "Harbour at dusk"\ndimensions = "120 x 90 cm"\n');
  await writeFile(join(repo, 'content/description.md'), 'Taken from the north pier, by [the lighthouse](#xywh=2000,1500,500,400).\n');
  await commit(repo, 'A picture');
  site = await deploy(repo);
  assert.equal(site.built, true, site.log);
});
after(() => browser?.close());

const open = (query, options) => browse(browser, { siteUrl: site.baseUrl, query, fileFor: (path) => join(site.dist, path), ...options });
const region = (page) => (new URL(page.url()).hash.match(/^#xywh=(\d+),(\d+),(\d+),(\d+)$/) ?? []).slice(1).map(Number);

for (const [viewer, ready] of [['openseadragon', '.openseadragon-container'], ['mirador', '.mirador-window .openseadragon-container']]) {
  test(`in Safari, ${viewer} zooms to full resolution without asking for anything that is not there`, async () => {
    const opened = await open(`?viewer=${viewer}`);
    await opened.page.locator(ready).first().waitFor();
    assert.equal(await opened.page.title(), 'Harbour at dusk');
    await zoomToFullResolution(opened);
    assert.deepEqual(opened.problems, []);
    await opened.close();
  });
}

test('in Safari, a detail link moves the viewer there, and the scale bar measures what is shown', async () => {
  const { page, problems, close } = await open('?viewer=openseadragon');
  await page.locator('.openseadragon-container').first().waitFor();
  await page.waitForLoadState('networkidle');
  await until(async () => /^\d+ cm$/.test((await page.locator('.scale-bar').textContent()) ?? ''), 'the scale bar');
  await page.getByRole('link', { name: 'the lighthouse' }).click();
  await until(() => {
    const [x, y, w, h] = region(page);
    return x <= 2002 && y <= 1502 && x + w >= 2498 && y + h >= 1898 && h < 1000;
  }, 'the viewer to show the lighthouse');
  assert.deepEqual(problems, []);
  await close();
});

test('in Safari, dark mode swaps black and white, and printing shows a still of the view, black on white', async () => {
  const { page, close } = await open('?viewer=openseadragon', { colorScheme: 'dark' });
  await page.locator('.openseadragon-container').first().waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.print-view').evaluate((img) => img.naturalWidth > 0 && img.src.startsWith('data:image/png')), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
  await close();
});

test('in Safari, the embedded picture leaves a plain scroll to the page it is on', async () => {
  const { page: home, close: closeHome } = await open('');
  const snippet = await home.getByLabel('Embed on a web page').inputValue();
  await closeHome();
  const blog = await open('', { elsewhere: `<!doctype html><h1>My post</h1>${snippet}<p style="height:2000px">More.</p>` });
  const frame = blog.page.frameLocator('iframe');
  await frame.locator('.openseadragon-container').first().waitFor();
  const box = await blog.page.locator('iframe').boundingBox();
  await blog.page.mouse.move(box.x + box.width / 2, 400);
  await blog.page.mouse.wheel(0, 300);
  await until(() => blog.page.evaluate(() => scrollY > 0), 'the post to scroll');
  assert.deepEqual(blog.problems, []);
  await blog.close();
});

test('on an iPhone, the page fits the screen, and a tap on a button zooms in', async () => {
  const { page, problems, close } = await open('?viewer=openseadragon', { device: devices['iPhone 15'] });
  await page.locator('.openseadragon-container').first().waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');
  await page.getByRole('button', { name: 'Zoom in' }).tap();
  await until(() => region(page).length === 4, 'the closer view to reach the address');
  assert.deepEqual(problems, []);
  await close();
});

test('on an iPhone, the settings helper works', async () => {
  const { page, problems, close } = await open('settings.html', { device: devices['iPhone 15'] });
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.waitFor();
  await title.fill('Harbour at night');
  assert.match(await page.getByRole('textbox', { name: 'whatiiif.toml' }).inputValue(), /^title = "Harbour at night"$/m);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');
  assert.deepEqual(problems, []);
  await close();
});
