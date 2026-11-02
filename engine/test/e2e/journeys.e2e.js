// Whole journeys through the template, as its users make them: a repository made from the template, an image
// committed the way they would commit it, the commands the Deploy workflow runs, and the site that comes
// out, opened in a real browser (Chromium, via Playwright).
import { suite, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { missingFiles } from '../../lib/service.js';
import { parseConfig } from '../../lib/config.js';
import { readNotesSource } from '../../lib/notes.js';
import { inspect, makeImage, makePhonePhoto, makeVariant } from '../support/fixtures.js';
import { schemaProblems, schemaUnavailable } from '../support/schema.js';
import { browse, clickToClose, commit, deploy, git, repo as template, run, templateCopy, until, zoomToFullResolution } from '../support/harness.js';
import { tempDir } from '../support/tmp.js';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = (path) => access(path).then(() => true, () => false);

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser?.close());

const open = (site, query, options) => browse(browser, { siteUrl: site.baseUrl, query, fileFor: (path) => join(site.dist, path), ...options });

test('a fresh copy of the template has nothing to publish yet, and says so instead of failing', async () => {
  const site = await deploy(await templateCopy());
  assert.equal(site.skipped, true);
  assert.match(site.log, /::notice::No image in content\/ yet\. Commit one picture there \(TIFF, PNG, JPEG, WebP, AVIF or GIF\)/);
});

