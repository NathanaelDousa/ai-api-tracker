# Privacy Policy — AI API Tracker

**Last updated: May 2026**

## What This Plugin Does

AI API Tracker is a Stream Deck plugin that displays your remaining balance or
monthly usage for AI provider APIs (OpenAI, Anthropic Claude, Google Gemini,
DeepSeek, OpenRouter, and xAI Grok) directly on your Stream Deck keys.

## Data Collected

This plugin does **not** collect, store, or transmit any personal data to the
plugin developer or any third party.

### API Keys

Your API keys are entered in the Stream Deck property inspector and stored
**locally** by the Elgato Stream Deck application on your device. They are
never sent anywhere except directly to the respective AI provider's official
API endpoint to retrieve your own usage or balance information.

Optional dashboard balance fields for OpenAI, Claude, and Grok are also stored
locally by Stream Deck. They are only used for display on your tile.

### Usage Data

Balance and usage figures are fetched from provider APIs and displayed on your
Stream Deck. The plugin developer does not receive this data.

The plugin stores a small local trend/spend file for providers that need local
history, such as DeepSeek balance deltas and today-vs-yesterday trend lines.
These files stay on your device and are excluded from Marketplace release
packages.

### Exchange Rates

When your DeepSeek balance is denominated in CNY, the plugin fetches a live
CNY → USD exchange rate from [frankfurter.app](https://www.frankfurter.app)
(European Central Bank data). No personally identifiable information is sent
in this request.

## Third-Party Services

| Service | Purpose | Privacy Policy |
|---------|---------|----------------|
| OpenAI API | Fetch usage data | https://openai.com/policies/privacy-policy |
| Anthropic API | Fetch usage data | https://www.anthropic.com/privacy |
| Google Gemini API | Fetch usage data | https://policies.google.com/privacy |
| DeepSeek API | Fetch balance | https://www.deepseek.com/privacy |
| OpenRouter API | Fetch credits and usage | https://openrouter.ai/privacy |
| xAI API | Fetch API key usage | https://x.ai/legal/privacy-policy |
| frankfurter.app | CNY→USD rate | https://www.frankfurter.app |

## Logging

The plugin writes local diagnostic logs through Stream Deck. Logs are intended
for troubleshooting only and avoid raw provider responses. Local logs are not
included in release packages.

## Contact

If you have questions about this privacy policy, open an issue at
https://github.com/NathanaelDousa/ai-api-tracker or contact
nathan.dousa@gmail.com.
