// The scripts in engine/ci are what the workflows run, so they are tested by running them. GitHub itself is stood
// in for by a `gh` on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commit, git, repo as template, run, templateCopy } from './support/harness.js';
import { tempDir } from './support/tmp.js';

const read = (path) => readFile(path, 'utf8');
const script = (name) => join(template, 'engine/ci', name);

/**
 * Runs has-image.js in a repository whose content/ holds the given files, each a name or [name, text]; returns what
 * it told the workflow.
 */
async function lookForImage(...files) {
  const repo = await tempDir('repo');
  await mkdir(join(repo, 'content'));
  for (const file of files) {
    const [name, text] = Array.isArray(file) ? file : [file, 'x'];
    await writeFile(join(repo, 'content', name), text);
  }
  const output = join(repo, 'github-output');
  await writeFile(output, '');
  const { stdout } = await run('node', [script('has-image.js')], { cwd: repo, env: { GITHUB_OUTPUT: output } });
  return { output: await read(output), stdout };
}

test('tells the deploy workflow there is nothing to publish while content/ has no image', async () => {
  const { output, stdout } = await lookForImage('whatiiif.toml', '.gitkeep');
  assert.equal(output, 'image=false\n');
  assert.match(stdout, /::notice::.*content\//);
});

test('tells the deploy workflow to go ahead once an image is committed', async () => {
  assert.equal((await lookForImage('whatiiif.toml', 'harbour.tif')).output, 'image=true\n');
});

test('tells the deploy workflow to go ahead when whatiiif.toml names a picture by its link', async () => {
  const settings = 'title = "Harbour"\n  picture = "https://github.com/gjh/harbour/releases/download/picture/scan.tif"\n';
  assert.equal((await lookForImage(['whatiiif.toml', settings])).output, 'image=true\n');
});

test('a picture link that is still commented out is not one', async () => {
  const settings = '# picture = "https://github.com/gjh/harbour/releases/download/picture/scan.tif"\n';
  assert.equal((await lookForImage(['whatiiif.toml', settings])).output, 'image=false\n');
});

test('lets the build run, and explain itself, when the only image is in an unsupported format', async () => {
  assert.equal((await lookForImage('scan.jp2')).output, 'image=true\n');
});

test('has-image.js needs nothing installed: the Deploy workflow runs it before installing any packages', async () => {
  const repo = await tempDir('repo');
  await cp(join(template, 'engine'), join(repo, 'engine'), { recursive: true, filter: (path) => !path.includes('node_modules') });
  await mkdir(join(repo, 'content'));
  await writeFile(join(repo, 'content/harbour.tif'), 'x');
  const result = await run('node', ['engine/ci/has-image.js'], { cwd: repo, env: { GITHUB_OUTPUT: join(repo, 'output') } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await read(join(repo, 'output')), 'image=true\n');
});

/**
 * A `gh` on the PATH that knows one upstream release, held in `upstream`, and writes what it was asked to `log`.
 * With `releaseError`, asking for the latest release fails with that message instead, as the real `gh` does.
 * `open` lists the repository's open pull requests, as `number branch` lines; `createError` is what the real `gh`
 * says when the repository does not let workflows open pull requests.
 */
async function fakeGitHub({ upstream, tag, releaseError, open = '', createError }) {
  const bin = await tempDir('bin');
  const log = join(bin, 'calls');
  const releaseView = releaseError ? `echo "${releaseError}" >&2; exit 1` : `echo "${tag}"`;
  const body = `while [ $# -gt 0 ]; do [ "$1" = --body ] && printf '%s' "$2" > "${log}.body"; shift; done`;
  const create = createError ? `echo "${createError}" >&2; exit 1` : `${body}; echo https://github.com/someone/their-image/pull/9`;
  await writeFile(
    join(bin, 'gh'),
    `#!/bin/bash
echo "$*" >> "${log}"
case "$1 $2" in
  "release view") ${releaseView} ;;
  "api repos/example/whatiiif/tarball/${tag}") tar -czf - -C "${upstream}/.." --exclude .git --exclude node_modules "$(basename "${upstream}")" ;;
  "pr list") printf '${open}' ;;
  "pr create") ${create} ;;
  "pr edit") ${body} ;;
  "pr close") ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
  );
  await chmod(join(bin, 'gh'), 0o755);
  await writeFile(log, '');
  return { bin, calls: () => read(log), body: () => read(`${log}.body`) };
}

/** A copy of the template that updates from example/whatiiif, on `version` if given. */
async function userCopy(version) {
  const user = await templateCopy();
  await writeFile(join(user, 'engine/UPSTREAM'), 'example/whatiiif\n');
  if (version) await writeFile(join(user, 'engine/VERSION'), `${version}\n`);
  await commit(user, 'Point at upstream');
  return user;
}

/** Upstream on `version`, with whatever else `change` does to it. */
async function release(version, change = async () => {}) {
  const upstream = await templateCopy();
  await writeFile(join(upstream, 'engine/VERSION'), `${version}\n`);
  await change(upstream);
  await commit(upstream, `Release ${version}`);
  return upstream;
}

// GITHUB_REF_NAME is what GitHub sets for the run that runs these tests (9/merge, for a pull request): the script
// must link to the branch it updates, which it has checked out, whatever that says.
const update = (cwd, gh, repository = 'someone/their-image') =>
  run('bash', ['engine/ci/update.sh'], { cwd, env: { PATH: `${gh.bin}:${process.env.PATH}`, GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: '9/merge' } });

test('a newer release replaces the engine on a branch, leaves content/ alone and opens a pull request', async () => {
  // Upstream has moved on: a new version, a change inside the engine, a file gone, and a workflow edited.
  const upstream = await release('9.9.9', async (dir) => {
    await writeFile(join(dir, 'engine/lib/new-in-999.js'), 'export const added = true;\n');
    await git(dir, ['rm', '-q', 'engine/lib/budget.js']);
    await writeFile(join(dir, '.github/workflows/deploy.yml'), `${await read(join(dir, '.github/workflows/deploy.yml'))}# changed upstream\n`);
  });

  // The user is on the old release, has their own image and settings, and pushes to their own remote.
  const user = await userCopy();
  await writeFile(join(user, 'content/harbour.jpg'), 'my image');
  await writeFile(join(user, 'content/whatiiif.toml'), 'title = "Mine"\n');
  await commit(user, 'My image');
  const origin = await tempDir('origin');
  await git(origin, ['init', '-q', '--bare']);
  await git(user, ['remote', 'add', 'origin', origin]);
  const oldVersion = (await read(join(user, 'engine/VERSION'))).trim();

  const gh = await fakeGitHub({ upstream, tag: 'v9.9.9' });
  const result = await update(user, gh);
  assert.equal(result.code, 0, result.stderr);

  // The branch that was pushed holds the new engine and the user's untouched content.
  const show = async (path) => (await git(origin, ['show', `whatiiif-update-9.9.9:${path}`])).stdout;
  assert.equal(await show('engine/VERSION'), '9.9.9\n');
  assert.equal(await show('engine/lib/new-in-999.js'), 'export const added = true;\n');
  await assert.rejects(show('engine/lib/budget.js'), 'a file removed upstream is removed here too');
  assert.equal(await show('content/harbour.jpg'), 'my image');
  assert.equal(await show('content/whatiiif.toml'), 'title = "Mine"\n');
  // Workflow files cannot be changed by the workflow's token, so they must stay as they were...
  assert.doesNotMatch(await show('.github/workflows/deploy.yml'), /changed upstream/);

  // ...and the pull request has to say so, linking each file to copy and the place to paste it.
  assert.match(await gh.calls(), /pr create --title Update WhatIIIF to 9\.9\.9/);
  const body = await gh.body();
  assert.match(body, new RegExp(`from \\*\\*example/whatiiif\\*\\* ${oldVersion.replaceAll('.', '\\.')} → 9\\.9\\.9`));
  assert.match(body, /Your `content\/` is untouched/);
  assert.match(body, /\*\*Copy by hand:\*\* GitHub does not let this automation change workflow files/);
  assert.match(
    body,
    /- `deploy\.yml`: open \[the new version\]\(https:\/\/github\.com\/example\/whatiiif\/blob\/v9\.9\.9\/\.github\/workflows\/deploy\.yml\), copy all of it, and paste it over \[yours\]\(https:\/\/github\.com\/someone\/their-image\/edit\/main\/\.github\/workflows\/deploy\.yml\)\./,
  );
  assert.doesNotMatch(body, /update\.yml/, 'only the files that changed');
});

