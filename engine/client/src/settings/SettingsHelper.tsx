// The settings helper: a form that writes content/whatiiif.toml for its owner, checked by the same code the build
// uses, to paste into the file on GitHub. It saves nothing itself, so it needs no login and no token.
import { useEffect, useState, type ReactNode } from 'react';
import { parseConfig } from '../../../lib/config.js';
import { withLanguage, writeConfig } from '../../../lib/write-config.js';
import { rightsName } from '../describe';
import { languageName } from '../language';
import type { Text } from '../site';
import { TextField } from './TextField';

/** The settings as config.js reads them; a form holds the dimensions as typed. */
export interface Settings {
  language: string;
  title?: Text;
  summary?: Text;
  creator?: Text;
  date?: Text;
  attribution?: Text;
  alt?: Text;
  rights?: string;
  dimensions?: string | { text: string };
  picture?: string;
  viewer: string;
  base_url?: string;
  metadata: { label: Text; value: Text }[];
  tiles: { size: number; quality: number };
  publish: { full: boolean; original: boolean };
  colours: Record<string, string>;
}

const COMMON_RIGHTS = [
  'http://creativecommons.org/licenses/by/4.0/',
  'http://creativecommons.org/licenses/by-sa/4.0/',
  'http://creativecommons.org/licenses/by-nc/4.0/',
  'http://creativecommons.org/licenses/by-nc-sa/4.0/',
  'http://creativecommons.org/licenses/by-nd/4.0/',
  'http://creativecommons.org/licenses/by-nc-nd/4.0/',
  'http://creativecommons.org/publicdomain/zero/1.0/',
  'http://creativecommons.org/publicdomain/mark/1.0/',
  'http://rightsstatements.org/vocab/InC/1.0/',
  'http://rightsstatements.org/vocab/InC-EDU/1.0/',
  'http://rightsstatements.org/vocab/InC-NC/1.0/',
  'http://rightsstatements.org/vocab/NoC-US/1.0/',
  'http://rightsstatements.org/vocab/NKC/1.0/',
  'http://rightsstatements.org/vocab/CNE/1.0/',
  'http://rightsstatements.org/vocab/UND/1.0/',
];
const OTHER = 'other';
const COLOURS: [string, string][] = [
  ['paper', 'Background'],
  ['ink', 'Text, lines and the selected button'],
  ['viewer', 'Behind the picture'],
  ['error', 'Messages about something that went wrong'],
];

