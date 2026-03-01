import { Tiktoken } from "https://esm.sh/js-tiktoken@1.0.21";
import o200kBase from "https://esm.sh/js-tiktoken@1.0.21/ranks/o200k_base";

const DURATION_SEC = 10;
const DURATION_MS = DURATION_SEC * 1000;
const VOICE_FINALIZE_IDLE_MS = 220;
const VOICE_FINALIZE_MAX_MS = 1200;
const VOSK_MODEL_URL = "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";
const VOSK_MODEL_SIZE_LABEL = "~40MB";

const modeTextEl = document.getElementById("mode-text");
const modeVoiceEl = document.getElementById("mode-voice");
const shareEl = document.getElementById("share");
const resetEl = document.getElementById("reset");
const voiceStartEl = document.getElementById("voice-start");
const voiceActionHintEl = document.getElementById("voice-action-hint");
const metricTpsEl = document.getElementById("metric-tps");
const metricTokensEl = document.getElementById("metric-tokens");
const metricCpmEl = document.getElementById("metric-cpm");
const timerLabelEl = document.getElementById("timer-label");
const timerEl = document.getElementById("timer");
const statusEl = document.getElementById("status");
const runtimeEl = document.querySelector(".runtime");
const typingEl = document.getElementById("typing");
const voicePanelEl = document.getElementById("voice-panel");
const voicePanelTextEl = document.getElementById("voice-panel-text");
const editorTabEl = document.getElementById("editor-tab");
const editorModeBadgeEl = document.getElementById("editor-mode-badge");
const editorEl = document.querySelector(".editor");
const editorBodyEl = document.querySelector(".editor-body");
const inputHighlightWrapEl = document.getElementById("input-highlight-wrap");
const inputHighlightEl = document.getElementById("input-highlight");
const tokenIdRowEl = document.getElementById("token-id-row");
const tokenTooltipEl = document.getElementById("token-tooltip");

let encoder = null;
let encoderReady = false;
let state = "idle"; // idle | running | recording | transcribing | finished
let selectedMode = modeVoiceEl.checked ? "voice" : "text";
let startTime = 0;
let rafId = 0;
let lastShareText = "";
let runCounter = 0;
let activeRunId = 0;
let mediaStream = null;
let audioContext = null;
let mediaSourceNode = null;
let recognizerNode = null;
let voskModel = null;
let voskModelPromise = null;
let voskRecognizer = null;
let voiceFinalSegments = [];
let voicePartial = "";
let voiceFinalizeTimeoutId = 0;
let voiceLastUpdateAt = 0;
let voiceModelLoading = false;

const utf8Encoder = new TextEncoder();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setVoicePanelText(message) {
  voicePanelTextEl.textContent = message;
}

function formatSeconds(ms) {
  return `${(Math.max(ms, 0) / 1000).toFixed(1)}s`;
}

