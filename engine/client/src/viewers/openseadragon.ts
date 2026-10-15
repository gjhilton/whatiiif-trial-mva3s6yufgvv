import OpenSeadragon from 'openseadragon';
import type { ViewerAdapter } from './types';
import type { Region } from '../address';
import { pageColour } from '../colours';
import { scaleLength } from '../describe';
import { addControls } from './controls';

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

    addControls(viewer);

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