suite('a photographer uploads a phone photo on github.com and fills in every setting', () => {
  let site;

  before(async () => {
    const repo = await templateCopy();
    await copyFile(await makePhonePhoto(), join(repo, 'content/Harbour view.jpg'));
    await writeFile(
      join(repo, 'content/whatiiif.toml'),
      [
        'title = "Harbour at dusk"',
        'summary = "The fishing fleet coming in."',
        'attribution = "Example Museum"',
        'alt = "Fishing boats coming into the harbour at dusk"',
        'rights = "https://creativecommons.org/licenses/by/4.0/deed.en"', // as copied from the licence's page
        'creator = "A. Photographer"',
        'date = "1890"',
        'dimensions = "30 x 40 cm"',
        '',
        '[[metadata]]',
        'label = "Source"',
        'value = "https://archives.example.org/collections/harbour-views/1890/plate-17"',
        '',
        '[publish]',
        'footer = false',
      ].join('\n'),
    );
    await writeFile(join(repo, 'content/description.md'), '## About this view\n\nTaken from the *north* pier, by [the lighthouse](#xywh=200,300,400,500).\n');
    await commit(repo, 'Add my photo'); // stored whole: github.com does not put uploads into Git LFS
    site = await deploy(repo, { baseUrl: 'https://gjh.github.io/harbour', repository: 'gjh/harbour' });
  });

  test('the build succeeds and says what it made', () => {
    assert.equal(site.built, true, site.log);
    assert.match(site.log, /Done: \d+ MB of IIIF files at https:\/\/gjh\.github\.io\/harbour\/iiif\//);
  });

  test('the image service is complete, at its Pages address, and upright', async () => {
    const info = await json(join(site.dist, 'iiif/image/info.json'));
    assert.equal(info.id, 'https://gjh.github.io/harbour/iiif/image');
    assert.deepEqual([info.width, info.height], [1200, 1600]);
    assert.deepEqual(await missingFiles(join(site.dist, 'iiif/image')), []);
  });

  test('nothing the camera recorded is published: no location, no rotation tag, no wide-gamut numbers', async () => {
    const { exif, orientation, space, width, height } = await inspect(join(site.dist, 'iiif/image/full/max/0/default.jpg'));
    assert.deepEqual({ exif, orientation, space, width, height }, { exif: false, orientation: 1, space: 'srgb', width: 1200, height: 1600 });
  });

  test('the manifest says what the settings said and links the original on the host that serves it', async () => {
    const manifest = await json(join(site.dist, 'iiif/manifest.json'));
    assert.equal(manifest.id, 'https://gjh.github.io/harbour/iiif/manifest.json');
    assert.deepEqual(manifest.label, { en: ['Harbour at dusk'] });
    assert.deepEqual(manifest.summary, { en: ['The fishing fleet coming in.'] });
    assert.deepEqual(manifest.requiredStatement.value, { en: ['Example Museum'] });
    assert.equal(manifest.rights, 'http://creativecommons.org/licenses/by/4.0/');
    assert.deepEqual(manifest.metadata, [
      { label: { en: ['Creator'] }, value: { en: ['A. Photographer'] } },
      { label: { en: ['Date'] }, value: { en: ['1890'] } },
      { label: { en: ['Dimensions'] }, value: { none: ['30 × 40 cm'] } },
      { label: { en: ['Source'] }, value: { en: ['https://archives.example.org/collections/harbour-views/1890/plate-17'] } },
    ]);
    assert.deepEqual([manifest.items[0].width, manifest.items[0].height], [1200, 1600]);
    // Not in LFS, whatever .gitattributes says, so the LFS media host would answer 404.
    assert.equal(manifest.rendering[0].id, 'https://raw.githubusercontent.com/gjh/harbour/main/content/Harbour%20view.jpg');
  });

  test('the manifest is valid IIIF Presentation 3.0', { skip: schemaUnavailable }, async () => {
    assert.deepEqual(schemaProblems(await json(join(site.dist, 'iiif/manifest.json'))), []);
  });

  test('the page opens with the title, the description and every detail, without asking for them separately', async () => {
    const { page, fetched, problems, close } = await open(site);
    await page.locator('h1').waitFor();
    assert.equal(await page.locator('h1').textContent(), 'Harbour at dusk');
    assert.equal(await page.locator('.masthead p').textContent(), 'The fishing fleet coming in.');
    assert.equal(await page.title(), 'Harbour at dusk');
    assert.equal(await page.locator('.prose h3').textContent(), 'About this view', 'a level below the page title');
    assert.equal(await page.locator('.prose em').textContent(), 'north');
    const rows = await page.locator('.meta tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((cell) => cell.textContent)));
    assert.deepEqual(rows, [
      ['Creator', 'A. Photographer'],
      ['Date', '1890'],
      ['Source', 'https://archives.example.org/collections/harbour-views/1890/plate-17'],
      ['Dimensions', '30 × 40 cm (1,200 × 1,600 px)'],
      ['Attribution', 'Example Museum'],
      ['Rights', 'CC BY 4.0'],
    ]);
    assert.equal(await page.getByRole('link', { name: 'CC BY 4.0' }).getAttribute('href'), 'http://creativecommons.org/licenses/by/4.0/');
    assert.equal(await page.getByRole('group', { name: 'Language' }).count(), 0, 'one language, so no switch');
    assert.equal(fetched.includes('site.json'), false, 'the page carries its details');
    assert.deepEqual(problems, []);
    await close();
  });

  test('on a phone the page fits the screen, however long an address in it', async () => {
    const { page, close } = await open(site);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.meta').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await close();
  });

  const citationToday = (link) => {
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return `A. Photographer (1890) Harbour at dusk. Example Museum. Available at: ${link} (Accessed: ${today}).`;
  };

  test('the links to share and cite the view, and the manifest and image service addresses, are shown and can be copied', async () => {
    const { page, close } = await open(site);
    const fields = page.locator('.copy-field');
    await fields.first().waitFor();
    assert.deepEqual(await fields.locator('input').evaluateAll((inputs) => inputs.map((input) => input.value)), [
      'https://gjh.github.io/harbour/?viewer=openseadragon', // the link to this view: the whole picture, so no fragment
      '<iframe src="https://gjh.github.io/harbour/?embed&amp;viewer=openseadragon" width="800" height="1067" style="border:0;width:100%;max-width:800px;height:auto;aspect-ratio:800/1067" allowfullscreen loading="lazy" title="Harbour at dusk"></iframe>',
      citationToday('https://gjh.github.io/harbour/?viewer=openseadragon'),
      'https://gjh.github.io/harbour/iiif/manifest.json',
      'https://gjh.github.io/harbour/iiif/image/info.json',
    ]);
    const manifest = page.locator('.copy-field', { hasText: 'Manifest URL' });
    await manifest.locator('button').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://gjh.github.io/harbour/iiif/manifest.json');
    assert.equal(await manifest.locator('button').textContent(), 'Copied');
    await close();
  });

  test('the downloads say how big they are, and lead to the full-size JPEG, which is published, and to the original on GitHub', async () => {
    const { page, close } = await open(site);
    const href = (name) => page.getByRole('link', { name }).getAttribute('href');
    assert.equal(await href(/^Full-size JPEG \([\d.]+ [KM]B\)$/), 'https://gjh.github.io/harbour/iiif/image/full/max/0/default.jpg');
    assert.equal(await href(/^Original file \(JPEG, [\d.]+ [KM]B\)$/), 'https://raw.githubusercontent.com/gjh/harbour/main/content/Harbour%20view.jpg');
    assert.equal(await href('View manifest'), 'https://gjh.github.io/harbour/iiif/manifest.json');
    assert.equal(await exists(join(site.dist, 'iiif/image/full/max/0/default.jpg')), true);
    await close();
  });

  test('a shared link shows the title, the summary and a picture that is published', async () => {
    const html = await readFile(join(site.dist, 'index.html'), 'utf8');
    const meta = (name) => html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)">`))?.[1];
    assert.match(html, /<title>Harbour at dusk<\/title>/);
    assert.equal(meta('og:title'), 'Harbour at dusk');
    assert.equal(meta('og:description'), 'The fishing fleet coming in.');
    assert.equal(meta('og:url'), 'https://gjh.github.io/harbour/');
    assert.equal(meta('og:image:alt'), 'Fishing boats coming into the harbour at dusk');
    assert.equal(meta('og:image'), 'https://gjh.github.io/harbour/card.jpg');
    assert.equal(await exists(join(site.dist, 'card.jpg')), true);
  });

  test('without JavaScript the page still shows the picture, described, with its links', async () => {
    const { page, problems, close } = await open(site, '', { javaScriptEnabled: false });
    const picture = page.locator('.fallback img');
    await picture.waitFor();
    assert.equal(await page.locator('.fallback h1').textContent(), 'Harbour at dusk');
    assert.equal(await picture.getAttribute('alt'), 'Fishing boats coming into the harbour at dusk');
    await page.waitForLoadState('networkidle');
    assert.equal(await picture.evaluate((img) => img.complete && img.naturalWidth > 0), true, 'the picture loads');
    assert.deepEqual(await page.locator('.fallback a').allTextContents(), ['IIIF manifest', 'Full-size JPEG', 'Original file']);
    assert.deepEqual(problems, []);
    await close();
  });

  test('a screen reader is told what the picture shows', async () => {
    const { page, close } = await open(site);
    const viewer = page.getByRole('region', { name: 'Image viewer' });
    await viewer.waitFor();
    const description = page.locator(`#${await viewer.getAttribute('aria-describedby')}`);
    assert.equal(await description.textContent(), 'Fishing boats coming into the harbour at dusk');
    await close();
  });

  test('the embed code puts the picture on someone else\'s page, with its credit and a link back', async () => {
    const { page, close } = await open(site);
    const snippet = await page.getByLabel('Embed on a web page').inputValue();
    await close();

    // A blog on another site, carrying the snippet; the site itself is answered from the build.
    const blog = await open(site, '', { elsewhere: `<!doctype html><h1>My post</h1>${snippet}<p style="height:2000px">More of the post.</p>` });
    const frame = blog.page.frameLocator('iframe');
    await frame.locator('.openseadragon-container').first().waitFor();
    await until(() => blog.fetched.some((path) => path.startsWith('iiif/image/')), 'the picture to load in the frame');
    const iframe = await blog.page.locator('iframe').boundingBox();
    assert.deepEqual([iframe.width, Math.round(iframe.height)], [800, 1067], 'the shape of the picture');

    // Someone reading the post scrolls past the picture: it zooms only if they hold Ctrl (or Cmd) as they scroll.
    await blog.page.mouse.move(iframe.x + 400, 400);
    await blog.page.mouse.wheel(0, 300);
    await until(() => blog.page.evaluate(() => scrollY > 0), 'the post to scroll');
    assert.ok(await frame.locator('.openseadragon-cooperative-overlay').textContent(), 'a hint says how to zoom');

    assert.equal(await frame.locator('.masthead').count(), 0, 'no header');
    assert.equal(await frame.locator('.details').count(), 0, 'no details');
    assert.deepEqual(await frame.locator('.credit span').allTextContents(), ['Harbour at dusk', 'Example Museum']);
    const back = frame.getByRole('link', { name: 'Open the full page' });
    assert.equal(await back.getAttribute('href'), 'https://gjh.github.io/harbour/?viewer=openseadragon');
    assert.equal(await back.getAttribute('target'), '_blank');
    const pane = await frame.locator('.viewer').boundingBox();
    assert.ok(pane.width > 790 && pane.height > 520, `the viewer fills the frame (${pane.width}x${pane.height})`);

    // Holding Ctrl, they zoom in; the link back then opens the full page on what they zoomed into.
    await blog.page.evaluate(() => scrollTo(0, 0));
    await zoomToFullResolution(blog, { holding: 'Control', within: frame });
    await until(async () => /#xywh=\d+,\d+,\d+,\d+$/.test(await back.getAttribute('href')), 'the link back to follow the view');
    assert.deepEqual(blog.problems, []);
    await blog.close();
  });

  test('a link in the description to a detail of the picture shows that detail, in either viewer', async () => {
    for (const viewer of ['openseadragon', 'mirador']) {
      const { page, problems, close } = await open(site, `?viewer=${viewer}`);
      await page.locator(viewer === 'mirador' ? '.mirador-window .openseadragon-container' : '.openseadragon-container').first().waitFor();
      await page.waitForLoadState('networkidle');
      await page.getByRole('link', { name: 'the lighthouse' }).click();
      const shown = () => (new URL(page.url()).hash.match(/^#xywh=(\d+),(\d+),(\d+),(\d+)$/) ?? []).slice(1).map(Number);
      await until(() => {
        const [x, y, w, h] = shown();
        return x <= 202 && y <= 302 && x + w >= 598 && y + h >= 798 && h < 1000;
      }, `${viewer} to show the lighthouse`);
      assert.equal(new URL(page.url()).searchParams.get('viewer'), viewer, 'the viewer stays as it was');
      assert.deepEqual(problems, []);
      await close();
    }
  });

  test('editing the part of the picture in the address moves the viewer there', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon');
    await page.locator('.openseadragon-container').first().waitFor();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      location.hash = '#xywh=600,800,300,300';
    });
    await until(() => {
      const [x, y, w, h] = (new URL(page.url()).hash.match(/^#xywh=(\d+),(\d+),(\d+),(\d+)$/) ?? []).slice(1).map(Number);
      return x <= 602 && y <= 802 && x + w >= 898 && y + h >= 1098 && h < 1000;
    }, 'the viewer to settle on the part asked for');
    await close();
  });

  test('a visitor whose computer is set to dark mode sees the page in white on black, in either viewer', async () => {
    for (const viewer of ['openseadragon', 'mirador']) {
      const { page, problems, close } = await open(site, `?viewer=${viewer}`, { colorScheme: 'dark' });
      await page.locator(viewer === 'mirador' ? '.mirador-window .openseadragon-container' : '.openseadragon-container').first().waitFor();
      const colours = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
      assert.deepEqual(colours, ['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
      if (viewer === 'mirador') {
        const window = await page.locator('.mirador-window-top-bar').evaluate((bar) => getComputedStyle(bar).color);
        assert.equal(window, 'rgb(255, 255, 255)', "Mirador's own words are white too");
      }
      assert.deepEqual(problems, []);
      await close();
    }
  });

  test('OpenSeadragon has buttons in the page\'s own style, which zoom in and back out to the whole picture', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon');
    const controls = page.getByRole('group', { name: 'Picture' });
    await controls.waitFor();
    assert.deepEqual(await controls.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))), [
      'Zoom in',
      'Zoom out',
      'Show the whole picture',
      'Full screen',
    ]);
    await page.locator('.openseadragon-container').first().waitFor();
    await page.waitForLoadState('networkidle');
    await controls.getByRole('button', { name: 'Zoom in' }).click();
    await until(() => new URL(page.url()).hash.startsWith('#xywh='), 'the closer view to reach the address');
    await controls.getByRole('button', { name: 'Show the whole picture' }).click();
    await until(() => new URL(page.url()).hash === '', 'the whole picture, which needs no fragment');
    await close();
  });

  test('a scale bar measures the picture against its real size, and keeps to round lengths as the visitor zooms', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon');
    const bar = page.locator('.scale-bar');
    await page.locator('.openseadragon-container').first().waitFor();
    await page.waitForLoadState('networkidle');
    // The whole 30 cm width, 1,200 pixels, fits a pane 648 pixels high at 4:3, about 486 pixels across: 1 cm is about 16.
    await until(async () => (await bar.textContent()) === '5 cm', 'the scale bar to say 5 cm');
    const width = (await bar.boundingBox()).width;
    assert.ok(width > 70 && width < 90, `5 cm is ${width} pixels across, borders and all`);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await until(async () => ['1 cm', '2 cm'].includes(await bar.textContent()), 'a shorter length closer up');
    await close();
  });

  test('printed, the page shows the view as it was on screen, the details and the citation, black on white', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon#xywh=200,300,400,500', { colorScheme: 'dark' });
    await page.locator('.openseadragon-container').first().waitFor();
    await until(() => !page.url().endsWith('#xywh=200,300,400,500'), 'the viewer to report its view, which the citation links to');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    await page.emulateMedia({ media: 'print' });
    const view = page.locator('.print-view');
    assert.equal(await view.isVisible(), true);
    assert.equal(await view.evaluate((img) => img.naturalWidth > 0 && img.src.startsWith('data:image/png')), true, 'a still of the view');
    assert.equal(await page.locator('.details .uses').isVisible(), false, 'no copy fields on paper');
    assert.equal(await page.locator('.print-only p').textContent(), citationToday(page.url()));
    assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]), ['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await view.count(), 0, 'gone again after printing');
    await close();
  });

  test('with the footer switched off, the foot of the page says nothing of WhatIIIF', async () => {
    const { page, close } = await open(site);
    await page.locator('.openseadragon-container').first().waitFor();
    await page.locator('.details').waitFor();
    assert.equal(await page.locator('.made-with').count(), 0);
    assert.equal(await page.getByText(/Published with/).count(), 0);
    await close();
  });

  test('the settings helper starts from the settings as they are, and writes a file the build accepts, saying what is wrong when it is not', async () => {
    const { page, problems, close } = await open(site, 'settings.html');
    const file = page.getByRole('textbox', { name: 'whatiiif.toml' });
    await file.waitFor();
    assert.equal(await page.title(), 'Settings: Harbour at dusk');
    assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), 'Harbour at dusk');

    const translate = page.getByRole('button', { name: 'Add a translation' });
    assert.equal(await translate.count(), 0, 'a site in one language is not offered translations');
    await page.getByRole('checkbox', { name: 'Give texts in other languages too' }).check();
    assert.ok((await translate.count()) > 0, 'until it asks');

    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Harbour at night');
    const { settings } = await json(join(site.dist, 'settings.json'));
    const asJson = (value) => JSON.parse(JSON.stringify(value)); // as settings.json has them, unset settings left out
    assert.deepEqual(asJson(parseConfig(await file.inputValue())), { ...settings, title: { en: 'Harbour at night' } }, 'everything else as it was');

    // Saying the texts are in Welsh takes them with it, rather than leaving them as English to translate.
    await page.getByRole('textbox', { name: 'Language of your texts' }).fill('cy');
    assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), 'Harbour at night');
    assert.match(await file.inputValue(), /^language = "cy"\ntitle = "Harbour at night"$/m);
    await page.getByRole('textbox', { name: 'Language of your texts' }).fill('en');

    // The footer, switched off in this site's settings, is switched on again by ticking it, which is the default.
    const footer = page.getByRole('checkbox', { name: 'Say “Published with WhatIIIF” at the foot of the page' });
    assert.equal(await footer.isChecked(), false);
    assert.match(await file.inputValue(), /^\[publish\]\nfooter = false$/m);
    await footer.check();
    assert.doesNotMatch(await file.inputValue(), /footer/);
    await footer.uncheck();

    const size = page.getByRole('textbox', { name: 'Real size' });
    await size.fill('big');
    assert.match(await page.getByRole('alert').textContent(), /"dimensions" must be the width and height of the original/);
    await size.fill('30 × 40 cm');
    assert.equal(await page.getByRole('alert').count(), 0);

    await page.getByRole('button', { name: 'Copy' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await file.inputValue());
    assert.equal(await page.getByRole('link', { name: 'Open whatiiif.toml on GitHub' }).getAttribute('href'), 'https://github.com/gjh/harbour/edit/main/content/whatiiif.toml');
    assert.deepEqual(problems, []);
    await close();
  });

  test('OpenSeadragon opens first and zooms to full resolution', async () => {
    const opened = await open(site);
    await opened.page.locator('.openseadragon-container').first().waitFor(); // the viewer; its mini-map is a second one
    assert.equal(await opened.page.getByRole('button', { name: 'OpenSeadragon' }).getAttribute('aria-pressed'), 'true');
    await zoomToFullResolution(opened);
    assert.deepEqual(opened.problems, []);
    await opened.close();
  });

  test('the manifest opens in Mirador and Universal Viewer at their own projects’ addresses', async () => {
    const { page, close } = await open(site);
    const manifest = encodeURIComponent(`${site.baseUrl}/iiif/manifest.json`);
    assert.equal(await page.getByRole('link', { name: 'Open in Mirador' }).getAttribute('href'), `https://projectmirador.org/embed/?iiif-content=${manifest}`);
    // Universal Viewer's own, which universalviewer.io/uv.html leads to, rather than a host for trying out its versions.
    assert.equal(await page.getByRole('link', { name: 'Open in Universal Viewer' }).getAttribute('href'), `https://universalviewer.dev/uv.html#?manifest=${manifest}`);
    await close();
  });

  test('a visitor can switch to Mirador, and the address then remembers the choice', async () => {
    const opened = await open(site);
    await opened.page.getByRole('button', { name: 'Mirador' }).click();
    await opened.page.locator('.mirador-window .openseadragon-container').waitFor(); // Mirador draws with OpenSeadragon too
    assert.equal(new URL(opened.page.url()).searchParams.get('viewer'), 'mirador');
    await zoomToFullResolution(opened);
    assert.deepEqual(opened.problems, []);
    await opened.close();

    const linked = await open(site, '?viewer=mirador');
    await linked.page.locator('.mirador-window').waitFor();
    assert.equal(await linked.page.getByRole('button', { name: 'Mirador' }).getAttribute('aria-pressed'), 'true');
    await linked.close();
  });
});

