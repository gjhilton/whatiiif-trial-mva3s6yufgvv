#!/usr/bin/env node
// The screenshots in the README: the demo's picture, published by this working tree's template, in light and dark,
// the settings helper part-way through being filled in, and the notes demo on its tour. Run after a change to how
// the page looks:
//
//   node engine/test/support/readme-screenshots.js
//
// It downloads the demos' content, builds the sites as the Deploy workflow would, and writes PNGs to engine/artwork.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browse, commit, deploy, repo, templateCopy } from './harness.js';

const DEMO = 'gjhilton/whatiiif-demo';
const PICTURE = 'Concentric circles.png';
const out = (name) => join(repo, 'engine/artwork', name);

/** A site built by this working tree from the `files` in `demo`'s content/, at its address on GitHub Pages. */
async function demoSite(demo, files) {
  const copy = await templateCopy();
  for (const file of files) {
    const response = await fetch(`https://raw.githubusercontent.com/${demo}/main/content/${encodeURIComponent(file)}`);
    if (!response.ok) throw new Error(`${demo}'s ${file} could not be downloaded: ${response.status}`);
    await writeFile(join(copy, 'content', file), Buffer.from(await response.arrayBuffer()));
  }
  await commit(copy, 'The demo');
  const built = await deploy(copy, { baseUrl: `https://gjhilton.github.io/${demo.split('/')[1]}`, repository: demo });
  if (!built.built) throw new Error(built.log);
  return built;
}
let site = await demoSite(DEMO, [PICTURE]);

const browser = await chromium.launch();
/** A screenshot of `query` on `site`, settled, as a small PNG; `act` does anything to the page first. */
async function shoot(name, { query = '', colorScheme = 'light', size = { width: 1280, height: 860 }, fullPage = false, act } = {}) {
  const { page, close } = await browse(browser, { siteUrl: site.baseUrl, query, colorScheme, fileFor: (path) => join(site.dist, path) });
  await page.setViewportSize(size);
  await page.waitForLoadState('networkidle');
  if (act) await act(page);
  await page.waitForTimeout(1500); // the viewer draws its tiles a moment after they arrive
  const png = await page.screenshot({ fullPage });
  await sharp(png).png({ palette: true, quality: 95, effort: 10 }).toFile(out(name));
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
site = await demoSite('gjhilton/whatiiif-demo-notes', ['A harbour.png', 'whatiiif.toml', 'description.md', 'notes.md']);
await shoot('notes-demo.png', {
  query: '?viewer=openseadragon',
  size: { width: 1280, height: 1000 },
  act: async (page) => {
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await page.waitForTimeout(4500); // the viewer moves to the lighthouse, and its outline fades
    await page.evaluate(() => scrollTo(0, 0)); // the title in the picture too, above the tour
  },
});
await browser.close();
console.log('Written: engine/artwork/demo.png, demo-dark.png, settings.png and notes-demo.png');
