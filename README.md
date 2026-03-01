# Human Token Benchmarker

Static browser benchmark that measures throughput with OpenAI-style tokenization (`o200k_base`) over a fixed 10-second run, for both typing and voice transcript input.

## Metrics
- Tokens/s: `final tokens / 10`
- Total Tokens: token count of final text
- Characters/minute (CPM): `(final characters / 10) * 60`

## Modes
- Text typing
- Voice (10s mic capture, post-run local transcript via Vosk)

## Voice Mode Notes
- Speech transcription runs fully in-browser with Vosk WebAssembly (`vosk-browser`).
- Default model: `vosk-model-small-en-us-0.15.tar.gz`
  - URL: `https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz`
- First voice run may be slower because model files download and cache locally.
- Requires microphone permission and a browser with `getUserMedia` + `AudioContext` + `Web Workers`.
- Recommended target is modern desktop Chrome/Edge.

## Run locally
Serve the folder with any static server (recommended instead of opening `file://` directly):

```bash
cd human-token-speed-test
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Alternative:

```bash
npx serve .
```

Then open the URL shown in your terminal.

Note: The page loads tokenizer assets from CDN at runtime.

## Cache Busting (Deploys)
When you deploy updates, bump the version token in `index.html` (currently `2026-03-01-22`) so browsers fetch fresh assets:
- `favicon.svg?v=...`
- `styles.css?v=...`
- `app.js?v=...`