suite('a Welsh archive publishes its image in Welsh and English', () => {
  let site;

  before(async () => {
    const repo = await templateCopy();
    await copyFile(await makeImage(1600, 1200), join(repo, 'content/harbwr.tif'));
    await writeFile(
      join(repo, 'content/whatiiif.toml'),
      [
        'language = "cy"',
        'title = { cy = "Harbwr", en = "Harbour" }',
        'summary = { cy = "Y llongau pysgota yn dod adref.", en = "The fishing fleet coming home." }',
        'attribution = "Archifau Enghraifft"',
        '',
        '[[metadata]]',
        'label = { cy = "Dyddiad", en = "Date" }',
        'value = "1890"',
        '',
        '[colours]',
        'paper = "#fdf6e3"',
      ].join('\n'),
    );
    await writeFile(join(repo, 'content/description.md'), 'Golygfa o\'r *pier*.\n');
    await writeFile(join(repo, 'content/description.en.md'), 'Seen from the *pier*.\n');
    await commit(repo, 'Add the image');
    site = await deploy(repo);
  });

  test('the manifest gives each text in both languages', async () => {
    assert.equal(site.built, true, site.log);
    const manifest = await json(join(site.dist, 'iiif/manifest.json'));
    assert.deepEqual(manifest.label, { cy: ['Harbwr'], en: ['Harbour'] });
    assert.deepEqual(manifest.metadata, [{ label: { cy: ['Dyddiad'], en: ['Date'] }, value: { cy: ['1890'] } }]);
  });

  test('the bilingual manifest is valid IIIF Presentation 3.0', { skip: schemaUnavailable }, async () => {
    assert.deepEqual(schemaProblems(await json(join(site.dist, 'iiif/manifest.json'))), []);
  });

  // What the page shows, as [element, its text, its lang attribute], for a browser that prefers `locale`.
  const shown = async (options) => {
    const { page, problems, close } = await open(site, '', options);
    await page.locator('h1').waitFor();
    const read = (selector) => page.locator(selector).first().evaluate((el) => [el.textContent, el.closest('[lang]')?.getAttribute('lang')]);
    const result = {
      title: await read('h1'),
      summary: await read('.masthead p'),
      description: await read('.prose p'),
      firstRow: await read('.meta th'),
      pageTitle: await page.title(),
    };
    assert.deepEqual(problems, []);
    await close();
    return result;
  };

  test('a visitor whose browser prefers Welsh reads Welsh, marked as Welsh', async () => {
    assert.deepEqual(await shown({ locale: 'cy-GB' }), {
      title: ['Harbwr', 'cy'],
      summary: ['Y llongau pysgota yn dod adref.', 'cy'],
      description: ["Golygfa o'r pier.", 'cy'],
      firstRow: ['Dyddiad', 'cy'],
      pageTitle: 'Harbwr',
    });
  });

  test('a visitor whose browser prefers English reads English, and Welsh where there is no English', async () => {
    const english = await shown({ locale: 'en-GB' });
    assert.deepEqual(english.title, ['Harbour', 'en']);
    assert.deepEqual(english.description, ['Seen from the pier.', 'en']);
    const { page, close } = await open(site, '', { locale: 'en-GB' });
    await page.locator('h1').waitFor();
    const attribution = page.locator('.meta tr', { hasText: 'Attribution' }).locator('td');
    assert.deepEqual(await attribution.evaluate((el) => [el.textContent, el.getAttribute('lang')]), ['Archifau Enghraifft', 'cy']);
    await close();
  });

  test('the language switch changes the page, and the address remembers the choice', async () => {
    const { page, close } = await open(site, '', { locale: 'en-GB' });
    // Each language is offered under its own name for itself, as far as the browser knows it, Welsh first as the site's own.
    const switcher = page.getByRole('group', { name: 'Language' });
    const ownName = (tag) => page.evaluate((t) => new Intl.DisplayNames([t], { type: 'language' }).of(t), tag);
    await switcher.waitFor(); // drawn once site.json has loaded; reading its buttons does not wait
    assert.deepEqual(await switcher.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.lang)), ['cy', 'en']);
    assert.deepEqual(await switcher.getByRole('button').allTextContents(), [await ownName('cy'), await ownName('en')]);
    await switcher.locator('button[lang="cy"]').click();
    assert.equal(await page.locator('h1').textContent(), 'Harbwr');
    assert.equal(new URL(page.url()).searchParams.get('lang'), 'cy');
    await close();

    assert.deepEqual((await shown({ locale: 'en-GB', query: '?lang=cy' })).title, ['Harbwr', 'cy']);
  });

  test('the colours chosen in whatiiif.toml are the page\'s, in dark mode too', async () => {
    for (const colorScheme of ['light', 'dark']) {
      const { page, close } = await open(site, '', { colorScheme });
      await page.locator('h1').waitFor();
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(253, 246, 227)', colorScheme);
      await close();
    }
  });

  test('switching language leaves OpenSeadragon, which shows no words of its own, as it was', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon', { locale: 'en-GB' });
    await page.locator('.openseadragon-container').first().waitFor();
    await page.locator('.viewer-surface').evaluate((surface) => surface.setAttribute('data-before', ''));
    await page.getByRole('group', { name: 'Language' }).locator('button[lang="cy"]').click();
    await page.locator('h1', { hasText: 'Harbwr' }).waitFor();
    assert.equal(await page.locator('.viewer-surface[data-before]').count(), 1, 'the same viewer, not a new one');
    await close();
  });
});

