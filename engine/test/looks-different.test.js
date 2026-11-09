// Whether a README screenshot taken again looks different from the one committed: GitHub's Mac runner draws the
// picture's tiles a shade differently from run to run, which is no change, and must not be committed as one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { looksDifferent } from './support/looks-different.js';
import { tempDir } from './support/tmp.js';

const W = 400;
const H = 300;
/** A PNG of a grey-ish picture, with `change` made to its raw pixels first. */
async function png(change = () => {}) {
  const data = Buffer.alloc(W * H * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 200; // something like a picture, not flat
  change(data);
  return sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}
const committed = async (buffer) => {
  const file = join(await tempDir('artwork'), 'shot.png');
  await writeFile(file, buffer);
  return file;
};

test('a screenshot drawn a shade differently, here and there, as the Mac runner does, looks the same', async () => {
  const file = await committed(await png());
  // A hundred pixels each off by up to 40 of 255, as the runner's tiles were today: no change anyone could see.
  const shaded = await png((data) => {
    for (let n = 0; n < 100; n++) data[(n * 3571) % data.length] += 40;
  });
  assert.equal(await looksDifferent(shaded, file), false);
});

test('a real change, such as a word or a button, looks different, however small', async () => {
  const file = await committed(await png());
  const block = await png((data) => {
    for (let y = 100; y < 105; y++) for (let x = 100; x < 110; x++) data.fill(255, (y * W + x) * 3, (y * W + x) * 3 + 3);
  });
  assert.equal(await looksDifferent(block, file), true);
});

test('a screenshot of another size, or with none committed yet, is different', async () => {
  const file = await committed(await png());
  const wider = await sharp(await png()).resize(W + 10, H).png().toBuffer();
  assert.equal(await looksDifferent(wider, file), true);
  assert.equal(await looksDifferent(await png(), join(await tempDir('none'), 'missing.png')), true);
});
