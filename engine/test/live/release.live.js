// A picture too big to upload into content/, put in a GitHub release and named by its link in whatiiif.toml, as the
// README's "Large pictures" says, on real GitHub: in a public repository made from the template and holding this
// commit of it. Run by the Live workflow, or by hand with
// `npm run test:live` (see trial.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { tempDir } from '../support/tmp.js';
import { MINUTE, gh, ghJson, git, trialRepository } from './trial.js';

let trial;

before(async () => {
  trial = await trialRepository('HEAD');
  await trial.switchOnPages();
});
after(() => trial?.remove());

test('a picture in a release, linked from whatiiif.toml, is published, and downloads from the release', { timeout: 30 * MINUTE }, async () => {
  // About 50 MB, uncompressed: twice what the browser uploads into content/.
  const picture = join(await tempDir('release'), 'Harbour scan.tif');
  await sharp({ create: { width: 5000, height: 3500, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .tiff({ compression: 'none' })
    .toFile(picture);
  const { size } = await stat(picture);
  assert.ok(size > 25 * 1024 * 1024, `the picture is ${size} bytes`);

  // Steps 1 to 4: a release tagged "picture" holding the file, and the link GitHub gives it.
  await gh('release', 'create', 'picture', picture, '-R', trial.repository, '--title', 'Picture', '--notes', 'The picture for the site.');
  const [asset] = await ghJson('api', `repos/${trial.repository}/releases/tags/picture`, '--jq', '[.assets[] | {name, url: .browser_download_url}]');
  assert.match(asset.url, new RegExp(`^https://github\\.com/${trial.repository}/releases/download/picture/`));

  // Step 5: the link in whatiiif.toml, committed.
  const { work } = trial;
  await git(work, ['pull', '-q', '--ff-only']);
  await writeFile(join(work, 'content/whatiiif.toml'), `picture = "${asset.url}"\n`);
  await git(work, ['commit', '-q', '-am', 'Link to the picture in the release']);
  await git(work, ['push', '-q', 'origin', 'HEAD']);
  const { stdout: sha } = await git(work, ['rev-parse', 'HEAD']);

  const run = await trial.deployRunFor(sha.trim());
  assert.equal((await trial.finished(run, { timeout: 25 * MINUTE })).conclusion, 'success');
  await trial.checkSite();

  const site = await (await fetch(`${trial.siteUrl}/site.json`)).json();
  assert.deepEqual([site.width, site.height], [5000, 3500]);
  assert.deepEqual(site.title, { en: asset.name.replace(/\.tif$/, '') }, 'named after the file in the release');
  assert.deepEqual([site.originalUrl, site.originalFormat, site.originalBytes], [asset.url, 'image/tiff', size]);
  const original = await fetch(site.originalUrl, { method: 'HEAD' });
  assert.equal(original.ok, true, `the original downloads from ${site.originalUrl}`);
});
