// Whether a file is on a live site, by its headers alone, for check-site.js. Among the thousand or so files a big
// picture needs, a connection now and then times out, and just after a deploy a GitHub Pages server can answer for a
// file before it has it: both are asked again, a moment later, before a file is called missing. A file still not
// found is missing, and a site that never answers is said to be unreachable.

/** Whether `url` is published: asked `tries` times at most, `wait` milliseconds apart, while it is not found. */
export async function published(url, { fetch = globalThis.fetch, tries = 3, wait = 5000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      if ((await fetch(url, { method: 'HEAD' })).ok) return true;
      if (attempt >= tries) return false;
    } catch (error) {
      if (attempt >= tries) throw new Error(`${url} could not be reached: ${error.cause?.code ?? error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
