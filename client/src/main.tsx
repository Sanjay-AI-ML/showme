import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { calculateTotal, dueDate, type AppState, type EditOperation, type FocusTarget, type Mode, type Terms } from '../../shared/types';
import { api } from './api';
import { InvoiceHostAdapter } from './host';
import { ShowMeVoice } from './voice';
import './styles.css';

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
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Voice off');
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', speaker: 'agent', text: 'Hi! I can help you create this invoice, explain a field, or guide you step by step.' },
  ]);
  const voiceRef = useRef<ShowMeVoice | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlight, setHighlight] = useState<FocusTarget | null>(null);

  useEffect(() => {
    const unsubscribe = host.onChange(setState);
    void host.getContext().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load invoice.'));
    void api.capabilities().then((result) => setVoiceAvailable(result.voice)).catch(() => {});
    return () => { unsubscribe(); void voiceRef.current?.stop(); if (highlightTimer.current) clearTimeout(highlightTimer.current); };
  }, []);

  const total = useMemo(() => state ? calculateTotal(state.invoice, state.products) : 0, [state]);
  const customer = state?.customers.find((item) => item.id === state.invoice.customerId);
  const steps = [Boolean(customer), Boolean(state?.invoice.items.length), state?.invoice.status === 'saved'];
  const progress = steps.filter(Boolean).length;

  function addMessage(speaker: Message['speaker'], text: string) {
    if (!text.trim()) return;
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

  async function toggleVoice() {
    if (voiceRef.current) {
      await voiceRef.current.stop(); voiceRef.current = null; return;
    }
    setError('');
    const voice = new ShowMeVoice(host, {
      status: setVoiceStatus, transcript: addMessage,
      error: setError, highlight: showHighlight,
    });
    voiceRef.current = voice;
    try { await voice.start(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start voice.');
      await voice.stop(); voiceRef.current = null;
    }
  }

  function sendTyped() {
    const text = typed.trim(); if (!text) return;
    try { voiceRef.current?.sayText(text); setTyped(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Start voice first.'); }
  }

  if (!state) return <div className="loading"><span className="logo-mark">S</span><p>Opening your workspace…</p>{error && <p className="error-text">{error}</p>}</div>;
  const { invoice, products, mode } = state;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="logo-mark">S</span><span>ShowMe<small>WORKSPACE</small></span></div>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="nav-item active"><span>▧</span> Invoice studio <span className="nav-dot" /></button>
      <div className="sidebar-spacer" />
      <div className="sidebar-card"><span className="sidebar-card-icon">✦</span><strong>Learn as you go</strong><p>Ask for help, work together, or hand off the task. You can always take over.</p></div>
      <div className="sidebar-bottom"><span className="avatar">YO</span><div><strong>Your workspace</strong><small>Private draft session</small></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Workspace <span>›</span> Invoices <span>›</span> New invoice</div><div className="topbar-right"><span className="live-dot" /> Draft workspace <span className="top-divider" /> <span>Made with ShowMe</span></div></header>
      <div className="content">
        <section className="page-heading"><div><div className="eyebrow">INVOICE STUDIO <span className="eyebrow-line" /></div><h1>Your next invoice,<br /><em>made easier.</em></h1><p>Create a draft in your own way. ShowMe can guide you, work beside you, or handle the details.</p></div><div className="heading-decoration"><span>✳</span></div></section>
        <section className="stepper" aria-label="Invoice progress"><div className={`step ${progress >= 1 ? 'complete' : 'current'}`}><span>1</span><div><strong>Customer</strong><small>Who it’s for</small></div></div><div className="step-line" /><div className={`step ${progress >= 2 ? 'complete' : progress === 1 ? 'current' : ''}`}><span>2</span><div><strong>Details</strong><small>What you’re billing</small></div></div><div className="step-line" /><div className={`step ${progress >= 3 ? 'complete' : progress === 2 ? 'current' : ''}`}><span>3</span><div><strong>Save draft</strong><small>Review & finish</small></div></div></section>

        {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        <div className="work-grid"><div className="form-column">
          <section className={`card field-card ${highlight === 'customer' ? 'is-highlighted' : ''}`} id="field-customer" onClick={() => focusField('customer')}><div className="section-title"><div><span className="section-number">01</span><h2>Customer</h2></div><span className="section-hint">Who should receive this?</span></div><label htmlFor="customer-select">Bill to</label><select id="customer-select" value={invoice.customerId ?? ''} onChange={(event) => void edit('select_customer', { customerId: event.target.value })}><option value="" disabled>Select a customer</option>{state.customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.city}</option>)}</select>{customer && <div className="selection-detail"><span className="customer-avatar">{customer.name.slice(0, 2).toUpperCase()}</span><div><strong>{customer.name}</strong><small>{customer.email} · {customer.city}</small></div><span className="check">✓</span></div>}</section>

          <section className={`card field-card ${highlight === 'items' ? 'is-highlighted' : ''}`} id="field-items" onClick={() => focusField('items')}><div className="section-title"><div><span className="section-number">02</span><h2>Items</h2></div><span className="section-hint">Add from your catalog</span></div><div className="item-head"><span>PRODUCT</span><span>QTY</span><span>AMOUNT</span></div>{invoice.items.length === 0 && <div className="empty-items">No items yet. Choose a product below, or tell ShowMe what you’re billing for.</div>}{invoice.items.map((item) => { const product = products.find((entry) => entry.id === item.productId)!; return <div className="item-row" key={item.id}><div className="item-name"><strong>{product.name}</strong><small>{money(product.priceCents)} each</small></div><input aria-label={`${product.name} quantity`} type="number" min="1" max="999" key={`${item.id}-${invoice.revision}`} defaultValue={item.quantity} onBlur={(event) => { const quantity = Number(event.target.value); if (quantity !== item.quantity && Number.isInteger(quantity) && quantity > 0) void edit('upsert_item', { productId: item.productId, quantity }); }} /><strong>{money(product.priceCents * item.quantity)}</strong><button className="remove-item" aria-label={`Remove ${product.name}`} onClick={(event) => { event.stopPropagation(); void edit('remove_item', { itemId: item.id }); }}>×</button></div>; })}<div className="add-row"><select aria-label="Add a catalog product" value="" onChange={(event) => { void edit('upsert_item', { productId: event.target.value, quantity: 1 }); }}><option value="" disabled>＋ Add an item</option>{products.filter((product) => !invoice.items.some((item) => item.productId === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.priceCents)}</option>)}</select></div></section>

          <section className="card"><div className="section-title"><div><span className="section-number">03</span><h2>Final details</h2></div><span className="section-hint">Almost there</span></div><div className="field-pair"><div className={`field-card ${highlight === 'delivery' ? 'is-highlighted' : ''}`} id="field-delivery" onClick={() => focusField('delivery')}><label htmlFor="delivery-input">Delivery charge</label><div className="input-with-prefix"><span>₹</span><input id="delivery-input" type="number" min="0" step="1" key={`delivery-${invoice.revision}`} defaultValue={invoice.deliveryCents / 100} onBlur={(event) => { const next = Math.round(Number(event.target.value) * 100); if (next !== invoice.deliveryCents && Number.isFinite(next) && next >= 0) void edit('set_delivery', { deliveryCents: next }); }} /></div><small>Shown separately on the invoice</small></div><div className={`field-card ${highlight === 'terms' ? 'is-highlighted' : ''}`} id="field-terms" onClick={() => focusField('terms')}><label htmlFor="terms-select">Payment terms</label><select id="terms-select" value={invoice.terms} onChange={(event) => void edit('set_terms', { terms: event.target.value })}><option value="due_on_receipt">Due on receipt</option><option value="net_15">Net 15</option><option value="net_30">Net 30</option></select><small>Sets the payment due date</small></div></div></section>
        </div>

        <div className="preview-column"><section className={`preview-card ${highlight === 'preview' ? 'is-highlighted' : ''}`} id="field-preview" onClick={() => focusField('preview')}><div className="preview-top"><span>LIVE PREVIEW</span><span className={`status-pill ${invoice.status === 'saved' ? 'saved' : ''}`}>{invoice.status === 'saved' ? '✓ Saved draft' : '● Unsaved draft'}</span></div><div className="preview-header"><div className="preview-emblem">S</div><div><small>INVOICE</small><strong>#{invoice.id.slice(0, 8).toUpperCase()}</strong></div></div><div className="preview-rule" /><div className="preview-meta"><div><small>BILL TO</small><strong>{customer?.name ?? 'Your customer'}</strong><span>{customer?.city ?? 'Add a customer to begin'}</span></div><div><small>ISSUED</small><strong>{dateLabel(invoice.issueDate)}</strong><span>Due {dateLabel(dueDate(invoice))}</span></div></div><div className="preview-items-head"><span>DESCRIPTION</span><span>AMOUNT</span></div>{invoice.items.length ? invoice.items.map((item) => { const product = products.find((entry) => entry.id === item.productId)!; return <div className="preview-item" key={item.id}><div><strong>{product.name}</strong><span>{item.quantity} × {money(product.priceCents)}</span></div><strong>{money(item.quantity * product.priceCents)}</strong></div>; }) : <div className="preview-empty">Items will appear here as you add them.</div>}<div className="preview-delivery"><span>Delivery</span><strong>{money(invoice.deliveryCents)}</strong></div><div className="preview-total"><span>Total due</span><strong>{money(total)}</strong></div><div className="preview-footer">{termsLabel[invoice.terms]} · Created with ShowMe</div></section><button className="save-button" onClick={() => void edit('save_draft')} disabled={!customer || !invoice.items.length}><span>{invoice.status === 'saved' ? 'Save draft again' : 'Save invoice draft'}</span><span>↗</span></button><button className="undo-button" onClick={() => void edit('undo')}>↶ Undo last ShowMe edit</button><p className="save-note">This saves a draft in your workspace. Nothing is sent to your customer.</p><div className="field-tip"><span>✦</span><p>{state.focus ? help[state.focus] : 'Click any field and ask “What does this mean?”'}</p></div></div></div>
      </div>
    </main>

    <aside className="assistant-panel"><div className="assistant-head"><div className="assistant-brand"><span className="assistant-orb">✳</span><div><strong>ShowMe</strong><small>Your guide, right here</small></div></div><span className="assistant-menu">···</span></div><div className="assistant-intro"><span className="sparkle">✳</span><h2>How can I help?</h2><p>I’m here to make this easier. Tell me what you want done, or ask me to show you how.</p></div><div className="mode-box"><div className="mode-heading"><span>HOW SHOULD I HELP?</span><span className="mode-sparkle">✦</span></div><div className="mode-options">{(['guide', 'collaborate', 'delegate', 'manual'] as Mode[]).map((entry) => <button key={entry} className={mode === entry ? 'selected' : ''} onClick={() => void chooseMode(entry)}>{modeLabel[entry]}</button>)}</div></div><div className="chat-messages" aria-live="polite">{messages.map((message) => <div className={`chat-bubble ${message.speaker}`} key={message.id}>{message.speaker === 'agent' && <span className="bubble-avatar">✳</span>}<p>{message.text}</p></div>)}</div><div className="assistant-bottom"><div className="voice-row"><span className={`voice-indicator ${voiceStatus === 'Listening' ? 'listening' : ''}`} /> <span>{voiceAvailable ? voiceStatus : 'Voice needs an AssemblyAI API key'}</span><button className={`mic-button ${voiceStatus === 'Listening' ? 'on' : ''}`} disabled={!voiceAvailable} onClick={() => void toggleVoice()} aria-label={voiceRef.current ? 'Stop voice' : 'Start voice'}>{voiceRef.current ? '■' : '◉'}</button></div><form className="composer" onSubmit={(event) => { event.preventDefault(); sendTyped(); }}><input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={voiceRef.current ? 'Or type a message…' : 'Start voice to send messages'} disabled={!voiceRef.current} aria-label="Message ShowMe" /><button disabled={!voiceRef.current || !typed.trim()} aria-label="Send message">➤</button></form><p className="assistant-footnote">ShowMe can edit drafts. You approve anything that leaves this workspace.</p></div></aside>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
