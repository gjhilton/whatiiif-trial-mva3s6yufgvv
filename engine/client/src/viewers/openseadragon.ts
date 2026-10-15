import OpenSeadragon from 'openseadragon';
import type { ViewerAdapter } from './types';
import type { Region } from '../address';
import { pageColour } from '../colours';
import { scaleLength } from '../describe';

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

const adapter: ViewerAdapter = {
  mount(el, site, { region, onRegionChange, onError, cooperative, onNote }) {
    const viewer = OpenSeadragon({
      element: el,
      tileSources: site.infoUrl,
      showNavigationControl: false, // our own buttons, below
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      // The page's colours in place of the overview map's black, grey and red.
      navigatorBackground: pageColour('--viewer'),
      navigatorBorderColor: pageColour('--ink'),
      navigatorDisplayRegionColor: pageColour('--ink'),
      gestureSettingsMouse: { clickToZoom: false },
      cooperativeGestures: cooperative,
    });

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
    viewer.addHandler('full-page', ({ fullPage }) => {
      const label = fullPage ? 'Leave full screen' : 'Full screen';
      fullScreen.title = label;
      fullScreen.setAttribute('aria-label', label);
      fullScreen.innerHTML = icon(fullPage ? ICONS.leaveFullScreen : ICONS.enterFullScreen);
    });

    // A picture whose real size is known has a scale bar, kept to a round length as the visitor zooms.
    const { dimensions } = site;
    if (dimensions) {
      const bar = document.createElement('div');
      bar.className = 'scale-bar';
      bar.setAttribute('aria-hidden', 'true'); // the details give the size in words
      const scaleHolder = document.createElement('div');
      scaleHolder.append(bar);
      viewer.addControl(scaleHolder, { anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT, autoFade: false });
      viewer.addHandler('update-viewport', () => {
        const image = viewer.world.getItemAt(0);
        if (!image) return;
        const onScreen = image.viewportToImageZoom(viewer.viewport.getZoom(true)); // screen pixels to one of the picture's
        const { pixels, label } = scaleLength(dimensions.width / site.width / onScreen, dimensions.unit);
        bar.style.width = `${Math.round(pixels)}px`;
        bar.textContent = label;
      });
    }

    viewer.addHandler('open-failed', ({ message }) => onError(`The picture could not be opened: ${message}`));
    let opened = false;
    let waiting = region; // a part to show once the picture is open
    // The part a link asked for is outlined for a moment: the view is widened to the pane's shape, and the outline
    // shows what was meant within it.
    const fit = (part: Region, immediately: boolean) => {
      const area = viewer.world.getItemAt(0).imageToViewportRectangle(part.x, part.y, part.w, part.h);
      viewer.viewport.fitBounds(area, immediately);
      const outline = document.createElement('div');
      outline.className = 'region-outline';
      outline.addEventListener('animationend', () => viewer.removeOverlay(outline));
      viewer.addOverlay({ element: outline, location: area });
    };
    viewer.addOnceHandler('open', () => {
      opened = true;
      if (waiting) fit(waiting, true);
      // A numbered marker at the corner of each note's part of the picture, numbered as the list of notes is.
      if (onNote) {
        site.notes?.items.forEach(({ region: { x, y } }, i) => {
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'note-marker';
          marker.textContent = String(i + 1);
          marker.setAttribute('aria-label', `Note ${i + 1}`);
          marker.addEventListener('pointerdown', (event) => event.stopPropagation()); // a press, not the start of a drag
          marker.addEventListener('click', () => onNote(i));
          viewer.addOverlay({ element: marker, location: viewer.world.getItemAt(0).imageToViewportCoordinates(x, y) });
        });
      }
      viewer.addHandler('animation-finish', () => {
        const { x, y, width, height } = viewer.world.getItemAt(0).viewportToImageRectangle(viewer.viewport.getBounds(true));
        onRegionChange({ x, y, w: width, h: height });
      });
    });

    return {
      show(part) {
        if (opened) fit(part, false);
        else waiting = part;
      },
      destroy: () => viewer.destroy(),
    };
  },
};

export default adapter;
