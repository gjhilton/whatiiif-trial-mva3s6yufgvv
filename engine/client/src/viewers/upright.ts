// The picture as it is: OpenSeadragon, on its own and inside Mirador, turns the picture with r and R and mirrors it
// with f, but a link to the view, and a note's part, describe the picture unturned and unmirrored, so they would name
// the wrong part. Nothing here imports a viewer, so either viewer's bundle can use it.

/**
 * Stops r, R and f on their way to any picture inside `el`, before OpenSeadragon hears them; the other keys (arrows,
 * + and -, 0 for the whole picture) still move it. Returns a function that lets them through again.
 */
export function keepUpright(el: HTMLElement): () => void {
  const stop = (event: KeyboardEvent) => {
    const onPicture = event.target instanceof Element && event.target.closest('.openseadragon-canvas');
    if (onPicture && /^[rf]$/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
  };
  el.addEventListener('keydown', stop, true); // on the way down, before the picture's own listener
  return () => el.removeEventListener('keydown', stop, true);
}
