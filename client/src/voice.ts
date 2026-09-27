import { calculateTotal, dueDate, type AppState, type EditOperation, type FocusTarget, type Mode, type Terms } from '../../shared/types';
import { api } from './api';
import type { HostAdapter } from './host';

interface VoiceEvents {
  status: (value: string) => void;
  transcript: (speaker: 'user' | 'agent', value: string) => void;
  error: (message: string) => void;
  highlight: (target: FocusTarget) => void;
}

type PendingTool = { call_id: string; name: string; arguments: Record<string, unknown> };
const fieldHelp: Record<FocusTarget, string> = {
  customer: 'Choose who will receive the invoice. Their saved billing details appear on the draft.',
  items: 'Add catalog products and quantities. The invoice total updates from the catalog prices.',
  delivery: 'A separate delivery fee is shown as its own line instead of being hidden in an item price.',
  terms: 'Payment terms decide the due date: on receipt, 15 days, or 30 days after the issue date.',
  preview: 'Review the customer, quantities, delivery fee, total, and due date before saving the draft.',
};

const tools = [
  { type: 'function', name: 'read_context', description: 'Read the current invoice, customer and product catalog, selected field, and permitted mode. Call before resolving names or after a manual change.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'edit_invoice', description: 'Make one reversible invoice edit when the user asks you to do it. Never call in Guide me or Let me take over mode. Use exact catalog IDs from read_context. Delivery amount is in whole rupees. For a correction, edit the existing product rather than adding a duplicate.', parameters: { type: 'object', properties: {
    operation: { type: 'string', enum: ['select_customer', 'upsert_item', 'remove_item', 'set_delivery', 'set_terms'] },
    customer_id: { type: 'string', description: 'Exact customer ID from read_context' },
    product_id: { type: 'string', description: 'Exact product ID from read_context' },
    quantity: { type: 'integer', minimum: 1, maximum: 999 },
    delivery_rupees: { type: 'integer', minimum: 0, description: 'Whole rupees, e.g. 500 for ₹500' },
    terms: { type: 'string', enum: ['due_on_receipt', 'net_15', 'net_30'] },
  }, required: ['operation'] } },
  { type: 'function', name: 'highlight_field', description: 'Highlight a relevant field when explaining how the user can do something. Do not mutate invoice data.', parameters: { type: 'object', properties: { field: { type: 'string', enum: ['customer', 'items', 'delivery', 'terms', 'preview'] } }, required: ['field'] } },
  { type: 'function', name: 'explain_field', description: 'Read the app-authored explanation for a field, especially when the user asks what this means. Use the focused field from read_context when the user says this.', parameters: { type: 'object', properties: { field: { type: 'string', enum: ['customer', 'items', 'delivery', 'terms', 'preview'] } }, required: ['field'] } },
  { type: 'function', name: 'change_mode', description: 'Switch assistance mode when the user requests guidance, doing together, doing it quickly, or manual takeover.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['guide', 'collaborate', 'delegate', 'manual'] } }, required: ['mode'] } },
  { type: 'function', name: 'undo_agent_edit', description: 'Undo the most recent compatible agent edit only when the user asks to undo.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'save_draft', description: 'Save the invoice as a draft when the user explicitly asks to save. Never claim it saved before the tool returns success.', parameters: { type: 'object', properties: {} } },
];

function summarize(state: AppState) {
  const { invoice, products, customers } = state;
  return {
    mode: state.mode, focusedField: state.focus, revision: invoice.revision,
    customer: invoice.customerId ? customers.find((item) => item.id === invoice.customerId)?.name : null,
    items: invoice.items.map((item) => ({ product: products.find((entry) => entry.id === item.productId)?.name, quantity: item.quantity })),
    deliveryRupees: invoice.deliveryCents / 100, terms: invoice.terms, status: invoice.status,
    invoiceId: invoice.id, totalRupees: calculateTotal(invoice, products) / 100,
    issueDate: invoice.issueDate, dueDate: dueDate(invoice),
    customers: customers.map(({ id, name }) => ({ id, name })),
    products: products.map(({ id, name, priceCents }) => ({ id, name, rupees: priceCents / 100 })),
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export class ShowMeVoice {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private scheduled: AudioBufferSourceNode[] = [];
  private playbackTime = 0;
  private ready = false;
  private pending: PendingTool[] = [];
  private busy = false;
  private lastEvent = '';
  private ended = false;
  constructor(private host: HostAdapter, private events: VoiceEvents) {}

  async start() {
    this.ended = false;
    this.events.status('Connecting…');
    const { token } = await api.voiceToken();
    const audioContext = new AudioContext();
    this.audioContext = audioContext;
    await audioContext.resume();
    await audioContext.audioWorklet.addModule('/audio-processor.js');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
    this.stream = stream;
    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, 'showme-mic');
    const zero = audioContext.createGain(); zero.gain.value = 0;
    source.connect(worklet).connect(zero).connect(audioContext.destination);
    this.source = source; this.worklet = worklet;
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input.audio', audio: base64(new Uint8Array(event.data)) }));
      }
    };
    const initialState = await this.host.getContext();
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'session.update', session: {
      system_prompt: `You are ShowMe, a concise voice companion embedded in an invoice app. Help the user finish an accurate invoice and learn the app. Use read_context before guessing any catalog name or current field. Only speak customer names, prices, totals, dates, and save outcomes obtained from tools. Never invent an action result. In guide mode, explain and highlight; do not edit. In collaborate mode, do reversible requested edits and briefly explain useful steps. In delegate mode, execute supported requests efficiently. In manual mode, answer questions without editing. Ask one short question for missing or ambiguous values. Follow user corrections immediately. If a tool fails, say what failed and what remains unchanged. Keep spoken turns to one or two short sentences. Current state: ${JSON.stringify(summarize(initialState))}`,
      greeting: 'Hi, I’m ShowMe. Tell me what you want to do, or ask me to guide you.',
      tools,
      output: { voice: 'alba' },
    } }));
    ws.onmessage = (event) => { void this.handle(JSON.parse(event.data)); };
    ws.onerror = () => this.events.error('Voice connection error. You can keep editing the invoice manually.');
    ws.onclose = () => { this.ready = false; if (!this.ended) this.events.status('Disconnected'); };
  }

  async stop() {
    this.ended = true; this.ready = false; this.pending = [];
    this.flushAudio();
    const socket = this.ws;
    if (socket?.readyState === WebSocket.OPEN) {
      const liveSocket = socket;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(finish, 2000);
        function finish() {
          clearTimeout(timeout);
          liveSocket.removeEventListener('message', onMessage);
          liveSocket.removeEventListener('close', finish);
          resolve();
        }
        function onMessage(event: MessageEvent) {
          try { if (JSON.parse(String(event.data)).type === 'session.ended') finish(); }
          catch { /* ignore unrelated frames */ }
        }
        liveSocket.addEventListener('message', onMessage);
        liveSocket.addEventListener('close', finish);
        liveSocket.send(JSON.stringify({ type: 'session.end' }));
      });
    }
    socket?.close(); this.ws = null;
    this.worklet?.disconnect(); this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.audioContext?.close();
    this.audioContext = null;
    this.events.status('Voice off');
  }

  sayText(text: string) {
    if (!this.ready || !this.ws) throw new Error('Start voice first to send a typed message.');
    this.ws.send(JSON.stringify({ type: 'conversation.message', role: 'user', content: text }));
    this.ws.send(JSON.stringify({ type: 'reply.create' }));
    this.events.transcript('user', text);
  }

  notifyHostChange(state: AppState) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'conversation.message', role: 'system', content: `Verified host app state changed: ${JSON.stringify(summarize(state))}` }));
    }
  }

  private async handle(event: Record<string, unknown>) {
    const type = event.type;
    if (type === 'session.ready') { this.ready = true; this.events.status('Listening'); }
    else if (type === 'transcript.user') this.events.transcript('user', String(event.text ?? ''));
    else if (type === 'transcript.agent') this.events.transcript('agent', String(event.text ?? ''));
    else if (type === 'reply.audio' && typeof event.data === 'string') this.play(event.data);
    else if (type === 'tool.call') {
      this.pending.push({ call_id: String(event.call_id), name: String(event.name), arguments: (event.arguments ?? {}) as Record<string, unknown> });
      if (this.lastEvent === 'reply.done') await this.drain();
    }
    else if (type === 'reply.done') {
      this.lastEvent = 'reply.done';
      if (event.status === 'interrupted') { this.pending = []; this.flushAudio(); }
      else await this.drain();
    }
    else if (type === 'reply.started' || type === 'input.speech.started') this.lastEvent = type;
    else if (type === 'session.error') this.events.error(String(event.message ?? 'Voice session error.'));
  }

  private async drain() {
    if (this.busy || !this.ws || this.ended) return;
    this.busy = true;
    try {
      while (this.pending.length && !this.ended) {
        const call = this.pending.shift()!;
        let result: unknown; let isError = false;
        try { result = await this.execute(call); }
        catch (error) { result = { error: error instanceof Error ? error.message : 'Action failed.' }; isError = true; }
        if (this.ws?.readyState === WebSocket.OPEN && !this.ended) {
          this.ws.send(JSON.stringify({ type: 'tool.result', call_id: call.call_id, result: JSON.stringify(result), is_error: isError }));
        }
      }
    } finally { this.busy = false; }
  }

  private async execute(call: PendingTool): Promise<unknown> {
    const args = call.arguments;
    if (call.name === 'read_context') return summarize(await this.host.getContext());
    if (call.name === 'highlight_field' || call.name === 'explain_field') {
      const target = args.field as FocusTarget;
      if (!(target in fieldHelp)) throw new Error('Unknown field.');
      await this.host.focus(target);
      this.events.highlight(target);
      return { field: target, explanation: fieldHelp[target] };
    }
    if (call.name === 'change_mode') {
      const mode = args.mode as Mode;
      const state = await this.host.setMode(mode);
      return { mode: state.mode };
    }
    const state = await this.host.getContext();
    const operation: EditOperation = call.name === 'save_draft' ? 'save_draft' : call.name === 'undo_agent_edit' ? 'undo' : args.operation as EditOperation;
    if (!['select_customer', 'upsert_item', 'remove_item', 'set_delivery', 'set_terms', 'save_draft', 'undo'].includes(operation)) throw new Error('Unsupported action.');
    const edit = {
      operation, expectedRevision: state.invoice.revision, requestId: call.call_id, source: 'agent' as const,
      customerId: args.customer_id as string | undefined,
      productId: args.product_id as string | undefined,
      quantity: args.quantity as number | undefined,
      deliveryCents: typeof args.delivery_rupees === 'number' ? Math.round(args.delivery_rupees * 100) : undefined,
      terms: args.terms as Terms | undefined,
    };
    const outcome = await this.host.execute(edit);
    return { success: true, receipt: outcome.receipt, invoice: summarize(outcome.state) };
  }

  private play(encoded: string) {
    const context = this.audioContext;
    if (!context) return;
    const raw = atob(encoded);
    const pcm = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) output[i] = pcm[i] / 32768;
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    this.playbackTime = Math.max(this.playbackTime, context.currentTime);
    source.start(this.playbackTime); this.playbackTime += buffer.duration;
    this.scheduled.push(source);
    source.onended = () => { this.scheduled = this.scheduled.filter((item) => item !== source); };
  }

  private flushAudio() {
    for (const source of this.scheduled) { try { source.stop(); } catch { /* source already stopped */ } }
    this.scheduled = []; this.playbackTime = this.audioContext?.currentTime ?? 0;
  }
}