function formatFloat(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function isVoiceMode() {
  return selectedMode === "voice";
}

function syncEditorChrome() {
  if (selectedMode === "voice") {
    editorTabEl.textContent = "voice-session.tw";
    editorModeBadgeEl.textContent = "Voice input mode";
  } else {
    editorTabEl.textContent = "typing-session.tw";
    editorModeBadgeEl.textContent = "Text input mode";
  }
}

function syncModeUI() {
  const isVoice = isVoiceMode();
  const showVoiceStart = isVoice && state === "idle";

  voiceStartEl.classList.toggle("hidden", !showVoiceStart);
  voiceActionHintEl.classList.toggle("hidden", !isVoice);
  if (isVoice) {
    if (voiceModelLoading) {
      voiceActionHintEl.textContent = "Loading voice model... please wait before speaking.";
    } else if (state === "recording") {
      voiceActionHintEl.textContent = "Listening now...";
    } else if (state === "transcribing") {
      voiceActionHintEl.textContent = "Wrapping up final words...";
    } else if (voskModel) {
      voiceActionHintEl.textContent = "Voice model ready.";
    } else {
      voiceActionHintEl.textContent = `First run downloads voice model (${VOSK_MODEL_SIZE_LABEL}).`;
    }

    typingEl.classList.add("hidden");
    if (state !== "finished") {
      inputHighlightWrapEl.classList.add("hidden");
      voicePanelEl.classList.remove("hidden");
    }
  } else {
    voicePanelEl.classList.add("hidden");
    if (state !== "finished") {
      typingEl.classList.remove("hidden");
    }
  }

  syncEditorChrome();
}

function resetPrimaryMetrics() {
  metricTpsEl.textContent = "0.00";
  metricTokensEl.textContent = "0";
  metricCpmEl.textContent = "0";
}

function clearResults() {
  timerLabelEl.textContent = "Time left";
  timerEl.textContent = formatSeconds(DURATION_MS);
  runtimeEl.classList.remove("results-mode");

  resetPrimaryMetrics();
  shareEl.disabled = true;
  shareEl.textContent = "📋 Share Results";
  shareEl.classList.add("hidden");
  lastShareText = "";
  inputHighlightEl.textContent = "";
  tokenIdRowEl.textContent = "";
  hideTokenTooltip();
  editorEl.classList.remove("results-fit");
  editorBodyEl.style.height = "";
  inputHighlightEl.style.height = "";
  tokenIdRowEl.style.height = "";
  inputHighlightWrapEl.classList.add("hidden");
  typingEl.classList.remove("hidden");
  voicePanelEl.classList.add("hidden");

  if (isVoiceMode()) {
    setStatus(`Press Start Recording to begin a ${DURATION_SEC}-second voice run.`);
    setVoicePanelText(
      `Voice mode ready. First run downloads a local model (${VOSK_MODEL_SIZE_LABEL}). Press Start Recording to begin a ${DURATION_SEC}-second run.`,
    );
    typingEl.classList.add("hidden");
    voicePanelEl.classList.remove("hidden");
  } else {
    setStatus(`Click in the editor and type to begin the ${DURATION_SEC}-second run.`);
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function buildShareText({ tps, finalTokens, cpm, modeLabel }) {
  const lines = [
    "🚀 Human Token Benchmarker",
    `⚡ Tokens/s: ${formatFloat(tps)} | 🧱 Total tokens: ${finalTokens} | ✍️ Characters/minute: ${formatFloat(cpm, 0)}`,
    `🧪 Mode: ${modeLabel} | Tokenizer: o200k_base | Duration: ${DURATION_SEC}s`,
  ];

  lines.push("🔗 https://georgemclaughlin.github.io/human-token-speed-test/");
  return lines.join("\n");
}

async function handleShareClick() {
  if (!lastShareText) {
    return;
  }

  try {
    await copyToClipboard(lastShareText);
    shareEl.textContent = "Copied";
    setTimeout(() => {
      shareEl.textContent = "📋 Share Results";
    }, 1400);
  } catch (error) {
    console.error(error);
    shareEl.textContent = "Copy Failed";
    setTimeout(() => {
      shareEl.textContent = "📋 Share Results";
    }, 1800);
  }
}

function renderTokenHighlight(tokenIds) {
  inputHighlightEl.replaceChildren();
  tokenIdRowEl.replaceChildren();

  if (!tokenIds.length) {
    inputHighlightEl.textContent = "(No tokens in final text)";
    tokenIdRowEl.textContent = "(No token ids)";
    return;
  }

  let previousDecoded = "";
  let charCursor = 0;
  for (let i = 0; i < tokenIds.length; i += 1) {
    const tokenId = tokenIds[i];
    const cumulativeDecoded = String(encoder.decode(tokenIds.slice(0, i + 1)));
    const piece = cumulativeDecoded.slice(previousDecoded.length);
    previousDecoded = cumulativeDecoded;
    const charLen = [...piece].length;
    const byteLen = utf8Encoder.encode(piece).length;
    const spanStart = charCursor;
    const spanEnd = charCursor + charLen;
    charCursor = spanEnd;
    const color = `hsl(${(i * 43) % 360} 70% 30%)`;

    const chip = document.createElement("span");
    chip.className = "token-chip";
    chip.style.background = color;
    chip.textContent = piece;
    chip.dataset.tokenIndex = String(i + 1);
    chip.dataset.tokenId = String(tokenId);
    chip.dataset.tokenText = piece;
    chip.dataset.tokenChars = String(charLen);
    chip.dataset.tokenBytes = String(byteLen);
    chip.dataset.spanStart = String(spanStart);
    chip.dataset.spanEnd = String(spanEnd);
    inputHighlightEl.appendChild(chip);

    const idChip = document.createElement("span");
    idChip.className = "token-id-chip";
    idChip.style.background = color;
    idChip.textContent = String(tokenId);
    idChip.dataset.tokenIndex = String(i + 1);
    idChip.dataset.tokenId = String(tokenId);
    idChip.dataset.tokenText = piece;
    idChip.dataset.tokenChars = String(charLen);
    idChip.dataset.tokenBytes = String(byteLen);
    idChip.dataset.spanStart = String(spanStart);
    idChip.dataset.spanEnd = String(spanEnd);
    tokenIdRowEl.appendChild(idChip);
  }
}

function formatTokenTextForTooltip(text) {
  const literal = JSON.stringify(text);
  if (literal.length <= 140) {
    return literal;
  }
  return `${literal.slice(0, 137)}..."`;
}

function showTokenTooltip(target, clientX, clientY) {
  const lines = [
    `Token #${target.dataset.tokenIndex}`,
    `ID: ${target.dataset.tokenId}`,
    `Text: ${formatTokenTextForTooltip(target.dataset.tokenText ?? "")}`,
    `Chars: ${target.dataset.tokenChars}`,
    `Bytes: ${target.dataset.tokenBytes}`,
    `Span: ${target.dataset.spanStart}..${target.dataset.spanEnd} (chars)`,
  ];
  tokenTooltipEl.textContent = lines.join("\n");
  tokenTooltipEl.classList.remove("hidden");
  tokenTooltipEl.setAttribute("aria-hidden", "false");

  const pad = 12;
  const tipW = tokenTooltipEl.offsetWidth;
  const tipH = tokenTooltipEl.offsetHeight;
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + tipW > window.innerWidth - 8) {
    x = window.innerWidth - tipW - 8;
  }
  if (y + tipH > window.innerHeight - 8) {
    y = window.innerHeight - tipH - 8;
  }
  tokenTooltipEl.style.left = `${Math.max(8, x)}px`;
  tokenTooltipEl.style.top = `${Math.max(8, y)}px`;
}

function hideTokenTooltip() {
  tokenTooltipEl.classList.add("hidden");
  tokenTooltipEl.setAttribute("aria-hidden", "true");
}

function handleTokenHoverMove(event) {
  const target = event.target.closest(".token-chip, .token-id-chip");
  if (!target) {
    hideTokenTooltip();
    return;
  }
  showTokenTooltip(target, event.clientX, event.clientY);
}

function fitResultEditorToContent() {
  editorEl.classList.add("results-fit");

  // Reset to natural size before measuring.
  editorBodyEl.style.height = "";
  inputHighlightEl.style.height = "auto";
  tokenIdRowEl.style.height = "auto";

  const viewportCap = Math.floor(window.innerHeight * 0.74);
  const highlightMin = 72;
  const highlightMax = Math.max(300, viewportCap - 120);
  const idsMin = 34;
  const idsMax = Math.max(180, Math.floor(viewportCap * 0.45));

  const highlightTarget = Math.min(Math.max(inputHighlightEl.scrollHeight + 2, highlightMin), highlightMax);
  const idsTarget = Math.min(Math.max(tokenIdRowEl.scrollHeight + 2, idsMin), idsMax);

  inputHighlightEl.style.height = `${highlightTarget}px`;
  tokenIdRowEl.style.height = `${idsTarget}px`;
  editorBodyEl.style.height = `${highlightTarget + idsTarget + 10}px`;
}

function setState(nextState) {
  state = nextState;
  const typingRunnable = selectedMode !== "voice" && (nextState === "idle" || nextState === "running");
  const voiceReady = selectedMode === "voice" && nextState === "idle" && encoderReady;
  const modeLocked = nextState === "running" || nextState === "recording" || nextState === "transcribing";

  modeTextEl.disabled = modeLocked;
  modeVoiceEl.disabled = modeLocked;
  typingEl.disabled = !encoderReady || !typingRunnable;
  voiceStartEl.disabled = !voiceReady;

  if (nextState === "idle") {
    timerEl.textContent = formatSeconds(DURATION_MS);
  }

  syncModeUI();
}

function stopMediaTracks() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  mediaStream = null;
}

function cleanupVoiceResources() {
  if (recognizerNode) {
    recognizerNode.onaudioprocess = null;
    try {
      recognizerNode.disconnect();
    } catch (error) {
      console.error(error);
    }
  }
  recognizerNode = null;

  if (mediaSourceNode) {
    try {
      mediaSourceNode.disconnect();
    } catch (error) {
      console.error(error);
    }
  }
  mediaSourceNode = null;

  stopMediaTracks();

  if (audioContext) {
    try {
      audioContext.close();
    } catch (error) {
      console.error(error);
    }
  }
  audioContext = null;

  if (voskRecognizer) {
    try {
      voskRecognizer.remove();
    } catch (error) {
      console.error(error);
    }
  }
  voskRecognizer = null;
  voiceFinalSegments = [];
  voicePartial = "";
}

function resetRun() {
  runCounter += 1;
  activeRunId = runCounter;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (voiceFinalizeTimeoutId) {
    clearTimeout(voiceFinalizeTimeoutId);
    voiceFinalizeTimeoutId = 0;
  }

  cleanupVoiceResources();
  startTime = 0;
  typingEl.value = "";
  clearResults();
  syncModeUI();
  setState("idle");
}

function finishWithText(finalText, sourceLabel, warningMessage = "") {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  setState("finished");
  typingEl.blur();

  const finalChars = finalText.length;
  const finalTokenIds = encoder.encode(finalText);
  const finalTokens = finalTokenIds.length;
  const tps = finalTokens / DURATION_SEC;
  const cpm = (finalChars / DURATION_SEC) * 60;

  const modeLabel = selectedMode === "voice" ? "voice" : "text";

  lastShareText = buildShareText({
    tps,
    finalTokens,
    cpm,
    modeLabel,
  });
  shareEl.disabled = false;
  shareEl.classList.remove("hidden");

  metricTpsEl.textContent = formatFloat(tps);
  metricTokensEl.textContent = String(finalTokens);
  metricCpmEl.textContent = formatFloat(cpm, 0);

  timerLabelEl.textContent = "Final result";
  timerEl.textContent = `${formatFloat(tps)} tokens/s`;
  statusEl.innerHTML =
    `<span class="result-line"><strong>Run complete.</strong> ${sourceLabel} produced ${finalTokens} tokens in ${DURATION_SEC} seconds.</span>` +
    `<span class="result-line"><strong>Pace snapshot:</strong> ${formatFloat(cpm, 0)} characters/minute at ${formatFloat(tps)} tokens/s with o200k_base.</span>` +
    (warningMessage
      ? `<span class="result-line"><strong>Note:</strong> ${warningMessage}</span>`
      : "");
  statusEl.classList.remove("error");
  runtimeEl.classList.add("results-mode");

  renderTokenHighlight(finalTokenIds);
  typingEl.classList.add("hidden");
  voicePanelEl.classList.add("hidden");
  inputHighlightWrapEl.classList.remove("hidden");
  fitResultEditorToContent();
}

function finishTypingRun() {
  finishWithText(typingEl.value, "Final text");
}

function normalizeTranscript(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function finalizeVoiceRun() {
  const transcript = normalizeTranscript([...voiceFinalSegments, voicePartial].filter(Boolean).join(" "));
  voiceFinalSegments = [];
  voicePartial = "";

  if (!transcript) {
    setState("idle");
    clearResults();
    setStatus("No speech detected during the run. Try again and speak clearly.", true);
    setVoicePanelText("No speech detected. Press Start Recording to try again.");
    return;
  }

  finishWithText(transcript, "Voice transcript");
}

function ensureVoskAvailable() {
  return Boolean(window.Vosk && typeof window.Vosk.createModel === "function");
}

async function loadVoskModel() {
  if (voskModel) {
    return voskModel;
  }

  if (!ensureVoskAvailable()) {
    throw new Error("Vosk runtime is not available.");
  }

  if (!voskModelPromise) {
    voiceModelLoading = true;
    syncModeUI();
    voskModelPromise = window.Vosk.createModel(VOSK_MODEL_URL)
      .then((model) => {
        voskModel = model;
        voiceModelLoading = false;
        syncModeUI();
        return model;
      })
      .catch((error) => {
        voskModelPromise = null;
        voiceModelLoading = false;
        syncModeUI();
        throw error;
      });
  }

  return voskModelPromise;
}

function stopVoiceRecording() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  timerEl.textContent = formatSeconds(0);
  setState("transcribing");
  setStatus("Finalizing transcript...");
  setVoicePanelText(`Wrapping up final words (up to ${(VOICE_FINALIZE_MAX_MS / 1000).toFixed(1)}s)...`);
  const runId = activeRunId;
  const startedAt = performance.now();
  const pollFinalize = () => {
    if (runId !== activeRunId) {
      return;
    }
    const now = performance.now();
    const idleForMs = now - voiceLastUpdateAt;
    const elapsedMs = now - startedAt;
    if (idleForMs >= VOICE_FINALIZE_IDLE_MS || elapsedMs >= VOICE_FINALIZE_MAX_MS) {
      voiceFinalizeTimeoutId = 0;
      finalizeVoiceRun();
      cleanupVoiceResources();
      return;
    }
    voiceFinalizeTimeoutId = window.setTimeout(pollFinalize, 120);
  };
  voiceFinalizeTimeoutId = window.setTimeout(pollFinalize, 120);
}

function tick() {
  if (state !== "running" && state !== "recording") {
    return;
  }

  const elapsedMs = performance.now() - startTime;
  const remainingMs = DURATION_MS - elapsedMs;
  timerEl.textContent = formatSeconds(remainingMs);

  if (remainingMs <= 0) {
    if (state === "running") {
      finishTypingRun();
    } else {
      stopVoiceRecording();
    }
    return;
  }

  rafId = requestAnimationFrame(tick);
}

function beginTypingRun() {
  if (state !== "idle") {
    return;
  }

  setState("running");
  startTime = performance.now();
  setStatus("Running... keep typing until time runs out.");
  rafId = requestAnimationFrame(tick);
}

async function beginVoiceRun() {
  if (state !== "idle" || !isVoiceMode()) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    setStatus("Voice mode is not supported in this browser.", true);
    setVoicePanelText("Voice mode requires getUserMedia + AudioContext support.");
    return;
  }

  if (!ensureVoskAvailable()) {
    setStatus("Voice runtime failed to load. Refresh and try again.", true);
    setVoicePanelText("Vosk runtime unavailable. Refresh the page to retry.");
    return;
  }

  const runId = ++runCounter;
  activeRunId = runId;
  voiceFinalSegments = [];
  voicePartial = "";
  voiceLastUpdateAt = performance.now();

  setStatus("Loading local speech model...");
  setVoicePanelText("Loading Vosk model in-browser...");
  setState("recording");

  try {
    const model = await loadVoskModel();
    if (runId !== activeRunId) {
      return;
    }

    setStatus("Requesting microphone permission...");
    setVoicePanelText(`Allow microphone access, then speak for ${DURATION_SEC} seconds.`);

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    });
    if (runId !== activeRunId) {
      cleanupVoiceResources();
      return;
    }

    audioContext = new AudioContext();
    await audioContext.resume();
    mediaSourceNode = audioContext.createMediaStreamSource(mediaStream);

    voskRecognizer = new model.KaldiRecognizer(audioContext.sampleRate);
    voskRecognizer.setWords(true);
    voskRecognizer.on("result", (message) => {
      if (runId !== activeRunId) {
        return;
      }
      voiceLastUpdateAt = performance.now();
      const text = normalizeTranscript(message?.result?.text ?? "");
      if (text) {
        voiceFinalSegments.push(text);
      }
    });
    voskRecognizer.on("partialresult", (message) => {
      if (runId !== activeRunId) {
        return;
      }
      voiceLastUpdateAt = performance.now();
      voicePartial = normalizeTranscript(message?.result?.partial ?? "");
    });

    recognizerNode = audioContext.createScriptProcessor(4096, 1, 1);
    recognizerNode.onaudioprocess = (event) => {
      if (runId !== activeRunId || (state !== "recording" && state !== "transcribing")) {
        return;
      }
      try {
        voskRecognizer.acceptWaveform(event.inputBuffer);
      } catch (error) {
        console.error("acceptWaveform failed", error);
      }
    };
    mediaSourceNode.connect(recognizerNode);
    recognizerNode.connect(audioContext.destination);

    startTime = performance.now();
    timerLabelEl.textContent = "Time left";
    setStatus("Recording... speak now until the timer ends.");
    setVoicePanelText(`Recording... speak continuously for ${DURATION_SEC} seconds.`);
    rafId = requestAnimationFrame(tick);
  } catch (error) {
    console.error(error);
    cleanupVoiceResources();
    setState("idle");
    setStatus("Voice recognition setup failed. Check microphone permissions and retry.", true);
    setVoicePanelText("Voice setup failed. Press Start Recording to retry.");
  }
}

