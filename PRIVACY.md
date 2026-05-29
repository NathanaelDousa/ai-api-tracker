# Privacy Policy — AI API Tracker

**Last updated: May 2026**

## What This Plugin Does

AI API Tracker is a Stream Deck plugin that displays your remaining balance or
monthly usage for AI provider APIs (OpenAI, Anthropic Claude, Google Gemini,
and DeepSeek) directly on your Stream Deck keys.

## Data Collected

This plugin does **not** collect, store, or transmit any personal data to the
plugin developer or any third party.

### API Keys

Your API keys are entered in the Stream Deck property inspector and stored
**locally** by the Elgato Stream Deck application on your device. They are
never sent anywhere except directly to the respective AI provider's official
API endpoint to retrieve your own usage or balance information.

### Usage Data

Balance and usage figures are fetched in real time from each provider's API
and displayed on your Stream Deck. This data is never stored persistently or
shared.

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
| frankfurter.app | CNY→USD rate | https://www.frankfurter.app |

## Contact

If you have questions about this privacy policy, open an issue at
https://github.com/NathanaelDousa/ai-api-tracker or contact
nathan.dousa@gmail.com.
