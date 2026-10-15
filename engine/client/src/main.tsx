import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSite } from './site';
import { darkPage } from './colours';
import './colours.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

loadSite().then(
  (site) => {
    // A background of the owner's own holds in light and dark mode alike, so the browser's own parts (scroll bars,
    // for one) follow it, not the computer's setting.
    if (site.colours?.paper) document.documentElement.style.colorScheme = darkPage() ? 'dark' : 'light';
    root.render(
      <StrictMode>
        <App site={site} />
      </StrictMode>,
    );
  },
  () => root.render(<p className="load-error">This page could not load the details of its image (site.json).</p>),
);