test('a workflow added upstream is linked to the page that creates it', async () => {
  const upstream = await release('9.9.9', async (dir) => {
    await writeFile(join(dir, '.github/workflows/tidy.yml'), 'name: Tidy\n');
  });
  const user = await userCopy();
  const origin = await tempDir('origin');
  await git(origin, ['init', '-q', '--bare']);
  await git(user, ['remote', 'add', 'origin', origin]);
  const gh = await fakeGitHub({ upstream, tag: 'v9.9.9' });
  assert.equal((await update(user, gh)).code, 0);
  assert.match(
    await gh.body(),
    /- `tidy\.yml` \(new\): open \[the new version\]\(https:\/\/github\.com\/example\/whatiiif\/blob\/v9\.9\.9\/\.github\/workflows\/tidy\.yml\), copy all of it, and paste it into \[a new file\]\(https:\/\/github\.com\/someone\/their-image\/new\/main\?filename=\.github\/workflows\/tidy\.yml\)\./,
  );
});

/** A user's copy, with a remote to push to, and an upstream that has released 9.9.9. */
async function readyToUpdate() {
  const upstream = await release('9.9.9');
  const user = await userCopy();
  const origin = await tempDir('origin');
  await git(origin, ['init', '-q', '--bare']);
  await git(user, ['remote', 'add', 'origin', origin]);
  return { upstream, user, origin };
}

test('an update that replaces an older one still open closes that one, so the two cannot clash', async () => {
  const { upstream, user } = await readyToUpdate();
  const gh = await fakeGitHub({ upstream, tag: 'v9.9.9', open: '4 whatiiif-update-9.9.8\\n7 my-own-branch\\n' });
  assert.equal((await update(user, gh)).code, 0);
  const calls = await gh.calls();
  assert.match(calls, /pr create/);
  assert.match(calls, /^pr close 4 --delete-branch --comment Replaced by https:\/\/github\.com\/someone\/their-image\/pull\/9, which updates to 9\.9\.9\.$/m);
  assert.doesNotMatch(calls, /pr close 7/, 'pull requests that are not updates are left alone');
});

test('an update already offered is brought up to date rather than offered twice', async () => {
  const { upstream, user } = await readyToUpdate();
  const gh = await fakeGitHub({ upstream, tag: 'v9.9.9', open: '5 whatiiif-update-9.9.9\\n' });
  assert.equal((await update(user, gh)).code, 0);
  const calls = await gh.calls();
  assert.match(calls, /^pr edit 5 --body /m);
  assert.doesNotMatch(calls, /pr create|pr close/);
});

test('when the repository does not let workflows open pull requests, the run fails and says how to allow it', async () => {
  const { upstream, user, origin } = await readyToUpdate();
  const createError = 'pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)';
  const gh = await fakeGitHub({ upstream, tag: 'v9.9.9', createError });
  const result = await update(user, gh);
  assert.notEqual(result.code, 0);
  assert.match(
    result.stdout,
    /^::error title=Update 9\.9\.9 is ready but could not be offered::.*Settings → Actions → General.*Allow GitHub Actions to create and approve pull requests.*https:\/\/github\.com\/someone\/their-image\/compare\/main\.\.\.whatiiif-update-9\.9\.9\?expand=1/m,
  );
  assert.equal((await git(origin, ['show', 'whatiiif-update-9.9.9:engine/VERSION'])).stdout, '9.9.9\n', 'the update is pushed, ready to be offered');
});

test('changes to workflows that only run in the template itself are not passed on as work to do', async () => {
  const upstream = await release('9.9.9', async (dir) => {
    for (const file of ['ci.yml', 'live.yml', 'publish.yml', 'offer-update.yml', 'release.yml']) {
      await writeFile(join(dir, '.github/workflows', file), `${await read(join(dir, '.github/workflows', file))}# changed upstream\n`);
    }
    await writeFile(join(dir, '.github/workflows/tidy.yml'), '# whatiiif: template only. Copies call this one; they need no copy of it.\nname: Tidy\n');
  });
  const user = await userCopy();
  const origin = await tempDir('origin');
  await git(origin, ['init', '-q', '--bare']);
  await git(user, ['remote', 'add', 'origin', origin]);

  const gh = await fakeGitHub({ upstream, tag: 'v9.9.9' });
  const result = await update(user, gh);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(await gh.body(), /Copy by hand/);
});

