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
import { inspect, makeImage, makePhonePhoto, makeVariant } from '../support/fixtures.js';
import { schemaProblems, schemaUnavailable } from '../support/schema.js';
import { browse, commit, deploy, git, run, templateCopy, until, zoomToFullResolution } from '../support/harness.js';

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
    await writeFile(join(repo, 'content/notes.md'), `Three things to look for.\n\n${text.join('\n')}`);
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
