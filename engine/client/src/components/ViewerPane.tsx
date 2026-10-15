import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { viewers } from '../viewers';
import type { MountedViewer } from '../viewers/types';
import type { Site, ViewerId } from '../site';
import { inLanguage } from '../language';
import type { Region } from '../address';
import { keepUpright } from '../viewers/upright';

interface Props {
  site: Site;
  viewer: ViewerId;
  language: string;
  /** The part of the picture a newly mounted viewer opens on: the one in the link, then wherever the visitor got to. */
  startAt: RefObject<Region | undefined>;
  /** A part of the picture to move to, as a detail link asks; each new object is a new request. */
  goTo?: { region: Region };
  onRegionChange: (region: Region) => void;
  /** Inside someone else's page. */
  embedded: boolean;
  /** Told which note's marker the visitor chose; without it, no markers are shown. */
  onNote?: (index: number) => void;
}

const DARK = '(prefers-color-scheme: dark)';

/** Mounts the chosen viewer adapter into a fresh container and tears it down on change. */
export function ViewerPane({ site, viewer, language, startAt, goTo, onRegionChange, embedded, onNote }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedViewer>(undefined);
  const [error, setError] = useState<string>();
  const alt = inLanguage(site.alt, language, site);
  const viewerLanguage = viewers[viewer].localised ? language : site.language;
  // The viewers take the page's colours when they open, so one opens again when the computer turns dark or light.
  const [dark, setDark] = useState(() => matchMedia(DARK).matches);
  useEffect(() => {
    const query = matchMedia(DARK);
    const change = () => setDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  // Links to the view describe the picture as it is, so neither viewer turns or mirrors it.
  useEffect(() => keepUpright(host.current!), []);

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement('div');
    el.className = 'viewer-surface';
    host.current?.replaceChildren(el);
    setError(undefined);
    const fail = (message: string) => {
      if (!cancelled) setError(message);
    };

    viewers[viewer]
      .load()
      .then((adapter) => {
        if (cancelled) return;
        mounted.current = adapter.mount(el, site, {
          language: viewerLanguage,
          region: startAt.current,
          onRegionChange,
          onError: fail,
          cooperative: embedded,
          onNote,
        });
      })
      .catch((e: Error) => fail(`Could not load ${viewers[viewer].label}: ${e.message}`));

    return () => {
      cancelled = true;
      mounted.current?.destroy();
      mounted.current = undefined;
    };
  }, [site, viewer, viewerLanguage, startAt, onRegionChange, embedded, dark, onNote]);

  useEffect(() => {
    if (!goTo) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    host.current?.parentElement?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
    mounted.current?.show(goTo.region); // a viewer still loading opens there anyway: startAt has it
  }, [goTo]);

  // A viewer draws on a canvas, which a printed page would show stretched to its own shape: what is on screen is
  // printed as a still picture instead.
  const [snapshot, setSnapshot] = useState<string>();
  useEffect(() => {
    const before = () => {
      const canvases = [...(host.current?.querySelectorAll('canvas') ?? [])];
      const drawn = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0]; // the viewer's, not its overview
      try {
        // PNG: JPEG would blur the edges between colours, and turn the canvas's clear margins black.
        flushSync(() => setSnapshot(drawn?.toDataURL('image/png')));
      } catch {
        // A canvas that cannot be read is printed as it is.
      }
    };
    const after = () => setSnapshot(undefined);
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    return () => {
      removeEventListener('beforeprint', before);
      removeEventListener('afterprint', after);
    };
  }, []);

  // Tall enough for the picture's shape at the page's width, between 22rem and most of the window.
  const shape = { '--shape': site.width / site.height } as CSSProperties;
  return (
    <div className="viewer" style={shape} role="region" aria-label="Image viewer" aria-describedby="viewer-alt">
      <p id="viewer-alt" className="visually-hidden" lang={alt.lang}>{alt.text}</p>
      <div className="viewer-host" ref={host} />
      {snapshot && <img className="print-view" src={snapshot} alt={alt.text} lang={alt.lang} />}
      {error && <p className="viewer-error">{error}</p>}
    </div>
  );
}