const leftAlone = async (user, gh) => {
  assert.doesNotMatch(await gh.calls(), /pr (create|edit|close)|tarball/);
  assert.equal((await git(user, ['branch', '--list', 'whatiiif-update-*'])).stdout, '');
};

test('a repository already on the latest release is left alone', async () => {
  const user = await userCopy('0.2.1');
  const gh = await fakeGitHub({ upstream: user, tag: 'v0.2.1' });
  const result = await update(user, gh);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Already on the latest release \(0\.2\.1\)/);
  await leftAlone(user, gh);
});

test('a repository newer than the latest release, made from the template between releases, is not offered a downgrade', async () => {
  const user = await userCopy('0.10.0');
  const gh = await fakeGitHub({ upstream: user, tag: 'v0.9.1' });
  const result = await update(user, gh);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /0\.10\.0 is newer than the latest release \(0\.9\.1\), so there is nothing to update to/);
  await leftAlone(user, gh);
});

test('a copy made while the template was on a pre-release is offered the full release that follows it', async () => {
  const user = await userCopy('1.2.0-rc.1');
  const origin = await tempDir('origin');
  await git(origin, ['init', '-q', '--bare']);
  await git(user, ['remote', 'add', 'origin', origin]);
  const upstream = await release('1.2.0');
  const gh = await fakeGitHub({ upstream, tag: 'v1.2.0' });
  const result = await update(user, gh);

  assert.equal(result.code, 0, result.stderr);
  assert.match(await gh.calls(), /^pr create/m);
  assert.match(await gh.body(), /1\.2\.0-rc\.1 → 1\.2\.0/);
});

test('a template that has not published a release yet is left alone, and that is not a failure', async () => {
  const user = await userCopy();
  // What the real gh says, word for word, when a repository has no releases.
  const gh = await fakeGitHub({ releaseError: 'release not found' });
  const result = await update(user, gh);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /example\/whatiiif has not published a release yet, so there is nothing to update to\./);
  await leftAlone(user, gh);
});

test('when GitHub cannot say what the latest release is, the update fails and passes on why', async () => {
  const user = await userCopy();
  const gh = await fakeGitHub({ releaseError: 'HTTP 502: Bad Gateway (https://api.github.com/repos/example/whatiiif/releases/latest)' });
  const result = await update(user, gh);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /HTTP 502: Bad Gateway/);
  await leftAlone(user, gh);
});

test('the update workflow does nothing, successfully, in the template repository itself', async () => {
  const user = await userCopy();
  const gh = await fakeGitHub({ releaseError: 'any call to gh means the script went looking for a release' });
  const result = await update(user, gh, 'example/whatiiif');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await gh.calls(), '');
});

// A copy's own workflows call the steps kept in the template's repository, so the steps improve without anyone
// copying a workflow file by hand. Read as text: the template has no YAML parser, and these lines are the contract.
const workflow = (name) => read(join(template, '.github/workflows', name));
/** A job of a workflow, as text: the lines under its name. */
const job = (text, name) => text.slice(text.indexOf('\njobs:')).match(new RegExp(`\\n {2}${name}:\\n((?: {4}.*\\n|\\n)+)`))?.[1] ?? '';

