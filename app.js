import { Tiktoken } from "https://esm.sh/js-tiktoken@1.0.21";
import o200kBase from "https://esm.sh/js-tiktoken@1.0.21/ranks/o200k_base";

const DURATION_SEC = 20;
const DURATION_MS = DURATION_SEC * 1000;

const prompts = [
  "In the old workshop, a single test run could take all afternoon, so every step mattered. We checked power rails twice, verified each pin against the schematic, and wrote down every observation in plain language. When something failed, we avoided guessing and traced one signal at a time until the behavior made sense. Speed was useful, but clarity was what saved us from repeating the same mistake tomorrow.",
  "A strong typing session feels almost musical: steady tempo, light touch, and quick recovery when a note goes wrong. You do not pause to panic after a typo; you correct it cleanly and return to rhythm. Over twenty seconds, consistency beats bursts of chaos. The goal is not to be perfect in every keystroke, but to keep output flowing with minimal wasted motion and minimal backtracking.",
  "Modern tools can measure performance in many ways, but each metric tells a different story. Final throughput shows what survived to the end, while editing activity reveals how much work happened behind the scenes. If two people produce similar final text, one may have done it with fewer corrections and less friction. Better technique often looks calm from the outside, even when it is moving very quickly.",
  "When you practice deliberately, you can improve both speed and quality at the same time. Start with a comfortable pace, focus on accuracy, and only increase speed when your error rate stays controlled. Watch for tension in your shoulders and hands, because strain creates mistakes you cannot see at first. Small improvements in posture, rhythm, and confidence compound over many sessions into meaningful gains.",
];

const modeEl = document.getElementById("mode");
const shareEl = document.getElementById("share");
const resetEl = document.getElementById("reset");
const metricTpsEl = document.getElementById("metric-tps");
const metricTokensEl = document.getElementById("metric-tokens");
const metricCpmEl = document.getElementById("metric-cpm");
const timerLabelEl = document.getElementById("timer-label");
const timerEl = document.getElementById("timer");
const statusEl = document.getElementById("status");
const runtimeEl = document.querySelector(".runtime");
const promptPanelEl = document.getElementById("prompt-panel");
const promptTextEl = document.getElementById("prompt-text");
const typingEl = document.getElementById("typing");
const editorEl = document.querySelector(".editor");
const editorBodyEl = document.querySelector(".editor-body");
const inputHighlightWrapEl = document.getElementById("input-highlight-wrap");
const inputHighlightEl = document.getElementById("input-highlight");
const tokenIdRowEl = document.getElementById("token-id-row");
const tokenTooltipEl = document.getElementById("token-tooltip");

let encoder = null;
let encoderReady = false;
let state = "idle"; // idle | running | finished
let selectedMode = modeEl.value;
let startTime = 0;
let rafId = 0;
let previousValue = "";
let insertedTokenOps = 0;
let deletedTokenOps = 0;
let lastShareText = "";
const utf8Encoder = new TextEncoder();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function formatSeconds(ms) {
  return `${(Math.max(ms, 0) / 1000).toFixed(1)}s`;
}

