import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, writeFile, readFile, copyFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../lib/build.js';
import { missingFiles } from '../lib/service.js';
import sharp from 'sharp';
import { makeImage } from './support/fixtures.js';
import { run, repo } from './support/harness.js';
import { tempDir } from './support/tmp.js';

async function setup(toml = '') {
  const content = await tempDir('content');
  const out = await tempDir('dist');
  await copyFile(await makeImage(2000, 1500), join(content, 'harbour.tif'));
  if (toml) await writeFile(join(content, 'whatiiif.toml'), toml);
  return { content, out };
}
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));

test('builds a valid service, manifest and site config from a committed image', async () => {
  const { content, out } = await setup('title = "Harbour"\nattribution = "Museum"');
  await build({
    contentDir: content,
    outDir: out,
    env: { SITE_BASE_URL: 'https://example.org/site', GITHUB_REPOSITORY: 'gjh/harbour', GITHUB_REF_NAME: 'main' },
  });

  const imageDir = join(out, 'iiif/image');
  assert.deepEqual(await missingFiles(imageDir), []);
  assert.equal((await read(join(imageDir, 'info.json'))).id, 'https://example.org/site/iiif/image');

  const manifest = await read(join(out, 'iiif/manifest.json'));
  assert.equal(manifest.id, 'https://example.org/site/iiif/manifest.json');
  assert.deepEqual(manifest.label, { en: ['Harbour'] });
  assert.deepEqual(manifest.homepage[0].id, 'https://example.org/site/');
  assert.deepEqual(manifest.rendering[0], {
    id: 'https://raw.githubusercontent.com/gjh/harbour/main/content/harbour.tif',
    type: 'Image',
    label: { en: ['Original file'] },
    format: 'image/tiff',
  });

  const site = await read(join(out, 'site.json'));
  assert.equal(site.viewer, 'openseadragon');
  assert.equal(site.manifestUrl, 'https://example.org/site/iiif/manifest.json');
  assert.equal(site.infoUrl, 'https://example.org/site/iiif/image/info.json');
  assert.equal(site.canvasId, manifest.items[0].id);
  assert.deepEqual(site.title, { en: 'Harbour' });
  assert.equal(site.width, 2000);
});

test('base_url in the config overrides the derived Pages URL', async () => {
  const { content, out } = await setup('base_url = "https://iiif.example.com/"');
  await build({ contentDir: content, outDir: out, env: { SITE_BASE_URL: 'https://example.org/site' } });
  assert.equal((await read(join(out, 'iiif/manifest.json'))).id, 'https://iiif.example.com/iiif/manifest.json');
});

test('honours publish.full = false', async () => {
  const { content, out } = await setup('[publish]\nfull = false');
  await build({ contentDir: content, outDir: out, env: {} });
  const body = (await read(join(out, 'iiif/manifest.json'))).items[0].items[0].items[0].body;
  assert.match(body.id, /full\/1000,750\/0\/default\.jpg$/);
});

test('a rebuild after swapping the image leaves no tiles from the previous one', async () => {
  const { content, out } = await setup();
  await build({ contentDir: content, outDir: out, env: {} });
  await rm(join(content, 'harbour.tif'));
  await copyFile(await makeImage(300, 200), join(content, 'postcard.tif'));
  await build({ contentDir: content, outDir: out, env: {} });

  // A 300x200 image is one tile, so all that is published is the whole image, under the name libvips
  // gives it and the one viewers ask for.
  assert.deepEqual(await readdir(join(out, 'iiif/image')), ['full', 'info.json']);
  assert.deepEqual(await readdir(join(out, 'iiif/image/full')), ['300,200', 'max']);
});

test('gives the page its texts in every language, with the description already turned into HTML', async () => {
  const { content, out } = await setup('language = "cy"\ntitle = { en = "Harbour", cy = "Harbwr" }');
  await writeFile(join(content, 'description.md'), 'Golygfa *hyfryd*');
  await build({ contentDir: content, outDir: out, env: {} });

  const site = await read(join(out, 'site.json'));
  assert.equal(site.language, 'cy');
  assert.deepEqual(site.languages, ['cy', 'en']);
  assert.deepEqual(site.title, { en: 'Harbour', cy: 'Harbwr' });
  assert.deepEqual(site.description, { cy: '<p>Golygfa <em>hyfryd</em></p>\n' });
});