test("a copy's Deploy and Update workflows call the template's, by the repository named in engine/UPSTREAM, at the tag of its version's major", async () => {
  const upstream = (await read(join(template, 'engine/UPSTREAM'))).trim();
  // A copy made from the template is all one version: on 1.x, its workflows call the steps at v1, as its engine is 1.x.
  const major = `v${(await read(join(template, 'engine/VERSION'))).trim().split('.')[0]}`;
  for (const [caller, called] of [['deploy.yml', 'publish.yml'], ['update.yml', 'offer-update.yml']]) {
    const text = await workflow(caller);
    assert.match(text, new RegExp(`uses: ${upstream}/\\.github/workflows/${called.replace('.', '\\.')}@${major}\\n\\s+secrets: inherit`), caller);
    assert.doesNotMatch(text, /template only/, `${caller} is copied`);
    assert.match(await workflow(called), /^# whatiiif: template only\./, `${called} is not`);
    assert.match(await workflow(called), /\n {2}workflow_call:/, `${called} is called`);
  }
});

test('the steps copies call still run the scripts at the paths copies have always had', async () => {
  const publish = await workflow('publish.yml');
  assert.match(publish, /run: node engine\/ci\/has-image\.js/);
  assert.match(publish, /run: engine\/ci\/build\.sh/);
  assert.match(publish, /node-version-file: engine\/\.node-version/);
  assert.match(await workflow('offer-update.yml'), /run: engine\/ci\/update\.sh/);
});

test('a release made by hand moves the tag of its major version, which copies call, by the rule a merged one does, and only in the template', async () => {
  const text = await workflow('release.yml');
  assert.match(text, /^# whatiiif: template only\./);
  assert.doesNotMatch(text, /\bv0\b/, 'copies call the steps at the tag of their major version, v1 for 1.x');
  // A pre-release is for trying out: copies keep running the last full release.
  assert.match(text, /if: github\.event\.repository\.is_template && !github\.event\.release\.prerelease/);
  assert.match(text, /run: bash \.github\/release\.sh point "\$TAG"/);
  assert.match(text, /TAG: \$\{\{ github\.event\.release\.tag_name \}\}/);
  assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(text, /git tag -f/, 'the rule is release.sh’s alone');
});

test('packages are kept up to date in the template only, and checked before they are offered', async () => {
  const text = await workflow('dependencies.yml');
  assert.match(text, /^# whatiiif: template only\./);
  assert.match(text, /if: github\.event\.repository\.is_template/);
  assert.match(text, /^\s+npm update$/m);
  const [tested, offered] = [text.indexOf('npm run test:e2e'), text.indexOf('gh pr create')];
  assert.ok(tested > 0 && offered > tested, 'the tests pass before the pull request is opened');
  // A dependabot.yml would be copied into every site made from the template, and open pull requests there for
  // packages its Update workflow looks after.
  await assert.rejects(read(join(template, '.github/dependabot.yml')));
});

test("once both demos are up, the README's screenshots of them are remade on a Mac and committed if they changed", async () => {
  const text = await workflow('live.yml');
  const job = text.slice(text.indexOf('\n  screenshots:'));
  assert.match(job, /needs: demo/);
  assert.match(job, /runs-on: macos-/);
  assert.match(job, /node engine\/test\/support\/readme-screenshots\.js/);
  assert.match(job, /contents: write/);
  assert.match(job, /git push -q origin HEAD:main/);
});

test('the screenshots, pushed straight to main, pass the Version check main requires of every commit, which GitHub runs for no push a workflow makes', async () => {
  const job = (await workflow('live.yml')).slice((await workflow('live.yml')).indexOf('\n  screenshots:'));
  assert.match(job, /^ {6}statuses: write\b/m);
  const steps = ['bash .github/release.sh check origin/main', 'git push -q -f origin HEAD:refs/heads/readme-screenshots', '-f context=version', 'git push -q origin HEAD:main'];
  const at = steps.map((step) => job.indexOf(step));
  assert.ok(at.every((where, i) => where > 0 && (i === 0 || where > at[i - 1])), `checked, its commit given to GitHub, marked as checked, then pushed: ${at}`);
  assert.match(job, /git push -q origin :refs\/heads\/readme-screenshots/, 'the branch it was given on is gone again');
});

/**
 * A demo made from the template, as a bare repository holding only its picture, and a `gh` that answers for its
 * Deploy run: watching it is cut off by the network the first time, while the run goes on; watched again, it
 * ends in `conclusion`.
 */
async function demoToDeploy(conclusion) {
  const demo = await tempDir('demo');
  await git(demo, ['init', '-q', '--bare']);
  const seed = await tempDir('seed');
  await git(seed, ['init', '-q']);
  await mkdir(join(seed, 'content'));
  await writeFile(join(seed, 'content/picture.png'), 'a picture');
  await commit(seed, 'The demo');
  await git(seed, ['push', '-q', demo, 'HEAD']);
  const bin = await tempDir('bin');
  const log = join(bin, 'calls');
  await writeFile(
    join(bin, 'gh'),
    `#!/bin/bash
echo "$*" >> "${log}"
case "$1 $2" in
  "run list") echo 42 ;;
  "run watch") if [ ! -e "${log}.cut" ]; then touch "${log}.cut"; echo 'read: connection reset by peer' >&2; exit 1; fi; touch "${log}.ended" ;;
  "run view") if [ -e "${log}.ended" ]; then echo ${conclusion}; else echo; fi ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
  );
  await chmod(join(bin, 'gh'), 0o755);
  const cwd = await templateCopy();
  const result = await run('bash', ['engine/test/live/deploy-demo.sh', 'someone/demo'], { cwd, env: { PATH: `${bin}:${process.env.PATH}`, DEMO_GIT_URL: demo } });
  return { ...result, demo, calls: await read(log) };
}

test("a demo's Deploy is judged by how its run ended, not by a watch of it that the network cut off", async () => {
  const deployed = await demoToDeploy('success');
  assert.equal(deployed.code, 0, deployed.stderr);
  assert.equal(deployed.stdout.trim().split('\n').at(-1), 'https://someone.github.io/demo/');
  // The demo is as a site made from the template now is: its workflows call the steps at the tag they name.
  for (const file of ['deploy.yml', 'update.yml']) {
    const shown = (await git(deployed.demo, ['show', `HEAD:.github/workflows/${file}`])).stdout;
    assert.equal(shown, await workflow(file), `${file} as the template has it`);
  }
  assert.match(deployed.calls, /run watch 42[^\n]*\n(?:.*\n)*run watch 42/, 'watched again once cut off');

  const failed = await demoToDeploy('failure');
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /someone\/demo's Deploy ended in failure: https:\/\/github\.com\/someone\/demo\/actions\/runs\/42/);
});

test('main is production: Live runs on every push to main, whatever changed, so the demos have it within minutes', async () => {
  const text = await workflow('live.yml');
  assert.match(text, /\n {2}push:\n {4}branches: \[main\]\n {2}\S/);
  assert.doesNotMatch(text, /\n {4}paths:/);
});

// Releasing: the version in engine/VERSION is the one thing anyone changes (.github/release.sh). A pull request that
// changes what sites get raises it; merging that releases it; and Live fails if main ever gets ahead of a release.
const releaseScript = join(template, '.github/release.sh');

/** The package files of a template built with sharp, and developed with typescript, at those versions. */
const packages = (dir, { sharp = '0.34.1', typescript = '5.9.0' } = {}) =>
  Promise.all([
    writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'whatiiif', dependencies: { sharp: '^0.34.0' }, devDependencies: { typescript: `^${typescript}` } }, null, 2)),
    writeFile(
      join(dir, 'package-lock.json'),
      JSON.stringify(
        {
          name: 'whatiiif',
          lockfileVersion: 3,
          packages: {
            '': { name: 'whatiiif', dependencies: { sharp: '^0.34.0' }, devDependencies: { typescript: `^${typescript}` } },
            'node_modules/sharp': { version: sharp },
            'node_modules/typescript': { version: typescript, dev: true },
          },
        },
        null,
        2,
      ),
    ),
  ]);

/**
 * A repository like this one, released at 1.1.0 (tagged v1.1.0, with v1 and v0 too, and a GitHub release), its origin
 * a bare repository, and a `gh` that makes releases there and says which pull request brought a commit to main: by
 * default, one merged with a merge commit, the commit itself. `pulls(sha, [pull(…)])` gives another answer for a
 * commit, `apiFails()` makes every answer an error, and `releaseMade(tag)` makes a GitHub release for a tag without
 * its tag. `change` makes main's next commit. The script runs as on main, whatever the run of these tests is on.
 */
async function released(change = async () => {}, scriptEnv = {}) {
  const origin = await tempDir('origin');
  await git(origin, ['init', '-q', '--bare']);
  const here = await tempDir('here');
  await git(here, ['init', '-q']);
  await mkdir(join(here, 'engine/lib'), { recursive: true });
  await mkdir(join(here, 'engine/test'), { recursive: true });
  await writeFile(join(here, 'engine/VERSION'), '1.1.0\n');
  await writeFile(join(here, 'engine/lib/build.js'), 'build\n');
  await writeFile(join(here, 'README.md'), 'Read me.\n');
  await packages(here);
  await commit(here, '1.1.0');
  for (const tag of ['v1.1.0', 'v1']) await git(here, ['tag', tag]);
  await git(here, ['tag', 'v0', 'HEAD']);
  await git(here, ['remote', 'add', 'origin', origin]);
  await git(here, ['push', '-q', 'origin', 'HEAD:refs/heads/main', '--tags']);
  const base = (await git(here, ['rev-parse', 'HEAD'])).stdout.trim();
  await change(here);
  await commit(here, 'main');
  const bin = await tempDir('bin');
  const log = join(bin, 'calls');
  await mkdir(join(bin, 'pulls'));
  await writeFile(join(bin, 'pull.json'), JSON.stringify([pull({ merge_commit_sha: '@SHA@' })]));
  await writeFile(join(bin, 'releases'), 'v1.1.0\n');
  await writeFile(
    join(bin, 'gh'),
    `#!/bin/bash
echo "$*" >> "${log}"
case "$1 $2" in
  "api repos/someone/whatiiif/commits/"*)
    [ -e "${bin}/api-fails" ] && { echo 'HTTP 403: Resource not accessible by integration' >&2; exit 1; }
    sha=\${2#repos/someone/whatiiif/commits/}; sha=\${sha%/pulls}
    if [ -e "${bin}/pulls/$sha" ]; then cat "${bin}/pulls/$sha"; else sed "s/@SHA@/$sha/" "${bin}/pull.json"; fi ;;
  "release view")
    grep -qx "$3" "${bin}/releases" && { echo "$3"; exit 0; }
    echo 'release not found' >&2; exit 1 ;;
  "release create")
    tag=$3; target=; notes=
    while [ $# -gt 0 ]; do case "$1" in --target) target=$2 ;; --notes-file) notes=$2 ;; esac; shift; done
    [ -n "$notes" ] && cp "$notes" "${log}.notes"
    git ls-remote --exit-code --tags origin "refs/tags/$tag" > /dev/null || git push -q origin "$target:refs/tags/$tag"
    echo "$tag" >> "${bin}/releases" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
  );
  await chmod(join(bin, 'gh'), 0o755);
  await writeFile(log, '');
  const script = (...args) =>
    run('bash', [releaseScript, ...args], {
      cwd: here,
      env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'someone/whatiiif', GITHUB_REF: 'refs/heads/main', ...scriptEnv },
    });
  const tagged = async (tag) => (await run('git', ['rev-parse', '-q', '--verify', `${tag}^{commit}`], { cwd: origin })).stdout.trim();
  return {
    here,
    bin,
    base,
    script,
    tagged,
    head: (await git(here, ['rev-parse', 'HEAD'])).stdout.trim(),
    calls: () => read(log),
    notes: () => read(`${log}.notes`),
    pulls: (sha, list) => writeFile(join(bin, 'pulls', sha), JSON.stringify(list)),
    apiFails: () => writeFile(join(bin, 'api-fails'), ''),
    releaseMade: async (tag) => writeFile(join(bin, 'releases'), `${await read(join(bin, 'releases'))}${tag}\n`),
  };
}
/** A pull request merged into main, as GitHub's API gives one, its description written for the people who use WhatIIIF. */
const pull = (fields) => ({
  number: 7,
  merged_at: '2026-10-16T00:00:00Z',
  base: { ref: 'main' },
  user: { login: 'someone', type: 'User' },
  body: '## For you\n\nA new thing.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ...fields,
});
const raise = (version) => (dir) => writeFile(join(dir, 'engine/VERSION'), `${version}\n`);
const changeSites = (dir) => writeFile(join(dir, 'engine/lib/build.js'), 'better build\n');
const sha = async (dir, rev) => (await git(dir, ['rev-parse', rev])).stdout.trim();

test('a pull request that changes what sites get must raise engine/VERSION; one that does not, need not', async () => {
  const unraised = await released(changeSites);
  const refused = await unraised.script('check', unraised.base);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /::error title=Raise engine\/VERSION::This changes what sites get \(engine\/lib\/build\.js\), so it is a new version: raise engine\/VERSION above 1\.1\.0/);

  for (const [what, change] of [
    ['the README', (dir) => writeFile(join(dir, 'README.md'), 'Read me again.\n')],
    ['a test', (dir) => writeFile(join(dir, 'engine/test/a.test.js'), 'test\n')],
  ]) {
    const docs = await released(change);
    assert.equal((await docs.script('check', docs.base)).code, 0, what);
  }

  const raised = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
  });
  const passed = await raised.script('check', raised.base);
  assert.equal(passed.code, 0, passed.stdout);
  assert.match(passed.stdout, /Merging this releases 1\.2\.0\./);

  // Run by hand before committing, it reads every file as it is, engine/VERSION too.
  const uncommitted = await released((dir) => writeFile(join(dir, 'README.md'), 'Read me again.\n'));
  await changeSites(uncommitted.here);
  await raise('1.2.0')(uncommitted.here);
  const before = await uncommitted.script('check', uncommitted.base);
  assert.equal(before.code, 0, before.stdout);
  assert.match(before.stdout, /Merging this releases 1\.2\.0\./);

  const lowered = await released(raise('1.0.9'));
  const backwards = await lowered.script('check', lowered.base);
  assert.equal(backwards.code, 1);
  assert.match(backwards.stdout, /::error title=engine\/VERSION must go up::1\.0\.9 is not above 1\.1\.0/);

  for (const [from, to] of [['1.2.0-rc.1', '1.2.0'], ['1.9.0', '1.10.0'], ['1.2.0-rc.1', '1.2.0-rc.2']]) {
    const promoted = await released(async (dir) => {
      await raise(from)(dir);
      await commit(dir, from);
      await git(dir, ['tag', `v${from}`]);
      await raise(to)(dir);
    });
    const base = (await git(promoted.here, ['rev-parse', 'HEAD~1'])).stdout.trim();
    const passed = await promoted.script('check', base);
    assert.equal(passed.code, 0, `${from} to ${to}: ${passed.stdout}`);
  }

  for (const odd of ['1.2', 'v1.2.0', '1.2.0.0', 'one']) {
    const malformed = await released(raise(odd));
    const refused = await malformed.script('check', malformed.base);
    assert.equal(refused.code, 1, odd);
    assert.match(refused.stdout, /::error title=engine\/VERSION is not a version::/, odd);
  }
});