suite('a visitor shares the part of the picture they have zoomed into', () => {
  let site;
  const tile = (x, y) => `iiif/image/${x},${y},512,512/512,512/0/default.jpg`; // a full-resolution tile
  const linkToView = (page) => page.getByLabel('Link to this view').inputValue();

  before(async () => {
    const repo = await templateCopy();
    await copyFile(await makeImage(4000, 3000), join(repo, 'content/harbour.tif'));
    await commit(repo, 'Add the image');
    site = await deploy(repo);
  });

  for (const viewer of ['openseadragon', 'mirador']) {
    test(`a link to a region opens ${viewer} on that region, at full resolution`, async () => {
      const { page, fetched, problems, close } = await open(site, `?viewer=${viewer}#xywh=2000,1500,500,400`);
      await until(() => fetched.includes(tile(2048, 1536)), 'the full-resolution tile in the middle of the region');
      assert.equal(fetched.includes(tile(0, 0)), false, 'nothing at full resolution far from the region');
      // The address names what is on screen: the region asked for, widened to the shape of the pane.
      const [x, y, w, h] = new URL(page.url()).hash.slice('#xywh='.length).split(',').map(Number);
      assert.ok(x <= 2002 && y <= 1502 && x + w >= 2498 && y + h >= 1898, `${[x, y, w, h]} holds 2000,1500,500,400`);
      assert.deepEqual(problems, []);
      await close();
    });
  }

  for (const viewer of ['openseadragon', 'mirador']) {
    test(`in ${viewer}, keys do not turn or mirror the picture, so a link to the view still names what is on screen`, async () => {
      const { page, problems, close } = await open(site, `?viewer=${viewer}#xywh=2000,1500,500,400`);
      const canvas = page.locator(viewer === 'mirador' ? '.mirador-window .openseadragon-canvas' : '.openseadragon-canvas').first();
      await canvas.waitFor();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000); // settled, and the outline of the region faded away (in OpenSeadragon)
      const pane = page.locator('.viewer');
      await canvas.focus(); // first, so its focus ring is in both pictures of it
      await page.waitForTimeout(500);
      const [before, address] = [await pane.screenshot(), page.url()];
      for (const key of ['r', 'R', 'f']) await page.keyboard.press(key);
      await page.waitForTimeout(1500);
      assert.equal(page.url(), address, 'the address still names the same part');
      assert.ok(before.equals(await pane.screenshot()), 'the picture as it was');
      assert.deepEqual(problems, []);
      await close();
    });
  }

  test('the foot of the page says it was published with WhatIIIF, and which version, linking to WhatIIIF; an embedded picture does not', async () => {
    const version = (await readFile(join(template, 'engine/VERSION'), 'utf8')).trim();
    const { page, problems, close } = await open(site, '?viewer=openseadragon');
    const footer = page.locator('footer.made-with');
    await footer.waitFor();
    assert.equal(await footer.textContent(), `Published with WhatIIIF v${version}`);
    assert.equal(await footer.getByRole('link', { name: 'WhatIIIF' }).getAttribute('href'), 'https://github.com/gjhilton/WhatIIIF');
    assert.deepEqual(problems, []);
    await close();
    const embedded = await open(site, '?embed');
    await embedded.page.locator('.credit').waitFor();
    assert.equal(await embedded.page.locator('.made-with').count(), 0);
    await embedded.close();
  });

  test('a link to a region outlines that region for a moment, so whoever opens it sees what was meant', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon#xywh=2000,1500,500,400');
    const outline = page.locator('.region-outline');
    await outline.waitFor();
    await page.waitForLoadState('networkidle');
    const box = await outline.boundingBox();
    const pane = await page.locator('.viewer').boundingBox();
    assert.ok(Math.abs(box.width / box.height - 500 / 400) < 0.05, `outlined in the region's shape (${box.width}x${box.height})`);
    assert.ok(box.x > pane.x && box.x + box.width < pane.x + pane.width, 'within the pane, as the region is narrower than it');
    await outline.waitFor({ state: 'detached', timeout: 10_000 });
    await close();
  });

  test('the view on screen can be saved as a picture, made from the published tiles', async () => {
    const { page, fetched, close } = await open(site, '?viewer=openseadragon#xywh=2000,1500,500,400');
    await until(() => fetched.includes(tile(2048, 1536)), 'the view to open');
    // The address names the part asked for until the viewer reports the view it opened on, the pane's shape.
    await until(() => !page.url().endsWith('#xywh=2000,1500,500,400'), 'the viewer to report its view');
    await page.waitForLoadState('networkidle');
    const [x, y, w, h] = new URL(page.url()).hash.slice('#xywh='.length).split(',').map(Number);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'This view, as a JPEG' }).click()]);
    assert.equal(download.suggestedFilename(), `harbour ${x},${y},${w},${h}.jpg`);
    const { width, height, format } = await sharp(await download.path()).metadata();
    assert.deepEqual({ width, height, format }, { width: w, height: h, format: 'jpeg' }, 'at full resolution, as it is under 4096 pixels a side');
    await close();
  });

  test('zooming in puts the view in the address and the link field, and that link opens the same view', async () => {
    const first = await open(site, '?viewer=openseadragon');
    assert.equal(new URL(first.page.url()).hash, '', 'the whole picture needs no fragment');
    await zoomToFullResolution(first);
    // Zoom in as far as OpenSeadragon goes (about 1090 image pixels across this 1200-pixel pane), so whoever opens the
    // link needs full-resolution tiles. The address follows a zoom only once its animation has finished, so stop
    // scrolling and wait for it to settle.
    for (let notch = 0; notch < 15; notch++) await first.page.mouse.wheel(0, -300);
    let settled = '';
    await until(async () => {
      const before = first.page.url();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      settled = first.page.url();
      return settled === before && new URL(settled).hash !== '';
    }, 'the view to settle in the address');
    assert.match(new URL(settled).hash, /^#xywh=\d+,\d+,(\d+),\d+$/);
    assert.ok(Number(new URL(settled).hash.split(',')[2]) <= 1200, `${new URL(settled).hash} is no wider than the pane`);
    const link = await linkToView(first.page);
    assert.equal(new URL(link).hash, new URL(settled).hash);
    assert.ok(link.startsWith(`${site.baseUrl}/?`), link);
    const [x, y, w, h] = new URL(link).hash.slice('#xywh='.length).split(',').map(Number);
    await first.close();

    // Whoever opens the link sees full-resolution pixels around the same spot.
    const centre = tile(Math.floor((x + w / 2) / 512) * 512, Math.floor((y + h / 2) / 512) * 512);
    const second = await browse(browser, { siteUrl: site.baseUrl, query: new URL(link).search + new URL(link).hash, fileFor: (path) => join(site.dist, path) });
    await until(() => second.fetched.includes(centre), `the tile at the centre of the shared view (${centre})`);
    assert.deepEqual(second.problems, []);
    await second.close();
  });

  test('switching viewer keeps the view', async () => {
    const { page, fetched, close } = await open(site, '?viewer=openseadragon#xywh=2000,1500,500,400');
    await until(() => fetched.includes(tile(2048, 1536)), 'OpenSeadragon on the region');
    // The tiles are cached by now, so watch the address instead: clear it, and only Mirador reporting the view
    // it opened on can put the region back.
    await page.evaluate(() => history.replaceState(null, '', location.pathname + location.search));
    await page.getByRole('button', { name: 'Mirador' }).click();
    await until(() => /^#xywh=/.test(new URL(page.url()).hash), 'Mirador to report the view it opened on');
    const [x, y, w, h] = new URL(page.url()).hash.slice('#xywh='.length).split(',').map(Number);
    assert.ok(x <= 2002 && y <= 1502 && x + w >= 2498 && y + h >= 1898, `${[x, y, w, h]} holds 2000,1500,500,400`);
    await close();
  });
});

