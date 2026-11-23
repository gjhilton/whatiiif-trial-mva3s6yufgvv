// The picture in the notes helper: OpenSeadragon, with the part of the picture each note is about outlined and
// numbered. The chosen note's part can be changed on the picture: its number dragged to move it, a corner to resize
// it. A new part can be drawn by dragging across the picture.
import OpenSeadragon from 'openseadragon';
import type { Site } from '../site';
import type { Region } from '../address';
import { pageColour } from '../colours';
import { addControls } from '../viewers/controls';
import { keepUpright } from '../viewers/upright';
import { motion } from '../viewers/motion';

export interface Picture {
  /** The part of the picture on screen, in whole pixels within it. */
  inView(): Region | undefined;
  /** Moves the view to `region`, with a margin round it, now or once the picture is open. */
  show(region: Region): void;
  /** Outlines each note's part, numbered; the `selected` one more boldly, with corners to drag. */
  mark(regions: (Region | undefined)[], selected: number | undefined): void;
  /**
   * Lets the next drag across the picture mark a part, rather than move the picture, which still zooms; `onDrawn` is
   * told which part, and `onStopped` that drawing stopped without one (Escape was pressed).
   */
  draw(onDrawn: (region: Region) => void, onStopped: () => void): void;
  stopDrawing(): void;
  destroy(): void;
}

export interface PictureEvents {
  /** The owner pressed the number of note `index`. */
  onChoose: (index: number) => void;
  /** Told why, if the picture cannot be opened. */
  onError: (message: string) => void;
  /** The owner moved or resized the part of note `index` on the picture. */
  onAdjust: (index: number, region: Region) => void;
}

type Grip = 'move' | 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: Grip[] = ['nw', 'ne', 'se', 'sw'];
// Screen pixels a press can wander and still be a press, not a drag: a finger wanders further than a mouse.
const SLOP = { mouse: 4, pen: 6, touch: 12 } as Record<string, number>;
const DRAWN = 8; // screen pixels a drawn part must be across, one way or the other: less is a tap
const MARGIN = 0.15; // of a note's part, shown round it

