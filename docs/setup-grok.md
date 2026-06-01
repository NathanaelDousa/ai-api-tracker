# Grok (xAI) setup

Grok is xAI's family of AI models. The AI API Tracker tile shows your total credits used and how many remain on your xAI account.

---

## 1. Get an API key

1. Go to [console.x.ai](https://console.x.ai) and sign in.
2. Navigate to **API Keys** and create a new key.
3. Copy the key (starts with `xai-`).

---

## 2. Configure the tile

1. Drag an **API Tracker** tile onto your Stream Deck layout.
2. Open the property inspector and select **Grok (xAI)** from the Provider dropdown.
3. Paste your API key into the **API Key** field.
4. **Budget ($)** — enter your credit limit if you want the tile to show remaining balance. If your key already has a hard limit configured in the xAI console, the tile picks it up automatically.

---

## What the tile shows

| Line | Content |
|------|---------|
| Provider name | Grok |
| Credits used | Total spend on the account |
| Credits remaining | Limit minus used, or budget minus used if no hard limit |
| Trend | ↑ / ↓ / → vs yesterday's spend |

---

## Troubleshooting

| Tile message | Cause | Fix |
|---|---|---|
| Add API key in settings | No key entered | Paste your `xai-...` key |
| Check API key in settings | Key rejected (401) | Regenerate the key at console.x.ai |
| Rate limited | Too many requests | Wait and tap to retry |
| Offline? Check network | Network error | Check your internet connection |

---

## Note on the billing endpoint

The tile reads credit data from xAI's `/v1/api-key` endpoint. This is an undocumented endpoint that was available at time of writing — if xAI changes it, the tile will show an API error and an update to the plugin will be needed.