test('personalises the built page: a social card showing a published picture, and a fallback without JavaScript', async () => {
  const { content, out } = await setup('title = "Harbour"\nalt = "Fishing boats at dusk"');
  // What Vite leaves in the output folder before the engine runs.
  await writeFile(join(out, 'index.html'), '<head><!-- whatiiif:head --><title>whatiiif</title><!-- /whatiiif:head --></head><body><!-- whatiiif:body --><!-- /whatiiif:body --></body>'); // as Vite leaves it
  await build({ contentDir: content, outDir: out, env: { SITE_BASE_URL: 'https://example.org/site' } });

  assert.equal((await read(join(out, 'site.json'))).pageUrl, 'https://example.org/site/');
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('<meta property="og:image" content="https://example.org/site/card.jpg">'), 'the card picture is an absolute address on the site');
  const { width, height, format } = await sharp(join(out, 'card.jpg')).metadata();
  assert.deepEqual({ width, height, format }, { width: 1200, height: 630, format: 'jpeg' }, 'in the shape social sites show');
  assert.ok(html.includes('alt="Fishing boats at dusk"'));
});

// What Vite leaves in the output folder before the engine runs.
const builtPage = '<head><!-- whatiiif:head --><title>whatiiif</title><!-- /whatiiif:head --></head><body><!-- whatiiif:body --><!-- /whatiiif:body --></body>';
const github = { SITE_BASE_URL: 'https://gjh.github.io/harbour', GITHUB_REPOSITORY: 'gjh/harbour', GITHUB_REF_NAME: 'main' };

test('a picture given by its link is published, and the link is where its original is downloaded from', async () => {
  const content = await tempDir('content');
  const out = await tempDir('dist');
  const link = 'https://github.com/gjh/harbour/releases/download/picture/Harbour%20scan.tif';
  const picture = await readFile(await makeImage(900, 600));
  await writeFile(join(content, 'whatiiif.toml'), `picture = "${link}"`);
  const fetch = async (url) => (url === link ? new Response(picture) : new Response('', { status: 404 }));

  await build({ contentDir: content, outDir: out, env: github, fetch });
  const manifest = await read(join(out, 'iiif/manifest.json'));
  assert.deepEqual(manifest.label, { en: ['Harbour scan'] });
  assert.equal(manifest.rendering[0].id, link);
  assert.deepEqual(await missingFiles(join(out, 'iiif/image')), []);
  const site = await read(join(out, 'site.json'));
  assert.deepEqual([site.originalUrl, site.originalBytes, site.originalFormat], [link, picture.length, 'image/tiff']);
});

test('site.json says how big each download is', async () => {
  const { content, out } = await setup();
  await build({ contentDir: content, outDir: out, env: github });
  const site = await read(join(out, 'site.json'));
  assert.equal(site.fullBytes, (await readFile(join(out, 'iiif/image/full/max/0/default.jpg'))).length);
  assert.equal(site.originalBytes, (await readFile(join(content, 'harbour.tif'))).length);
  assert.equal(site.originalFormat, 'image/tiff');
});

test('publish.original = false leaves the original unlinked', async () => {
  const { content, out } = await setup('[publish]\noriginal = false');
  await build({ contentDir: content, outDir: out, env: github });
  assert.equal('rendering' in (await read(join(out, 'iiif/manifest.json'))), false);
  assert.equal((await read(join(out, 'site.json'))).originalUrl, undefined);
});

test('a private repository does not link its original, which visitors could not download', async () => {
  const { content, out } = await setup();
  const event = join(await tempDir('github'), 'event.json');
  await writeFile(event, JSON.stringify({ repository: { full_name: 'gjh/harbour', visibility: 'private', private: true } }));
  await build({ contentDir: content, outDir: out, env: { ...github, GITHUB_EVENT_PATH: event } });
  assert.equal('rendering' in (await read(join(out, 'iiif/manifest.json'))), false);
});