test('what a site made from the template starts with is part of its version: its settings file and .gitignore too', async () => {
  for (const [file, text] of [['content/whatiiif.toml', '# title = "Your picture"\n'], ['.gitignore', 'node_modules/\n']]) {
    const changed = await released(async (dir) => {
      await mkdir(join(dir, 'content'), { recursive: true });
      await writeFile(join(dir, file), text);
    });
    const refused = await changed.script('check', changed.base);
    assert.equal(refused.code, 1, file);
    assert.match(refused.stdout, new RegExp(`This changes what sites get \\(${file.replace('.', '\\.')}\\)`), file);
  }
});

test('the packages sites install are part of their version; those only for developing WhatIIIF, which sites never install, are not', async () => {
  const developing = await released((dir) => packages(dir, { typescript: '5.9.3' }));
  const fine = await developing.script('check', developing.base);
  assert.equal(fine.code, 0, fine.stdout);
  assert.match(fine.stdout, /Nothing sites get changes/);

  const building = await released((dir) => packages(dir, { sharp: '0.34.2' }));
  const refused = await building.script('check', building.base);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /This changes what sites get \(package-lock\.json\)/);
});

test('the next patch version, which the weekly package update raises engine/VERSION to, of a release and of a pre-release', async () => {
  for (const [now, next] of [['1.4.0', '1.4.1'], ['1.9.9', '1.9.10'], ['1.2.0-rc.1', '1.2.0-rc.2'], ['1.2.0-beta', '1.2.0-beta.1']]) {
    const at = await released(raise(now));
    const result = await at.script('next');
    assert.equal(result.code, 0, `${now}: ${result.stderr}`);
    assert.equal(result.stdout, `${next}\n`, now);
  }
});

