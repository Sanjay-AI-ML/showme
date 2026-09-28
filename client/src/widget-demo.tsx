import React, { useEffect, useRef, useState } from 'react';
import type { ProfileField, ProfileState } from '../../shared/profile';
import { mountShowMe, type WidgetHandle } from '../../sdk/widget';
import { api } from './api';
import './widget-demo.css';

const editable: ProfileField[] = ['name', 'email', 'phone', 'preferredContact', 'notes'];

/** A small host application: its UI and API own the data; ShowMe is mounted as a widget. */
export function WidgetDemo() {
  const [state, setState] = useState<ProfileState | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const mountRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<WidgetHandle<ProfileState> | null>(null);
  const lastNameRef = useRef('');
  const ready = state !== null;

  useEffect(() => {
    let cancelled = false;
    void api.profileState().then((initial) => {
      if (cancelled) return;
      lastNameRef.current = initial.profile.name;
      setDraft(initial.profile.name);
      setState(initial);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open the widget demo.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!state || !mountRef.current) return;
    try {
      widgetRef.current = mountShowMe<ProfileState>({
        element: mountRef.current,
        name: 'Customer profile',
        read: api.profileState,
        revisionOf: (value) => value.revision,
        summarize: (value) => ({ profile: value.profile, task: value.task, revision: value.revision }),
        initialMode: state.mode,
        tokenProvider: api.voiceToken,
        audioWorkletUrl: '/audio-processor.js',
        focusedField: () => document.activeElement?.id.replace(/^demo-/, '') || null,
        highlight: (field) => document.getElementById(`demo-${field}`)?.focus(),
        fieldHelp: {
          name: 'The customer name shown to your team.',
          email: 'The email address on this profile. ShowMe does not send messages.',
          phone: 'The phone number on this profile. ShowMe does not call it.',
          preferredContact: 'The channel the customer prefers. It should have a usable address or number.',
          notes: 'Short internal context about the customer.',
        },
        onModeChange: async (mode) => { await api.profileMode(mode); },
        onStateChange: (next) => {
          setState(next);
          if (next.profile.name !== lastNameRef.current) { lastNameRef.current = next.profile.name; setDraft(next.profile.name); }
        },
        actions: [{
          name: 'set_profile_field',
          description: 'Set one customer-profile field to the exact value requested by the user. Ask for missing values; do not invent contact details.',
          parameters: { type: 'object', properties: {
            field: { type: 'string', enum: editable }, value: { type: 'string' },
          }, required: ['field', 'value'] },
          async run(args, { expectedRevision, requestId }) {
            if (!editable.includes(args.field as ProfileField) || typeof args.value !== 'string') throw new Error('Choose a supported field and value.');
            return (await api.profileEdit({ field: args.field as ProfileField, value: args.value,
              expectedRevision, requestId, source: 'agent' })).state;
          },
        }],
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the widget demo.'); }
    return () => { void widgetRef.current?.destroy(); widgetRef.current = null; };
  }, [ready]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    try {
      setError('');
      await api.profileEdit({ field: 'name', value: draft, expectedRevision: state.revision,
        requestId: crypto.randomUUID(), source: 'manual' });
      await widgetRef.current?.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save name.'); await widgetRef.current?.refresh(); }
  }
  if (!state) return <main className="widget-demo-loading" role="status">{error || 'Opening the embedded widget…'}</main>;
  return <div className="widget-demo-shell">
    <main className="widget-demo-host"><nav><a href="/">← Invoice studio</a><a href="/profile">Full profile host →</a></nav>
      <div className="widget-demo-eyebrow">A SEPARATE HOST UI</div>
      <h1>ShowMe, mounted inside<br /><em>another application.</em></h1>
      <p className="widget-demo-lead">This page owns the customer record and its API. The panel beside it is the reusable ShowMe widget. Both use the same checked actions.</p>
      {error && <p className="widget-demo-error" role="alert">{error}</p>}
      <section className="widget-demo-card"><div className="widget-demo-card-head"><span>Customer record</span><small>Revision {state.revision}</small></div>
        <form onSubmit={(event) => void saveName(event)}><label htmlFor="demo-name">Name</label><div><input id="demo-name" value={draft} onChange={(event) => setDraft(event.target.value)} /><button disabled={draft === state.profile.name}>Save</button></div></form>
        <dl><div><dt>Email</dt><dd id="demo-email" tabIndex={0}>{state.profile.email || 'Not set'}</dd></div><div><dt>Phone</dt><dd id="demo-phone" tabIndex={0}>{state.profile.phone || 'Not set'}</dd></div><div><dt>Preferred contact</dt><dd id="demo-preferredContact" tabIndex={0}>{state.profile.preferredContact}</dd></div><div><dt>Task status</dt><dd>{state.task.complete ? 'Ready to use' : state.task.nextStep}</dd></div></dl>
      </section><p className="widget-demo-hint">Try typing: “Set the name to Aarav Patel.” Then change it manually and ask ShowMe what it sees.</p>
    </main><aside className="widget-demo-panel" ref={mountRef} aria-label="ShowMe assistant" />
  </div>;
}
