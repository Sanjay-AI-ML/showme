class ShowMeMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.phase = 0;
    this.buffer = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    while (this.phase < input.length) {
      const a = Math.floor(this.phase);
      const b = Math.min(a + 1, input.length - 1);
      const fraction = this.phase - a;
      const value = input[a] * (1 - fraction) + input[b] * fraction;
      this.buffer.push(Math.max(-32768, Math.min(32767, Math.round(value * 32767))));
      this.phase += this.ratio;
      if (this.buffer.length >= 2400) {
        const pcm = new Int16Array(this.buffer.splice(0, 2400));
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
      }
    }
    this.phase -= input.length;
    return true;
  }
}
registerProcessor('showme-mic', ShowMeMicProcessor);