suite('a museum adds notes to its picture, which make a tour', () => {
  let site;
  let source; // notes.md as written
  const notes = [
    ['The lighthouse', '600,300,400,700'],
    ['The boats', '2400,1800,900,500'],
    ['A gull', '3300,200,200,150'],
  ];
  const holds = (page, [x0, y0, w0, h0]) => {
    const [x, y, w, h] = (new URL(page.url()).hash.match(/^#xywh=(\d+),(\d+),(\d+),(\d+)$/) ?? []).slice(1).map(Number);
    return x <= x0 + 2 && y <= y0 + 2 && x + w >= x0 + w0 - 2 && y + h >= y0 + h0 - 2 && w < 4000;
  };
  const at = (region) => region.split(',').map(Number);

  before(async () => {
    const repo = await templateCopy();
    await copyFile(await makeImage(4000, 3000), join(repo, 'content/harbour.tif'));
    const text = notes.map(([title, region]) => `## [${title}](https://example.github.io/my-image/?viewer=openseadragon#xywh=${region})\n\nAbout ${title.toLowerCase()}.\n`);
    source = `Three things to look for.\n\n${text.join('\n')}`;
    await writeFile(join(repo, 'content/notes.md'), source);
    await commit(repo, 'A picture with notes');
    site = await deploy(repo);
    assert.equal(site.built, true, site.log);
  });

  test('the notes are listed under the picture, numbered as markers on it, and each takes the viewer to its part', async () => {
    const { page, problems, close } = await open(site, '?viewer=openseadragon');
    await page.locator('.openseadragon-container').first().waitFor();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await page.locator('.notes li h3').allTextContents(), notes.map(([title]) => title));
    const markers = page.getByRole('button', { name: /^Note \d$/ });
    assert.equal(await markers.count(), 3);

    await page.getByRole('button', { name: 'Note 2' }).click();
    await until(() => holds(page, at(notes[1][1])), 'the viewer to show the boats');
    assert.equal(await page.locator('.notes li[aria-current]').locator('h3').textContent(), 'The boats');

    await page.getByRole('button', { name: 'A gull' }).click();
    await until(() => holds(page, at(notes[2][1])), 'the viewer to show the gull');
    assert.deepEqual(problems, []);
    await close();
  });

  test('the tour goes through the notes in order, moving the viewer, and ends when asked', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon');
    await page.locator('.openseadragon-container').first().waitFor();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Take the tour' }).click();
    const tour = page.getByRole('region', { name: 'Tour' });
    assert.equal(await tour.locator('.tour-step').textContent(), 'Note 1 of 3');
    assert.equal(await tour.locator('h2').textContent(), 'The lighthouse');
    assert.equal(await tour.getByRole('button', { name: 'Back' }).isDisabled(), true);
    await until(() => holds(page, at(notes[0][1])), 'the viewer to show the lighthouse');

    await tour.getByRole('button', { name: 'Next' }).click();
    assert.equal(await tour.locator('h2').textContent(), 'The boats');
    await until(() => holds(page, at(notes[1][1])), 'the viewer to show the boats');
    await tour.getByRole('button', { name: 'Next' }).click();
    assert.equal(await tour.locator('.tour-step').textContent(), 'Note 3 of 3');
    await tour.getByRole('button', { name: 'Back' }).click();
    assert.equal(await tour.locator('.tour-step').textContent(), 'Note 2 of 3');
    await tour.getByRole('button', { name: 'Back' }).press('Escape');
    assert.equal(await tour.count(), 0, 'Escape ends it');
    await close();
  });

  test('in Mirador, the notes are in its own list of annotations', async () => {
    const { page, problems, close } = await open(site, '?viewer=mirador');
    const mirador = page.locator('.mirador-window');
    await mirador.getByText('Showing 3 annotations').waitFor();
    for (const [title] of notes) await mirador.getByText(title, { exact: true }).waitFor();
    assert.deepEqual(problems, []);
    await close();
  });

  test('Mirador opens with its list of notes on the page, but not in a small embedded frame', async () => {
    for (const [query, expanded] of [['?viewer=mirador', 'true'], ['?embed&viewer=mirador', 'false']]) {
      const { page, problems, close } = await open(site, query);
      const sidebar = page.locator('.mirador-window-menu-btn');
      await sidebar.waitFor();
      assert.equal(await sidebar.getAttribute('aria-expanded'), expanded, query);
      assert.deepEqual(problems, []);
      await close();
    }
  });

  test('in Mirador, with its list of notes open beside the picture, a link to the view describes what is on screen', async () => {
    const { page, problems, close } = await open(site, '?viewer=mirador');
    await page.locator('.mirador-window .openseadragon-container').first().waitFor();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // time for Mirador to report the view it opened on
    assert.equal(new URL(page.url()).hash, '', 'the whole picture, as Mirador opens on it, names no part of it in the address');
    await page.locator('.notes').getByRole('button', { name: 'The boats' }).click();
    // The address names the boats themselves at once, then the view Mirador reports once it has got there.
    await until(() => new URL(page.url()).hash.startsWith('#xywh=') && !page.url().endsWith(`#xywh=${notes[1][1]}`), 'Mirador to report its view');
    assert.ok(holds(page, at(notes[1][1])), 'the view holds the boats');
    const [, , w, h] = new URL(page.url()).hash.match(/(\d+),(\d+),(\d+),(\d+)$/).slice(1).map(Number);
    const screen = await page.locator('.mirador-window .openseadragon-container').first().boundingBox();
    const shape = w / h / (screen.width / screen.height);
    assert.ok(Math.abs(shape - 1) < 0.03, `the view is ${w} × ${h}, on a screen ${Math.round(screen.width)} × ${Math.round(screen.height)}`);
    assert.ok(Math.abs(w / 900 - 1) < 0.02, `the boats, wider than the screen's shape, fill its width (${w} wide)`);
    assert.deepEqual(problems, []);
    await close();
  });

  test('in Mirador, with its list of notes open, a link to a part of the picture opens on just that part', async () => {
    const { page, problems, close } = await open(site, `?viewer=mirador#xywh=${notes[1][1]}`);
    await until(() => new URL(page.url()).hash.startsWith('#xywh=') && !page.url().endsWith(`#xywh=${notes[1][1]}`), 'Mirador to report its view');
    assert.ok(holds(page, at(notes[1][1])), 'the view holds the boats');
    const [, , w] = new URL(page.url()).hash.match(/(\d+),(\d+),(\d+),(\d+)$/).slice(1).map(Number);
    assert.ok(Math.abs(w / 900 - 1) < 0.02, `the boats fill the width of the picture's part of the window (${w} wide)`);
    assert.deepEqual(problems, []);
    await close();
  });

  test('on a narrow screen Mirador leaves its list of notes closed, to leave room for the picture: the page lists them', async () => {
    const { page, problems, close } = await open(site, '?viewer=mirador', { device: { viewport: { width: 600, height: 900 } } });
    const sidebar = page.locator('.mirador-window-menu-btn');
    await sidebar.waitFor();
    assert.equal(await sidebar.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(problems, []);
    await close();
  });

  test('from the keyboard, the picture’s own buttons come before the numbers of the notes on it, as they do on screen', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon');
    await page.locator('.note-marker').first().waitFor();
    await page.getByRole('button', { name: 'Mirador' }).focus(); // the last thing before the picture
    const order = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.className));
    }
    assert.deepEqual(order.slice(0, 4), ['Zoom in', 'Zoom out', 'Show the whole picture', 'Full screen']);
    assert.ok(order.indexOf('Note 1') > 3, order.join(', '));
    // And still drawn over the picture, where they can be pressed.
    const zoomIn = await page.getByRole('button', { name: 'Zoom in' }).boundingBox();
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: zoomIn.x + zoomIn.width / 2, y: zoomIn.y + zoomIn.height / 2 }), 'Zoom in');
    await close();
  });

  test('the tour takes keyboard focus when it starts, and gives it back when it ends', async () => {
    const { page, close } = await open(site, '?viewer=openseadragon');
    await page.locator('.openseadragon-container').first().waitFor();
    const start = page.getByRole('button', { name: 'Take the tour' });
    await start.focus();
    await page.keyboard.press('Enter');
    const tour = page.getByRole('region', { name: 'Tour' });
    await tour.waitFor();
    assert.equal(await tour.evaluate((element) => element.contains(document.activeElement)), true, 'focus moves into the tour');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Next', 'Back is disabled, so Next is first');
    await page.keyboard.press('Escape');
    assert.equal(await tour.count(), 0);
    assert.equal(await start.evaluate((element) => element === document.activeElement), true, 'focus goes back to Take the tour');
    await close();
  });

  /**
   * Gives the page a clock of its own, so that how far the picture gets in a given time does not depend on how fast
   * this machine is. Installed before the page loads again, so its viewers take their time from it.
   */
  const ownClock = async (page) => {
    await page.clock.install();
    await page.reload();
  };
  const holdClock = async (page) => page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  /** Clicks `button` with the clock held, and lets the page answer the click, which its clock does not hold up. */
  const press = async (page, button) => {
    await button.click();
    await page.waitForTimeout(100);
  };

  test('for a visitor whose computer is set to reduce motion, either viewer goes straight to a note rather than gliding there', async () => {
    for (const [viewer, ready] of [['openseadragon', '.openseadragon-container'], ['mirador', '.mirador-window .openseadragon-container']]) {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const { page, close } = await open(site, `?viewer=${viewer}`, { device: { reducedMotion } });
        await ownClock(page);
        await page.locator(ready).first().waitFor();
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: 'Take the tour' }).click();
        await until(() => holds(page, at(notes[0][1])), `${viewer}: the viewer to show the lighthouse`);
        await holdClock(page);
        await press(page, page.getByRole('region', { name: 'Tour' }).getByRole('button', { name: 'Next' }));
        // The page puts the note's part in the address at once; the viewer puts what it shows there once it arrives.
        const arrived = () => holds(page, at(notes[1][1])) && new URL(page.url()).hash !== `#xywh=${notes[1][1]}`;
        await page.clock.runFor(200);
        assert.equal(arrived(), reducedMotion === 'reduce', `${viewer}, ${reducedMotion}: at the boats a moment after Next`);
        await page.clock.runFor(5000);
        assert.equal(arrived(), true, `${viewer}, ${reducedMotion}: at the boats in the end`);
        await close();
      }
    }
  });

  // The notes helper (notes.html), which writes the notes files for the site's owner.
  const helper = async (on = site, options = {}) => {
    const opened = await open(on, 'notes.html', { device: { reducedMotion: 'reduce' }, ...options }); // so the page scrolls at once
    const { page } = opened;
    await page.locator('.openseadragon-canvas').first().waitFor();
    await page.waitForLoadState('networkidle');
    const file = (name = 'notes.md') => page.getByRole('textbox', { name, includeHidden: true });
    /** A note's line in the list, which opens it. */
    const note = (n) => page.getByRole('button', { name: new RegExp(`^Note ${n}: `) });
    return { ...opened, file, note, written: async (name) => readNotesSource(await file(name).inputValue()) };
  };
  const near = (region, [x, y, w, h], slack = 20) =>
    Math.abs(region.x - x) <= slack && Math.abs(region.y - y) <= slack && Math.abs(region.w - w) <= slack && Math.abs(region.h - h) <= slack;
  /** Waits for `locator` to stop moving, as the picture does once it has got where it was sent. */
  const settled = async (locator) => {
    let last;
    await until(async () => {
      const now = JSON.stringify(await locator.boundingBox());
      const still = now === last;
      last = now;
      return still;
    }, 'the picture to settle');
    return JSON.parse(last);
  };
  const drag = async (page, from, by) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 5 });
    await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 5 });
    await page.mouse.up();
  };
  const middle = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

  test('in the notes helper too, Show it takes the picture straight to a note’s part when the computer is set to reduce motion', async () => {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const { page, note, close } = await helper(site, { device: { reducedMotion } });
      await ownClock(page);
      await page.locator('.openseadragon-canvas').first().waitFor();
      await page.waitForLoadState('networkidle');
      await note(1).click();
      await page.getByRole('button', { name: 'Show note 1' }).click();
      const area = page.locator('.note-area').nth(1);
      await settled(area);
      await note(2).click(); // the picture stays where it is until Show it
      await holdClock(page);
      await press(page, page.getByRole('button', { name: 'Show note 2' }));
      await page.clock.runFor(200);
      const soon = JSON.stringify(await area.boundingBox());
      await page.clock.runFor(5000);
      const there = JSON.stringify(await area.boundingBox());
      assert.equal(soon === there, reducedMotion === 'reduce', `${reducedMotion}: note 2's part where it ends up a moment after Show it`);
      await close();
    }
  });

  test('the notes helper starts from the notes as written, and writes what reads back as the same notes', async () => {
    const { page, problems, close, written, note } = await helper();
    assert.deepEqual(await written(), readNotesSource(source));
    assert.equal(await page.locator('.note-area').count(), 3, 'each note’s part is outlined on the picture');
    assert.deepEqual(await page.locator('.notes-list .note-row-title').allTextContents(), notes.map(([title], i) => `Note ${i + 1}: ${title}`));
    await page.getByText('3 notes, as on your site.').waitFor();
    await page.getByText('These are the notes your site has.').waitFor();
    assert.equal(await page.locator('.note-problems, .notes-publish .problem').count(), 0);

    await note(1).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The lighthouse at dusk');
    await page.getByText('3 notes. Changed, and not yet on your site: this browser keeps the changes until then.').waitFor();
    // Changes can be let go of at once, without a reload first.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Start again from your site’s notes' }).click();
    assert.deepEqual(await written(), readNotesSource(source));
    await note(1).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The lighthouse at dusk');
    assert.equal(await page.getByRole('link', { name: 'Open notes.md on GitHub' }).getAttribute('href'), 'https://github.com/example/my-image/edit/main/content/notes.md');
    assert.deepEqual(problems, []);
    await close();
  });

  test('in the notes helper a note opened from the list leaves the picture until shown, and a number chosen on the picture opens its note', async () => {
    const { page, problems, close, note } = await helper();
    const pane = await page.locator('.notes-picture .viewer').boundingBox();
    await note(2).click();
    const where = await settled(page.locator('.note-area[data-selected]'));
    assert.ok(where.width < pane.width / 2, `the picture stays where it was, so a part found there can be used for the note: ${JSON.stringify(where)}`);
    assert.equal(await page.locator('.note-handle').count(), 4, 'the open note’s part has a corner to drag at each corner');
    assert.equal(await page.getByRole('group', { name: 'Note 2' }).count(), 0, 'beside the picture, the note’s own buttons are enough');
    await page.getByRole('button', { name: 'Show note 2' }).click();
    const boats = await settled(page.locator('.note-area[data-selected]'));
    assert.ok(boats.width > pane.width / 2, `shown, the picture moves to the boats, which fill most of it: ${JSON.stringify(boats)}`);

    // A note opened below the open one stays in view as the one above it closes.
    await note(3).click();
    const row = await note(3).boundingBox();
    assert.ok(row.y >= 0 && row.y + row.height <= 900, `note 3’s line is on screen: ${JSON.stringify(row)}`);
    await note(3).click();

    await page.getByRole('button', { name: 'Show the whole picture' }).click();
    await settled(page.locator('.note-area').first());
    await page.getByRole('button', { name: 'Note 3', exact: true }).click();
    assert.equal(await note(3).getAttribute('aria-expanded'), 'true');
    assert.equal(await note(3).evaluate((button) => button === document.activeElement), true, 'its line in the list has keyboard focus');
    assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), 'A gull');
    assert.deepEqual(problems, []);
    await close();
  });

  test('in the notes helper a note’s part is the part in view, one drawn round, or its outline dragged on the picture', async () => {
    const { page, problems, close, written, note } = await helper();
    // The whole picture in view: once it has settled there, that is the part.
    await note(1).click();
    await page.getByRole('button', { name: 'Show the whole picture' }).click();
    await until(async () => {
      await page.getByRole('button', { name: 'Use the part in view for note 1' }).click();
      return near((await written()).items[0].region, [0, 0, 4000, 3000], 0);
    }, 'the whole picture to be the part of note 1');
    await page.getByText(/^The whole picture\. To point at a part of it, zoom in/).waitFor(); // most likely a slip

    // Drawn round the boats, outlined on the picture as note 2's part, it is the boats.
    await page.getByRole('button', { name: 'Draw it: note 1' }).click();
    const boats = await settled(page.locator('.note-area').nth(1));
    assert.equal(JSON.stringify(boats), JSON.stringify(await page.locator('.note-area').nth(1).boundingBox()), 'the picture holds still to be drawn on');
    await drag(page, { x: boats.x, y: boats.y }, { x: boats.width, y: boats.height });
    const drawn = (await written()).items[0].region;
    assert.ok(near(drawn, at(notes[1][1])), `drawn round the boats: ${JSON.stringify(drawn)}`);
    assert.equal(await page.getByRole('button', { name: 'Stop drawing' }).count(), 0, 'one drag draws one part');

    // While drawing, the picture still zooms; Escape stops drawing, and nothing is drawn.
    await page.getByRole('button', { name: 'Draw it: note 1' }).click();
    const outline = page.locator('.note-area').nth(2);
    const before = await settled(outline);
    await page.mouse.move(...Object.values(middle(await page.locator('.notes-picture .viewer').boundingBox())));
    await page.mouse.wheel(0, -400);
    const after = await settled(outline);
    assert.ok(after.width > before.width * 1.1, `zoomed in while drawing: ${before.width} to ${after.width}`); // a step of the wheel is 1.2 times
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Stop drawing' }).count(), 0);
    assert.deepEqual((await written()).items[0].region, drawn);
    // A tap while drawing, or a press that wanders a pixel or two, draws nothing: on a picture shown small, a pixel
    // on screen is many of the picture's, and a speck would take the place of the note's part.
    await page.getByRole('button', { name: 'Draw it: note 1' }).click();
    const pane = middle(await page.locator('.notes-picture .viewer').boundingBox());
    await drag(page, pane, { x: 2, y: 1 });
    assert.equal(await page.getByRole('button', { name: 'Stop drawing' }).count(), 1, 'still drawing');
    await page.keyboard.press('Escape');
    assert.deepEqual((await written()).items[0].region, drawn);
    // The picture is not turned or mirrored by OpenSeadragon's keys: parts are marked on it as it is.
    const shape = async () => {
      const { width, height } = await settled(page.locator('.note-area').nth(1));
      return width > height;
    };
    const wide = await shape();
    await page.locator('.notes-picture .openseadragon-canvas').first().focus();
    await page.keyboard.press('r');
    assert.equal(await shape(), wide, 'not turned');

    // The open note's part, dragged by a corner, changes size; dragged by its number, it moves.
    await note(2).click();
    await page.getByRole('button', { name: 'Show note 2' }).click();
    const area = await settled(page.locator('.note-area[data-selected]'));
    const scale = 900 / area.width; // the picture's pixels to the screen's
    await drag(page, middle(await page.locator('.note-handle[data-corner="se"]').boundingBox()), { x: 60, y: 40 });
    const [x, y, w, h] = at(notes[1][1]);
    const grown = (await written()).items[1].region;
    assert.ok(near(grown, [x, y, w + 60 * scale, h + 40 * scale], 8 * scale), `grown at one corner: ${JSON.stringify(grown)}`);
    await drag(page, middle(await page.locator('.note-area[data-selected] .note-marker').boundingBox()), { x: -50, y: -30 });
    const moved = (await written()).items[1].region;
    assert.ok(near(moved, [grown.x - 50 * scale, grown.y - 30 * scale, grown.w, grown.h], 8 * scale), `moved by its number: ${JSON.stringify(moved)}`);
    assert.deepEqual([moved.w, moved.h], [grown.w, grown.h], 'moving keeps its size');
    assert.equal(await note(2).getAttribute('aria-expanded'), 'true', 'a drag of the number is not a press of it');

    // A tap on another note's number that wanders a little opens that note, and moves nothing.
    const gull = (await written()).items[2].region;
    await page.getByRole('button', { name: 'Show the whole picture' }).click();
    const number = await settled(page.locator('.note-area').nth(2).locator('.note-marker'));
    await drag(page, middle(number), { x: 6, y: 3 });
    assert.equal(await note(3).getAttribute('aria-expanded'), 'true');
    assert.deepEqual((await written()).items[2].region, gull);

    // Drawing a new note's part: the button pressed becomes Stop drawing, keeping keyboard focus, and the hint, read out
    // as it changes, says what to do.
    const focused = () => page.evaluate(() => document.activeElement.textContent);
    await page.getByRole('button', { name: 'Draw a new note’s part' }).press('Enter');
    assert.equal(await focused(), 'Stop drawing');
    assert.match(await page.getByRole('status').filter({ hasText: /^Drag across the picture/ }).textContent(), /round the part for a new note/);
    await page.keyboard.press('Enter');
    assert.equal(await focused(), 'Draw a new note’s part');

    // A new note for the part in view, its title typed straight away.
    await page.getByRole('button', { name: 'Add a note for the part in view' }).click();
    await page.keyboard.type('The harbour');
    const { items } = await written();
    assert.equal(items.length, 4);
    assert.equal(items[3].title, 'The harbour');
    assert.ok(items[3].region, 'the part in view');
    assert.deepEqual(problems, []);
    await close();
  });

  test('on a narrow screen, the open note’s part is changed from under the picture, where the note’s own buttons are out of sight', async () => {
    const { page, problems, close, written, note } = await helper(site, { device: { viewport: { width: 600, height: 900 }, reducedMotion: 'reduce' } });
    await note(2).click();
    await page.getByRole('button', { name: 'Show note 2' }).click();
    const picture = await page.locator('.notes-picture').boundingBox();
    assert.ok(picture.y >= -1 && picture.y + picture.height <= 901, `the picture and what is under it are on screen: ${JSON.stringify(picture)}`);
    const here = page.getByRole('group', { name: 'Note 2' });
    await page.getByRole('button', { name: 'Show the whole picture' }).click();
    await until(async () => {
      await here.getByRole('button', { name: 'Use the part in view' }).click();
      return near((await written()).items[1].region, [0, 0, 4000, 3000], 0);
    }, 'the whole picture to be the part of note 2');
    // A number chosen on the picture opens its note there, rather than scrolling away to the list, and keeps focus.
    await page.getByRole('button', { name: 'Note 3', exact: true }).press('Enter');
    await page.getByRole('group', { name: 'Note 3' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Note 3');
    // Its Draw button there becomes Stop drawing as it is pressed, keeping focus.
    await page.getByRole('group', { name: 'Note 3' }).getByRole('button', { name: 'Draw it again' }).press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Stop drawing');
    await page.keyboard.press('Enter');
    const still = await page.locator('.notes-picture').boundingBox();
    assert.ok(still.y >= -1 && still.y + still.height <= 901, `the picture is still on screen: ${JSON.stringify(still)}`);
    assert.deepEqual(problems, []);
    await close();
  });

  test('in the notes helper notes can be put in another order, removed and put back, and a mistake is explained where it is', async () => {
    const { page, close, written, note } = await helper();
    const titles = async () => (await written()).items.map(({ title }) => title);
    await page.getByRole('button', { name: 'Move note 3 up' }).click();
    assert.deepEqual(await titles(), ['The lighthouse', 'A gull', 'The boats']);
    // From the keyboard, focus stays with the note moved, down and up, at the bottom and the top.
    const label = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
    await page.getByRole('button', { name: 'Move note 1 down' }).press('Enter');
    assert.equal(await label(), 'Move note 2 down');
    await page.keyboard.press('Enter');
    assert.deepEqual([await titles(), await label()], [['A gull', 'The boats', 'The lighthouse'], 'Move note 3 up']);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.deepEqual([await titles(), await label()], [['The lighthouse', 'A gull', 'The boats'], 'Move note 1 down']);
    // A key held down moves the note once, not on and back again as focus turns at the bottom.
    await page.getByRole('button', { name: 'Move note 2 down' }).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.down('Enter'); // the first a press, the rest the key repeating
    await page.keyboard.up('Enter');
    assert.deepEqual(await titles(), ['The lighthouse', 'The boats', 'A gull']);
    await page.getByRole('button', { name: 'Move note 3 up' }).click();
    assert.deepEqual(await titles(), ['The lighthouse', 'A gull', 'The boats']);
    await note(1).click();
    await page.getByRole('button', { name: 'Draw it: note 1' }).click();
    const focused = () => page.evaluate(() => document.activeElement.textContent);
    await page.getByRole('button', { name: 'Remove note 1' }).press('Enter');
    assert.equal(await page.getByRole('button', { name: 'Stop drawing' }).count(), 0, 'a note removed while its part was being drawn stops the drawing');
    assert.deepEqual(await titles(), ['A gull', 'The boats']);
    assert.equal(await focused(), 'Undo', 'keyboard focus goes from the button that went with the note to Undo');
    await page.keyboard.press('Enter');
    assert.deepEqual(await titles(), ['The lighthouse', 'A gull', 'The boats']);
    assert.equal(await note(1).getAttribute('aria-expanded'), 'true', 'put back, and open again');
    assert.equal(await note(1).evaluate((button) => button === document.activeElement), true, 'with keyboard focus');

    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('## Its lamp\n\nBright.');
    await note(2).click(); // a note's mistakes are pointed out once the owner moves on from it
    const said = ['Note 1 needs a title.', 'Note 1 has a heading made with ##, which would start a note of its own: use ### for a heading within a note.'];
    assert.deepEqual(await page.locator('.notes-list .note-problems li').allTextContents(), said);
    assert.equal(await page.getByRole('button', { name: /^Copy/ }).count(), 0, 'nothing to copy that would stop the site being built');
    await page.locator('.notes-publish').getByRole('button', { name: 'Note 1 needs a title.' }).click();
    assert.equal(await note(1).getAttribute('aria-expanded'), 'true', 'each mistake opens its note');
    await close();
  });

  test('the notes helper keeps changes in the browser until the site has them, and previews them on the site’s page', async () => {
    const { page, close, written, note } = await helper();
    await note(1).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The lighthouse at dusk');
    await page.reload(); // at once: kept as the page is left
    await page.getByText(/^These are the changes you made in this browser on /).waitFor();
    assert.equal((await written()).items[0].title, 'The lighthouse at dusk', 'a reload loses nothing');
    const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('whatiiif notes: https://example.github.io/my-image/')).saved);
    const made = await kept();
    await page.reload();
    await page.getByText(/^These are the changes you made in this browser on /).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await kept(), made, 'still kept as made when they were made, not when they were last looked at');

    // The preview: the site's own page, with these notes and their tour.
    const [preview] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: 'Preview them on your site' }).click()]);
    await preview.locator('.notes').waitFor();
    assert.match(await preview.locator('.preview-banner').textContent(), /^A preview of the notes you are writing, which are not on your site yet/);
    assert.deepEqual(await preview.locator('.notes li h3').allTextContents(), ['The lighthouse at dusk', 'The boats', 'A gull']);
    assert.equal(await preview.getByRole('button', { name: 'Mirador' }).count(), 0, 'no Mirador, which lists the notes the site has, not these');
    await preview.getByRole('button', { name: 'Take the tour' }).click();
    assert.equal(await preview.getByRole('region', { name: 'Tour' }).locator('h2').textContent(), 'The lighthouse at dusk');
    await preview.evaluate(() => dispatchEvent(new Event('focus')));
    assert.equal(await preview.getByRole('region', { name: 'Tour' }).count(), 1, 'come back to with nothing changed, the preview is left as it was, tour and all');
    // Changed again in the helper, the preview shows the change when the owner comes back to it.
    await note(3).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Two gulls');
    const comeBack = () => preview.evaluate(() => dispatchEvent(new Event('focus'))); // as the owner switches to it
    await until(async () => {
      await comeBack();
      return (await preview.locator('.notes li h3').allTextContents()).includes('Two gulls');
    }, 'the preview to show the change');
    // Notes the build could not read are not shown as no notes at all: the preview says why.
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('## Wings');
    const banner = preview.locator('.preview-banner');
    await until(async () => {
      await comeBack();
      return /^The notes you are writing cannot be shown yet: Note 3 has a heading made with ##/.test(await banner.textContent());
    }, 'the preview to say why');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('');

    // Back to the helper closes the preview, rather than opening a second helper in it.
    await clickToClose(preview, preview.getByRole('link', { name: 'Back to the notes helper' }));

    // Starting again while a part is being drawn stops the drawing, which was for a note now gone.
    await page.getByRole('button', { name: 'Draw a new note’s part' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Start again from your site’s notes' }).click();
    assert.deepEqual(await written(), readNotesSource(source));
    assert.equal(await page.getByRole('button', { name: 'Stop drawing' }).count(), 0);
    await close();
  });

  test('changes kept in the browser are said to undo any made to the site’s notes since they began, on GitHub perhaps', async () => {
    const elsewhere = join(await tempDir('changed'), 'settings.json');
    let changedOnGitHub = false;
    const { page, close, note } = await helper(site, { fileFor: (path) => (changedOnGitHub && path === 'settings.json' ? elsewhere : join(site.dist, path)) });
    await note(1).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The lighthouse at dusk');
    await page.waitForTimeout(500); // kept a moment after the change
    const settings = await json(join(site.dist, 'settings.json'));
    await writeFile(elsewhere, JSON.stringify({ ...settings, notes: { ...settings.notes, text: settings.notes.text.replace('A gull', 'Two gulls') } }));
    changedOnGitHub = true;
    const warning = page.getByText(/^Your site’s notes have changed since then, perhaps on GitHub/);
    await page.reload();
    await warning.waitFor();
    // Changed again, the changes still began from the notes the site had before.
    await note(2).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The fleet');
    await page.waitForTimeout(500);
    await page.reload();
    await warning.waitFor();
    // Changed back to what the site has, there is nothing kept to warn of.
    await note(1).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The lighthouse');
    await note(2).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The boats');
    await note(3).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Two gulls');
    await page.getByText('3 notes, as on your site.').waitFor();
    assert.equal(await warning.count(), 0);
    await close();
  });

  test('a second notes helper on the same site waits for the first to be closed, then carries on from its changes', async () => {
    const { page, close, note } = await helper();
    await note(1).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The lighthouse at dusk');
    const other = await page.context().newPage();
    await other.goto(page.url());
    await other.getByText(/^The notes helper for this site is open in another tab or window\. Carry on there/).waitFor();
    assert.equal(await other.getByRole('textbox').count(), 0, 'nothing to change in it meanwhile, to be kept over the first one’s changes');
    await page.close();
    await other.getByText(/^These are the changes you made in this browser on /).waitFor();
    assert.equal(await other.locator('.notes-list .note-row-title').first().textContent(), 'Note 1: The lighthouse at dusk');
    await close();
  });

  test('notes copied by hand from the helper’s box are watched for too, as where the browser would not copy them', async () => {
    const { page, close, note } = await helper();
    await note(2).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The fleet');
    // A page not served securely has no clipboard: the helper says how to copy it by hand.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
    await page.getByRole('button', { name: 'Copy notes.md' }).click();
    await page.getByText(/Your browser would not copy it: open See notes\.md, below, and copy everything in it\./).waitFor();
    await page.locator('summary', { hasText: 'See notes.md' }).click();
    await page.getByRole('textbox', { name: 'notes.md' }).focus();
    await page.keyboard.press('ControlOrMeta+C');
    await page.getByText('Watching for your site to have them…').waitFor();
    await close();
  });

  test('once its notes are copied, the notes helper watches for the site to have them, then forgets the changes', async () => {
    const rebuilt = join(await tempDir('rebuilt'), 'settings.json');
    let built = false;
    const { page, close, file, note } = await helper(site, { fileFor: (path) => (built && path === 'settings.json' ? rebuilt : join(site.dist, path)) });
    await note(2).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The fleet');
    await page.getByRole('button', { name: 'Copy notes.md' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await file().inputValue());
    await page.getByText('Watching for your site to have them…').waitFor();
    const github = page.getByRole('link', { name: 'Open notes.md on GitHub' });
    assert.deepEqual([await github.getAttribute('target'), await github.getAttribute('rel')], ['_blank', 'noopener'], 'GitHub in a tab of its own, so this one goes on watching');
    await page.waitForTimeout(500);
    await page.reload(); // even so, the owner may come back to it later
    await page.getByText('Watching for your site to have them…').waitFor();

    // The owner pastes them into notes.md on GitHub, and the site is rebuilt with them.
    const settings = await json(join(site.dist, 'settings.json'));
    await writeFile(rebuilt, JSON.stringify({ ...settings, notes: { ...settings.notes, text: await file().inputValue() } }));
    built = true;
    await page.getByText('Your site has these notes now.').waitFor({ timeout: 30_000 });
    await page.getByText('3 notes, as on your site.').waitFor();
    const kept = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('whatiiif notes')));
    await until(async () => (await kept()).length === 0, 'the changes to be forgotten, as the site has them');
    await close();
  });

  test('in the notes helper notes in other languages move with their notes, and files changed together go on the site together', async () => {
    const repo = await templateCopy();
    await copyFile(await makeImage(4000, 3000), join(repo, 'content/harbour.tif'));
    await writeFile(join(repo, 'content/notes.md'), source);
    await writeFile(join(repo, 'content/notes.cy.md'), 'Tri pheth.\n\n## Y goleudy\n\nAm y goleudy.\n\n## Y cychod\n\n## Gwylan\n');
    await commit(repo, 'Notes in Welsh too');
    const welsh = await deploy(repo);
    assert.equal(welsh.built, true, welsh.log);
    const { page, problems, close, written, note } = await helper(welsh);
    await page.getByRole('button', { name: 'Move note 3 up' }).click();
    const [en, cy] = [await written('notes.md'), await written('notes.cy.md')];
    assert.deepEqual(en.items.map(({ title }) => title), ['The lighthouse', 'A gull', 'The boats']);
    assert.deepEqual(cy.items.map(({ title }) => title), ['Y goleudy', 'Gwylan', 'Y cychod']);
    assert.equal(cy.items[0].text, 'Am y goleudy.');

    await note(1).click();
    const welshTitle = page.getByRole('textbox', { name: 'Title in Welsh' });
    assert.equal(await welshTitle.inputValue(), 'Y goleudy');
    await welshTitle.fill('');
    await note(2).click();
    await page.locator('.notes-publish').getByRole('button', { name: 'Note 1 needs a title in Welsh, for notes.cy.md.' }).waitFor();
    await note(1).click();
    await welshTitle.fill('Y goleudy');

    assert.equal(await page.getByRole('link', { name: 'Upload them to your content folder on GitHub' }).getAttribute('href'), 'https://github.com/example/my-image/upload/main/content');
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    for (const name of ['notes.md', 'notes.cy.md']) await page.getByRole('button', { name: `Download ${name}` }).click(); // one a press, as browsers ask before several
    await until(() => downloads.length === 2, 'both files to download');
    assert.deepEqual(downloads.map((download) => download.suggestedFilename()), ['notes.md', 'notes.cy.md']);
    assert.deepEqual(problems, []);
    await close();
  });

  test('a notes helper that cannot load the site’s notes says so, rather than taking the site for one with none', async () => {
    const { page, close } = await helper();
    await page.route('**/settings.json*', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.reload();
    await page.getByText(/^This page could not load your site’s details and notes\. Reload it to try again/).waitFor();
    assert.equal(await page.getByText('No notes yet.').count(), 0);
    await close();
  });

  test('on a site with no notes yet, the notes helper says what notes are, starts empty, and links to where notes.md is made', async () => {
    const plain = await deploy(await templateCopy().then(async (repo) => {
      await copyFile(await makeImage(800, 600), join(repo, 'content/plain.tif'));
      await commit(repo, 'A picture');
      return repo;
    }));
    const { page, problems, close, written, file } = await helper(plain);
    assert.deepEqual(await written(), { intro: '', items: [] });
    await page.getByText(/^Notes point out parts of your picture\./).waitFor();
    await page.getByText('No notes yet.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Preview them on your site' }).count(), 0, 'nothing to preview yet');
    await page.getByRole('button', { name: 'Add a note for the part in view' }).click();
    await page.keyboard.type('The middle');
    assert.equal(await page.getByRole('link', { name: 'Make content/notes.md on GitHub' }).getAttribute('href'), 'https://github.com/example/my-image/new/main?filename=content/notes.md');
    assert.match(await file().inputValue(), /^## \[The middle\]\(https:\/\/example\.github\.io\/my-image\/#xywh=0,0,800,600\)$/m);
    assert.deepEqual(problems, []);
    await close();
  });

  test('a picture without notes has no markers, list or tour', async () => {
    const plain = await deploy(await templateCopy().then(async (repo) => {
      await copyFile(await makeImage(800, 600), join(repo, 'content/plain.tif'));
      await commit(repo, 'A picture');
      return repo;
    }));
    const { page, close } = await open(plain, '?viewer=openseadragon');
    await page.locator('.openseadragon-container').first().waitFor();
    assert.equal(await page.locator('.notes, .note-marker').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Take the tour' }).count(), 0);
    await close();
  });
});

