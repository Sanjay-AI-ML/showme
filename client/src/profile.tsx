import React, { useEffect, useRef, useState } from 'react';
import type { ProfileField, ProfileState } from '../../shared/profile';
import type { Mode } from '../../shared/types';
import { api } from './api';
import { ProfileHostAdapter } from './profile-host';
import { createProfileVoiceIntegration } from './profile-voice';
import { ShowMeVoice } from './voice';
import './profile.css';

const host = new ProfileHostAdapter();
const fields: { key: ProfileField; label: string; hint: string }[] = [
  { key: 'name', label: 'Full name', hint: 'How your team recognizes this customer' },
  { key: 'email', label: 'Email address', hint: 'For reference; no message is sent' },
  { key: 'phone', label: 'Phone number', hint: 'Include a country code when possible' },
  { key: 'preferredContact', label: 'Preferred contact', hint: 'The channel this customer prefers' },
  { key: 'notes', label: 'Internal notes', hint: 'Keep notes brief and relevant' },
];
const labels: Record<Mode, string> = { guide: 'Guide me', collaborate: 'Do it with me', delegate: 'Do it for me', manual: 'I’ll take over' };
type Message = { id: string; speaker: 'user' | 'agent'; text: string };

function Field({ field, value, highlighted, onSave, onFocus }: { field: typeof fields[number]; value: string; highlighted: boolean; onSave: (value: string) => Promise<void>; onFocus: () => void }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const changed = draft !== value;
  const save = async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } };
  return <div className={`profile-field ${highlighted ? 'is-highlighted' : ''}`}>
    <div><label htmlFor={`profile-${field.key}`}>{field.label}</label><small>{field.hint}</small></div>
    <div className="profile-input-row">{field.key === 'preferredContact' ?
      <select id={`profile-${field.key}`} value={draft} onFocus={onFocus} onChange={(event) => setDraft(event.target.value)}><option value="email">Email</option><option value="phone">Phone</option></select> :
      field.key === 'notes' ? <textarea id={`profile-${field.key}`} value={draft} onFocus={onFocus} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={500} /> :
      <input id={`profile-${field.key}`} type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'} value={draft} onFocus={onFocus} onChange={(event) => setDraft(event.target.value)} maxLength={field.key === 'email' ? 254 : 120} />}
      <button type="button" disabled={!changed || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </div>;
}

export function ProfileApp({ pilotMode }: { pilotMode: boolean }) {
  const [state, setState] = useState<ProfileState | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [status, setStatus] = useState('Assistant off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<ProfileField | null>(null);
  const focusedFieldRef = useRef<ProfileField | null>(null);
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', speaker: 'agent', text: 'Tell me what to change in this profile, or ask what a field means.' }]);
  const agentRef = useRef<ShowMeVoice<ProfileState> | null>(null);
  useEffect(() => {
    host.reset();
    const unsubscribe = host.onChange(setState);
    void host.getContext().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load profile.'));
    void api.capabilities().then((result) => setVoiceAvailable(result.voice)).catch(() => {});
    const end = () => { void agentRef.current?.stop(); };
    window.addEventListener('pagehide', end);
    return () => { unsubscribe(); window.removeEventListener('pagehide', end); void agentRef.current?.stop(); };
  }, []);
  function addMessage(speaker: 'user' | 'agent', text: string) {
    if (text.trim()) setMessages((current) => [...current.slice(-30), { id: crypto.randomUUID(), speaker, text }]);
  }
  function makeAgent() {
    return new ShowMeVoice(createProfileVoiceIntegration(host, () => focusedFieldRef.current), {
      status: setStatus, transcript: addMessage, error: setError,
      highlight: (field) => { if (fields.some((entry) => entry.key === field)) pointToField(field as ProfileField); },
    });
  }
  function focusField(field: ProfileField) {
    focusedFieldRef.current = field;
    setFocusedField(field);
    if (state) agentRef.current?.notifyHostChange(state);
  }
  function pointToField(field: ProfileField) {
    document.getElementById(`profile-${field}`)?.focus();
    setHighlight(field);
    window.setTimeout(() => setHighlight(null), 3500);
  }
  async function save(field: ProfileField, value: string) {
    if (!state) return;
    try {
      setError('');
      const result = await host.execute({ field, value, expectedRevision: state.revision, requestId: crypto.randomUUID(), source: 'manual' });
      agentRef.current?.notifyHostChange(result.state);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this field.'); void host.getContext(); }
  }
  async function chooseMode(mode: Mode) {
    try { const next = await host.setMode(mode); agentRef.current?.notifyHostChange(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change mode.'); }
  }
  async function toggleVoice() {
    if (agentRef.current?.inputMode === 'voice') { await agentRef.current.stop(); agentRef.current = null; return; }
    setBusy(true); setError('');
    try {
      await agentRef.current?.stop();
      const agent = makeAgent(); agentRef.current = agent;
      await agent.start('voice');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start voice.'); await agentRef.current?.stop(); agentRef.current = null; }
    finally { setBusy(false); }
  }
  async function sendTyped() {
    const message = typed.trim(); if (!message) return;
    setTyped(''); setError('');
    try {
      let agent = agentRef.current;
      if (!agent || !agent.isReady() || agent.inputMode !== 'text') {
        setBusy(true);
        await agent?.stop();
        agent = makeAgent(); agentRef.current = agent;
        await agent.start('text');
      }
      agent.sayText(message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send message.'); await agentRef.current?.stop(); agentRef.current = null; }
    finally { setBusy(false); }
  }
  if (!state) return <div className="loading"><span className="logo-mark">S</span><p>Opening customer profiles…</p>{error && <p className="error-text" role="alert">{error}</p>}</div>;
  return <div className="app-shell profile-shell">
    <aside className="sidebar"><div className="brand"><span className="logo-mark">S</span><span>ShowMe<small>WORKSPACE</small></span></div><div className="workspace-label">YOUR WORKSPACE</div><a className="nav-item" href="/"><span>▧</span> Invoice studio</a><a className="nav-item active" href="/profile"><span>◫</span> Customer profile <span className="nav-dot" /></a>{pilotMode && <a className="account-nav" href="/?account=1">Account & data</a>}<div className="sidebar-spacer" /><div className="sidebar-card"><strong>A second real host</strong><p>ShowMe reads this screen’s state and makes checked changes through its own profile API.</p></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb">Workspace <span>›</span> Customers <span>›</span> Profile</div><div className="topbar-right"><span className="live-dot" /> Save each field <span className="top-divider" /> Revision {state.revision}</div></header>
      <div className="profile-content"><div className="eyebrow">CUSTOMER WORKSPACE <span className="eyebrow-line" /></div><h1>Get the details right,<br /><em>together.</em></h1><p className="profile-lead">Edit directly, ask ShowMe to handle a change, or correct it in your own words. Every update appears here immediately.</p>
        {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        <div className="profile-layout"><section className="profile-card"><div className="profile-card-head"><div className="profile-avatar">{state.profile.name ? state.profile.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() : '＋'}</div><div><span className="eyebrow">CUSTOMER RECORD</span><h2>{state.profile.name || 'New customer'}</h2><small>Local workspace profile · Changes are saved as you approve them</small></div></div>
          {fields.map((field) => <Field key={field.key} field={field} value={state.profile[field.key]} highlighted={highlight === field.key} onFocus={() => focusField(field.key)} onSave={(value) => save(field.key, value)} />)}
        </section><aside className="profile-activity"><div className="eyebrow">TASK PROGRESS</div><h2>{state.task.complete ? 'Ready to use' : 'Finish this profile'}</h2><p>{state.task.complete ? 'The record has a name and a reachable preferred contact.' : `Next: ${state.task.nextStep}.`}</p><div className="profile-steps">{state.task.steps.map((step) => <button key={step.id} type="button" className={step.complete ? 'complete' : ''} onClick={() => pointToField(step.id === 'contact' ? 'email' : step.id === 'preference' ? 'preferredContact' : 'name')}><span>{step.complete ? '✓' : '○'}</span>{step.label}</button>)}</div><div className="profile-context"><span>ShowMe is looking at</span><strong>{focusedField ? fields.find((field) => field.key === focusedField)?.label : 'No field selected'}</strong><span>Preferred contact</span><strong>{state.profile.preferredContact === 'email' ? 'Email' : 'Phone'}</strong><span>Current revision</span><strong>{state.revision}</strong></div><div className="eyebrow">CHANGE HISTORY</div><div className="profile-history" aria-live="polite">{state.recentActions.length ? state.recentActions.map((action) => <button className="profile-history-item" type="button" key={action.id} onClick={() => pointToField(action.targetField)}><span className="profile-history-mark">{action.field === 'undo' ? '↶' : action.source === 'agent' ? '✳' : '●'}</span><span className="profile-history-copy"><strong>{action.field === 'undo' ? `Undid ${fields.find((field) => field.key === action.targetField)?.label}` : fields.find((field) => field.key === action.targetField)?.label}</strong><small>{action.before || 'Empty'} → {action.after || 'Empty'}</small><em>{action.source === 'agent' ? 'ShowMe' : 'You'}{action.undone ? ' · undone later' : ''}</em></span></button>) : <p className="profile-history-empty">Changes made by you and ShowMe will appear here.</p>}</div><div className="profile-example">Try: “Use phone as the preferred contact.” Then say: “Actually, use email.”</div></aside></div>
      </div></main>
    <aside className="assistant-panel"><div className="assistant-head"><div className="assistant-brand"><span className="assistant-orb">✳</span><div><strong>ShowMe</strong><small>Profile assistant</small></div></div></div><div className="assistant-intro"><span className="sparkle">✳</span><h2>How can I help?</h2><p>Ask me to update a field, explain it, or undo my last change.</p></div><div className="mode-box"><div className="mode-heading"><span>HOW SHOULD I HELP?</span></div><div className="mode-options">{(['guide', 'collaborate', 'delegate', 'manual'] as Mode[]).map((mode) => <button key={mode} type="button" className={state.mode === mode ? 'selected' : ''} aria-pressed={state.mode === mode} onClick={() => void chooseMode(mode)}>{labels[mode]}</button>)}</div></div><div className="chat-messages" aria-live="polite">{messages.map((message) => <div key={message.id} className={`chat-bubble ${message.speaker}`}>{message.speaker === 'agent' && <span className="bubble-avatar">✳</span>}<p>{message.text}</p></div>)}</div><div className="assistant-bottom"><div className="voice-row"><span className={`voice-indicator ${status === 'Listening' ? 'listening' : ''}`} /><span>{voiceAvailable ? status : 'Assistant unavailable until configured'}</span><button type="button" className={`mic-button ${status === 'Listening' ? 'on' : ''}`} disabled={!voiceAvailable || busy} onClick={() => void toggleVoice()} aria-label={agentRef.current?.inputMode === 'voice' ? 'Stop voice' : 'Start voice'}>{agentRef.current?.inputMode === 'voice' ? '■' : '◉'}</button></div><form className="composer" onSubmit={(event) => { event.preventDefault(); void sendTyped(); }}><input value={typed} onChange={(event) => setTyped(event.target.value)} disabled={!voiceAvailable || busy} placeholder="Ask ShowMe by typing…" aria-label="Message ShowMe" /><button disabled={!voiceAvailable || busy || !typed.trim()} aria-label="Send message">➤</button></form><p className="assistant-footnote">Voice and chat send this profile context to AssemblyAI. No message is sent to the customer.</p></div></aside>
  </div>;
}