function handleInput() {
  if (state === "idle") {
    beginTypingRun();
  }
}

function handleModeChange() {
  selectedMode = modeVoiceEl.checked ? "voice" : "text";
  resetRun();
}

modeTextEl.addEventListener("change", handleModeChange);
modeVoiceEl.addEventListener("change", handleModeChange);

shareEl.addEventListener("click", handleShareClick);
resetEl.addEventListener("click", resetRun);
voiceStartEl.addEventListener("click", beginVoiceRun);
typingEl.addEventListener("input", handleInput);
inputHighlightWrapEl.addEventListener("mousemove", handleTokenHoverMove);
inputHighlightWrapEl.addEventListener("mouseleave", hideTokenTooltip);
window.addEventListener("resize", () => {
  if (state === "finished") {
    fitResultEditorToContent();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    resetRun();
  }
});

async function init() {
  syncModeUI();
  setStatus("Loading tokenizer...");

  try {
    encoder = new Tiktoken(o200kBase);
    encoderReady = true;
    clearResults();
    setState("idle");
    typingEl.focus();
  } catch (error) {
    console.error(error);
    encoderReady = false;
    setStatus("Failed to load tokenizer. Check network and refresh.", true);
    state = "finished";
    typingEl.disabled = true;
    modeTextEl.disabled = false;
    modeVoiceEl.disabled = false;
    voiceStartEl.disabled = true;
  }
}

init();
