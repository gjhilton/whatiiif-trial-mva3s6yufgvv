// OpenSeadragon's buttons, drawn like the page's own: on the page's picture, and the notes helper's.
import OpenSeadragon from 'openseadragon';

// The buttons' pictures: lines in the text colour, on a 20-unit square.
const ICONS = {
  zoomIn: 'M10 4v12M4 10h12',
  zoomOut: 'M4 10h12',
  home: 'M3 10l7-6 7 6M5 8.5V16h10V8.5',
  enterFullScreen: 'M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5',
  leaveFullScreen: 'M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5',
};
const STEP = 2; // how far a button zooms, as OpenSeadragon's own did

const icon = (path: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${path}"/></svg>`;

/** A button in the page's own style, in place of OpenSeadragon's pictures of buttons, which are not buttons. */
function button(label: string, path: string, press: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.title = label;
  element.setAttribute('aria-label', label);
  element.innerHTML = icon(path);
  element.addEventListener('click', press);
  return element;
}

/** Zoom in, zoom out, the whole picture and full screen, at the top left of `viewer`. */
export function addControls(viewer: OpenSeadragon.Viewer): void {
  const zoom = (by: number) => {
    viewer.viewport.zoomBy(by);
    viewer.viewport.applyConstraints();
  };
  const fullScreen = button('Full screen', ICONS.enterFullScreen, () => viewer.setFullScreen(!viewer.isFullPage()));
  const controls = document.createElement('div');
  controls.className = 'viewer-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Picture');
  controls.append(
    button('Zoom in', ICONS.zoomIn, () => zoom(STEP)),
    button('Zoom out', ICONS.zoomOut, () => zoom(1 / STEP)),
    button('Show the whole picture', ICONS.home, () => viewer.viewport.goHome()),
    fullScreen,
  );
  const holder = document.createElement('div'); // OpenSeadragon sets the display of what it is given
  holder.append(controls);
  viewer.addControl(holder, { anchor: OpenSeadragon.ControlAnchor.TOP_LEFT, autoFade: false });
  // OpenSeadragon puts its corner of buttons after the picture, so the keyboard reached every note's number on the
  // picture before them. Before it, they come first, as they do on screen, and are still drawn over it.
  let corner: HTMLElement | null = holder;
  while (corner && corner.parentElement !== viewer.container) corner = corner.parentElement;
  if (corner) {
    corner.style.zIndex = '1';
    viewer.container.insertBefore(corner, viewer.container.firstChild);
  }
  viewer.addHandler('full-page', ({ fullPage }) => {
    const label = fullPage ? 'Leave full screen' : 'Full screen';
    fullScreen.title = label;
    fullScreen.setAttribute('aria-label', label);
    fullScreen.innerHTML = icon(fullPage ? ICONS.leaveFullScreen : ICONS.enterFullScreen);
  });
}
