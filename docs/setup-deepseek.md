# DeepSeek setup

DeepSeek uses a prepaid credit model. The AI API Tracker tile shows your remaining credit balance and tracks how much you have spent this month by recording balance changes locally — no historical spend API is needed.

---

## 1. Get an API key

1. Go to [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) and sign in.
2. Click **Create new API key**.
3. Copy the key (starts with `sk-`).

---

## 2. Configure the tile

1. Drag an **API Tracker** tile onto your Stream Deck layout.
2. Open the property inspector and select **DeepSeek** from the Provider dropdown.
3. Paste your API key into the **API Key** field.
4. **Budget ($)** — optional. When set, the tile tracks spend against that limit. Leave blank to use your live credit balance as the ceiling.
5. **CNY→USD rate** — optional. DeepSeek bills in CNY; leave blank to fetch an automatic daily exchange rate, or enter a fixed rate to avoid the lookup.

---

## What the tile shows

| Line | Content |
|------|---------|
| Provider name | DeepSeek |
| Balance | Remaining credit in USD |
| Monthly spend | Locally tracked spend delta for the current month |
| Trend | ↑ / ↓ / → vs yesterday's spend |

---

## How spend tracking works

DeepSeek only exposes a live credit balance — there is no historical spend endpoint. The plugin tracks spend locally by recording the difference between successive balance readings:

- Balance went **down** → difference added to the month's total
- Balance went **up** → you topped up; baseline updated, spend unchanged
- New calendar month → monthly accumulator resets automatically

The local tracking file (`deepseek-spend.json`) lives inside Stream Deck's plugin data folder and is never included in any package or sent anywhere.

---

## Troubleshooting

| Tile message | Cause | Fix |
|---|---|---|
| Add API key in settings | No key entered | Paste your `sk-...` key |
| Check API key in settings | Key rejected (401) | Regenerate the key at platform.deepseek.com |
| Rate limited | Too many requests | Wait and tap to retry |
| Offline? Check network | Network error | Check your internet connection |