/** The file for `settings`, and what the build would say is wrong with it, if anything. */
function check(settings: Settings): { toml: string; problem?: string } {
  const toml = writeConfig(settings);
  try {
    parseConfig(toml);
    return { toml };
  } catch (error) {
    return { toml, problem: (error as Error).message };
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function SettingsHelper({ initial, editUrl, title }: { initial?: Settings; editUrl?: string; title?: string }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...(parseConfig('') as Settings), ...initial }));
  // Most sites are in one language, so translations are offered only on request, or when there are some already.
  const [translating, setTranslating] = useState(() => {
    const texts = [initial?.title, initial?.summary, initial?.creator, initial?.date, initial?.attribution, initial?.alt];
    const all = [...texts, ...(initial?.metadata ?? []).flatMap(({ label, value }) => [label, value])];
    return all.some((text) => text && Object.keys(text).some((tag) => tag !== initial?.language));
  });
  const set = <K extends keyof Settings>(name: K, value: Settings[K]) => setSettings((now) => ({ ...now, [name]: value }));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const { toml, problem } = check(settings);
  const rightsChoice = !settings.rights ? '' : COMMON_RIGHTS.includes(settings.rights) ? settings.rights : OTHER;
  const dimensions = typeof settings.dimensions === 'object' ? settings.dimensions.text : (settings.dimensions ?? '');
  const text = (name: 'title' | 'summary' | 'creator' | 'date' | 'attribution' | 'alt', label: string, hint?: string, multiline = false) => (
    <TextField
      label={label}
      hint={hint}
      value={settings[name]}
      language={settings.language}
      multiline={multiline}
      translatable={translating}
      onChange={(value) => set(name, value)}
    />
  );

  return (
    <div className="settings">
      <header className="masthead">
        <div>
          <h1>Settings</h1>
          {title && <p>{title}</p>}
        </div>
      </header>
      <main className="settings-columns">
        <form className="settings-form" onSubmit={(event) => event.preventDefault()}>
          <section>
            <h2>Language</h2>
            <Field label="Language of your texts" hint={`A language code such as en, cy or de-CH: ${languageName(settings.language)}.`}>
              <input value={settings.language} onChange={(event) => setSettings((now) => withLanguage(now, event.target.value.trim()))} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={translating} onChange={(event) => setTranslating(event.target.checked)} />
              Give texts in other languages too
            </label>
          </section>

          <section>
            <h2>About the picture</h2>
            {text('title', 'Title', 'Left blank, the title is the picture’s file name.')}
            {text('summary', 'Summary', 'One line, shown under the title.')}
            {text('creator', 'Creator', 'Who made it.')}
            {text('date', 'Date', 'When it was made, in any form: 1890, about 1890, 1890–1895.')}
            {text('attribution', 'Credit', 'Who to credit, such as the collection it belongs to.')}
            {text('alt', 'Description for people who cannot see it', 'Left blank, the title is used.', true)}
            <Field label="Real size" hint="Width × height of the original, in mm, cm, m or in, such as 120 × 80 cm. It gives the picture a scale bar.">
              <input value={dimensions} onChange={(event) => set('dimensions', event.target.value)} />
            </Field>
          </section>

          <section>
            <h2>Licence</h2>
            <Field label="Licence or rights statement">
              <select
                value={rightsChoice}
                onChange={(event) => set('rights', event.target.value === OTHER ? 'https://' : event.target.value || undefined)}
              >
                <option value="">None given</option>
                {COMMON_RIGHTS.map((url) => (
                  <option key={url} value={url}>{rightsName(url)}</option>
                ))}
                <option value={OTHER}>Another Creative Commons or RightsStatements.org address</option>
              </select>
            </Field>
            {rightsChoice === OTHER && (
              <Field label="Its address">
                <input value={settings.rights ?? ''} onChange={(event) => set('rights', event.target.value)} />
              </Field>
            )}
          </section>

          <section>
            <h2>More details</h2>
            {settings.metadata.map((entry, i) => (
              <fieldset key={i} className="detail">
                <legend>Detail {i + 1}</legend>
                <TextField
                  label="Name"
                  value={entry.label}
                  language={settings.language}
                  translatable={translating}
                  onChange={(label) => set('metadata', settings.metadata.map((e, j) => (j === i ? { ...e, label: label ?? {} } : e)))}
                />
                <TextField
                  label="Value"
                  value={entry.value}
                  language={settings.language}
                  translatable={translating}
                  onChange={(value) => set('metadata', settings.metadata.map((e, j) => (j === i ? { ...e, value: value ?? {} } : e)))}
                />
                <button type="button" className="quiet" onClick={() => set('metadata', settings.metadata.filter((_, j) => j !== i))}>
                  Remove this detail
                </button>
              </fieldset>
            ))}
            <button type="button" onClick={() => set('metadata', [...settings.metadata, { label: {}, value: {} }])}>
              Add a detail
            </button>
          </section>

          <section>
            <h2>The page</h2>
            <Field label="Viewer it opens in" hint="Visitors can switch.">
              <select value={settings.viewer} onChange={(event) => set('viewer', event.target.value)}>
                <option value="openseadragon">OpenSeadragon</option>
                <option value="mirador">Mirador</option>
              </select>
            </Field>
            <fieldset>
              <legend>Your own colours</legend>
              <p className="hint">Left blank, the page is black on white, or white on black in dark mode. Any CSS colour works.</p>
              {COLOURS.map(([name, label]) => (
                <Field key={name} label={label}>
                  <span className="colour">
                    <input
                      value={settings.colours[name] ?? ''}
                      onChange={(event) => {
                        const { [name]: _, ...rest } = settings.colours;
                        set('colours', event.target.value.trim() ? { ...rest, [name]: event.target.value } : rest);
                      }}
                    />
                    <span className="swatch" style={{ background: settings.colours[name] }} aria-hidden="true" />
                  </span>
                </Field>
              ))}
            </fieldset>
          </section>

          <section>
            <h2>Publishing</h2>
            <Field label="Picture too big to upload" hint="The link to it in a GitHub release; see the README’s Large pictures. Leave blank for a picture in content/.">
              <input value={settings.picture ?? ''} onChange={(event) => set('picture', event.target.value || undefined)} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={settings.publish.full} onChange={(event) => set('publish', { ...settings.publish, full: event.target.checked })} />
              Offer the full-size JPEG to download
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.publish.original} onChange={(event) => set('publish', { ...settings.publish, original: event.target.checked })} />
              Offer the original file to download
            </label>
            <details>
              <summary>Advanced</summary>
              <Field label="Tile size, in pixels" hint="64 to 4096.">
                <input type="number" min={64} max={4096} value={settings.tiles.size} onChange={(event) => set('tiles', { ...settings.tiles, size: event.target.valueAsNumber })} />
              </Field>
              <Field label="JPEG quality" hint="1 to 100.">
                <input type="number" min={1} max={100} value={settings.tiles.quality} onChange={(event) => set('tiles', { ...settings.tiles, quality: event.target.valueAsNumber })} />
              </Field>
              <Field label="Address, for a custom domain" hint="Only if GitHub Pages does not know it already.">
                <input value={settings.base_url ?? ''} onChange={(event) => set('base_url', event.target.value || undefined)} />
              </Field>
            </details>
          </section>
        </form>

        <aside className="settings-file">
          <h2>Your whatiiif.toml</h2>
          {problem ? <p className="problem" role="alert">{problem}</p> : <p className="hint">Ready to use.</p>}
          <textarea readOnly value={toml} aria-label="whatiiif.toml" rows={16} wrap="off" onFocus={(event) => event.currentTarget.select()} />
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(toml).then(() => setCopied(true), () => {})}
            aria-live="polite"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <ol>
            <li>Copy it.</li>
            <li>
              {editUrl ? <a href={editUrl}>Open whatiiif.toml on GitHub</a> : <>Open <code>content/whatiiif.toml</code> on GitHub</>}, select everything in
              it, and paste over it.
            </li>
            <li>Click <b>Commit changes</b>. The site rebuilds itself in a minute or two.</li>
          </ol>
        </aside>
      </main>
    </div>
  );
}
