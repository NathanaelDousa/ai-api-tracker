# Grok (xAI) setup

Grok is xAI's family of AI models. The AI API Tracker tile shows API key usage. If xAI does not return remaining credit for your account, you can enter the dashboard balance manually.

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
4. *(Optional)* **Budget ($)** — enter the amount you want to track against.
5. *(Optional)* **Balance ($)** — paste the xAI dashboard balance if xAI's API response does not include remaining credit.

---

## What the tile shows

| Line | Content |
|------|---------|
| Provider name | Grok |
| Usage | Total API key usage reported by xAI |
| Remaining | Budget remaining, API-reported remaining credit, or manually entered Balance |
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

The tile reads API key data from xAI's `/v1/api-key` endpoint. Some xAI responses include usage but not remaining balance; in that case, use the optional Balance field. If xAI changes the endpoint, the tile may show an API error and a plugin update may be needed.
