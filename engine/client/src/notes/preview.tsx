// The site's page as a preview of the notes being written in the notes helper, before they are published: the
// helper keeps them in the browser, and the page, opened with ?notes-draft, shows them in place of the site's own.
import type { MouseEvent } from 'react';
import type { Site } from '../site';
import { draftAsKept, languagesOf, loadDraft, previewOf, problemsOf } from './draft';

const storage = () => {
  try {
    return localStorage;
  } catch {
    return undefined; // a browser that keeps nothing has no draft to show
  }
};

/**
 * `site` with the notes kept by the notes helper, as the build would make them, or what would stop the build making
 * them; as it is if there are none. `version` changes when, and only when, they do.
 */
export function withDraft(site: Site): { site: Site; drafted: boolean; problem?: string; version: string } {
  const kept = storage();
  const draft = kept && loadDraft(kept, site.pageUrl);
  if (!draft) return { site, drafted: false, version: '' };
  const { notes, problem } = previewOf(draft.notes, site.language, site.pageUrl);
  // Said as the helper says it, about a note, where it can be, rather than as the build says it about the file.
  const files = languagesOf(draft.notes, site.language).map((language) => ({ file: language === site.language ? 'notes.md' : `notes.${language}.md`, language, text: '' }));
  const said = problem && (problemsOf(draft.notes, files, site)[0]?.message ?? problem);
  return { site: { ...site, notes }, drafted: true, problem: said, version: draftAsKept(kept, site.pageUrl) };
}

/**
 * Back to the helper that opened this preview, closing it, rather than a second helper in its place, which would only
 * wait for the first to be closed.
 */
function back(event: MouseEvent) {
  try {
    if (!opener || opener.closed || opener.location.origin !== location.origin) return;
  } catch {
    return; // a page elsewhere opened this one
  }
  event.preventDefault();
  opener.focus();
  close();
  setTimeout(() => location.assign('notes.html'), 300); // the browser would not close it
}

/** Says, above the page, that it is a preview, or why the notes cannot be shown, and leads back to the helper. */
export function PreviewBanner({ drafted, problem }: { drafted: boolean; problem?: string }) {
  return (
    <p className="preview-banner" role="status">
      {!drafted
        ? 'A preview of the notes helper’s changes, but there are none: these are the notes your site has.'
        : problem
          ? `The notes you are writing cannot be shown yet: ${problem}`
          : 'A preview of the notes you are writing, which are not on your site yet: its visitors still see the notes it has.'}{' '}
      <a href="notes.html" onClick={back}>Back to the notes helper</a>
    </p>
  );
}
