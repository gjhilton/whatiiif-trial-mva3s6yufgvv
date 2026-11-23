// Whether a screenshot taken again looks different from the one committed. A screenshot is seldom the same to the
// byte, and GitHub's Mac runner draws the picture's tiles a shade differently from run to run: scattered pixels off
// by up to 40 or so of 255 (13 commits of the README's screenshots on 2026-10-15 were nothing else). A real change,
// a word, a line, another picture, is pixels off by far more. So only a pixel off by more than a quarter of the way
// from black to white counts, and a few of those make a difference.
import sharp from 'sharp';

const OFF = 64; // of 255, in any of red, green and blue
const FEW = 16; // pixels so changed that make a screenshot different

/** Whether the PNG `png` (a buffer) looks different from the PNG file `file`, or there is no such file. */
export async function looksDifferent(png, file) {
  const pixels = (input) => sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [now, before] = await Promise.all([pixels(png), pixels(file).catch(() => undefined)]);
  if (!before || now.info.width !== before.info.width || now.info.height !== before.info.height) return true;
  let changed = 0;
  for (let i = 0; i < now.data.length; i += 4) {
    const apart = Math.max(...[0, 1, 2].map((c) => Math.abs(now.data[i + c] - before.data[i + c])));
    if (apart > OFF) changed++;
  }
  return changed > FEW;
}
