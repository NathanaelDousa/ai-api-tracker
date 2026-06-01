# AI API Tracker — Stream Deck Plugin

Monitor your AI API spending and credit balances directly on your Stream Deck keys. Supports OpenAI, Claude (Anthropic), Gemini (Google), DeepSeek, OpenRouter, and Grok (xAI) from a single plugin.

---

## What it shows

| Provider | What's displayed | Needs |
|----------|-----------------|-------|
| **OpenAI** | Daily spend · Monthly spend · optional budget or manually entered dashboard balance | Admin API key |
| **Claude** | Daily spend · Monthly spend · optional budget or manually entered dashboard balance | Admin API key (Team/Enterprise only) |
| **Gemini** | Requests today · Requests this month · or estimated spend when cost/request is set | GCP service account |
| **DeepSeek** | Remaining credit balance · locally tracked monthly spend · trend | Regular API key |
| **OpenRouter** | Credits remaining · daily/monthly usage when available · trend | API key from openrouter.ai |
| **Grok (xAI)** | Credits used · optional budget or manually entered dashboard balance · trend | API key from console.x.ai |

Each tile tracks one provider. You can place as many tiles as you like — one per provider, or several showing the same provider at different zoom levels.

---

## Features

- **Live data** — auto-refreshes on a configurable interval (1 min → 15 min or manual)
- **Budget tracking** — set a monthly budget and see how much you have left; tile turns amber at ≤ 25 % and red at ≤ 10 %
- **Trend line** — optional today-vs-yesterday trend for spend or request count
- **Focus modes** — zoom in on one number: remaining balance, monthly spend, or today's spend
- **Estimate marker** — values prefixed with `~` include best-effort local estimation
- **Hold to cycle** — hold any tile for 0.8 s to flip through all providers without opening settings
- **Tap to refresh** — single tap forces an immediate refresh
- **Bad key alert** — Stream Deck's native ⚠ flash fires when the key is wrong or missing, so you know instantly
- **Privacy first** — keys stored locally by Stream Deck and only ever sent to the official provider API

---

## Installation

### From the Elgato Marketplace *(recommended)*

Search for **AI API Tracker** in the Stream Deck app → Store tab, or visit the [Elgato Marketplace](https://marketplace.elgato.com).

### From source

```bash
git clone https://github.com/NathanaelDousa/ai-api-tracker.git
cd ai-api-tracker
npm install
npm run build          # compiles + links to Stream Deck automatically
```

---

## Quick setup

1. Drag an **API Tracker** tile onto your Stream Deck layout.
2. Open the property inspector (click the tile in the Stream Deck app).
3. Choose a provider from the **Provider** dropdown.
4. Paste your API key (or service account path for Gemini) in the relevant section.
5. Optionally set a monthly budget — the tile will show remaining balance vs that budget.
6. For OpenAI, Claude, or Grok, optionally paste the dashboard balance when the provider API does not expose it.

---

## Provider setup guides

Each provider has different authentication requirements. The links below walk you through the exact steps:

- [OpenAI setup](docs/setup-openai.md) — Admin key required; balance can be entered manually
- [Claude setup](docs/setup-claude.md) — Admin key required (Team/Enterprise only); balance can be entered manually
- [Gemini setup](docs/setup-gemini.md) — GCP service account required *(most involved)*
- **DeepSeek** — paste a regular API key from [platform.deepseek.com](https://platform.deepseek.com/api_keys); CNY balances use an automatic daily exchange rate or a manual override
- [OpenRouter setup](docs/setup-openrouter.md) — paste an API key from [openrouter.ai/keys](https://openrouter.ai/keys); account credits are picked up automatically
- [Grok (xAI) setup](docs/setup-grok.md) — paste an API key from [console.x.ai](https://console.x.ai); balance can be entered manually if xAI omits it

---

## Release packaging

Marketplace builds should be staged from a clean whitelist so local logs and
runtime state are never shipped:

```bash
npm run release:stage
streamdeck pack dist/release/com.nathanaeldousa.ai-api-tracker.sdPlugin
```

`release:stage` rebuilds the plugin, copies only release files into
`dist/release`, and fails if local logs, runtime JSON, source maps, external CDN
references, or raw-response logging are present.

---

## Tile interactions

| Action | Result |
|--------|--------|
| **Tap** | Immediate refresh |
| **Hold ≥ 0.8 s** | Cycle to next provider |
| **⚠ flash on tap** | API key is missing or invalid |

---

## Privacy

No data leaves your machine except the API calls to each provider's official endpoint. See [PRIVACY.md](PRIVACY.md) for the full policy.

---

## License

MIT — see [LICENSE](LICENSE).