test('merging a new engine/VERSION releases it: the tag, the GitHub release with the pull request’s words, and v1, which sites call', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
  });
  const result = await merged.script('release');
  assert.equal(result.code, 0, result.stderr);
  assert.match(await merged.calls(), new RegExp(`^release create v1\\.2\\.0 --target ${merged.head} --title WhatIIIF 1\\.2\\.0 --notes-file `, 'm'));
  assert.equal(await merged.notes(), '## For you\n\nA new thing.\n\n', 'the pull request’s description, without its tool line');
  assert.equal(await merged.tagged('v1.2.0'), merged.head);
  assert.equal(await merged.tagged('v1'), merged.head);
  assert.equal(await merged.tagged('v0'), merged.base, 'another major version’s tag is left alone');

  const again = await merged.script('release');
  assert.equal(again.code, 0);
  assert.match(again.stdout, /1\.2\.0 is released already\./);
  assert.equal((await merged.calls()).match(/release create/g).length, 1, 'released once');
});

test('versions merged one after another are each released, at the commit that made them, however few Live runs there were', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
    await commit(dir, '1.2.0');
    await writeFile(join(dir, 'engine/lib/build.js'), 'better still\n');
    await raise('1.3.0')(dir);
  });
  const first = (await git(merged.here, ['rev-parse', 'HEAD~1'])).stdout.trim();
  assert.equal((await merged.script('release')).code, 0);
  assert.equal(await merged.tagged('v1.2.0'), first);
  assert.equal(await merged.tagged('v1.3.0'), merged.head);
  assert.equal(await merged.tagged('v1'), merged.head);
});

test('a full release followed in the same Live run by a pre-release still moves v1 to the full release', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
    await commit(dir, '1.2.0');
    await raise('1.3.0-rc.1')(dir);
  });
  const full = (await git(merged.here, ['rev-parse', 'HEAD~1'])).stdout.trim();
  assert.equal((await merged.script('release')).code, 0);
  assert.equal(await merged.tagged('v1.2.0'), full);
  assert.equal(await merged.tagged('v1.3.0-rc.1'), merged.head);
  assert.equal(await merged.tagged('v1'), full);
});

test('a major version’s tag already on a later release is never moved back', async () => {
  const merged = await released(raise('1.2.0'));
  await raise('1.3.0')(merged.here);
  await commit(merged.here, '1.3.0, released by hand');
  await git(merged.here, ['push', '-q', '-f', 'origin', 'HEAD:refs/tags/v1']);
  const later = (await git(merged.here, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(merged.here, ['reset', '-q', '--hard', 'HEAD~1']);
  assert.equal((await merged.script('release')).code, 0);
  assert.equal(await merged.tagged('v1.2.0'), merged.head);
  assert.equal(await merged.tagged('v1'), later);
});

test('a release left half made, its tag made but v1 not moved, is finished when Live runs again', async () => {
  const merged = await released(raise('1.2.0'));
  await git(merged.here, ['push', '-q', 'origin', 'HEAD:refs/tags/v1.2.0']); // released, but v1 left behind
  await merged.releaseMade('v1.2.0');
  assert.equal((await merged.script('release')).code, 0);
  assert.equal(await merged.tagged('v1'), merged.head);
  assert.doesNotMatch(await merged.calls(), /release create/, 'not released twice');
});

test('a version tagged without a GitHub release, which copies would never be offered, is given its release', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
  });
  await git(merged.here, ['push', '-q', 'origin', 'HEAD:refs/tags/v1.2.0']); // as by hand: a tag, and nothing more
  const tagOnly = await merged.script('released');
  assert.equal(tagOnly.code, 1);
  assert.match(tagOnly.stdout, /::error title=1\.2\.0 is not released::/);

  assert.equal((await merged.script('release')).code, 0);
  assert.match(await merged.calls(), /^release create v1\.2\.0 /m);
  assert.equal(await merged.tagged('v1.2.0'), merged.head);
  assert.equal(await merged.tagged('v1'), merged.head);
  const fine = await merged.script('released');
  assert.equal(fine.code, 0, fine.stdout);
});

test('a pull request merged by rebasing is released at its last commit: not the one that raised engine/VERSION, nor the next pull request’s', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
    await commit(dir, 'Raise engine/VERSION');
    await writeFile(join(dir, 'engine/lib/build.js'), 'better build, after review\n');
    await commit(dir, 'After review');
    // The next pull request, merged before Live ran: a change, then its own new version.
    await writeFile(join(dir, 'engine/lib/build.js'), 'the next pull request\n');
    await commit(dir, 'The next pull request');
    await raise('1.3.0')(dir);
  });
  // GitHub names the commit main was moved to as the pull request's merge commit, whichever way it was merged.
  const last = await sha(merged.here, 'HEAD~2');
  await merged.pulls(await sha(merged.here, 'HEAD~3'), [pull({ merge_commit_sha: last })]);
  assert.equal((await merged.script('release')).code, 0);
  assert.equal(await merged.tagged('v1.2.0'), last);
  assert.equal(await merged.tagged('v1.3.0'), merged.head);
  assert.equal(await merged.tagged('v1'), merged.head);
  const fine = await merged.script('released');
  assert.equal(fine.code, 0, fine.stdout);
});

