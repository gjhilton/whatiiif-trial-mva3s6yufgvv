import { useCallback, useEffect, useRef, useState } from 'react';
import type { Site, ViewerId } from './site';
import { chooseLanguage, inLanguage, languageName } from './language';
import { embedCode, linkTo, readAddress, withChoice, withRegion, withinImage, type Region } from './address';
import { citation } from './describe';
import { saveView } from './save';
import { viewers } from './viewers';
import { ViewerPane } from './components/ViewerPane';
import { Details } from './components/Details';
import { Embed } from './components/Embed';
import { Toggle } from './components/Toggle';
import { Tour } from './components/Tour';

const VIEWER_IDS = Object.keys(viewers) as ViewerId[];

/** Changes the address without reloading or adding to the browser's history, so it stays a link to what is shown. */
const showInAddress = (href: string) => {
  if (href !== location.href) history.replaceState(null, '', href);
};

/**
 * The page. As a preview of notes being written (`preview`), it shows them in OpenSeadragon only: Mirador lists the
 * notes from the manifest, which are the notes the site has.
 */
export function App({ site, preview = false }: { site: Site; preview?: boolean }) {
  const [asked] = useState(() => readAddress(location.href, site, VIEWER_IDS));
  const [viewer, setViewer] = useState<ViewerId>(preview ? 'openseadragon' : (asked.viewer ?? site.viewer));
  const [language, setLanguage] = useState(() => chooseLanguage(site, [asked.language, ...navigator.languages]));
  const [region, setRegion] = useState(asked.region);
  const [goTo, setGoTo] = useState<{ region: Region }>();
  const [note, setNote] = useState<number>(); // the note the viewer was last taken to
  const [tour, setTour] = useState<number>(); // where the tour is, while it is being taken
  // Where a newly mounted viewer opens: the region in the link, then wherever the visitor has got to.
  const current = useRef(region);

  const onRegionChange = useCallback(
    (seen: Region) => {
      const next = withinImage(seen, site);
      current.current = next;
      setRegion(next);
      showInAddress(withRegion(location.href, next));
    },
    [site],
  );
  /** Moves the viewer to `part` of the picture, as a detail link or an edited address asks. */
  const show = useCallback((part: Region) => {
    current.current = part;
    setRegion(part);
    setGoTo({ region: part });
    showInAddress(withRegion(location.href, part));
  }, []);
  /** Takes the viewer to note `index`, and the tour with it if it is being taken. */
  const showNote = useCallback(
    (index: number) => {
      const notes = site.notes?.items ?? [];
      if (index < 0 || index >= notes.length) return;
      setNote(index);
      setTour((at) => (at === undefined ? undefined : index));
      show(notes[index].region);
    },
    [site, show],
  );
  const tourButton = useRef<HTMLButtonElement>(null);
  const startTour = () => {
    setTour(0);
    showNote(0);
  };
  const endTour = () => {
    setTour(undefined);
    tourButton.current?.focus({ preventScroll: true }); // where keyboard focus was when the tour began
  };
  useEffect(() => {
    const followAddress = () => {
      const { region: part } = readAddress(location.href, site, VIEWER_IDS);
      if (part) show(part);
    };
    addEventListener('hashchange', followAddress);
    return () => removeEventListener('hashchange', followAddress);
  }, [site, show]);

  const switchViewer = (id: ViewerId) => {
    setViewer(id);
    showInAddress(withChoice(location.href, 'viewer', id));
  };
  const switchLanguage = (tag: string) => {
    setLanguage(tag);
    showInAddress(withChoice(location.href, 'lang', tag));
  };

  const title = inLanguage(site.title, language, site);
  const summary = site.summary && inLanguage(site.summary, language, site);
  useEffect(() => {
    document.title = title.text;
  }, [title.text]);

  const viewerPane = (
    <ViewerPane
      site={site}
      viewer={viewer}
      language={language}
      startAt={current}
      goTo={goTo}
      onRegionChange={onRegionChange}
      embedded={asked.embed}
      onNote={asked.embed || !site.notes ? undefined : showNote}
    />
  );
  const link = linkTo(site, { viewer, language, region });
  if (asked.embed) {
    return (
      <Embed site={site} language={language} fullPage={link}>
        {viewerPane}
      </Embed>
    );
  }

  return (
    <>
      <header className="masthead">
        <div>
          <h1 lang={title.lang}>{title.text}</h1>
          {summary && <p lang={summary.lang}>{summary.text}</p>}
        </div>
        <div className="controls">
          {site.languages.length > 1 && (
            <Toggle label="Language" options={site.languages} chosen={language} onChoose={switchLanguage} name={languageName} lang />
          )}
          {!preview && <Toggle label="Viewer" options={VIEWER_IDS} chosen={viewer} onChoose={switchViewer} name={(id) => viewers[id].label} />}
        </div>
      </header>
      {viewerPane}
      {tour !== undefined && <Tour site={site} language={language} at={tour} onGo={showNote} onEnd={endTour} />}
      <main className="content">
        <Details
          site={site}
          language={language}
          link={link}
          embed={embedCode(linkTo(site, { viewer, language, region, embed: true }), title.text, site)}
          cite={citation(site, language, link, new Date())}
          show={show}
          save={() => saveView(site.infoUrl, title.text, region)}
          note={note}
          showNote={showNote}
          startTour={startTour}
          tourButton={tourButton}
        />
      </main>
    </>
  );
}
