import { createHostedTokenProvider, mountShowMe, type WidgetHandle } from './widget.js';

export type PageGuideOptions = { name: string } & (
  { backendOrigin: string; sessionEndpoint: string; tokenEndpoint?: never } |
  { tokenEndpoint: string; backendOrigin?: never; sessionEndpoint?: never }
);

export interface PageSnapshot {
  title: string;
  path: string;
  headings: string[];
  controls: string[];
  alerts: string[];
  focusedControl: string | null;
}

type PageState = { revision: number; page: PageSnapshot };

const clean = (value: string | null | undefined, max = 100) =>
  (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement) || element.closest('[hidden], [aria-hidden="true"], [data-showme-private]')) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function controlName(element: Element): string {
  if (!(element instanceof HTMLElement)) return '';
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const label = 'labels' in element ? [...(element.labels ?? [])].map((item) => clean(item.textContent)).join(' ') : '';
    return clean(label || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.name);
  }
  return clean(element.getAttribute('aria-label') || element.textContent);
}

/** Reads only visible page labels and structure. Never reads form values or URL query strings. */
export function snapshotVisiblePage(): PageSnapshot {
  const collect = (selector: string, limit: number, name: (element: Element) => string) => {
    const values: string[] = [];
    let inspected = 0;
    for (const element of document.querySelectorAll(selector)) {
      if (++inspected > 300) break;
      if (!visible(element)) continue;
      const value = name(element);
      if (value && !values.includes(value)) values.push(value);
      if (values.length >= limit) break;
    }
    return values;
  };
  const focused = document.activeElement;
  return {
    title: clean(document.title, 120),
    path: location.pathname.slice(0, 160),
    headings: collect('h1, h2, h3', 12, (element) => clean(element.textContent)),
    controls: collect('label, button, [role="button"], input:not([type="hidden"]):not([type="password"]), select, textarea, a',
      40, controlName),
    alerts: collect('[role="alert"], [aria-live="assertive"]', 5, (element) => clean(element.textContent, 160)),
    focusedControl: focused && visible(focused) ? controlName(focused) || null : null,
  };
}

/** One-call, guidance-only install for an ordinary website. Explicit host actions are required for edits. */
export function mountShowMeOnPage(options: PageGuideOptions): WidgetHandle<PageState> {
  if (!document.body) throw new Error('Mount ShowMe after the page body is ready.');
  if (options.tokenEndpoint && new URL(options.tokenEndpoint, location.href).origin !== location.origin)
    throw new Error('The direct ShowMe token endpoint must be on this website.');
  const host = document.createElement('div');
  host.id = 'showme-page-guide';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483000;font:14px system-ui,-apple-system,Segoe UI,sans-serif}
    *{box-sizing:border-box}.launcher{border:0;border-radius:999px;padding:13px 18px;background:#205f40;color:#fff;font:600 14px system-ui;box-shadow:0 8px 24px #12362255;cursor:pointer}
    .drawer{position:absolute;right:0;bottom:62px;width:min(390px,calc(100vw - 28px));max-height:calc(100vh - 90px);overflow:hidden;border-radius:17px;box-shadow:0 20px 50px #15392555;background:#fff}
    .drawer[hidden]{display:none}.close{display:block;width:100%;border:0;padding:7px 14px;text-align:right;background:#205f40;color:#fff;font:600 12px system-ui;cursor:pointer}
    .mount{--showme-width:100%;--showme-height:min(650px,calc(100vh - 125px));--showme-min-height:0}
    button:focus-visible{outline:3px solid #9bd5ac;outline-offset:2px}
    @media(max-width:500px){:host{right:12px;bottom:12px}.drawer{width:calc(100vw - 24px);bottom:56px}}`;
  const drawer = document.createElement('div');
  drawer.className = 'drawer'; drawer.hidden = true;
  const close = document.createElement('button');
  close.className = 'close'; close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close ShowMe');
  const mount = document.createElement('div'); mount.className = 'mount';
  drawer.append(close, mount);
  const launcher = document.createElement('button');
  launcher.className = 'launcher'; launcher.type = 'button'; launcher.textContent = 'Ask ShowMe';
  launcher.setAttribute('aria-expanded', 'false');
  shadow.append(style, drawer, launcher);
  document.body.append(host);

  let revision = 0;
  let fingerprint = '';
  const read = async (): Promise<PageState> => {
    const page = snapshotVisiblePage();
    const next = JSON.stringify(page);
    if (next !== fingerprint) { fingerprint = next; revision++; }
    return { revision, page };
  };
  const tokenProvider = options.tokenEndpoint ? async () => {
    const response = await fetch(options.tokenEndpoint, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await response.json();
    if (!response.ok || typeof data.token !== 'string') throw new Error('Could not start a ShowMe session.');
    return { token: data.token as string };
  } : createHostedTokenProvider({ backendOrigin: options.backendOrigin!, sessionEndpoint: options.sessionEndpoint! });
  let widget: WidgetHandle<PageState>;
  try {
    widget = mountShowMe<PageState>({
      element: mount, name: options.name, read,
      revisionOf: (state) => state.revision,
      summarize: (state) => state.page,
      initialMode: 'guide', actions: [],
      assistantInstructions: 'This is a guidance-only integration. Explain how to use visible controls and ask for missing details. You have no tool to click, type, save, purchase, submit, or change the host page. Never claim to have done so. Form values and URL query strings are intentionally unavailable.',
      tokenProvider,
    });
  } catch (error) { host.remove(); throw error; }
  const setOpen = (open: boolean) => {
    drawer.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) close.focus(); else launcher.focus();
  };
  launcher.addEventListener('click', () => setOpen(drawer.hidden));
  close.addEventListener('click', () => setOpen(false));
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (JSON.stringify(snapshotVisiblePage()) !== fingerprint) void widget.refresh().catch(console.error);
    }, 350);
  };
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  document.addEventListener('focusin', scheduleRefresh);
  return {
    refresh: widget.refresh,
    setMode: widget.setMode,
    reset: widget.reset,
    async destroy() {
      observer.disconnect();
      window.removeEventListener('popstate', scheduleRefresh);
      window.removeEventListener('hashchange', scheduleRefresh);
      document.removeEventListener('focusin', scheduleRefresh);
      if (refreshTimer) clearTimeout(refreshTimer);
      await widget.destroy();
      host.remove();
    },
  };
}