const lfs = await run('git', ['lfs', 'version']).then(({ code }) => code === 0, () => false);

suite('an archive commits a 16-bit scan through Git LFS and changes no settings', { skip: !lfs && 'git-lfs is not installed' }, () => {
  let repo;
  let site;

  before(async () => {
    repo = await templateCopy();
    await git(repo, ['lfs', 'install', '--local'], { lfs: true });
    await copyFile(await makeVariant('rgb16', 2600, 1800), join(repo, 'content/Survey_1856.png'));
    await commit(repo, 'Add the scan', { lfs: true });
    site = await deploy(repo);
  });

  test('git really holds a pointer, not the image', async () => {
    const { stdout } = await git(repo, ['cat-file', '-p', 'HEAD:content/Survey_1856.png']);
    assert.match(stdout, /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
  });

  test('the site is built, named after the file, with the original linked on the LFS media host', async () => {
    assert.equal(site.built, true, site.log);
    const manifest = await json(join(site.dist, 'iiif/manifest.json'));
    assert.deepEqual(manifest.label, { en: ['Survey_1856'] });
    assert.equal(manifest.rendering[0].id, 'https://media.githubusercontent.com/media/example/my-image/main/content/Survey_1856.png');
  });

  test('the 16-bit scan is published as ordinary 8-bit sRGB JPEG tiles that a viewer can zoom into fully', async () => {
    const { depth, space, channels } = await inspect(join(site.dist, 'iiif/image/0,0,512,512/512,512/0/default.jpg'));
    assert.deepEqual({ depth, space, channels }, { depth: 'uchar', space: 'srgb', channels: 3 });
    assert.deepEqual(await missingFiles(join(site.dist, 'iiif/image')), []);

    const opened = await open(site);
    assert.equal(await opened.page.locator('h1').textContent(), 'Survey_1856');
    await zoomToFullResolution(opened);
    assert.deepEqual(opened.problems, []);
    await opened.close();
  });

  test('replacing the image and deploying again leaves nothing of the old one', async () => {
    await rm(join(repo, 'content/Survey_1856.png'));
    await copyFile(await makeImage(300, 200), join(repo, 'content/postcard.tif'));
    await commit(repo, 'Swap the image', { lfs: true });
    const again = await deploy(repo);

    assert.equal(again.built, true, again.log);
    const { title, width, height } = await json(join(again.dist, 'site.json'));
    assert.deepEqual({ title, width, height }, { title: { en: 'postcard' }, width: 300, height: 200 });
    assert.deepEqual(await readdir(join(again.dist, 'iiif/image')), ['full', 'info.json']); // one tile: the whole image

    const opened = await open(again);
    await zoomToFullResolution(opened);
    assert.deepEqual(opened.problems, []);
    await opened.close();
  });
});

suite('a library publishes a scan too big to upload by linking to it in a GitHub release', () => {
  let server;
  let link;
  let site;
  const requested = [];

  before(async () => {
    // Stands in for github.com serving a release's file: it answers the build, never the visitor's browser.
    const picture = await readFile(await makeImage(2600, 1800));
    server = createServer((request, response) => {
      requested.push(request.url);
      if (request.url !== '/gjh/harbour/releases/download/picture/Harbour%20scan.tif') return response.writeHead(404).end();
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(picture);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    link = `http://127.0.0.1:${server.address().port}/gjh/harbour/releases/download/picture/Harbour%20scan.tif`;

    const repo = await templateCopy();
    await writeFile(join(repo, 'content/whatiiif.toml'), `picture = "${link}"\n`);
    await commit(repo, 'Link to the scan');
    site = await deploy(repo);
  });
  after(() => server?.close());

  test('the site is built from the picture at the link, named after its file, and the link is where to download it', async () => {
    assert.equal(site.built, true, site.log);
    assert.deepEqual(requested, ['/gjh/harbour/releases/download/picture/Harbour%20scan.tif']);
    const manifest = await json(join(site.dist, 'iiif/manifest.json'));
    assert.deepEqual(manifest.label, { en: ['Harbour scan'] });
    assert.deepEqual([manifest.rendering[0].id, manifest.rendering[0].format], [link, 'image/tiff']);
    assert.deepEqual(await missingFiles(join(site.dist, 'iiif/image')), []);
  });

  test('visitors zoom into it as into any other', async () => {
    const opened = await open(site);
    assert.equal(await opened.page.locator('h1').textContent(), 'Harbour scan');
    await zoomToFullResolution(opened);
    assert.deepEqual(opened.problems, []);
    await opened.close();
  });
});

// What someone gets wrong, and the sentence that must tell them so. The build fails, so the workflow stops before
// deploying, and nothing about the image is made.
const mistakes = [
  {
    name: 'commits two images',
    files: { 'a.png': 'x', 'b.jpg': 'x' },
    says: /Build failed: content\/ must contain exactly one image, but found 2: a\.png, b\.jpg\. Remove the extras\./,
  },
  {
    name: 'commits a format that cannot be read yet',
    files: { 'scan.jp2': 'x' },
    says: /Build failed: scan\.jp2 is not supported yet\. Convert it to TIFF, PNG or JPEG and commit that in content\/ instead\./,
  },
  {
    name: 'uploads a photo straight from their iPhone',
    files: { 'IMG_0001.HEIC': 'x' },
    says: /Build failed: IMG_0001\.HEIC is an iPhone photo \(HEIC\), which cannot be read here\. Make it a JPEG first/,
  },
  {
    name: 'misspells a setting',
    files: { 'a.png': 'x', 'whatiiif.toml': 'titel = "Harbour"' },
    says: /Build failed: content\/whatiiif\.toml: unknown setting "titel"; did you mean "title"\? Valid settings here: language, title, summary/,
  },
  {
    name: 'leaves the settings file half-written',
    files: { 'a.png': 'x', 'whatiiif.toml': 'title = ' },
    says: /Build failed: content\/whatiiif\.toml is not valid TOML/,
  },
  {
    name: 'gives their own terms page as the rights URL',
    files: { 'a.png': 'x', 'whatiiif.toml': 'rights = "https://example.org/terms"' },
    says: /Build failed: content\/whatiiif\.toml: "rights" must be a Creative Commons or RightsStatements\.org URL.*Describe any other terms in "attribution" instead\./,
  },
];

for (const { name, files, says } of mistakes) {
  test(`someone who ${name} is told what to fix, and nothing is built`, async () => {
    const repo = await templateCopy();
    for (const [file, content] of Object.entries(files)) await writeFile(join(repo, 'content', file), content);
    await commit(repo, 'A mistake');
    const site = await deploy(repo);

    assert.equal(site.built, false);
    assert.equal(site.code, 1);
    assert.match(site.log, says);
    assert.equal(await exists(join(site.dist, 'site.json')), false);
    assert.equal(await exists(join(site.dist, 'iiif')), false);
  });
}
