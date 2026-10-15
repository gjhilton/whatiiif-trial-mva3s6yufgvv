import { useState, type MouseEvent, type RefObject } from 'react';
import type { Site } from '../site';
import { inLanguage } from '../language';
import { regionLinked, type Region } from '../address';
import { fileSize, formatName, rightsName } from '../describe';
import { CopyField } from './CopyField';
import { Notes } from './Notes';

interface Props {
  site: Site;
  language: string;
  /** The address of the page as it is being looked at, view and all. */
  link: string;
  /** The HTML that shows that view on another page. */
  embed: string;
  /** A citation of that view. */
  cite: string;
  /** Moves the viewer to a part of the picture, as a detail link in the description asks. */
  show: (region: Region) => void;
  /** Downloads the view as a picture. */
  save: () => Promise<void>;
  /** The note the viewer was last taken to, taking it to another, and starting the tour. */
  note?: number;
  showNote: (index: number) => void;
  startTour: () => void;
  tourButton: RefObject<HTMLButtonElement | null>;
}

export function Details({ site, language, link, embed, cite, show, save, note, showNote, startTour, tourButton }: Props) {
  const [saving, setSaving] = useState<'saving' | 'failed'>();
  const saveView = async () => {
    setSaving('saving');
    try {
      await save();
      setSaving(undefined);
    } catch {
      setSaving('failed');
    }
  };
  const { manifestUrl, infoUrl, fullUrl, originalUrl, rights } = site;
  const words = (text: Site['title']) => inLanguage(text, language, site);
  const description = site.description && words(site.description);
  const attribution = site.attribution && words(site.attribution);
  // [label, value], each with the language it is in; our own labels and the dimensions need none
  const pixels = `${site.width.toLocaleString()} × ${site.height.toLocaleString()} px`;
  const rows: { text: string; lang?: string }[][] = [
    ...(site.creator ? [[{ text: 'Creator' }, words(site.creator)]] : []),
    ...(site.date ? [[{ text: 'Date' }, words(site.date)]] : []),
    ...site.metadata.map(({ label, value }) => [words(label), words(value)]),
    [{ text: 'Dimensions' }, { text: site.dimensions ? `${site.dimensions.text} (${pixels})` : pixels }],
  ];

  // A link in the description to a part of the picture moves the viewer there rather than opening the page again.
  const followDetailLink = (event: MouseEvent) => {
    const link = (event.target as Element).closest('a');
    const region = link && regionLinked(link.href, site, location.href);
    if (!region || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    show(region);
  };

  return (
    <div className="details">
      <section>
        {description && (
          <div className="prose" lang={description.lang} onClick={followDetailLink} dangerouslySetInnerHTML={{ __html: description.text }} />
        )}
        <Notes site={site} language={language} current={note} onShow={showNote} onTour={startTour} tourButton={tourButton} />
        <table className="meta">
          <tbody>
            {rows.map(([label, value], i) => (
              <tr key={i}>
                <th scope="row" lang={label.lang}>{label.text}</th>
                <td lang={value.lang}>{value.text}</td>
              </tr>
            ))}
            {attribution && (
              <tr>
                <th scope="row">Attribution</th>
                <td lang={attribution.lang}>{attribution.text}</td>
              </tr>
            )}
            {rights && (
              <tr>
                <th scope="row">Rights</th>
                <td><a href={rights}>{rightsName(rights)}</a></td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="uses">
        <h2>Share this view</h2>
        <CopyField label="Link to this view" value={link} />
        <CopyField label="Embed on a web page" value={embed} />
        <CopyField label="Cite this view" value={cite} />

        <h2>Use it in any IIIF viewer</h2>
        <CopyField label="Manifest URL" value={manifestUrl} />
        <CopyField label="Image service (info.json)" value={infoUrl} />
        <p className="links">
          <a href={`https://projectmirador.org/embed/?iiif-content=${encodeURIComponent(manifestUrl)}`}>Open in Mirador</a>
          <a href={`https://universalviewer.dev/uv.html#?manifest=${encodeURIComponent(manifestUrl)}`}>Open in Universal Viewer</a>
          <a href={manifestUrl}>View manifest</a>
        </p>

        <h2>Download</h2>
        <p className="links">
          <button type="button" className="link" onClick={saveView} disabled={saving === 'saving'}>
            {saving === 'saving' ? 'Saving this view…' : 'This view, as a JPEG'}
          </button>
          {fullUrl && <a href={fullUrl}>Full-size JPEG{site.fullBytes && ` (${fileSize(site.fullBytes)})`}</a>}
          {originalUrl && (
            <a href={originalUrl} rel="nofollow">
              Original file
              {site.originalFormat && ` (${[formatName(site.originalFormat), site.originalBytes && fileSize(site.originalBytes)].filter(Boolean).join(', ')})`}
            </a>
          )}
        </p>
        {saving === 'failed' && <p className="problem" role="alert">This view could not be saved. Try again, or zoom out a little.</p>}
      </section>

      {/* On paper the copy fields are no use: the citation, with its link, is written out instead. */}
      <section className="print-only">
        <h2>Cite this view</h2>
        <p>{cite}</p>
      </section>
    </div>
  );
}
