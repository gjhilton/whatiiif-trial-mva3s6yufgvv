#!/usr/bin/env node
// The screenshots in the README: the demo's picture, published by this working tree's template, in light and dark,
// the settings helper part-way through being filled in, and the notes demo on its tour and in its notes helper. The Live workflow runs this
// on a Mac after every change, once both demos are published, and commits any that changed; by hand:
//
//   node engine/test/support/readme-screenshots.js
//
// It downloads the demos' content, builds the sites as the Deploy workflow would, and writes PNGs to engine/artwork,
// replacing one only where it looks different: a screenshot taken again is seldom the same to the byte.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browse, commit, deploy, repo, templateCopy } from './harness.js';
import { looksDifferent } from './looks-different.js';

const DEMO = 'gjhilton/whatiiif-demo';
const out = (name) => join(repo, 'engine/artwork', name);
// Asked of GitHub's API with the workflow's token where there is one, which it limits less than strangers.
const headers = process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {};

/**
 * A site built by this working tree from everything in `demo`'s content/, at its address on GitHub Pages: the demo
 * exactly, its settings too, so the screenshots show what the demo does.
 */
async function demoSite(demo) {
  const copy = await templateCopy();
  const listing = await fetch(`https://api.github.com/repos/${demo}/contents/content`, { headers });
  if (!listing.ok) throw new Error(`${demo}'s content/ could not be listed: ${listing.status}`);
  for (const { name, type, download_url: url } of await listing.json()) {
    if (type !== 'file' || name === '.gitkeep') continue;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${demo}'s ${name} could not be downloaded: ${response.status}`);
    await writeFile(join(copy, 'content', name), Buffer.from(await response.arrayBuffer()));
  }
  await commit(copy, 'The demo');
  const built = await deploy(copy, { baseUrl: `https://gjhilton.github.io/${demo.split('/')[1]}`, repository: demo });
  if (!built.built) throw new Error(built.log);
  return built;
}
let site = await demoSite(DEMO);

const written = [];
const browser = await chromium.launch();
/** A screenshot of `query` on `site`, settled, as a small PNG; `act` does anything to the page first. */
async function shoot(name, { query = '', colorScheme = 'light', size = { width: 1280, height: 860 }, fullPage = false, act } = {}) {
  const { page, close } = await browse(browser, { siteUrl: site.baseUrl, query, colorScheme, fileFor: (path) => join(site.dist, path) });
  await page.setViewportSize(size);
  await page.waitForLoadState('networkidle');
  if (act) await act(page);
  await page.waitForTimeout(1500); // the viewer draws its tiles a moment after they arrive
  const png = await sharp(await page.screenshot({ fullPage })).png({ palette: true, quality: 95, effort: 10 }).toBuffer();
  if (await looksDifferent(png, out(name))) {
    await writeFile(out(name), png);
    written.push(name);
  }
  await close();
}

await shoot('demo.png', { query: '?viewer=openseadragon', fullPage: true });
await shoot('demo-dark.png', { query: '?viewer=openseadragon', colorScheme: 'dark', fullPage: true });
await shoot('settings.png', {
  query: 'settings.html',
  size: { width: 1280, height: 900 },
  act: async (page) => {
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Concentric circles');
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Rings of flat colour, eighteen thousand pixels across.');
    await page.evaluate(() => document.activeElement.blur()); // no focus ring in the picture
  },
});
site = await demoSite('gjhilton/whatiiif-demo-notes');
await shoot('notes-demo.png', {
  query: '?viewer=openseadragon',
  size: { width: 1280, height: 1000 },
  act: async (page) => {
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await page.waitForTimeout(4500); // the viewer moves to the lighthouse, and its outline fades
    await page.evaluate(() => scrollTo(0, 0)); // the title in the picture too, above the tour
  },
});
await shoot('notes-helper.png', {
  query: 'notes.html',
  size: { width: 1280, height: 900 },
  act: async (page) => {
    await page.getByRole('button', { name: /^Note 1: / }).click();
    await page.getByRole('button', { name: 'Show note 1' }).click();
    await page.waitForTimeout(2500); // the picture moves to the lighthouse
    await page.evaluate(() => document.activeElement.blur()); // no focus ring
  },
});
await browser.close();
console.log(written.length ? `Remade, as they looked different: ${written.join(', ')}` : 'Every screenshot looks as it did.');
