// Shared by the tests on real GitHub, which are run by hand, logged in with gh, before every release and after any
// change to the workflows or what they run (about ten minutes):
//
//   npm run test:live
//
// Each test file makes a public repository from the template for itself and deletes it afterwards if gh may
// (`gh auth refresh -s delete_repo`, once); otherwise it says which repository to delete by hand.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tempDir } from '../support/tmp.js';
import { repo as template, run } from '../support/harness.js';

const exec = promisify(execFile);
export const MINUTE = 60_000;

export async function gh(...args) {
  const result = await run('gh', args);
  if (result.code !== 0) throw new Error(`gh ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
export const ghJson = async (...args) => JSON.parse(await gh(...args));

/** Asks `condition` every ten seconds (GitHub's API has a rate limit) until it gives something truthy. */
export async function poll(condition, what, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

// Git with an identity, pushing as the gh login over HTTPS. Git LFS only where a step asks for it.
const AS_ME = ['-c', 'user.name=WhatIIIF live test', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  '-c', 'commit.gpgsign=false', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
const NO_LFS = ['-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false'];
export const git = (cwd, args, { lfs = false } = {}) =>
  exec('git', [...AS_ME, ...(lfs ? [] : NO_LFS), ...args], { cwd, env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' }, maxBuffer: 64 * 1024 * 1024 });

/**
 * Points a copy's workflows, which call the template's steps at the tag of its major version (v1 for 1.x, the last
 * release), at commit `sha` instead, so a trial runs the steps being tried. GitHub must have that commit.
 */
async function callStepsAt(work, sha, upstream) {
  if ((await run('gh', ['api', `repos/${upstream}/commits/${sha}`, '--silent'])).code !== 0) {
    throw new Error(`Push ${sha} to ${upstream} first: a trial's workflows call the steps kept there, at that commit.`);
  }
  const dir = join(work, '.github/workflows');
  for (const file of await readdir(dir)) {
    const text = await readFile(join(dir, file), 'utf8');
    await writeFile(join(dir, file), text.replace(/(uses: \S+\/\.github\/workflows\/[^@\s]+)@v\d+$/gm, `$1@${sha}`));
  }
}

/**
 * A new public repository made with "Use this template", cloned, with the template's files (everything but
 * content/) replaced by those at `ref` here: HEAD to try this commit, or a release tag to start from that release.
 * Its workflows call the template's steps at `ref` too.
 */
export async function trialRepository(ref = 'HEAD') {
  const owner = await gh('api', 'user', '--jq', '.login');
  const name = `whatiiif-trial-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const repository = `${owner}/${name}`;
  const upstream = (await readFile(join(template, 'engine/UPSTREAM'), 'utf8')).trim();
  await gh('repo', 'create', repository, '--template', upstream, '--public', '--description', 'A short-lived test of WhatIIIF; deleted when the test ends');
  // GitHub copies the template a moment after saying the repository exists.
  await poll(async () => (await run('gh', ['api', `repos/${repository}/contents/engine/VERSION`])).code === 0, 'the template to be copied', 2 * MINUTE);

  const work = join(await tempDir('live'), name);
  await git(template, ['clone', '-q', `https://github.com/${repository}.git`, work]);
  await git(work, ['rm', '-q', '-r', '--', '.', ':!content']);
  const { stdout: top } = await exec('git', ['ls-tree', '--name-only', ref], { cwd: template });
  const entries = top.split('\n').filter((entry) => entry && entry !== 'content');
  await exec('bash', ['-c', 'git archive "$1" -- "${@:2}" | tar -x -C "$0"', work, ref, ...entries], { cwd: template });
  const { stdout: sha } = await exec('git', ['rev-parse', `${ref}^{commit}`], { cwd: template });
  await callStepsAt(work, sha.trim(), upstream);
  await git(work, ['add', '-A']);
  if ((await run('git', ['diff', '--cached', '--quiet'], { cwd: work })).code !== 0) {
    await git(work, ['commit', '-q', '-m', `The template at ${ref}`]);
    await git(work, ['push', '-q', 'origin', 'HEAD']);
  }

  const runFor = (workflow, sha) =>
    poll(async () => (await ghJson('run', 'list', '-R', repository, '--workflow', workflow, '--commit', sha, '--json', 'databaseId'))[0]?.databaseId,
      `${workflow} to start for ${sha}`, 5 * MINUTE);

  return {
    repository,
    work,
    siteUrl: `https://${owner.toLowerCase()}.github.io/${name}`,

    /** The Deploy run GitHub started for a commit. */
    deployRunFor: (sha) => runFor('Deploy', sha),

    /**
     * What a Deploy run put at the top of its page, from its deploy job, as [level, title, message]. The job is
     * "deploy" in a copy whose deploy.yml has the steps itself, as before 0.4.0, and "publish / deploy" in one whose
     * deploy.yml calls publish.yml.
     */
    async deployAnnotations(id) {
      const { jobs } = await ghJson('api', `repos/${repository}/actions/runs/${id}/jobs`);
      const job = jobs.find(({ name }) => name === 'deploy' || name.endsWith(' / deploy'));
      assert.ok(job, `run ${id} has no deploy job, only ${jobs.map(({ name }) => name).join(', ')}`);
      return ghJson('api', `repos/${repository}/check-runs/${job.id}/annotations`, '--jq', '[.[] | [.annotation_level, .title, .message]]');
    },

    /** A run once it has finished, on the given attempt (a re-run is attempt 2). */
    finished: (id, { attempt = 1, timeout = 15 * MINUTE } = {}) =>
      poll(async () => {
        const view = await ghJson('run', 'view', String(id), '-R', repository, '--json', 'status,conclusion,attempt');
        return view.attempt === attempt && view.status === 'completed' && view;
      }, `run ${id} to finish`, timeout),

    /** Switches GitHub Pages on, with GitHub Actions as its source: step 2 of the README. */
    switchOnPages: () => gh('api', '-X', 'POST', `repos/${repository}/pages`, '-f', 'build_type=workflow'),

    /** Adds a file in one commit, as an upload on github.com does; returns the commit. */
    async upload(path, file, message = 'Add files via upload') {
      const request = join(await tempDir('upload'), 'request.json');
      await writeFile(request, JSON.stringify({ message, content: (await readFile(file)).toString('base64') }));
      return (await ghJson('api', '-X', 'PUT', `repos/${repository}/contents/${path}`, '--input', request)).commit.sha;
    },

    /** check-site.js against the live site. */
    async checkSite() {
      const result = await run('node', ['--test', 'engine/test/e2e/check-site.js'], { cwd: template, env: { E2E_SITE_URL: this.siteUrl } });
      assert.equal(result.code, 0, `check-site.js against ${this.siteUrl}:\n${result.stdout}${result.stderr}`);
    },

    /** Deletes the repository if gh may (gh auth refresh -s delete_repo); otherwise says which to delete by hand. */
    async remove() {
      const deleted = await run('gh', ['repo', 'delete', repository, '--yes']);
      if (deleted.code !== 0) console.log(`Delete https://github.com/${repository} by hand: ${deleted.stderr.trim()}`);
    },
  };
}