test('a version pushed to main with no pull request is released at main’s latest commit, with GitHub’s own notes', async () => {
  const pushed = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
    await commit(dir, 'Raise engine/VERSION');
    await writeFile(join(dir, 'engine/lib/build.js'), 'better build, pushed after\n');
  });
  await pushed.pulls(await sha(pushed.here, 'HEAD~1'), []);
  assert.equal((await pushed.script('release')).code, 0);
  assert.match(await pushed.calls(), new RegExp(`^release create v1\\.2\\.0 --target ${pushed.head} --title WhatIIIF 1\\.2\\.0 --generate-notes$`, 'm'));
  assert.equal(await pushed.tagged('v1'), pushed.head);
});

test('a release’s words are those of the pull request merged into main, not of another that holds the same commit', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
  });
  await merged.pulls(merged.head, [
    pull({ number: 8, merged_at: null, merge_commit_sha: null, body: 'Still being written, on top of #7.' }),
    pull({ number: 9, base: { ref: 'an-idea' }, merge_commit_sha: merged.head, body: 'Into another branch.' }),
    pull({ merge_commit_sha: merged.head }),
  ]);
  assert.equal((await merged.script('release')).code, 0);
  assert.equal(await merged.notes(), '## For you\n\nA new thing.\n\n');
});

test('a pull request from Dependabot, its description written for whoever merges it, is released with GitHub’s own notes', async () => {
  const merged = await released(async (dir) => {
    await packages(dir, { sharp: '0.34.2' });
    await raise('1.1.1')(dir);
  });
  await merged.pulls(merged.head, [
    pull({ merge_commit_sha: merged.head, user: { login: 'dependabot[bot]', type: 'Bot' }, body: 'Bumps sharp from 0.34.1 to 0.34.2.\n\nDependabot commands and options' }),
  ]);
  assert.equal((await merged.script('release')).code, 0);
  assert.match(await merged.calls(), /^release create v1\.1\.1 .* --generate-notes$/m);
});

test('when GitHub cannot say which pull request brought a version, nothing is released, and the run fails saying why', async () => {
  const merged = await released(async (dir) => {
    await changeSites(dir);
    await raise('1.2.0')(dir);
  });
  await merged.apiFails();
  const result = await merged.script('release');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /HTTP 403/);
  assert.doesNotMatch(await merged.calls(), /release create/);
  assert.equal(await merged.tagged('v1.2.0'), '');
});

test('when v1 cannot be fetched to see where it is, it is left there and the run fails, rather than moved blind', async () => {
  const merged = await released(raise('1.2.0'));
  await raise('1.3.0')(merged.here);
  await commit(merged.here, '1.3.0, released by hand');
  await git(merged.here, ['push', '-q', '-f', 'origin', 'HEAD:refs/tags/v1']);
  const later = await sha(merged.here, 'HEAD');
  await git(merged.here, ['reset', '-q', '--hard', 'HEAD~1']);
  const realGit = (await run('bash', ['-c', 'command -v git'])).stdout.trim();
  await writeFile(
    join(merged.bin, 'git'),
    `#!/bin/bash
if [ "$1" = fetch ] && [[ " $* " == *" refs/tags/v1:refs/tags/v1 "* ]]; then echo 'fatal: unable to access origin' >&2; exit 128; fi
exec "${realGit}" "$@"
`,
  );
  await chmod(join(merged.bin, 'git'), 0o755);
  const result = await merged.script('release');
  assert.notEqual(result.code, 0);
  assert.equal(await merged.tagged('v1'), later);
});

test('releases are made from main alone: Live run by hand on another branch releases nothing', async () => {
  const branch = await released(raise('1.2.0'), { GITHUB_REF: 'refs/heads/an-idea' });
  const result = await branch.script('release');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Releases are made from main: this is refs\/heads\/an-idea\./);
  assert.equal(await branch.tagged('v1.2.0'), '');
});

/** In a repository made by `released`, a release of `version` made by hand, on a commit of its own off 1.1.0's. */
async function byHand(at, version) {
  await git(at.here, ['checkout', '-q', '--detach', at.base]);
  await raise(version)(at.here);
  await commit(at.here, version);
  await git(at.here, ['push', '-q', 'origin', `HEAD:refs/tags/v${version}`]);
  await at.releaseMade(`v${version}`);
  const made = await sha(at.here, 'HEAD');
  await git(at.here, ['checkout', '-q', '-']);
  return made;
}

test('a release made by hand moves its major version’s tag forward, but never back from a later release, nor to a pre-release', async () => {
  const merged = await released(raise('1.2.0'));
  assert.equal((await merged.script('release')).code, 0); // 1.2.0, released on merging, and v1 on it
  const point = async (version) => {
    const result = await merged.script('point', `v${version}`);
    assert.equal(result.code, 0, `${version}: ${result.stdout}${result.stderr}`);
  };

  await byHand(merged, '1.1.2'); // a fix to the line before
  await point('1.1.2');
  assert.equal(await merged.tagged('v1'), merged.head, 'v1 stays on 1.2.0');

  const later = await byHand(merged, '1.3.0');
  await point('1.3.0');
  assert.equal(await merged.tagged('v1'), later);

  await byHand(merged, '1.4.0-rc.1');
  await point('1.4.0-rc.1');
  assert.equal(await merged.tagged('v1'), later, 'a pre-release moves nothing');

  const two = await byHand(merged, '2.0.0');
  await point('2.0.0');
  assert.equal(await merged.tagged('v2'), two);
  assert.equal(await merged.tagged('v1'), later, 'only its own major version’s tag');
});

test('when the major version’s tag cannot be moved, the run fails and says how to move it by hand', async () => {
  const merged = await released(raise('1.2.0'));
  await merged.releaseMade('v1.2.0');
  await git(merged.here, ['push', '-q', 'origin', 'HEAD:refs/tags/v1.2.0']);
  const realGit = (await run('bash', ['-c', 'command -v git'])).stdout.trim();
  await writeFile(
    join(merged.bin, 'git'),
    `#!/bin/bash
if [ "$1" = push ] && [[ " $* " == *" refs/tags/v1 "* ]]; then echo 'remote: refusing' >&2; exit 1; fi
exec "${realGit}" "$@"
`,
  );
  await chmod(join(merged.bin, 'git'), 0o755);
  const result = await merged.script('point', 'v1.2.0');
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /::error title=v1 still points at the previous release::.*move it by hand: .*git tag -f v1 v1\.2\.0/);
  assert.equal(await merged.tagged('v1'), merged.base);
});

