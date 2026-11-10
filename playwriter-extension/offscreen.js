import "./assets/modulepreload-polyfill-COaX8i6R.js";
const OFFSCREEN_ACTIONS = /* @__PURE__ */ new Set(["copyText", "playSound"]);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!OFFSCREEN_ACTIONS.has(message.action)) {
    return false;
  }
  void handleMessage(message).then(sendResponse);
  return true;
});
async function handleMessage(message) {
  switch (message.action) {
    case "copyText":
      return handleCopyText(message);
    case "playSound":
      return handlePlaySound(message);
  }
}
const SOUND_RECIPES = {
  // Three-note ascending confirmation, played after clipboard copies.
  success: {
    masterGain: 0.5,
    layers: [
      { kind: "tone", waveform: "sine", frequency: 880, attack: 4e-3, decay: 0.09, peak: 0.06 },
      { kind: "tone", waveform: "sine", frequency: 1108.73, offset: 0.06, attack: 4e-3, decay: 0.1, peak: 0.06 },
      { kind: "tone", waveform: "sine", frequency: 1318.51, offset: 0.12, attack: 4e-3, decay: 0.18, peak: 0.07 }
    ],
    shimmer: { delay: 0.1, feedback: 0.22, wet: 0.16, lowpass: 4500 }
  }
};
let audioContext = null;
function renderSound(ctx, recipe) {
  const now = ctx.currentTime;
  const output = ctx.createGain();
  output.gain.value = 4;
  output.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = recipe.masterGain;
  master.connect(output);
  const { shimmer } = recipe;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = shimmer.delay;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = shimmer.lowpass;
  const feedback = ctx.createGain();
  feedback.gain.value = shimmer.feedback;
  const wet = ctx.createGain();
  wet.gain.value = shimmer.wet;
  master.connect(delay);
  delay.connect(lowpass).connect(feedback).connect(delay);
  lowpass.connect(wet).connect(output);
  recipe.layers.forEach((layer) => {
    const start = now + (layer.offset || 0);
    const duration = layer.attack + layer.decay + 0.05;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(1e-4, start);
    envelope.gain.exponentialRampToValueAtTime(layer.peak, start + layer.attack);
    envelope.gain.exponentialRampToValueAtTime(1e-4, start + layer.attack + layer.decay);
    envelope.connect(master);
    if (layer.kind === "tone") {
      const oscillator = ctx.createOscillator();
      oscillator.type = layer.waveform;
      oscillator.frequency.setValueAtTime(layer.frequency, start);
      if (layer.glideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(layer.glideTo, start + (layer.glideTime || duration));
      }
      oscillator.connect(envelope);
      oscillator.start(start);
      oscillator.stop(start + duration);
      return;
    }
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(duration * ctx.sampleRate)), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    samples.forEach((_, index) => {
      samples[index] = 2 * Math.random() - 1;
    });
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filterType;
    filter.frequency.value = layer.filterFreq;
    filter.Q.value = layer.filterQ;
    source.connect(filter).connect(envelope);
    source.start(start);
    source.stop(start + duration);
  });
}
async function handlePlaySound(message) {
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state !== "running") {
      await audioContext.resume();
    }
    renderSound(audioContext, SOUND_RECIPES[message.sound]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
async function handleCopyText(message) {
  try {
    const textarea = document.querySelector("#clipboard-text");
    if (!textarea) {
      return { success: false, error: "Clipboard textarea is missing" };
    }
    textarea.value = message.text;
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.value = "";
    if (!copied) {
      return { success: false, error: "Clipboard copy command failed" };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
console.log("Playwriter offscreen document loaded");
