# Human Token Benchmarker

Static browser typing test that measures throughput with OpenAI-style tokenization (`o200k_base`) over a fixed 20-second run.

## Metrics
- Final TPS: `tokens in final text / 20`
- Raw Input TPS: `(inserted token ops + deleted token ops) / 20`
- Total Tokens: token count of final text
- Total Characters: character count of final text

## Modes
- Free typing
- Copy text (prompt shown)

## Run locally
Serve the folder with any static server (recommended instead of opening `file://` directly):

```bash
cd /home/george/code/tokenwars
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Note: The page loads tokenizer assets from CDN at runtime.

## Cache Busting (Deploys)
When you deploy updates, bump the version token in `index.html` (currently `2026-03-01-1`) so browsers fetch fresh assets:
- `favicon.svg?v=...`
- `styles.css?v=...`
- `app.js?v=...`
