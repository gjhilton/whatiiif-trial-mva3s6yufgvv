import type { Region } from './address';

export type ViewerId = 'openseadragon' | 'mirador';

/** One text in each language it was written in, such as { en: 'Harbour', cy: 'Harbwr' }. */
export type Text = Record<string, string>;

/** A note on the picture, from content/notes.md: the part it is about, its title, and its text as HTML. */
export interface Note {
  region: Region;
  title: Text;
  text?: Text;
}

/** Everything the page knows about the image. Written next to the page by engine/build.js. */
export interface Site {
  /** The language plain texts are in, and the fallback for a text missing in the visitor's language. */
  language: string;
  /** Every language some text is in, the site language first. */
  languages: string[];
  title: Text;
  summary?: Text;
  creator?: Text;
  date?: Text;
  attribution?: Text;
  /** Describes the image for people who cannot see it. */
  alt: Text;
  rights?: string;
  /** How big the original is, which gives the picture a scale. */
  dimensions?: { width: number; height: number; unit: 'mm' | 'cm' | 'm' | 'in'; text: string };
  metadata: { label: Text; value: Text }[];
  /** HTML made from content/description*.md when the site was built. */
  description?: Text;
  /** Notes on the picture, in the order of the tour, and what introduces them: an optional extra. */
  notes?: { intro?: Text; items: Note[] };
  viewer: ViewerId;
  /** Colours chosen in whatiiif.toml, by their names in colours.css; the build writes them into the page. */
  colours?: Record<string, string>;
  manifestUrl: string;
  /** The manifest's one canvas; Mirador keeps a starting view only when it is told which canvas to open. */
  canvasId: string;
  infoUrl: string;
  fullUrl?: string;
  fullBytes?: number;
  /** Where the picture the site was made from can be downloaded, if it can, with its media type and size. */
  originalUrl?: string;
  originalFormat?: string;
  originalBytes?: number;
  width: number;
  height: number;
  /** The page's own public address. */
  pageUrl: string;
  /** For the line at the foot of the page, unless its owner switched it off: the WhatIIIF that made it. */
  footer?: { version: string; url: string };
}

/**
 * The build writes the site's details into the page it personalises, so they need no second request; a page it
 * has not personalised (as Vite serves it while the page is being worked on) asks for site.json instead.
 */
export async function loadSite(): Promise<Site> {
  const written = document.getElementById('whatiiif-site')?.textContent;
  if (written) return JSON.parse(written);
  const response = await fetch('./site.json');
  if (!response.ok) throw new Error(`site.json answered ${response.status}`);
  return response.json();
}
