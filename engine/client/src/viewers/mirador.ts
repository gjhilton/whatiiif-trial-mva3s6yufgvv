import Mirador from 'mirador';
import type { ViewerAdapter } from './types';
import type { Region } from '../address';
import { darkPage, pageColour } from '../colours';
import { motion } from './motion';

interface ViewerState {
  x: number;
  y: number;
  zoom: number;
}

interface MiradorInstance {
  unmount?: () => void;
  store: {
    getState(): { viewers: Record<string, ViewerState | undefined> };
    subscribe(listener: () => void): () => void;
    dispatch(action: unknown): void;
  };
}

const WINDOW = 'whatiiif';
const ROOM_FOR_NOTES = 720; // the narrowest pane, in CSS pixels, that keeps a useful picture beside Mirador's list of notes

// Mirador keeps a window's view as the centre of the screen, in image pixels, and OpenSeadragon's zoom, which is
// one over the width of image on screen. `aspect` is the width over the height of the part of the window showing the
// picture, which is narrower than the pane while Mirador's list of notes is open beside it.
const toView = (r: Region, aspect: number): ViewerState => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, zoom: 1 / Math.max(r.w, r.h * aspect) });
const toRegion = ({ x, y, zoom }: ViewerState, aspect: number): Region => {
  const w = 1 / zoom;
  const h = w / aspect;
  return { x: x - w / 2, y: y - h / 2, w, h };
};

/**
 * The page's colours in place of Mirador's blue and grey. On a dark page Mirador's own dark theme is chosen, for its
 * light words on dark, and given the page's colours too, or its teal would show instead.
 */
function theme() {
  const palette = {
    primary: { main: pageColour('--ink') },
    secondary: { main: pageColour('--ink') },
    error: { main: pageColour('--error') },
    shades: { dark: pageColour('--viewer') },
  };
  if (!darkPage()) return { theme: { palette } };
  const paper = pageColour('--paper');
  const dark = { ...palette, mode: 'dark', shades: { ...palette.shades, main: paper, light: paper }, background: { default: paper, paper } };
  // MUI lightens raised surfaces in dark mode; here black stays black, as white does on a light page.
  const flat = { MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } } };
  return { selectedTheme: 'dark', theme: { palette: dark, components: flat }, themes: { dark: { palette: dark } } };
}

const adapter: ViewerAdapter = {
  mount(el, site, { language, region, onRegionChange, onNote }) {
    el.id = 'mirador-root';
    const aspect = () => {
      const picture = el.querySelector('.openseadragon-container') ?? el;
      return picture.clientWidth / picture.clientHeight;
    };

    const instance = Mirador.viewer({
      id: el.id,
      language, // Mirador's own interface, and which language of the manifest's labels to show
      windows: [
        {
          id: WINDOW,
          manifestId: site.manifestUrl,
          maximized: true, // fill the pane; there is only ever one window
        },
      ],
      // A picture with notes opens with Mirador's own list of them, which it reads from the manifest's annotations;
      // not in someone else's page, which shows no notes (`onNote` is given where notes are shown), nor where the
      // list would leave the picture little room, as on a phone: the page lists the notes below in any case.
      window: {
        allowClose: false,
        allowMaximize: false,
        sideBarOpen: Boolean(site.notes && onNote) && el.clientWidth >= ROOM_FOR_NOTES,
        defaultSideBarPanel: 'annotations',
      },
      osdConfig: motion(), // added to Mirador's own options for OpenSeadragon
      workspace: { isWorkspaceAddVisible: false },
      workspaceControlPanel: { enabled: false },
      ...theme(),
    }) as MiradorInstance;
    const view = () => instance.store.getState().viewers[WINDOW];

    // Mirador zooms around where the centre is on screen at the time, so panning and zooming at once would land off
    // target: a part of the picture is shown in two steps, a pan and then a zoom, each asked for once Mirador has
    // reported where the one before took it. A step that would not move it is skipped, as no report would follow.
    const steps: Partial<ViewerState>[] = [];
    const already = (at: ViewerState, step: Partial<ViewerState>) =>
      'zoom' in step ? Math.abs(at.zoom / step.zoom! - 1) < 1e-3 : Math.abs(at.x - step.x!) < 1 && Math.abs(at.y - step.y!) < 1;
    let asking = false; // the state changes our own requests make are not reports of where Mirador is
    const next = () => {
      const at = view();
      let step = steps.shift();
      while (step && at && already(at, step)) step = steps.shift();
      if (!step) return false;
      asking = true;
      instance.store.dispatch(Mirador.actions.updateViewport(WINDOW, step as ViewerState));
      asking = false;
      return true;
    };
    const stepsTo = (part: Region) => {
      const { x, y, zoom } = toView(part, aspect());
      steps.splice(0, steps.length, { x, y }, { zoom });
    };

    // Mirador opens on the whole picture and reports that view first (it overwrites a window's
    // initialViewerConfig), so a shared view is applied after that, once the picture's part of the window has the
    // shape it will keep.
    let waiting = region;
    let seen: ViewerState | undefined;
    const unsubscribe = instance.store.subscribe(() => {
      const at = view();
      if (!at || at === seen || at.zoom === undefined) return;
      seen = at;
      if (waiting) stepsTo(waiting);
      waiting = undefined;
      if (asking || next()) return;
      onRegionChange(toRegion(at, aspect()));
    });

    return {
      show(part) {
        if (view()?.zoom === undefined) waiting = part; // Mirador's first report starts it
        else {
          stepsTo(part);
          next();
        }
      },
      destroy() {
        unsubscribe();
        instance.unmount?.();
      },
    };
  },
};

export default adapter;