function formatFloat(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function choosePrompt() {
  const pick = prompts[Math.floor(Math.random() * prompts.length)];
  promptTextEl.textContent = pick;
}

function syncModeUI() {
  const isCopy = selectedMode === "copy";
  promptPanelEl.classList.toggle("hidden", !isCopy);
  if (isCopy) {
    choosePrompt();
  }
}

function tokenizeLength(text) {
  if (!encoderReady || !text) {
    return 0;
  }
  return encoder.encode(text).length;
}

function diffStrings(previousText, currentText) {
  if (previousText === currentText) {
    return { added: "", removed: "" };
  }

  let start = 0;
  const prevLen = previousText.length;
  const currLen = currentText.length;
  while (start < prevLen && start < currLen && previousText[start] === currentText[start]) {
    start += 1;
  }

  let prevEnd = prevLen - 1;
  let currEnd = currLen - 1;
  while (prevEnd >= start && currEnd >= start && previousText[prevEnd] === currentText[currEnd]) {
    prevEnd -= 1;
    currEnd -= 1;
  }

  return {
    removed: previousText.slice(start, prevEnd + 1),
    added: currentText.slice(start, currEnd + 1),
  };
}

function resetPrimaryMetrics() {
  metricTpsEl.textContent = "0.00";
  metricTokensEl.textContent = "0";
  metricCpmEl.textContent = "0";
}

function clearResults() {
  timerLabelEl.textContent = "Time left";
  timerEl.textContent = formatSeconds(DURATION_MS);
  setStatus("Click in the editor and type to begin the 20-second run.");
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

function buildShareText(tps, finalTokens, cpm, tokenOps, opsPerSec) {
  const modeLabel = selectedMode === "copy" ? "copy-text" : "free-typing";
  return [
    "🚀 Human Token Benchmarker",
    `⚡ Tokens/s: ${formatFloat(tps)} | 🧱 Total tokens: ${finalTokens} | ✍️ Characters/minute: ${formatFloat(cpm, 0)}`,
    `Mode: ${modeLabel} | Tokenizer: o200k_base | Duration: 20s`,
    "🔗 https://georgemclaughlin.github.io/human-token-speed-test/",
  ].join("\n");
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

  const highlightTarget = Math.min(
    Math.max(inputHighlightEl.scrollHeight + 2, highlightMin),
    highlightMax,
  );
  const idsTarget = Math.min(
    Math.max(tokenIdRowEl.scrollHeight + 2, idsMin),
    idsMax,
  );

  inputHighlightEl.style.height = `${highlightTarget}px`;
  tokenIdRowEl.style.height = `${idsTarget}px`;
  editorBodyEl.style.height = `${highlightTarget + idsTarget + 10}px`;
}

function setState(nextState) {
  state = nextState;
  const canType = encoderReady && (nextState === "idle" || nextState === "running");

  modeEl.disabled = nextState === "running";
  typingEl.disabled = !canType;

  if (nextState === "idle") {
    timerEl.textContent = formatSeconds(DURATION_MS);
  }
}

function resetRun() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  startTime = 0;
  previousValue = "";
  insertedTokenOps = 0;
  deletedTokenOps = 0;
  typingEl.value = "";
  clearResults();
  syncModeUI();
  setState("idle");
}

function finishRun() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  setState("finished");
  typingEl.blur();

  const finalText = typingEl.value;
  const finalChars = finalText.length;
  const finalTokenIds = encoder.encode(finalText);
  const finalTokens = finalTokenIds.length;

  const tps = finalTokens / DURATION_SEC;
  const cpm = (finalChars / DURATION_SEC) * 60;
  const tokenOps = insertedTokenOps + deletedTokenOps;
  const opsPerSec = tokenOps / DURATION_SEC;
  lastShareText = buildShareText(tps, finalTokens, cpm, tokenOps, opsPerSec);
  shareEl.disabled = false;
  shareEl.classList.remove("hidden");

  metricTpsEl.textContent = formatFloat(tps);
  metricTokensEl.textContent = String(finalTokens);
  metricCpmEl.textContent = formatFloat(cpm, 0);

  timerLabelEl.textContent = "Final result";
  timerEl.textContent = `${formatFloat(tps)} tokens/s`;
  statusEl.innerHTML =
    `<span class="result-line"><strong>Run complete.</strong> You produced ${finalTokens} final tokens in 20 seconds.</span>` +
    `<span class="result-line"><strong>Pace snapshot:</strong> ${formatFloat(cpm, 0)} characters/minute at ${formatFloat(tps)} tokens/s using o200k_base.</span>`;
  statusEl.classList.remove("error");
  runtimeEl.classList.add("results-mode");

  renderTokenHighlight(finalTokenIds);
  typingEl.classList.add("hidden");
  inputHighlightWrapEl.classList.remove("hidden");
  fitResultEditorToContent();
}

function tick() {
  if (state !== "running") {
    return;
  }

  const elapsedMs = performance.now() - startTime;
  const remainingMs = DURATION_MS - elapsedMs;

  timerEl.textContent = formatSeconds(remainingMs);

  if (remainingMs <= 0) {
    finishRun();
    return;
  }

  rafId = requestAnimationFrame(tick);
}

function beginRun() {
  if (state !== "idle") {
    return;
  }

  setState("running");
  startTime = performance.now();
  setStatus("Running... keep typing until time runs out.");
  rafId = requestAnimationFrame(tick);
}

function handleInput() {
  if (state === "idle") {
    beginRun();
  }

  if (state !== "running") {
    previousValue = typingEl.value;
    return;
  }

  const currentValue = typingEl.value;
  const { added, removed } = diffStrings(previousValue, currentValue);

  if (added) {
    insertedTokenOps += tokenizeLength(added);
  }
  if (removed) {
    deletedTokenOps += tokenizeLength(removed);
  }

  previousValue = currentValue;
}

modeEl.addEventListener("change", () => {
  selectedMode = modeEl.value;
  syncModeUI();
});

shareEl.addEventListener("click", handleShareClick);
resetEl.addEventListener("click", resetRun);
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
    setStatus("Tokenizer ready. Click in the editor and start typing.");
    setState("idle");
    typingEl.focus();
  } catch (error) {
    console.error(error);
    encoderReady = false;
    setStatus("Failed to load tokenizer. Check network and refresh.", true);
    state = "finished";
    typingEl.disabled = true;
    modeEl.disabled = false;
  }
}

init();
