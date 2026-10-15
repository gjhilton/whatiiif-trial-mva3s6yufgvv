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

test("a copy's Deploy and Update workflows call the template's, by the repository named in engine/UPSTREAM", async () => {
  const upstream = (await read(join(template, 'engine/UPSTREAM'))).trim();
  for (const [caller, called] of [['deploy.yml', 'publish.yml'], ['update.yml', 'offer-update.yml']]) {
    const text = await workflow(caller);
    assert.match(text, new RegExp(`uses: ${upstream}/\\.github/workflows/${called.replace('.', '\\.')}@v0\\n\\s+secrets: inherit`), caller);
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

test('a release moves the v0 tag that copies call, and only in the template', async () => {
  const text = await workflow('release.yml');
  assert.match(text, /^# whatiiif: template only\./);
  assert.match(text, /if: github\.event\.repository\.is_template/);
  assert.match(text, /git tag -f "\$major"/);
  // A pre-release is for trying out: copies keep running the last full release.
  assert.match(text, /if: github\.event\.repository\.is_template && !github\.event\.release\.prerelease/);
  assert.match(text, /::error title=\$major still points at the previous release::.*move it by hand/, 'a tag left behind says how to move it');
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

test('after each change, the Live workflow publishes the template to both demos, the plain one and the one with notes', async () => {
  const text = await workflow('live.yml');
  assert.match(text, /^# whatiiif: template only\./);
  for (const [repository, key] of [['DEMO_REPOSITORY', 'DEMO_DEPLOY_KEY'], ['NOTES_DEMO_REPOSITORY', 'NOTES_DEMO_DEPLOY_KEY']]) {
    assert.match(text, new RegExp(`- \\{ repository: ${repository}, key: ${key} \\}`), repository);
  }
  assert.match(text, /vars\[matrix\.demo\.repository\]/);
  assert.match(text, /secrets\[matrix\.demo\.key\]/);
  // The demos run publish.yml at the commit tried, so a change to it alone is tried on them too.
  assert.match(text, /paths: \[[^\]]*'\.github\/workflows\/publish\.yml'/);
});