/** Opens the picture of `site` in `el`. */
export function openPicture(el: HTMLElement, site: Site, { onChoose, onAdjust, onError }: PictureEvents): Picture {
  const viewer = OpenSeadragon({
    ...motion(),
    element: el,
    tileSources: site.infoUrl,
    showNavigationControl: false, // our own buttons, as on the page
    showNavigator: true,
    navigatorPosition: 'BOTTOM_RIGHT',
    navigatorBackground: pageColour('--viewer'),
    navigatorBorderColor: pageColour('--ink'),
    navigatorDisplayRegionColor: pageColour('--ink'),
    gestureSettingsMouse: { clickToZoom: false },
  });
  addControls(viewer);
  viewer.addHandler('open-failed', ({ message }) => onError(`The picture could not be opened: ${message}`));
  const letTurn = keepUpright(el); // parts are marked on the picture as it is
  const image = () => viewer.world.getItemAt(0);
  let opened = false;
  let waiting: Region | undefined;
  viewer.addOnceHandler('open', () => {
    opened = true;
    if (waiting) fit(waiting);
  });

  /** A rectangle of the picture, in its own pixels, kept within it and rounded to whole pixels. */
  const within = (x0: number, y0: number, x1: number, y1: number): Region | undefined => {
    const [left, right] = [Math.max(0, Math.round(Math.min(x0, x1))), Math.min(site.width, Math.round(Math.max(x0, x1)))];
    const [top, bottom] = [Math.max(0, Math.round(Math.min(y0, y1))), Math.min(site.height, Math.round(Math.max(y0, y1)))];
    return right - left >= 1 && bottom - top >= 1 ? { x: left, y: top, w: right - left, h: bottom - top } : undefined;
  };
  const area = ({ x, y, w, h }: Region) => image().imageToViewportRectangle(x, y, w, h);
  const fit = (region: Region) => {
    const { x, y, width, height } = area(region);
    viewer.viewport.fitBounds(new OpenSeadragon.Rect(x - width * MARGIN, y - height * MARGIN, width * (1 + 2 * MARGIN), height * (1 + 2 * MARGIN)));
  };
  // Pointers are measured against the picture as it is on screen (`true`), which differs from where it is heading
  // while it zooms.
  const fromPixel = (point: OpenSeadragon.Point) => viewer.viewport.pointFromPixel(point, true);
  /** Where a pointer is, in the picture's own pixels. */
  const pointAt = (event: PointerEvent) => {
    const { left, top } = viewer.canvas.getBoundingClientRect();
    return image().viewportToImageCoordinates(fromPixel(new OpenSeadragon.Point(event.clientX - left, event.clientY - top)));
  };

  /** `region` with its `grip` dragged by `dx`, `dy` pixels of the picture: moved whole, or by one corner. */
  const dragged = (region: Region, grip: Grip, dx: number, dy: number): Region | undefined => {
    if (grip === 'move') {
      const x = Math.min(Math.max(region.x + dx, 0), site.width - region.w);
      const y = Math.min(Math.max(region.y + dy, 0), site.height - region.h);
      return within(x, y, x + region.w, y + region.h);
    }
    let [left, top, right, bottom] = [region.x, region.y, region.x + region.w, region.y + region.h];
    if (grip.includes('w')) left += dx;
    if (grip.includes('e')) right += dx;
    if (grip.includes('n')) top += dy;
    if (grip.includes('s')) bottom += dy;
    return within(left, top, right, bottom);
  };

  let marks: HTMLElement[] = [];
  const unmark = () => {
    for (const mark of marks) viewer.removeOverlay(mark);
    marks = [];
  };
  /**
   * Lets a press on `handle` drag `grip` of note `index`'s part, `outline` following it; a press that does not
   * move is left to be a click.
   */
  const grab = (handle: HTMLElement, outline: HTMLElement, index: number, region: Region, grip: Grip) => {
    let wasDragged = false;
    handle.addEventListener('pointerdown', (down) => {
      down.stopPropagation(); // a drag of this, not of the picture
      if (!down.isPrimary || down.button !== 0) return;
      handle.setPointerCapture(down.pointerId);
      const from = pointAt(down);
      let now: Region | undefined;
      wasDragged = false;
      const move = (event: PointerEvent) => {
        if (!wasDragged && Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < (SLOP[down.pointerType] ?? SLOP.mouse)) return;
        wasDragged = true;
        const at = pointAt(event);
        now = dragged(region, grip, at.x - from.x, at.y - from.y) ?? now;
        if (now) viewer.updateOverlay(outline, area(now));
      };
      const end = (event: PointerEvent) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        if (event.type === 'pointerup' && now) onAdjust(index, now);
        else viewer.updateOverlay(outline, area(region));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    // A press that became a drag is not also a click.
    handle.addEventListener('click', (event) => {
      if (wasDragged) event.stopImmediatePropagation();
      wasDragged = false;
    });
  };

  // Drawing a part: a press starts a box, a drag sizes it, and letting go makes it the part. The picture still zooms
  // meanwhile, by the wheel, a pinch or the buttons; it only stops moving under a drag.
  let drawn: ((region: Region) => void) | undefined;
  let stopped: (() => void) | undefined;
  let start: OpenSeadragon.Point | undefined;
  let end: OpenSeadragon.Point | undefined;
  let across = 0; // how far the pointer has gone from where it was pressed, on screen
  let pressedAt: OpenSeadragon.Point | undefined;
  const box = document.createElement('div');
  box.className = 'drawn-area';
  const boxAround = (a: OpenSeadragon.Point, b: OpenSeadragon.Point) =>
    new OpenSeadragon.Rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const unbox = () => {
    if (start) viewer.removeOverlay(box);
    start = end = undefined;
  };
  // The viewer's own events, as a second tracker on its canvas would find each move already taken by the viewer's.
  viewer.addHandler('canvas-press', (event) => {
    if (!drawn || !opened) return;
    pressedAt = event.position;
    across = 0;
    start = end = fromPixel(event.position);
    viewer.addOverlay({ element: box, location: boxAround(start, end) });
  });
  viewer.addHandler('canvas-drag', (event) => {
    if (!drawn) return;
    event.preventDefaultAction = true; // drawing, not moving the picture
    if (!start || !pressedAt) return;
    across = Math.max(across, Math.abs(event.position.x - pressedAt.x), Math.abs(event.position.y - pressedAt.y));
    end = fromPixel(event.position);
    viewer.updateOverlay(box, boxAround(start, end));
  });
  viewer.addHandler('canvas-drag-end', (event) => {
    if (drawn) event.preventDefaultAction = true; // no flick
  });
  viewer.addHandler('canvas-pinch', () => drawn && unbox()); // two fingers zoom, and draw nothing
  viewer.addHandler('canvas-release', () => {
    if (!start || !end || !drawn) return;
    const [a, b] = [image().viewportToImageCoordinates(start), image().viewportToImageCoordinates(end)];
    unbox();
    // A tap, or a press that wandered a little, marks nothing: still drawing. On a big picture shown whole, a
    // pixel on screen is many of the picture's, and a speck would take the place of the note's part.
    const region = across >= DRAWN ? within(a.x, a.y, b.x, b.y) : undefined;
    if (!region) return;
    const tell = drawn;
    picture.stopDrawing();
    tell(region);
  });
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !drawn) return;
    const tell = stopped;
    picture.stopDrawing();
    tell?.();
  };
  document.addEventListener('keydown', escape);

  const picture: Picture = {
    inView() {
      if (!opened) return undefined;
      const { x, y, width, height } = image().viewportToImageRectangle(viewer.viewport.getBounds(true));
      return within(x, y, x + width, y + height);
    },
    show(region) {
      if (opened) fit(region);
      else waiting = region;
    },
    mark(regions, selected) {
      // Keyboard focus on a number stays on it as the numbers are made again.
      const focused = marks.findIndex((mark) => mark.contains(document.activeElement));
      const focusedNote = focused < 0 ? undefined : Number(marks[focused].dataset.note);
      unmark();
      if (!opened) {
        viewer.addOnceHandler('open', () => picture.mark(regions, selected));
        return;
      }
      regions.forEach((region, i) => {
        if (!region) return;
        const outline = document.createElement('div');
        outline.className = 'note-area';
        outline.dataset.note = String(i);
        const number = document.createElement('button');
        number.type = 'button';
        number.className = 'note-marker';
        number.textContent = String(i + 1);
        number.setAttribute('aria-label', `Note ${i + 1}`);
        if (i === selected) grab(number, outline, i, region, 'move'); // first, so a drag can keep its click from choosing the note
        // Any other number is only pressed, to open its note: a tap that wanders a little moves nothing.
        else number.addEventListener('pointerdown', (event) => event.stopPropagation()); // a press, not the start of a pan
        number.addEventListener('click', () => onChoose(i));
        outline.append(number);
        if (i === selected) {
          outline.dataset.selected = '';
          number.title = 'Drag to move this part';
          for (const corner of CORNERS) {
            const handle = document.createElement('div');
            handle.className = 'note-handle';
            handle.dataset.corner = corner;
            handle.setAttribute('aria-hidden', 'true'); // the note's own buttons do this from the keyboard
            outline.append(handle);
            grab(handle, outline, i, region, corner);
          }
        }
        viewer.addOverlay({ element: outline, location: area(region) });
        marks.push(outline);
        if (i === focusedNote) number.focus({ preventScroll: true });
      });
    },
    draw(onDrawn, onStopped) {
      drawn = onDrawn;
      stopped = onStopped;
      el.classList.add('drawing');
    },
    stopDrawing() {
      drawn = stopped = undefined;
      unbox();
      el.classList.remove('drawing');
    },
    destroy() {
      document.removeEventListener('keydown', escape);
      letTurn();
      viewer.destroy();
    },
  };
  return picture;
}
