# OpenRouter setup

OpenRouter is an API aggregator that lets you access models from OpenAI, Anthropic, Google, Meta, Mistral, and many more through a single API key and a single bill. The AI API Tracker tile reads account credits automatically and shows how much credit remains.

---

## 1. Get an API key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and sign in.
2. Click **Create key**.
3. Optionally set a **credit limit** if you want OpenRouter to enforce spending for that key.
4. Copy the key (starts with `sk-or-`).

---

## 2. Configure the tile

1. Drag an **API Tracker** tile onto your Stream Deck layout.
2. Open the property inspector and select **OpenRouter** from the Provider dropdown.
3. Paste your API key into the **API Key** field.
4. **Budget ($)** — optional. When set, the tile shows budget remaining instead of account credit remaining.

---

## What the tile shows

| Line | Content |
|------|---------|
| Provider name | OpenRouter |
| Credits remaining | Account credits minus total usage, or budget remaining when Budget is set |
| Usage | Daily/monthly usage when OpenRouter returns it, otherwise total usage |
| Trend | ↑ / ↓ / → vs yesterday's spend |

---

## Troubleshooting

| Tile message | Cause | Fix |
|---|---|---|
| Add API key in settings | No key entered | Paste your `sk-or-...` key |
| Check API key in settings | Key rejected (401) | Regenerate the key at openrouter.ai/keys |
| Rate limited | Too many requests | Wait and tap to retry |
| Offline? Check network | Network error | Check your internet connection |
