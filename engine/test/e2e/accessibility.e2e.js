// Every state of the page a visitor can meet, and the settings helper, checked against WCAG 2.1 AA by axe, the
// checker browsers' own accessibility tools use. A site with every setting and two languages, so nothing is missed.
import { suite, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { makeImage } from '../support/fixtures.js';
import { browse, commit, deploy, templateCopy } from '../support/harness.js';

let browser;
let site;

before(async () => {
  browser = await chromium.launch();
  const repo = await templateCopy();
  await copyFile(await makeImage(2400, 1600), join(repo, 'content/harbour.tif'));
  await writeFile(
    join(repo, 'content/whatiiif.toml'),
    `title = { en = "Harbour at dusk", cy = "Harbwr gyda'r hwyr" }
summary = "The fishing fleet coming in."
creator = "A. Painter"
date = "1890"
attribution = "Example Museum"
alt = "Fishing boats coming into the harbour at dusk"
rights = "https://creativecommons.org/licenses/by/4.0/"
dimensions = "120 x 80 cm"

[[metadata]]
label = "Medium"
value = "Oil on canvas"
`,
  );
  await writeFile(join(repo, 'content/description.md'), '## About this view\n\nTaken from the north pier, by [the lighthouse](#xywh=200,300,400,500).\n');
  await writeFile(join(repo, 'content/notes.md'), 'Two things to look for.\n\n## [The lighthouse](#xywh=200,300,400,500)\n\nStill lit.\n\n## [The boats](#xywh=1200,900,600,400)\n');
  await commit(repo, 'A picture');
  site = await deploy(repo);
  assert.equal(site.built, true, site.log);
});
after(() => browser?.close());

/** What axe finds wrong, as "rule: what is wrong (where)" lines; empty when nothing is. */
async function problemsIn(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.flatMap(({ id, help, nodes }) => nodes.map(({ target }) => `${id}: ${help} (${target.join(' ')})`));
}

const states = {
  'the page, in OpenSeadragon': { query: '?viewer=openseadragon', ready: '.openseadragon-container' },
  'the page, in Mirador': { query: '?viewer=mirador', ready: '.mirador-window .openseadragon-container' },
  'the page in dark mode': { query: '?viewer=openseadragon', ready: '.openseadragon-container', colorScheme: 'dark' },
  'the page in Welsh': { query: '?viewer=openseadragon&lang=cy', ready: '.openseadragon-container' },
  'the picture embedded in another page': { query: '?embed', ready: '.openseadragon-container' },
  // axe is itself a script, so this is the page as a browser without JavaScript shows it: the fallback unwrapped
  // from its <noscript>, and the page's own script left out.
  'the page without JavaScript': { query: '', ready: '.fallback img', withoutScript: true },
  'the settings helper': { query: 'settings.html', ready: 'textarea' },
  'the notes helper': { query: 'notes.html', ready: '.note-area' },
  'the notes helper with a note open, changed, and a mistake pointed out': {
    query: 'notes.html',
    ready: '.note-area',
    act: async (page) => {
      await page.getByRole('button', { name: /^Note 1: / }).click();
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill('');
      await page.getByRole('button', { name: /^Note 2: / }).click();
      await page.locator('.note-problems').waitFor();
    },
  },
  'the page as a preview of notes being written': { query: '?notes-draft', ready: '.preview-banner' },
  'the page on its tour of the notes': {
    query: '?viewer=openseadragon',
    ready: '.note-marker',
    act: (page) => page.getByRole('button', { name: 'Take the tour' }).click(),
  },
};

suite('nothing on the page stands in the way of someone using assistive technology', () => {
  for (const [name, { query, ready, ...options }] of Object.entries(states)) {
    test(name, async () => {
      const { withoutScript, act, ...rest } = options;
      const fileFor = (path) => join(site.dist, path);
      const opened = await browse(browser, { siteUrl: site.baseUrl, query, fileFor, ...rest });
      const { page, close } = opened;
      if (withoutScript) {
        const html = (await readFile(fileFor('index.html'), 'utf8'))
          .replace(/<\/?noscript>/g, '')
          .replace(/<script type="module"[^>]*><\/script>/, '');
        await page.route((url) => url.pathname === new URL(`${site.baseUrl}/`).pathname, (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.reload();
      }
      await page.locator(ready).first().waitFor();
      if (act) await act(page);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(await problemsIn(page), []);
      await close();
    });
  }
});
