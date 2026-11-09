// Shared by the end-to-end tests: copies of the template as a user would have it, the commands the
// workflows run, and a browser that is handed a built site straight from disk.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './tmp.js';

const exec = promisify(execFile);
export const repo = fileURLToPath(new URL('../../../', import.meta.url));

/** Runs a command and reports its exit code and output rather than throwing when it fails. */
export async function run(command, args, { cwd, env } = {}) {
  try {
    const { stdout, stderr } = await exec(command, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

// Git with an identity and no signing. Its LFS filter is off unless a test asks for it (`lfs`), so that an
// image is stored whole, as it is when uploaded on github.com, whatever this machine has installed.
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.org', '-c', 'commit.gpgsign=false'];
const NO_LFS = ['-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false'];
export const git = (cwd, args, { lfs = false } = {}) => exec('git', [...IDENTITY, ...(lfs ? [] : NO_LFS), ...args], { cwd });

/** Stages everything in a template copy and commits it. */
export async function commit(dir, message, options) {
  await git(dir, ['add', '-A', '--', '.', ':!node_modules'], options);
  await git(dir, ['commit', '-q', '-m', message], options);
}

// What content/ holds in the template itself, before anyone adds a picture.
const TEMPLATE_CONTENT = ['content/.gitkeep', 'content/whatiiif.toml'];

/**
 * A new repository holding the template as it stands in this working tree: what "Use this template" gives.
 * Its content/ is the template's own, as last committed, not whatever picture or settings this checkout holds
 * (a developer's preview, or a copy of the template that runs these tests).
 */
export async function templateCopy() {
  const dir = await tempDir('copy');
  const { stdout } = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo });
  for (const file of stdout.split('\0').filter((file) => file && !file.startsWith('content/'))) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await copyFile(join(repo, file), join(dir, file));
  }
  await mkdir(join(dir, 'content'));
  for (const file of TEMPLATE_CONTENT) {
    await writeFile(join(dir, file), (await exec('git', ['show', `HEAD:${file}`], { cwd: repo })).stdout);
  }
  await symlink(join(repo, 'node_modules'), join(dir, 'node_modules')); // stands in for the workflow's `npm ci`
  await git(dir, ['init', '-q', '-b', 'main']);
  await commit(dir, 'Initial commit');
  return dir;
}

/**
 * What the Deploy workflow does with a repository, short of installing dependencies and the steps only
 * GitHub Pages can run: look for an image, then build the site for the address Pages would give it.
 */
export async function deploy(dir, { baseUrl = 'https://example.github.io/my-image', repository = 'example/my-image' } = {}) {
  const output = join(await tempDir('github'), 'output');
  await writeFile(output, '');
  const env = { GITHUB_OUTPUT: output, GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: 'main', SITE_BASE_URL: baseUrl };

  const look = await run('node', ['engine/ci/has-image.js'], { cwd: dir, env });
  if ((await readFile(output, 'utf8')) !== 'image=true\n') return { built: false, skipped: true, log: look.stdout };

  const build = await run('npm', ['run', 'build'], { cwd: dir, env });
  return { built: build.code === 0, skipped: false, code: build.code, log: build.stdout + build.stderr, dist: join(dir, 'dist'), baseUrl };
}

/** Builds the preview page on its own; it is the same for every image. */
export async function buildPage() {
  const outDir = await tempDir('page');
  const { build: buildWithVite } = await import('vite');
  await buildWithVite({ configFile: join(repo, 'engine/client/vite.config.ts'), build: { outDir }, logLevel: 'error' });
  return outDir;
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// A page on someone else's site, such as a blog post holding the embed code.
export const ELSEWHERE = 'https://elsewhere.example/post.html';

/**
 * Opens the site at `siteUrl` (plus `query`) in a new page and records what it fetches and anything that
 * goes wrong: a file that is not published, a request to another site, an error in the page's scripts.
 * With `fileFor`, every request is answered with the file it names, so no web server is needed; without
 * it the site is fetched over the network, as a visitor would. With `elsewhere`, the page opened is instead
 * one at ELSEWHERE holding that HTML. `colorScheme` is the visitor's choice of light or dark.
 */
export async function browse(browser, { siteUrl, fileFor, query = '', locale = 'en-GB', colorScheme = 'light', javaScriptEnabled = true, elsewhere, device }) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    // Only Chromium lets a test read the clipboard.
    permissions: browser.browserType().name() === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [],
    ...device, // a phone or tablet, as playwright's `devices` describe them, in place of a desktop window
    locale,
    colorScheme,
    javaScriptEnabled,
  });
  const page = await context.newPage();
  const fetched = [];
  const problems = [];
  page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
  const folder = new URL(`${siteUrl}/`).pathname; // "/" for a site at the root of its address, "/my-image/" in a sub-folder
  const pathOf = (url) => decodeURIComponent(new URL(url).pathname).slice(folder.length) || 'index.html';
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (elsewhere !== undefined && url === ELSEWHERE) return route.fulfill({ contentType: 'text/html', body: elsewhere });
    if (!url.startsWith(`${siteUrl}/`)) {
      problems.push(`request to another site: ${url}`);
      return route.abort();
    }
    if (!fileFor) return route.continue();
    try {
      const body = await readFile(fileFor(pathOf(url)));
      await route.fulfill({ body, contentType: TYPES[extname(pathOf(url))] ?? 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });
  page.on('response', (response) => {
    if (!response.url().startsWith(`${siteUrl}/`)) return;
    if (response.ok()) fetched.push(pathOf(response.url()));
    else problems.push(`not published: ${pathOf(response.url())}`);
  });
  await page.goto(elsewhere === undefined ? `${siteUrl}/${query}` : ELSEWHERE);
  return { page, fetched, problems, close: () => context.close() };
}

/**
 * Clicks `link` on `page`, which closes the page, and waits for it to close. The click can see the page close under
 * it, as it should: that is a failure only if the page is still open.
 */
export async function clickToClose(page, link) {
  const closed = page.waitForEvent('close');
  await link.click().catch((error) => {
    if (!page.isClosed()) throw error;
  });
  await closed;
}

export async function until(condition, what, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Full-resolution pixels: a tile as many pixels across as the region it covers, or the whole image at its own size.
const FULL_RESOLUTION = /^iiif\/image\/(?:full\/max|\d+,\d+,(\d+),(\d+)\/\1,\2)\/0\/default\.jpg$/;

/**
 * Scrolls in at the middle of the viewer until it has asked for full-resolution pixels, then lets it settle. Inside
 * someone else's page the viewer zooms only while Control is held (a plain scroll scrolls that page), so `holding`
 * names a key to hold; `within` is the frame the viewer is in, if it is in one.
 */
export async function zoomToFullResolution({ page, fetched }, { holding, within = page } = {}) {
  const box = await within.locator('.viewer').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (holding) await page.keyboard.down(holding);
  await until(async () => {
    await page.mouse.wheel(0, -300);
    return fetched.some((path) => FULL_RESOLUTION.test(path));
  }, 'full-resolution pixels to be requested');
  if (holding) await page.keyboard.up(holding);
  await page.waitForLoadState('networkidle');
}