test('files in content/ that are not used are pointed out, and do not stop the build', async () => {
  const { content, out } = await setup();
  await writeFile(join(content, 'descripton.md'), 'A view');
  const warnings = [];
  await build({ contentDir: content, outDir: out, env: {}, warn: (message) => warnings.push(message) });
  assert.deepEqual(warnings, ['content/descripton.md is not used; did you mean description.md?']);
});

test('the built page carries the site\'s details, so it opens without asking for them, and an icon cut from the picture', async () => {
  const { content, out } = await setup('title = "Harbour"');
  await writeFile(join(out, 'index.html'), builtPage);
  await build({ contentDir: content, outDir: out, env: github });

  const html = await readFile(join(out, 'index.html'), 'utf8');
  const data = html.match(/<script type="application\/json" id="whatiiif-site">(.*?)<\/script>/s);
  assert.deepEqual(JSON.parse(data[1]), await read(join(out, 'site.json')));
  assert.ok(html.includes('<link rel="icon" href="icon.png">'));
  const { width, height, format } = await sharp(join(out, 'icon.png')).metadata();
  assert.deepEqual({ width, height, format }, { width: 180, height: 180, format: 'png' });
});

test('colours chosen in whatiiif.toml are written into the page, where they outrank the defaults', async () => {
  const { content, out } = await setup('[colours]\npaper = "#fdf6e3"\nink = "rgb(20 20 20)"');
  await writeFile(join(out, 'index.html'), builtPage);
  await build({ contentDir: content, outDir: out, env: github });
  assert.ok((await readFile(join(out, 'index.html'), 'utf8')).includes('<style>html:root { --paper: #fdf6e3; --ink: rgb(20 20 20); }</style>'));
});

