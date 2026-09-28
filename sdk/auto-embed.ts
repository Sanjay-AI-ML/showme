import { mountShowMeOnPage } from './page-guide.js';

declare global {
  interface Window { ShowMe?: { mount: typeof mountShowMeOnPage } }
}

window.ShowMe = { mount: mountShowMeOnPage };

const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.showmeSession || script?.dataset.showmeTokenEndpoint) {
  const start = () => {
    try {
      const name = script.dataset.showmeName || document.title || 'This website';
      if (script.dataset.showmeTokenEndpoint) {
        mountShowMeOnPage({ name, tokenEndpoint: script.dataset.showmeTokenEndpoint });
      } else {
        mountShowMeOnPage({ name, backendOrigin: script.dataset.showmeBackend || new URL(script.src).origin,
          sessionEndpoint: script.dataset.showmeSession! });
      }
    } catch (error) { console.error('ShowMe could not start:', error); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
