// WhatIIIF on real GitHub, the way someone new to it might go about it, in a public repository made from the
// template with "Use this template" and holding this commit of the template, so a change can be tried here before
// it is merged. Run by hand with `npm run test:live` (see trial.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { makePhonePhoto, makeRepeatedNoise } from '../support/fixtures.js';
import { run } from '../support/harness.js';
import { MINUTE, gh, git, poll, trialRepository } from './trial.js';

let trial;
let firstRun;

before(async () => {
  trial = await trialRepository('HEAD');
});
after(() => trial?.remove());

test('a picture uploaded before Pages is switched on fails, saying how to switch it on', { timeout: 20 * MINUTE }, async () => {
  const sha = await trial.upload('content/harbour.jpg', await makePhonePhoto());
  firstRun = await trial.deployRunFor(sha);
  assert.equal((await trial.finished(firstRun)).conclusion, 'failure');
  const messages = (await trial.deployAnnotations(firstRun)).map(([, , message]) => message);
  assert.ok(
    messages.includes("GitHub Pages is not enabled. Go to Settings > Pages and set Source to 'GitHub Actions', then re-run this workflow."),
    `the run's messages were: ${messages.join(' | ')}`,
  );
});

test('after switching Pages on, re-running the failed jobs publishes the site', { timeout: 20 * MINUTE }, async () => {
  await trial.switchOnPages();
  await gh('run', 'rerun', String(firstRun), '-R', trial.repository, '--failed');
  assert.equal((await trial.finished(firstRun, { attempt: 2 })).conclusion, 'success');
  await trial.checkSite();
});

test('a picture too big for the browser goes through Git LFS, and a site near the Pages limit leaves out the full-size JPEG', { timeout: 40 * MINUTE }, async () => {
  // About 776 MB of tiles at quality 100: under the 900 MB budget alone, over it with the full-size JPEG.
  const picture = await makeRepeatedNoise(21_504);
  const file = `Survey sheet ${basename(picture)}`;
  const { work, repository } = trial;
  await git(work, ['pull', '-q', '--ff-only'], { lfs: true });
  await git(work, ['lfs', 'install', '--local'], { lfs: true });
  await git(work, ['rm', '-q', 'content/harbour.jpg']);
  await copyFile(picture, join(work, 'content', file));
  await writeFile(join(work, 'content/whatiiif.toml'), '[tiles]\nquality = 100\n');
  await git(work, ['add', '-A'], { lfs: true });
  await git(work, ['commit', '-q', '-m', 'A bigger picture, through Git LFS'], { lfs: true });
  await git(work, ['push', '-q', 'origin', 'HEAD'], { lfs: true });
  const { stdout: pointer } = await git(work, ['cat-file', '-p', `HEAD:content/${file}`]);
  assert.match(pointer, /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/, 'git holds a pointer, not the picture');

  const { stdout: sha } = await git(work, ['rev-parse', 'HEAD']);
  const id = await trial.deployRunFor(sha.trim());
  assert.equal((await trial.finished(id, { timeout: 35 * MINUTE })).conclusion, 'success');
  // A run's log can take a moment to be available after the run has finished.
  const log = await poll(async () => {
    const { code, stdout } = await run('gh', ['run', 'view', String(id), '-R', repository, '--log']);
    return code === 0 && stdout.includes('Done:') && stdout;
  }, `the log of run ${id}`, 5 * MINUTE);
  // Said at the top of the run's page (the log shows GitHub's rewriting of the command, not the command).
  assert.deepEqual(await trial.deployAnnotations(id), [['warning', 'Worth a look', 'The site would have been too big for GitHub Pages, so the full-size JPEG was left out.']]);
  const megabytes = Number(log.match(/Done: (\d+) MB of IIIF files/)?.[1]);
  assert.ok(megabytes > 700 && megabytes < 900, `the site holds ${megabytes} MB of IIIF files`);

  const site = await (await fetch(`${trial.siteUrl}/site.json`)).json();
  assert.equal(site.fullUrl, undefined, 'no full-size download is offered');
  assert.equal(site.originalUrl, `https://media.githubusercontent.com/media/${repository}/main/content/${encodeURIComponent(file)}`);
  const original = await fetch(site.originalUrl);
  assert.equal(original.ok, true, `the original is downloadable from ${site.originalUrl}`);
  assert.equal((await original.arrayBuffer()).byteLength, (await stat(picture)).size, 'the original is the picture itself, not its pointer');
  await trial.checkSite();
});
