import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { calculateTotal, dueDate, type AppState, type EditOperation, type FocusTarget, type Mode, type Terms } from '../../shared/types';
import { api } from './api';
import { InvoiceHostAdapter } from './host';
import { ShowMeVoice } from './voice';
import { createInvoiceVoiceIntegration } from './invoice-voice';
import { ProfileApp } from './profile';
import { WidgetDemo } from './widget-demo';
import './styles.css';
import './hallmark.css';

const host = new InvoiceHostAdapter();
const money = (cents: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(cents / 100);
const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const modeLabel: Record<Mode, string> = { guide: 'Guide me', collaborate: 'Do it with me', delegate: 'Do it for me', manual: 'I’ll take over' };
const termsLabel: Record<Terms, string> = { due_on_receipt: 'Due on receipt', net_15: 'Net 15', net_30: 'Net 30' };
const help: Record<FocusTarget, string> = {
  customer: 'Choose the person or business receiving this invoice.',
  items: 'Add products from the catalog. Change quantities whenever you need to.',
  delivery: 'Delivery appears on a separate line in the invoice total.',
  terms: 'Payment terms set the due date from the issue date.',
  preview: 'Review the invoice before saving it as a draft.',
};
type Message = { id: string; speaker: 'user' | 'agent' | 'system'; text: string };

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [auth, setAuth] = useState<'loading' | 'signed-out' | 'signed-in'>('loading');
  const [pilotMode, setPilotMode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerCity, setCustomerCity] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [creatingCatalog, setCreatingCatalog] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Voice off');
  const [connecting, setConnecting] = useState(false);
  const [feedback, setFeedback] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', speaker: 'agent', text: 'Hi! I can help you create this invoice, explain a field, or guide you step by step.' },
  ]);
  const voiceRef = useRef<ShowMeVoice<AppState> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerDetails = useRef<HTMLDetailsElement | null>(null);
  const productDetails = useRef<HTMLDetailsElement | null>(null);
  const accountDialog = useRef<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState<FocusTarget | null>(null);

  useEffect(() => {
    const unsubscribe = host.onChange(setState);
    const endOnPageHide = () => { void voiceRef.current?.stop(); };
    window.addEventListener('pagehide', endOnPageHide);
    void api.auth().then(async (result) => {
      setPilotMode(result.required);
      if (result.required && !result.authenticated) { setAuth('signed-out'); return; }
      await host.getContext();
      setAuth('signed-in');
      if (result.required && new URLSearchParams(window.location.search).get('account') === '1') setAccountOpen(true);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load invoice.'));
    void api.capabilities().then((result) => setVoiceAvailable(result.voice)).catch(() => {});
    return () => { unsubscribe(); window.removeEventListener('pagehide', endOnPageHide); void voiceRef.current?.stop(); if (highlightTimer.current) clearTimeout(highlightTimer.current); };
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    accountDialog.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAccountOpen(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = accountDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [accountOpen]);

  const total = useMemo(() => state ? calculateTotal(state.invoice, state.products) : 0, [state]);
  const customer = state?.customers.find((item) => item.id === state.invoice.customerId);
  const steps = [Boolean(customer), Boolean(state?.invoice.items.length), state?.invoice.status === 'saved'];
  const progress = steps.filter(Boolean).length;

  function track(kind: string, channel: 'voice' | 'text' | null = null) {
    void api.validationEvent(kind, channel).catch(() => {});
  }

  function addMessage(speaker: Message['speaker'], text: string) {
    if (!text.trim()) return;
    if (speaker === 'user') track('turn', voiceRef.current?.inputMode ?? null);
    setMessages((current) => [...current.slice(-30), { id: crypto.randomUUID(), speaker, text }]);
  }

  async function edit(operation: EditOperation, fields: Record<string, unknown> = {}) {
    if (!state) return;
    setError('');
    try {
      const current = await host.getContext();
      const result = await host.execute({ operation, expectedRevision: current.invoice.revision, requestId: crypto.randomUUID(), source: 'manual', ...fields });
      voiceRef.current?.notifyHostChange(result.state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
      await host.getContext().catch(() => {});
    }
  }

  async function createCustomer(event: React.FormEvent) {
    event.preventDefault(); setError(''); setCreatingCatalog(true);
    try {
      const created = await host.addCustomer({ name: customerName, city: customerCity, email: customerEmail });
      setCustomerName(''); setCustomerCity(''); setCustomerEmail('');
      const selected = await host.execute({ operation: 'select_customer', customerId: created.customer.id,
        expectedRevision: created.state.invoice.revision, requestId: crypto.randomUUID(), source: 'manual' });
      voiceRef.current?.notifyHostChange(selected.state);
      if (customerDetails.current) customerDetails.current.open = false;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add customer.'); await host.getContext().catch(() => {}); }
    finally { setCreatingCatalog(false); }
  }

  async function createProduct(event: React.FormEvent) {
    event.preventDefault(); setError(''); setCreatingCatalog(true);
    const priceCents = Math.round(Number(productPrice) * 100);
    try {
      const created = await host.addProduct({ name: productName, description: productDescription, priceCents });
      setProductName(''); setProductDescription(''); setProductPrice('');
      const selected = await host.execute({ operation: 'upsert_item', productId: created.product.id, quantity: 1,
        expectedRevision: created.state.invoice.revision, requestId: crypto.randomUUID(), source: 'manual' });
      voiceRef.current?.notifyHostChange(selected.state);
      if (productDetails.current) productDetails.current.open = false;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add product.'); await host.getContext().catch(() => {}); }
    finally { setCreatingCatalog(false); }
  }

  async function chooseMode(mode: Mode) {
    setError('');
    try { const next = await host.setMode(mode); voiceRef.current?.notifyHostChange(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Mode could not change.'); }
  }

  function focusField(target: FocusTarget) {
    void host.focus(target).then((next) => voiceRef.current?.notifyHostChange(next));
  }

  function showHighlight(target: FocusTarget) {
    setHighlight(target);
    document.getElementById(`field-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 5000);
  }

  function openCatalog(kind: 'customer' | 'product') {
    const details = kind === 'customer' ? customerDetails.current : productDetails.current;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => details.querySelector('input')?.focus());
  }

  function makeAgent() {
    return new ShowMeVoice(createInvoiceVoiceIntegration(host), {
      status: setVoiceStatus, transcript: addMessage,
      error: (message) => { setError(message); track('assistant_error', voiceRef.current?.inputMode ?? null); },
      highlight: (target) => showHighlight(target as FocusTarget),
    });
  }

  async function toggleVoice() {
    if (voiceRef.current?.inputMode === 'voice') {
      await voiceRef.current.stop(); voiceRef.current = null; track('session_stopped', 'voice'); return;
    }
    setError('');
    setConnecting(true);
    if (voiceRef.current) { const previousMode = voiceRef.current.inputMode; await voiceRef.current.stop(); track('session_stopped', previousMode); }
    const voice = makeAgent();
    voiceRef.current = voice;
    try { await voice.start('voice'); track('session_started', 'voice'); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start voice.');
      track('assistant_error', 'voice'); await voice.stop(); voiceRef.current = null;
    } finally { setConnecting(false); }
  }

  async function sendTyped() {
    const text = typed.trim(); if (!text) return;
    if (!voiceAvailable || connecting) return;
    setError(''); setConnecting(true);
    let agent = voiceRef.current;
    try {
      if (!agent?.isReady()) {
        if (agent) { const previousMode = agent.inputMode; await agent.stop(); track('session_stopped', previousMode); }
        agent = makeAgent();
        voiceRef.current = agent;
        await agent.start('text');
        track('session_started', 'text');
      }
      agent.sayText(text);
      setTyped('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the message.');
      track('assistant_error', agent?.inputMode ?? 'text');
      if (agent) await agent.stop();
      if (voiceRef.current === agent) voiceRef.current = null;
    } finally { setConnecting(false); }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setSigningIn(true);
    try {
      await api.login(inviteCode);
      host.reset();
      await host.getContext();
      setInviteCode('');
      setAuth('signed-in');
      if (new URLSearchParams(window.location.search).get('account') === '1') setAccountOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
    finally { setSigningIn(false); }
  }

  async function signOut() {
    setAccountError('');
    try {
      await voiceRef.current?.stop();
      voiceRef.current = null;
      await api.logout();
      host.reset();
      setState(null); setAccountOpen(false); setAuth('signed-out');
    } catch (cause) { setAccountError(cause instanceof Error ? cause.message : 'Could not sign out.'); }
  }

  async function exportAccount() {
    setAccountError('');
    try {
      const data = await api.exportAccount();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'showme-workspace.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setAccountError(cause instanceof Error ? cause.message : 'Could not export workspace.'); }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== 'DELETE') return;
    setAccountError('');
    try {
      await voiceRef.current?.stop();
      voiceRef.current = null;
      await api.deleteAccount();
      host.reset();
      setState(null); setAccountOpen(false); setDeleteConfirmation(''); setAuth('signed-out');
    } catch (cause) { setAccountError(cause instanceof Error ? cause.message : 'Could not delete workspace.'); }
  }

  if (auth === 'signed-out') return <main className="pilot-login"><form className="pilot-login-card" onSubmit={(event) => void signIn(event)}><span className="logo-mark">S</span><div className="eyebrow">SHOWME PILOT</div><h1>Your workspace is ready.</h1><p>Enter your invitation code to continue. Your draft stays in your private workspace between visits.</p><label htmlFor="invite-code">Invitation code</label><input id="invite-code" type="password" autoComplete="off" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required minLength={32} autoFocus />{error && <p className="error-text" role="alert">{error}</p>}<button type="submit" disabled={signingIn || inviteCode.trim().length < 32}>{signingIn ? 'Opening workspace…' : 'Open workspace'}</button></form></main>;
  if (window.location.pathname === '/profile' && auth === 'signed-in') return <ProfileApp pilotMode={pilotMode} />;
  if (window.location.pathname === '/widget-demo' && auth === 'signed-in') return <WidgetDemo />;
  if (!state) return <div className="loading"><span className="logo-mark">S</span><p>Opening your workspace…</p>{error && <p className="error-text">{error}</p>}</div>;
  const { invoice, products, mode } = state;

  return <div className="app-shell">
    {accountOpen && <div className="account-overlay" onClick={() => setAccountOpen(false)}><section ref={accountDialog} className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(event) => event.stopPropagation()}><button className="account-close" type="button" aria-label="Close account settings" onClick={() => setAccountOpen(false)}>×</button><div className="eyebrow">PILOT ACCOUNT</div><h2 id="account-title">Your workspace data</h2><p>Download your invoice, customer profile, and action history as JSON. You can also permanently delete this workspace and its local activity records.</p><button className="account-export" type="button" onClick={() => void exportAccount()}>Download my data</button><button className="account-signout" type="button" onClick={() => void signOut()}>Sign out</button><div className="account-danger"><strong>Delete this workspace</strong><p>This removes the draft, customer profile, and local activity. The same invitation can create a new, empty workspace later. Backups and AssemblyAI data have separate retention.</p><label htmlFor="delete-confirmation">Type DELETE to confirm</label><input id="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /><button type="button" disabled={deleteConfirmation !== 'DELETE'} onClick={() => void deleteAccount()}>Delete workspace</button></div>{accountError && <p className="error-text" role="alert">{accountError}</p>}</section></div>}
    <aside className="sidebar">
      <div className="brand"><span className="logo-mark">S</span><span>ShowMe<small>WORKSPACE</small></span></div>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="nav-item active"><span>▧</span> Invoice studio <span className="nav-dot" /></button>
      <a className="nav-item" href="/profile"><span>◫</span> Customer profile</a>
      <a className="nav-item" href="/widget-demo"><span>✳</span> Widget demo</a>
      {pilotMode && <button className="account-nav" type="button" onClick={() => { setAccountError(''); setDeleteConfirmation(''); setAccountOpen(true); }}>Account & data</button>}
      <div className="sidebar-spacer" />
      <div className="sidebar-card"><strong>Learn as you go</strong><p>Ask for help, work together, or hand off the task. You can always take over.</p></div>
      <div className="sidebar-bottom"><span className="avatar">YO</span><div><strong>Your workspace</strong><small>Private draft session</small></div>{pilotMode && <button className="signout-button" type="button" onClick={() => void signOut()}>Sign out</button>}</div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Workspace <span>›</span> Invoices <span>›</span> New invoice</div><div className="topbar-right"><span className="live-dot" /> Draft workspace <span className="top-divider" /> <span>Made with ShowMe</span></div></header>
      <div className="content">
        <section className="page-heading"><div><div className="eyebrow">INVOICE STUDIO <span className="eyebrow-line" /></div><h1>Create an invoice<br /><span>with confidence.</span></h1><p>Build a draft in your own way. ShowMe can explain a field, work beside you, or handle the details.</p></div><div className="heading-note"><span>YOUR TASK</span><strong>From customer to saved draft</strong><p>Review each change as it appears in the live preview.</p></div></section>
        <section className="stepper" aria-label="Invoice progress"><div className={`step ${progress >= 1 ? 'complete' : 'current'}`}><span>1</span><div><strong>Customer</strong><small>Who it’s for</small></div></div><div className="step-line" /><div className={`step ${progress >= 2 ? 'complete' : progress === 1 ? 'current' : ''}`}><span>2</span><div><strong>Details</strong><small>What you’re billing</small></div></div><div className="step-line" /><div className={`step ${progress >= 3 ? 'complete' : progress === 2 ? 'current' : ''}`}><span>3</span><div><strong>Save draft</strong><small>Review & finish</small></div></div></section>

        {(!state.customers.length || !products.length) && <section className="setup-panel" aria-label="Set up your catalog"><div><span className="setup-label">FIRST-TIME SETUP</span><h2>Start with your own details.</h2><p>Add a customer and a priced product. They stay in this workspace and appear in ShowMe’s context.</p></div><div className="setup-actions">{!state.customers.length && <button type="button" onClick={() => openCatalog('customer')}>Add customer <span aria-hidden="true">↗</span></button>}{!products.length && <button type="button" onClick={() => openCatalog('product')}>Add product <span aria-hidden="true">↗</span></button>}</div></section>}

        {state.lastAction && <div className="action-receipt" role="status"><span className="receipt-marker" aria-hidden="true">✓</span><div><strong>Latest change</strong><span>{state.lastAction.summary}</span></div><small>Revision {state.lastAction.afterRevision}</small></div>}

        {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        <div className="work-grid"><div className="form-column">
          <section className={`card field-card ${highlight === 'customer' ? 'is-highlighted' : ''}`} id="field-customer" onClick={() => focusField('customer')}><div className="section-title"><div><span className="section-number">01</span><h2>Customer</h2></div><span className="section-hint">Who should receive this?</span></div><label htmlFor="customer-select">Bill to</label><select id="customer-select" value={invoice.customerId ?? ''} onChange={(event) => void edit('select_customer', { customerId: event.target.value })}><option value="" disabled>{state.customers.length ? 'Select a customer' : 'Add a customer below'}</option>{state.customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.city}</option>)}</select>{customer && <div className="selection-detail"><span className="customer-avatar">{customer.name.slice(0, 2).toUpperCase()}</span><div><strong>{customer.name}</strong><small>{customer.email} · {customer.city}</small></div><span className="check">✓</span></div>}</section>

          <details ref={customerDetails} className="card catalog-card"><summary>Add a customer <span>New contact</span></summary><form onSubmit={(event) => void createCustomer(event)}><label htmlFor="new-customer-name">Customer name</label><input id="new-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required maxLength={120} /><label htmlFor="new-customer-city">City</label><input id="new-customer-city" value={customerCity} onChange={(event) => setCustomerCity(event.target.value)} required maxLength={100} /><label htmlFor="new-customer-email">Billing email</label><input id="new-customer-email" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} required maxLength={254} /><button disabled={creatingCatalog}>Add and select customer</button></form></details>

          <section className={`card field-card ${highlight === 'items' ? 'is-highlighted' : ''}`} id="field-items" onClick={() => focusField('items')}><div className="section-title"><div><span className="section-number">02</span><h2>Items</h2></div><span className="section-hint">Add from your catalog</span></div><div className="item-head"><span>PRODUCT</span><span>QTY</span><span>AMOUNT</span></div>{invoice.items.length === 0 && <div className="empty-items">No items yet. Choose a product below, or tell ShowMe what you’re billing for.</div>}{invoice.items.map((item) => { const product = products.find((entry) => entry.id === item.productId)!; return <div className="item-row" key={item.id}><div className="item-name"><strong>{product.name}</strong><small>{money(product.priceCents)} each</small></div><input aria-label={`${product.name} quantity`} type="number" min="1" max="999" key={`${item.id}-${invoice.revision}`} defaultValue={item.quantity} onBlur={(event) => { const quantity = Number(event.target.value); if (quantity !== item.quantity && Number.isInteger(quantity) && quantity > 0) void edit('upsert_item', { productId: item.productId, quantity }); }} /><strong>{money(product.priceCents * item.quantity)}</strong><button className="remove-item" aria-label={`Remove ${product.name}`} onClick={(event) => { event.stopPropagation(); void edit('remove_item', { itemId: item.id }); }}>×</button></div>; })}<div className="add-row"><select aria-label="Add a catalog product" value="" onChange={(event) => { void edit('upsert_item', { productId: event.target.value, quantity: 1 }); }}><option value="" disabled>{products.length ? '＋ Add an item' : 'Add a product below'}</option>{products.filter((product) => !invoice.items.some((item) => item.productId === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.priceCents)}</option>)}</select></div></section>
          <details ref={productDetails} className="card catalog-card"><summary>Add a product <span>New line item</span></summary><form onSubmit={(event) => void createProduct(event)}><label htmlFor="new-product-name">Product or service</label><input id="new-product-name" value={productName} onChange={(event) => setProductName(event.target.value)} required maxLength={120} /><label htmlFor="new-product-price">Price in rupees</label><input id="new-product-price" type="number" min="0.01" max="1000000" step="0.01" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} required /><label htmlFor="new-product-description">Description (optional)</label><input id="new-product-description" value={productDescription} onChange={(event) => setProductDescription(event.target.value)} maxLength={500} /><button disabled={creatingCatalog}>Add to invoice</button></form></details>

          <section className="card"><div className="section-title"><div><span className="section-number">03</span><h2>Final details</h2></div><span className="section-hint">Almost there</span></div><div className="field-pair"><div className={`field-card ${highlight === 'delivery' ? 'is-highlighted' : ''}`} id="field-delivery" onClick={() => focusField('delivery')}><label htmlFor="delivery-input">Delivery charge</label><div className="input-with-prefix"><span>₹</span><input id="delivery-input" type="number" min="0" step="1" key={`delivery-${invoice.revision}`} defaultValue={invoice.deliveryCents / 100} onBlur={(event) => { const next = Math.round(Number(event.target.value) * 100); if (next !== invoice.deliveryCents && Number.isFinite(next) && next >= 0) void edit('set_delivery', { deliveryCents: next }); }} /></div><small>Shown separately on the invoice</small></div><div className={`field-card ${highlight === 'terms' ? 'is-highlighted' : ''}`} id="field-terms" onClick={() => focusField('terms')}><label htmlFor="terms-select">Payment terms</label><select id="terms-select" value={invoice.terms} onChange={(event) => void edit('set_terms', { terms: event.target.value })}><option value="due_on_receipt">Due on receipt</option><option value="net_15">Net 15</option><option value="net_30">Net 30</option></select><small>Sets the payment due date</small></div></div></section>
        </div>

        <div className="preview-column"><section className={`preview-card ${highlight === 'preview' ? 'is-highlighted' : ''}`} id="field-preview" onClick={() => focusField('preview')}><div className="preview-top"><span>LIVE PREVIEW</span><span className={`status-pill ${invoice.status === 'saved' ? 'saved' : ''}`}>{invoice.status === 'saved' ? '✓ Saved draft' : '● Unsaved draft'}</span></div><div className="preview-header"><div className="preview-emblem">S</div><div><small>INVOICE</small><strong>#{invoice.id.slice(0, 8).toUpperCase()}</strong></div></div><div className="preview-rule" /><div className="preview-meta"><div><small>BILL TO</small><strong>{customer?.name ?? 'Your customer'}</strong><span>{customer?.city ?? 'Add a customer to begin'}</span></div><div><small>ISSUED</small><strong>{dateLabel(invoice.issueDate)}</strong><span>Due {dateLabel(dueDate(invoice))}</span></div></div><div className="preview-items-head"><span>DESCRIPTION</span><span>AMOUNT</span></div>{invoice.items.length ? invoice.items.map((item) => { const product = products.find((entry) => entry.id === item.productId)!; return <div className="preview-item" key={item.id}><div><strong>{product.name}</strong><span>{item.quantity} × {money(product.priceCents)}</span></div><strong>{money(item.quantity * product.priceCents)}</strong></div>; }) : <div className="preview-empty">Items will appear here as you add them.</div>}<div className="preview-delivery"><span>Delivery</span><strong>{money(invoice.deliveryCents)}</strong></div><div className="preview-total"><span>Total due</span><strong>{money(total)}</strong></div><div className="preview-footer">{termsLabel[invoice.terms]} · Created with ShowMe</div></section><button className="save-button" onClick={() => void edit('save_draft')} disabled={!customer || !invoice.items.length}><span>{invoice.status === 'saved' ? 'Save draft again' : 'Save invoice draft'}</span><span>↗</span></button><button className="undo-button" onClick={() => void edit('undo')}>↶ Undo last ShowMe edit</button><p className="save-note">This saves a draft in your workspace. Nothing is sent to your customer.</p>{invoice.status === 'saved' && <div className="feedback-box"><strong>Was ShowMe useful for this invoice?</strong><div><button type="button" aria-pressed={feedback === 'yes'} onClick={() => { setFeedback('yes'); track('helpful_yes'); }}>Yes</button><button type="button" aria-pressed={feedback === 'no'} onClick={() => { setFeedback('no'); track('helpful_no'); }}>Needs work</button></div><small>Optional feedback. No conversation text is stored here.</small></div>}<div className="field-tip"><span>✦</span><p>{state.focus ? help[state.focus] : 'Click any field and ask “What does this mean?”'}</p></div></div></div>
      </div>
    </main>

    <aside className="assistant-panel"><div className="assistant-head"><div className="assistant-brand"><span className="assistant-orb">✳</span><div><strong>ShowMe</strong><small>Your guide, right here</small></div></div><span className="assistant-menu">···</span></div><div className="assistant-intro"><span className="sparkle">✳</span><h2>How can I help?</h2><p>Ask me to change a quantity, set delivery, or explain a field while you work.</p></div><div className="mode-box"><div className="mode-heading"><span>HOW SHOULD I HELP?</span><span className="mode-sparkle">✦</span></div><div className="mode-options">{(['guide', 'collaborate', 'delegate', 'manual'] as Mode[]).map((entry) => <button type="button" key={entry} className={mode === entry ? 'selected' : ''} aria-pressed={mode === entry} onClick={() => void chooseMode(entry)}>{modeLabel[entry]}</button>)}</div></div><div className="chat-messages" aria-live="polite">{messages.map((message) => <div className={`chat-bubble ${message.speaker}`} key={message.id}>{message.speaker === 'agent' && <span className="bubble-avatar">✳</span>}<p>{message.text}</p></div>)}</div><div className="assistant-bottom"><div className="voice-row"><span className={`voice-indicator ${voiceStatus === 'Listening' ? 'listening' : ''}`} /> <span>{voiceAvailable ? voiceStatus : 'Assistant unavailable until configured'}</span><button className={`mic-button ${voiceStatus === 'Listening' ? 'on' : ''}`} disabled={!voiceAvailable || connecting} onClick={() => void toggleVoice()} aria-label={voiceRef.current?.inputMode === 'voice' ? 'Stop voice' : 'Start voice'}>{voiceRef.current?.inputMode === 'voice' ? '■' : '◉'}</button></div><form className="composer" onSubmit={(event) => { event.preventDefault(); void sendTyped(); }}><input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Ask ShowMe by typing…" disabled={!voiceAvailable || connecting} aria-label="Message ShowMe" /><button disabled={!voiceAvailable || connecting || !typed.trim()} aria-label="Send message">➤</button></form><p className="assistant-footnote">Voice and chat use AssemblyAI. Drafts stay here; no invoice is sent to a customer.</p></div></aside>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
