# OpenAI Setup

The plugin uses OpenAI's **Organization Costs API** (`/v1/organization/costs`), which returns your actual billed USD amounts per day. It also reads today's **Usage API** token counts for completions and embeddings so recent activity can be estimated while the cost report catches up. These endpoints require an **Admin key** — a regular project key (`sk-proj-…`) will receive a 403 Forbidden error.

---

## Step 1 — Create an Admin API key

1. Go to **[platform.openai.com/organization/api-keys](https://platform.openai.com/organization/api-keys)**
   *(You must be an Owner or Admin of the organization.)*

2. Click **Create new secret key**.

3. Give it a name, e.g. `Stream Deck`.

4. Under **Role**, select **Admin**.

5. Click **Create secret key**, then **copy** the key immediately — you won't be able to see it again.

> **Admin vs Project keys**
> OpenAI has two key types. Project keys (`sk-proj-…`) can only call inference endpoints. Admin keys (also starting with `sk-…`) have access to organization-level data like billing and usage. The role is set at creation time and is not visible in the key string itself.

---

## Step 2 — Paste the key into Stream Deck

1. Click your **API Tracker** tile in the Stream Deck app.
2. In the property inspector, scroll to the **OpenAI** section.
3. Paste the key into the **API Key** field.
4. *(Optional)* Enter a **Budget ($)** — the tile will show budget minus month-to-date usage.
5. *(Optional)* Enter **Balance ($)** from the OpenAI billing dashboard. OpenAI currently blocks this credit-balance value from Admin API keys, so this field is the reliable way to show your dashboard balance on the tile when Budget is blank.

---

## Step 3 — Verify it works

Tap the tile once to trigger a manual refresh. If the key is correct you'll see your configured dashboard balance or budget remaining and month-to-date spend within a few seconds.

If the tile flashes ⚠:
- Double-check the key was created with **Admin** role.
- Make sure you're logged in as an **Owner or Admin** of the organization (Personal accounts don't have the Organization Costs API).

---

## What the tile shows

| Field | Value |
|-------|-------|
| Line 1 | Provider name |
| Line 2 | Configured dashboard balance or budget remaining, e.g. `$12.40 left` |
| Line 3 | Month-to-date spend, e.g. `$0.10 /mo` |

When neither Budget nor Balance is set, line 2 shows today's spend because OpenAI's public Admin API exposes costs and usage, but not the prepaid credit balance shown in the billing dashboard.

---

## Why the balance may differ slightly from the platform

When a budget is configured, the tile calculates remaining balance as **your configured budget minus the spend reported by the Costs API**, plus a best-effort estimate for today's completion and embedding token usage when that estimate is ahead of the settled cost report. Estimated values are prefixed with `~`.

OpenAI's Costs API processes usage in batches and can lag behind real-time billing. The Usage API is fresher, but it reports usage counts rather than final invoices, so the plugin avoids double-counting by using the settled cost report as the baseline and only adding the live estimate delta while it is higher.

When no budget is configured, the plugin also makes a best-effort credit-balance lookup against OpenAI's billing dashboard endpoint. In current OpenAI behavior this endpoint can return `403` because it requires a browser session key, so the optional Balance field is used as the dependable fallback.
