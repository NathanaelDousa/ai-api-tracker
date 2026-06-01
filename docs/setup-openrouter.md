# OpenRouter setup

OpenRouter is an API aggregator that lets you access models from OpenAI, Anthropic, Google, Meta, Mistral, and many more through a single API key and a single bill. The AI API Tracker tile shows your total credits used and how many remain.

---

## 1. Get an API key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and sign in.
2. Click **Create key**.
3. Optionally set a **credit limit** — if you do, the tile will use that as the budget ceiling automatically (no manual budget setting needed).
4. Copy the key (starts with `sk-or-`).

---

## 2. Configure the tile

1. Drag an **API Tracker** tile onto your Stream Deck layout.
2. Open the property inspector and select **OpenRouter** from the Provider dropdown.
3. Paste your API key into the **API Key** field.
4. **Budget ($)** — only needed if your key has no hard credit limit set. Enter the amount of credits you want to track against.

---

## What the tile shows

| Line | Content |
|------|---------|
| Provider name | OpenRouter |
| Credits used | Total spend across all models since your last credit purchase |
| Credits remaining | Hard limit minus used, or budget minus used if no hard limit |
| Trend | ↑ / ↓ / → vs yesterday's spend |

---

## Troubleshooting

| Tile message | Cause | Fix |
|---|---|---|
| Add API key in settings | No key entered | Paste your `sk-or-...` key |
| Check API key in settings | Key rejected (401) | Regenerate the key at openrouter.ai/keys |
| Rate limited | Too many requests | Wait and tap to retry |
| Offline? Check network | Network error | Check your internet connection |
