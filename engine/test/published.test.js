// Whether a file is on a live site, as check-site.js asks it of a thousand or so files just after a deploy, when
// GitHub Pages can now and then fail to answer, or answer before every one of its servers has the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { published } from './support/published.js';

/** A fetch that gives each answer in turn: a status, or an error as when no answer came. */
const answering = (...answers) => {
  const asked = [];
  const fetch = async (url, options) => {
    asked.push([url, options.method]);
    const answer = answers[Math.min(asked.length, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return { ok: answer >= 200 && answer < 300, status: answer };
  };
  return { fetch, asked };
};
const quickly = { wait: 1 };

test('a file found is published, asked for once, by its headers alone', async () => {
  const { fetch, asked } = answering(200);
  assert.equal(await published('https://gjh.github.io/harbour/icon.png', { fetch, ...quickly }), true);
  assert.deepEqual(asked, [['https://gjh.github.io/harbour/icon.png', 'HEAD']]);
});

test('a file not found at first, as a server just after a deploy can say, is asked for again before it is called missing', async () => {
  const { fetch, asked } = answering(404, 200);
  assert.equal(await published('https://gjh.github.io/harbour/tile.jpg', { fetch, ...quickly }), true);
  assert.equal(asked.length, 2);
});

test('a file not found however often it is asked for is missing', async () => {
  const { fetch, asked } = answering(404);
  assert.equal(await published('https://gjh.github.io/harbour/tile.jpg', { fetch, ...quickly }), false);
  assert.equal(asked.length, 3);
});

test('a site that cannot be reached at all is said to be, rather than its files called missing', async () => {
  const cut = Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
  const { fetch } = answering(cut);
  await assert.rejects(published('https://gjh.github.io/harbour/tile.jpg', { fetch, ...quickly }), /https:\/\/gjh\.github\.io\/harbour\/tile\.jpg could not be reached: ETIMEDOUT/);
  const { fetch: once } = answering(cut, 200);
  assert.equal(await published('https://gjh.github.io/harbour/tile.jpg', { fetch: once, ...quickly }), true, 'a connection cut once is tried again');
});
