export interface VoiceTransportOptions {
  tokenProvider: () => Promise<{ token: string }>;
  audioWorkletUrl?: string;
}

async function sameOriginToken(): Promise<{ token: string }> {
  const response = await fetch('/api/voice-token', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `Voice token request failed (${response.status}).`);
  return data;
}

export interface VoiceEvents {
  status: (value: string) => void;
  transcript: (speaker: 'user' | 'agent', value: string) => void;
  error: (message: string) => void;
  highlight: (target: string) => void;
}
export type InputMode = 'voice' | 'text';

export type PendingTool = { call_id: string; name: string; arguments: Record<string, unknown> };
export interface VoiceIntegration<State> {
  getContext(): Promise<State>;
  summarize(state: State): unknown;
  tools: unknown[];
  systemPrompt(initial: State): string;
  greeting: string;
  execute(call: PendingTool, events: VoiceEvents): Promise<unknown>;
  errorNoun: string;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export class ShowMeVoice<State> {
  inputMode: InputMode = 'voice';
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
  private queuedText: string[] = [];
  private textTurnInFlight = false;
  private nextTextTimer: ReturnType<typeof setTimeout> | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPromise: Promise<void> | null = null;
  constructor(private integration: VoiceIntegration<State>, private events: VoiceEvents,
    private options: VoiceTransportOptions = { tokenProvider: sameOriginToken }) {}

  isReady() { return this.ready && this.ws?.readyState === WebSocket.OPEN; }

  async start(inputMode: InputMode = 'voice') {
    this.inputMode = inputMode;
    this.ended = false;
    this.events.status(inputMode === 'voice' ? 'Connecting voice…' : 'Connecting chat…');
    const { token } = await this.options.tokenProvider();
    if (inputMode === 'voice') {
      const audioContext = new AudioContext();
      this.audioContext = audioContext;
      await audioContext.resume();
      await audioContext.audioWorklet.addModule(this.options.audioWorkletUrl ?? '/audio-processor.js');
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
    }
    const initialState = await this.integration.getContext();
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'session.update', session: {
      system_prompt: this.integration.systemPrompt(initialState),
      ...(inputMode === 'voice' ? { greeting: this.integration.greeting } : {}),
      tools: this.integration.tools,
      output: { voice: 'alba' },
    } }));
    ws.onmessage = (event) => { void this.handle(JSON.parse(event.data)); };
    ws.onerror = () => this.events.error(`Voice connection error. You can keep editing the ${this.integration.errorNoun} manually.`);
    ws.onclose = () => { this.ready = false; if (!this.ended) this.events.status('Disconnected'); };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Assistant connection timed out.')), 12000);
      function finish(error?: Error) {
        clearTimeout(timeout);
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
        if (error) reject(error); else resolve();
      }
      function onMessage(event: MessageEvent) {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'session.ready') finish();
          if (message.type === 'session.error') finish(new Error(String(message.message ?? 'Assistant connection failed.')));
        } catch { finish(new Error('Invalid assistant response.')); }
      }
      function onError() { finish(new Error('Assistant connection failed.')); }
      function onClose() { finish(new Error('Assistant connection closed.')); }
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });
    if (inputMode === 'text') {
      this.events.status('Chat ready');
      this.scheduleTextIdle();
    }
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.finishStop();
    try { await this.stopPromise; }
    finally { this.stopPromise = null; }
  }

  private async finishStop() {
    this.ended = true; this.ready = false; this.pending = [];
    this.queuedText = []; this.textTurnInFlight = false;
    if (this.nextTextTimer) clearTimeout(this.nextTextTimer);
    this.nextTextTimer = null;
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.requestTimer = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
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
    this.events.status('Assistant off');
  }

  sayText(text: string) {
    if (!this.isReady() || !this.ws) throw new Error('Assistant is connecting. Try again shortly.');
    this.scheduleTextIdle();
    this.events.transcript('user', text);
    if (this.inputMode === 'text') {
      this.queuedText.push(text);
      if (!this.textTurnInFlight) this.sendNextText();
    } else {
      this.sendTextFrame(text);
    }
  }

  private sendTextFrame(text: string) {
    this.ws?.send(JSON.stringify({ type: 'conversation.message', role: 'user', content: text }));
    this.requestTimer = setTimeout(() => {
      this.requestTimer = null;
      if (this.isReady()) this.ws?.send(JSON.stringify({ type: 'reply.create', instructions: `Respond to the user's typed request and use the permitted tools when appropriate. The request is: ${JSON.stringify(text)}` }));
    }, 1000);
  }

  private sendNextText() {
    const next = this.queuedText.shift();
    if (!next) { this.textTurnInFlight = false; return; }
    this.textTurnInFlight = true;
    this.sendTextFrame(next);
  }

  private scheduleTextIdle() {
    if (this.inputMode !== 'text') return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { void this.stop(); }, 5 * 60_000);
  }

  notifyHostChange(state: State) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'conversation.message', role: 'system', content: `Verified host app state changed: ${JSON.stringify(this.integration.summarize(state))}` }));
    }
  }

  private async handle(event: Record<string, unknown>) {
    const type = event.type;
    if (type === 'session.ready') { this.ready = true; if (this.inputMode === 'voice') this.events.status('Listening'); }
    else if (type === 'transcript.user') this.events.transcript('user', String(event.text ?? ''));
    else if (type === 'transcript.agent') this.events.transcript('agent', String(event.text ?? ''));
    else if (type === 'reply.audio' && typeof event.data === 'string') this.play(event.data);
    else if (type === 'tool.call') {
      if (this.nextTextTimer) clearTimeout(this.nextTextTimer);
      this.nextTextTimer = null;
      this.pending.push({ call_id: String(event.call_id), name: String(event.name), arguments: (event.arguments ?? {}) as Record<string, unknown> });
      if (this.lastEvent === 'reply.done') await this.drain();
    }
    else if (type === 'reply.done') {
      this.lastEvent = 'reply.done';
      this.scheduleTextIdle();
      if (event.status === 'interrupted') { this.pending = []; this.flushAudio(); }
      else {
        const hadToolCalls = this.pending.length > 0 || this.busy;
        await this.drain();
        if (this.inputMode === 'text' && this.textTurnInFlight && !hadToolCalls) {
          if (this.nextTextTimer) clearTimeout(this.nextTextTimer);
          this.nextTextTimer = setTimeout(() => { this.nextTextTimer = null; this.textTurnInFlight = false; this.sendNextText(); }, 250);
        }
      }
    }
    else if (type === 'reply.started' || type === 'input.speech.started') {
      this.lastEvent = type;
      if (this.nextTextTimer) clearTimeout(this.nextTextTimer);
      this.nextTextTimer = null;
    }
    else if (type === 'session.error') this.events.error(String(event.message ?? 'Voice session error.'));
  }

  private async drain() {
    if (this.busy || !this.ws || this.ended) return;
    this.busy = true;
    try {
      while (this.pending.length && !this.ended) {
        const call = this.pending.shift()!;
        let result: unknown; let isError = false;
        try { result = await this.integration.execute(call, this.events); }
        catch (error) { result = { error: error instanceof Error ? error.message : 'Action failed.' }; isError = true; }
        if (this.ws?.readyState === WebSocket.OPEN && !this.ended) {
          this.ws.send(JSON.stringify({ type: 'tool.result', call_id: call.call_id, result: JSON.stringify(result), is_error: isError }));
        }
      }
    } finally { this.busy = false; }
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
