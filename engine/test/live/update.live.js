// The Update workflow on real GitHub, as someone using the template meets it: a copy on the previous release, its
// picture published, is offered the latest release as a pull request, and merging that republishes the site.
// Needs two releases. Run by the Live workflow, or by hand with
// `npm run test:live` (see trial.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makePhonePhoto } from '../support/fixtures.js';
import { repo as template, run } from '../support/harness.js';
import { MINUTE, gh, ghJson, poll, trialRepository } from './trial.js';

const upstream = (await readFile(join(template, 'engine/UPSTREAM'), 'utf8')).trim();
const [latest, previous] = await ghJson('release', 'list', '-R', upstream, '--exclude-drafts', '--exclude-pre-releases', '--limit', '2', '--json', 'tagName', '--jq', '[.[].tagName]');
const skip = !previous && `${upstream} has fewer than two releases`;

let trial;
let offer;

before(async () => {
  if (skip) return;
  await run('git', ['fetch', '-q', '--tags'], { cwd: template });
  trial = await trialRepository(previous);
  await trial.switchOnPages();
  // "Allow GitHub Actions to create and approve pull requests", which the README asks people to turn on.
  await gh('api', '-X', 'PUT', `repos/${trial.repository}/actions/permissions/workflow`, '-f', 'default_workflow_permissions=read', '-F', 'can_approve_pull_request_reviews=true');
});
after(() => trial?.remove());

test(`a copy on the previous release (${previous}) publishes its picture`, { skip, timeout: 20 * MINUTE }, async () => {
  const sha = await trial.upload('content/harbour.jpg', await makePhonePhoto());
  assert.equal((await trial.finished(await trial.deployRunFor(sha))).conclusion, 'success');
  await trial.checkSite();
});

test(`the Update workflow offers ${latest} as a pull request that leaves content/ alone`, { skip, timeout: 20 * MINUTE }, async () => {
  await gh('workflow', 'run', 'update.yml', '-R', trial.repository);
  const id = await poll(async () => (await ghJson('run', 'list', '-R', trial.repository, '--workflow', 'Update', '--json', 'databaseId'))[0]?.databaseId, 'Update to start', 5 * MINUTE);
  assert.equal((await trial.finished(id)).conclusion, 'success');

  [offer] = await ghJson('pr', 'list', '-R', trial.repository, '--json', 'number,title,body');
  // Written by the previous release's update.sh, from before the project was called WhatIIIF, or after.
  assert.match(offer?.title ?? '', new RegExp(`^Update (whatiiif|WhatIIIF) to ${latest.replace(/^v/, '').replaceAll('.', '\\.')}$`));
  assert.match(offer.body, /Your `content\/` is untouched/);
  // ci.yml and live.yml run only in the template, so they are not passed on. The wording is the previous release's.
  const workflows = ['.github/workflows', ':!.github/workflows/ci.yml', ':!.github/workflows/live.yml'];
  const workflowsChanged = (await run('git', ['diff', '--quiet', previous, latest, '--', ...workflows], { cwd: template })).code !== 0;
  assert.equal(/Workflow files changed upstream|\*\*Copy by hand:\*\*/.test(offer.body), workflowsChanged, 'the pull request says whether workflow files need copying by hand');
  const files = (await gh('pr', 'diff', String(offer.number), '-R', trial.repository, '--name-only')).split('\n');
  assert.ok(files.includes('engine/VERSION'), files.join(', '));
  assert.deepEqual(files.filter((file) => !file.startsWith('engine/') && !/^package(-lock)?\.json$/.test(file)), []);
});

test(`merging it republishes the site on ${latest}`, { skip, timeout: 20 * MINUTE }, async () => {
  // GitHub works out whether a new pull request can be merged a little after opening it, and refuses until then.
  await poll(async () => (await ghJson('pr', 'view', String(offer.number), '-R', trial.repository, '--json', 'mergeable')).mergeable === 'MERGEABLE',
    'the pull request to be mergeable', 5 * MINUTE);
  await gh('pr', 'merge', String(offer.number), '-R', trial.repository, '--merge');
  const { mergeCommit } = await ghJson('pr', 'view', String(offer.number), '-R', trial.repository, '--json', 'mergeCommit');
  assert.equal((await trial.finished(await trial.deployRunFor(mergeCommit.oid))).conclusion, 'success');
  const version = await gh('api', `repos/${trial.repository}/contents/engine/VERSION`, '--jq', '.content');
  assert.equal(Buffer.from(version, 'base64').toString().trim(), latest.replace(/^v/, ''));
  await trial.checkSite();
});