// engine/build.js as the Deploy workflow runs it. GitHub shows annotations at the top of a run's page and the step
// summary below them, so whoever made a mistake reads what to do without opening any log.
async function buildInActions(content, out) {
  const summary = join(await tempDir('github'), 'summary.md');
  await writeFile(summary, '');
  const env = { ...github, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
  const result = await run('node', [join(repo, 'engine/build.js'), '--content', content, '--out', out], { env });
  return { ...result, summary: await readFile(summary, 'utf8') };
}

test('in a workflow run, a mistake is shown on the run\'s page as an error, saying what to fix', async () => {
  const { content, out } = await setup('titel = "Harbour"\n\n[[metadata]]\nlabel = "Date"');
  const { code, stdout, summary } = await buildInActions(content, out);
  assert.equal(code, 1);
  assert.match(stdout, /^::error title=Your site was not built::content\/whatiiif\.toml: unknown setting "titel"; did you mean "title"\? Valid settings here: .*$/m);
  assert.match(summary, /## Your site was not built\n\ncontent\/whatiiif\.toml: unknown setting "titel"/);
});

test('in a workflow run, anything worth a look is a warning, and the summary says where the site will be', async () => {
  const { content, out } = await setup('title = "Harbour"');
  await writeFile(join(content, 'descripton.md'), 'A view');
  const { code, stdout, summary } = await buildInActions(content, out);
  assert.equal(code, 0);
  assert.match(stdout, /^::warning title=Worth a look::content\/descripton\.md is not used; did you mean description\.md\?$/m);
  assert.match(summary, /\*\*https:\/\/gjh\.github\.io\/harbour\/\*\*/);
  assert.match(summary, /\| Picture \| harbour\.tif, 2,000 × 1,500 pixels \|/);
  assert.match(summary, /\| IIIF manifest \| https:\/\/gjh\.github\.io\/harbour\/iiif\/manifest\.json \|/);
  assert.match(summary, /\| Settings \| \[Change them with the settings helper\]\(https:\/\/gjh\.github\.io\/harbour\/settings\.html\) \|/);
  assert.match(summary, /!\[Harbour\]\(https:\/\/gjh\.github\.io\/harbour\/card\.jpg\)/, 'the picture a shared link shows');
  assert.match(summary, /- content\/descripton\.md is not used/);
});

test('in a workflow run, a message over several lines stays one annotation', async () => {
  const { stdout } = await buildInActions(await tempDir('content'), await tempDir('dist'));
  assert.match(stdout, /^::error title=Your site was not built::No image found in content\/\. .*$/m);
  const { escapeAnnotation } = await import('../lib/report.js');
  assert.equal(escapeAnnotation('50% done\nthen\r more'), '50%25 done%0Athen%0D more');
});

// The tiles of a 2000x1500 picture at the default quality, 85, without the full-size JPEG: what it takes to fit.
async function tilesAt85() {
  const { content, out } = await setup('[publish]\nfull = false');
  return (await build({ contentDir: content, outDir: out, env: {} })).bytes;
}

test('tiles too big for GitHub Pages are made again at a lower quality, and the build says so', async () => {
  const budgetBytes = Math.round((await tilesAt85()) * 0.9);
  const { content, out } = await setup();
  const warnings = [];
  const result = await build({ contentDir: content, outDir: out, env: {}, budgetBytes, warn: (message) => warnings.push(message) });
  assert.ok(result.bytes <= budgetBytes, `${result.bytes} bytes fit in ${budgetBytes}`);
  assert.equal(result.droppedFull, true, 'the full-size JPEG goes first');
  assert.match(warnings.join('\n'), /The tiles were too big for GitHub Pages at quality 85, so they were made at quality (75|65|55|45)\./);
  assert.deepEqual(await missingFiles(join(out, 'iiif/image')), []);
});

test('a picture too big for GitHub Pages at any quality stops the build, saying how much smaller it must be', async () => {
  const { content, out } = await setup();
  await assert.rejects(
    build({ contentDir: content, outDir: out, env: {}, budgetBytes: 100_000 }),
    /The picture is too big for GitHub Pages: its tiles take [\d.]+ MB even at quality 45, and [\d.]+ MB fit\. Make it smaller: about \d+% of its width and height would fit\./,
  );
});

test('the summary of a run says how many notes the picture has, and in which languages', async () => {
  const { content } = await setup();
  await writeFile(join(content, 'notes.md'), '## [The boat](#xywh=100,200,300,400)\n\n## [The gull](#xywh=10,20,30,40)\n');
  await writeFile(join(content, 'notes.cy.md'), '## Y cwch\n\n## Yr wylan\n');
  const { summary } = await buildInActions(content, await tempDir('dist'));
  assert.match(summary, /\| Notes \| 2, in English and Welsh\. \[Change them with the notes helper\]\(https:\/\/gjh\.github\.io\/harbour\/notes\.html\) \|/);
});

test('the summary of a run without notes says where they can be added', async () => {
  const { content } = await setup();
  const { summary } = await buildInActions(content, await tempDir('dist'));
  assert.match(summary, /\| Notes \| None\. \[Add some with the notes helper\]\(https:\/\/gjh\.github\.io\/harbour\/notes\.html\) \|/);
});

test('the page is told who made the picture, when, and how big it is', async () => {
  const { content, out } = await setup('creator = "J. M. W. Turner"\ndate = { de = "um 1890" }\ndimensions = "120 × 90 cm"');
  const warnings = [];
  await build({ contentDir: content, outDir: out, env: {}, warn: (message) => warnings.push(message) });
  const site = await read(join(out, 'site.json'));
  assert.deepEqual([site.creator, site.date, site.dimensions], [{ en: 'J. M. W. Turner' }, { de: 'um 1890' }, { width: 120, height: 90, unit: 'cm', text: '120 × 90 cm' }]);
  assert.deepEqual(site.languages, ['en', 'de']);
  assert.deepEqual(warnings, []);
});

test('dimensions that are not the shape of the picture are worth a look', async () => {
  const { content, out } = await setup('dimensions = "120 × 80 cm"'); // the picture is 2000 x 1500, 4:3
  const warnings = [];
  await build({ contentDir: content, outDir: out, env: {}, warn: (message) => warnings.push(message) });
  assert.deepEqual(warnings, [
    'The dimensions, 120 × 80 cm, are not the shape of the picture, 2,000 × 1,500 pixels: is one of them wrong, or the picture cropped? Measurements follow the width.',
  ]);
});

test('the settings helper is given the settings as written, and where to change them on GitHub', async () => {
  const { content, out } = await setup('summary = "A view"\n[tiles]\nquality = 70');
  await build({ contentDir: content, outDir: out, env: github });
  const { settings, editUrl } = await read(join(out, 'settings.json'));
  assert.deepEqual(settings.summary, { en: 'A view' });
  assert.equal(settings.title, undefined, 'not the title made from the file name, which was not written');
  assert.equal(settings.tiles.quality, 70);
  assert.equal(editUrl, 'https://github.com/gjh/harbour/edit/main/content/whatiiif.toml');
});

test('notes on the picture reach the page, and the manifest as annotations a IIIF viewer shows', async () => {
  const { content, out } = await setup();
  await writeFile(join(content, 'notes.md'), '## [The boat](#xywh=100,200,300,400)\n\nRed sails.\n');
  await build({ contentDir: content, outDir: out, env: github });
  const site = await read(join(out, 'site.json'));
  assert.deepEqual(site.notes, { items: [{ region: { x: 100, y: 200, w: 300, h: 400 }, title: { en: 'The boat' }, text: { en: '<p>Red sails.</p>\n' } }] });
  const [page] = (await read(join(out, 'iiif/manifest.json'))).items[0].annotations;
  assert.equal(page.items[0].target, 'https://gjh.github.io/harbour/iiif/canvas/1#xywh=100,200,300,400');
});

test('a note about a part outside the picture stops the build, saying how big the picture is', async () => {
  const { content, out } = await setup();
  await writeFile(join(content, 'notes.md'), '## [The boat](#xywh=1900,200,300,400)\n');
  await assert.rejects(
    build({ contentDir: content, outDir: out, env: {} }),
    /content\/notes\.md: the note "The boat" is about 1900,200,300,400, which runs off the picture, 2,000 × 1,500 pixels\. Copy its link from "Link to this view" again\./,
  );
});

test('a picture cut into tiles over 2000 pixels across, without the full-size JPEG, still has an icon, a card and a thumbnail', async () => {
  const content = await tempDir('content');
  const out = await tempDir('dist');
  await copyFile(await makeImage(4100, 100), join(content, 'scroll.tif'));
  await writeFile(join(content, 'whatiiif.toml'), '[tiles]\nsize = 2100\n[publish]\nfull = false');
  await writeFile(join(out, 'index.html'), builtPage);
  await build({ contentDir: content, outDir: out, env: {} });
  const manifest = await read(join(out, 'iiif/manifest.json'));
  const html = await readFile(join(out, 'index.html'), 'utf8');
  const fallback = html.match(/<img src="([^"]+)"/)[1];
  for (const url of [manifest.thumbnail[0].id, manifest.items[0].items[0].items[0].body.id, fallback]) {
    await access(join(out, url.replace('http://localhost:4173/', '')));
  }
  await access(join(out, 'icon.png'));
  await access(join(out, 'card.jpg'));
});

test('an empty SITE_BASE_URL counts as none', async () => {
  const { content, out } = await setup();
  await build({ contentDir: content, outDir: out, env: { SITE_BASE_URL: '' } });
  assert.equal((await read(join(out, 'site.json'))).pageUrl, 'http://localhost:4173/');
});

test('a note outside the picture stops the build before the picture is sliced, which can take minutes', async () => {
  const { content, out } = await setup();
  await writeFile(join(content, 'notes.md'), '## [The boat](#xywh=1900,200,300,400)\n');
  const logged = [];
  await assert.rejects(build({ contentDir: content, outDir: out, env: {}, log: (line) => logged.push(line) }), /runs off the picture/);
  assert.deepEqual(logged.filter((line) => line.startsWith('Slicing')), []);
});

test('a photo turned on its side by its camera is measured upright, for its notes as for its tiles', async () => {
  const content = await tempDir('content');
  const out = await tempDir('dist');
  // 300 wide and 200 high as stored, 200 wide and 300 high as seen.
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#808080' } }).jpeg().withMetadata({ orientation: 6 }).toFile(join(content, 'phone.jpg'));
  await writeFile(join(content, 'notes.md'), '## [The top](#xywh=0,250,200,50)\n');
  await build({ contentDir: content, outDir: out, env: {} });
  const { width, height } = await read(join(out, 'site.json'));
  assert.deepEqual({ width, height }, { width: 200, height: 300 });
});

test('the notes helper is given the notes files as written, and where to change them on GitHub and see them built', async () => {
  const { content, out } = await setup();
  const source = 'Look.\n\n## [The boat](#xywh=100,200,300,400)\n\nRed sails.\n';
  await writeFile(join(content, 'notes.md'), source);
  await writeFile(join(content, 'notes.cy.md'), '## Y cwch\n');
  await build({ contentDir: content, outDir: out, env: github });
  const { notes, notesUrl, uploadUrl, actionsUrl } = await read(join(out, 'settings.json'));
  assert.deepEqual(notes, {
    file: 'notes.md',
    language: 'en',
    text: source,
    translations: [{ file: 'notes.cy.md', language: 'cy', text: '## Y cwch\n', url: 'https://github.com/gjh/harbour/edit/main/content/notes.cy.md' }],
  });
  assert.equal(notesUrl, 'https://github.com/gjh/harbour/edit/main/content/notes.md');
  assert.equal(uploadUrl, 'https://github.com/gjh/harbour/upload/main/content', 'several files are changed at once by uploading them');
  assert.equal(actionsUrl, 'https://github.com/gjh/harbour/actions', 'where a build that stopped says why');
});

test('without notes, the notes helper is told where on GitHub to make notes.md', async () => {
  const { content, out } = await setup();
  await build({ contentDir: content, outDir: out, env: github });
  const { notes, notesUrl } = await read(join(out, 'settings.json'));
  assert.equal(notes, undefined);
  assert.equal(notesUrl, 'https://github.com/gjh/harbour/new/main?filename=content/notes.md');
});

test('the page is given the version of WhatIIIF and its address for its footer, unless the footer is switched off', async () => {
  const { content, out } = await setup();
  await build({ contentDir: content, outDir: out, env: github });
  const version = (await readFile(join(repo, 'engine/VERSION'), 'utf8')).trim();
  assert.deepEqual((await read(join(out, 'site.json'))).footer, { version, url: 'https://github.com/gjhilton/WhatIIIF' });
  await writeFile(join(content, 'whatiiif.toml'), '[publish]\nfooter = false\n');
  await build({ contentDir: content, outDir: out, env: github });
  assert.equal((await read(join(out, 'site.json'))).footer, undefined);
});

test('every published page says at the top that WhatIIIF made it, which version, and where WhatIIIF and the site come from', async () => {
  const { content, out } = await setup();
  const pages = ['index.html', 'settings.html', 'notes.html'];
  for (const page of pages) await writeFile(join(out, page), `<!doctype html>\n<html lang="en">${builtPage}</html>\n`);
  await build({ contentDir: content, outDir: out, env: github });
  await build({ contentDir: content, outDir: out, env: github }); // built again, as every push does
  const version = (await readFile(join(repo, 'engine/VERSION'), 'utf8')).trim();
  for (const page of pages) {
    const html = await readFile(join(out, page), 'utf8');
    const [comment] = html.match(/^<!doctype html>\n<!--[\s\S]*?-->\n<html/) ?? [];
    assert.ok(comment, `${page} starts with the comment, after its doctype`);
    assert.ok(comment.includes(`Published with WhatIIIF ${version}\n`), page);
    assert.ok(comment.includes('https://github.com/gjhilton/WhatIIIF\n'), page);
    assert.ok(comment.includes('https://github.com/gjh/harbour\n'), `${page} names the site's own repository`);
    assert.equal(html.match(/Published with WhatIIIF/g).length, 1, `${page} has it once, however often it is built`);
  }
});

test('the comment cannot be ended early by a repository whose name has two hyphens in a row', async () => {
  const { content, out } = await setup();
  await writeFile(join(out, 'index.html'), `<!doctype html>\n<html>${builtPage}</html>`);
  await build({ contentDir: content, outDir: out, env: { ...github, GITHUB_REPOSITORY: 'gjh/harbour--at-dusk' } });
  const [comment] = (await readFile(join(out, 'index.html'), 'utf8')).match(/<!--[\s\S]*?-->/);
  assert.equal(comment.slice(4, -3).includes('--'), false);
  assert.ok(comment.includes('https://github.com/gjh/harbour-%2Dat-dusk'), 'the address still leads there');
});