test('a pre-release is released as one, and leaves v1 on the last full release', async () => {
  const merged = await released(raise('1.2.0-rc.1'));
  assert.equal((await merged.script('release')).code, 0);
  assert.match(await merged.calls(), /^release create v1\.2\.0-rc\.1 .* --prerelease$/m);
  assert.equal(await merged.tagged('v1'), merged.base);
  const fine = await merged.script('released');
  assert.equal(fine.code, 0, fine.stdout);
  assert.match(fine.stdout, /Everything sites get on main is in 1\.2\.0-rc\.1, a pre-release: v1, which sites call, stays on the last full release\./);
});

test('Live fails when main is ahead of the release of its engine/VERSION, or v1 is not on it', async () => {
  const docs = await released((dir) => writeFile(join(dir, 'README.md'), 'Read me again.\n'));
  const fine = await docs.script('released');
  assert.equal(fine.code, 0, fine.stdout);
  assert.match(fine.stdout, /Everything sites get on main is in 1\.1\.0, and v1 points at it\./);

  const ahead = await released(changeSites);
  const behind = await ahead.script('released');
  assert.equal(behind.code, 1);
  assert.match(behind.stdout, /::error title=main is ahead of v1\.1\.0::engine\/lib\/build\.js changed since 1\.1\.0 was released, without a new version/);

  const unreleased = await released(raise('1.2.0'));
  const missing = await unreleased.script('released');
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /::error title=1\.2\.0 is not released::/);
});

test('releasing runs first in Live, so the demos and checks see the release; pull requests are checked for a version', async () => {
  const live = await workflow('live.yml');
  assert.match(live, /\n {2}release:\n[\s\S]*?run: bash \.github\/release\.sh release\n/);
  for (const job of ['demo', 'released']) assert.match(live, new RegExp(`\\n {2}${job}:\\n {4}needs: release\\n`), job);
  assert.match(live, /run: bash \.github\/release\.sh released/);
  const version = await workflow('version.yml');
  assert.match(version, /^# whatiiif: template only\./);
  assert.match(version, /\n {2}pull_request:\n/);
  assert.match(version, /run: bash \.github\/release\.sh check "origin\/\$\{\{ github\.base_ref \}\}"/);
  assert.match(await workflow('dependencies.yml'), /engine\/VERSION/, 'an update of the packages sites get is a new version too');
  // The tests of .github/release.sh are in engine/test: CI runs them when it changes too.
  assert.equal((await workflow('ci.yml')).match(/paths: \[[^\]]*'\.github\/\*\*'/g)?.length, 2);
  // Releasing is the template's, as the Version check is: not the demos', whose variables a template of one's own may
  // not have.
  for (const name of ['release', 'released']) assert.match(job(live, name), /^ {4}if: github\.event\.repository\.is_template$/m, name);
  assert.match(version, /^ {4}if: github\.event\.repository\.is_template$/m);
  // The release's words are its pull request's, and the released check asks GitHub for the release itself.
  assert.match(job(live, 'release'), /^ {6}pull-requests: read\b/m);
  assert.match(job(live, 'released'), /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test('the weekly package update raises engine/VERSION only when the packages sites install change, and its release notes are for the people who use WhatIIIF', async () => {
  const text = await workflow('dependencies.yml');
  assert.match(text, /if \[\[ -n "\$\(bash \.github\/release\.sh changed HEAD\)" \]\]; then/);
  assert.match(text, /next=\$\(bash \.github\/release\.sh next\)\n\s+echo "\$next" > engine\/VERSION/);
  assert.doesNotMatch(text, /\$\{version%\.\*\}/, 'the next version is release.sh’s, pre-releases and all');
  assert.match(text, /npm ls --depth=0 --omit=dev --json/, 'the notes list the packages sites install');
  assert.match(text, /## For you/);
  assert.match(text, /gh pr comment/, 'what whoever merges it needs to know is a comment, not the release notes');
});

test('the trials in new repositories made from the template are run by hand, not by Live, which would need a token that may make and delete repositories', async () => {
  const text = await workflow('live.yml');
  assert.doesNotMatch(text, /\n  trial:|npm run test:live\n|LIVE_TRIAL_TOKEN/);
  assert.match(text, /run by hand, with `npm run test:live`/);
  assert.match(await read(join(template, 'DEVELOPING.md')), /Run them before every\s+release/);
});

test('after each change, the Live workflow publishes the template to both demos, the plain one and the one with notes', async () => {
  const text = await workflow('live.yml');
  assert.match(text, /^# whatiiif: template only\./);
  for (const [repository, key] of [['DEMO_REPOSITORY', 'DEMO_DEPLOY_KEY'], ['NOTES_DEMO_REPOSITORY', 'NOTES_DEMO_DEPLOY_KEY']]) {
    assert.match(text, new RegExp(`- \\{ repository: ${repository}, key: ${key} \\}`), repository);
  }
  assert.match(text, /vars\[matrix\.demo\.repository\]/);
  assert.match(text, /secrets\[matrix\.demo\.key\]/);
  // Kept in step after every release and every day too, not only after a change.
  assert.match(text, /\n {2}release:\n {4}types: \[published\]/);
  assert.match(text, /\n {2}schedule:\n {4}- cron: /);
});

test('a release made by hand, perhaps a fix to an older line, starts Live on main: the demos and the checks are of main, not of its tag', async () => {
  const text = await workflow('live.yml');
  const checkouts = text.match(/- uses: actions\/checkout@v\d+\n/g).length;
  const ofMain = text.match(/- uses: actions\/checkout@v\d+\n {8}with:\n(?: {10}\S.*\n)*? {10}ref: \$\{\{ github\.event_name == 'release' && 'main' \|\| '' \}\}/g)?.length;
  assert.equal(ofMain, checkouts, 'every job checks out main when a release starts it');
  // The screenshots' commit names the commit of main they were made from, not the release's.
  assert.doesNotMatch(text, /GITHUB_SHA/);
});
