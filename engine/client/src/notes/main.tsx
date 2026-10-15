import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotesHelper, type Links, type NotesSource } from './NotesHelper';
import type { Site } from '../site';
import '../colours.css';
import '../styles.css';

/**
 * What the build left for this page: the site, its notes files as written, and where to change them on GitHub;
 * fetched afresh, never as the browser kept them, since notes just published must not be taken for older ones.
 */
async function load(): Promise<{ site: Site; notes?: NotesSource; links: Links }> {
  const json = (file: string) =>
    fetch(`./${file}`, { cache: 'no-store' }).then((response) =>
      response.ok ? response.json() : Promise.reject(Object.assign(new Error(`${file} answered ${response.status}`), { status: response.status })),
    );
  // A site built before there was a notes helper has no settings.json, and no notes: the form starts empty. Any other
  // failure is not taken for no notes, which the owner might then write over their own.
  const missing = (error: { status?: number }) => (error.status === 404 ? {} : Promise.reject(error));
  const [site, { notes, notesUrl, uploadUrl, actionsUrl }] = await Promise.all([json('site.json'), json('settings.json').catch(missing)]);
  return { site, notes, links: { notesUrl, uploadUrl, actionsUrl } };
}

/**
 * Opens the helper only where no other is open on the same site, in another tab or window: two would each keep
 * their own changes over the other's. Another waits, saying so, and once the first is closed, starts afresh from
 * the changes it kept. (A browser without Web Locks opens every one.)
 */
function alone(pageUrl: string, open: () => void, wait: () => void) {
  if (!navigator.locks) return open();
  const name = `whatiiif notes helper: ${pageUrl}`;
  navigator.locks.request(name, { ifAvailable: true }, (lock) => {
    if (lock) {
      open();
      return new Promise(() => {}); // held while this page is open
    }
    wait();
    navigator.locks.request(name, () => location.reload());
    return undefined;
  });
}

const root = createRoot(document.getElementById('root')!);
load().then(
  ({ site, notes, links }) => {
    const title = site.title[site.language] ?? Object.values(site.title)[0];
    document.title = `Notes: ${title}`;
    alone(
      site.pageUrl,
      () =>
        root.render(
          <StrictMode>
            <NotesHelper site={site} source={notes} links={links} />
          </StrictMode>,
        ),
      () =>
        root.render(
          <div className="settings notes-helper-elsewhere">
            <header className="masthead">
              <div>
                <h1>Notes</h1>
                <p>{title}</p>
              </div>
            </header>
            <p className="notes-elsewhere" role="status">
              The notes helper for this site is open in another tab or window. Carry on there: two would each keep their own changes over the
              other’s. Once that one is closed, this one carries on from its changes.
            </p>
          </div>,
        ),
    );
  },
  () =>
    root.render(
      <p className="load-error">
        This page could not load your site’s details and notes. Reload it to try again: any changes this browser keeps for you are kept still.
      </p>,
    ),
);
