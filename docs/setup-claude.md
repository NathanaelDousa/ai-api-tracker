# Claude (Anthropic) Setup

The plugin uses Anthropic's **Organization Cost Report API** (`/v1/organizations/cost_report`), which returns daily billed USD amounts. It also reads the **Messages Usage Report API** for today's message token counts. These endpoints require an **Admin key** — regular API keys (`sk-ant-api…`) will show "Admin key required" and the tile will flash ⚠.

> **Plan requirement**: Admin keys are only available on **Team and Enterprise plans**. Individual (free/pro) Anthropic accounts do not have access to organization-level billing data.

---

## Step 1 — Check your plan

Go to **[console.anthropic.com](https://console.anthropic.com)** and confirm you're on a Team or Enterprise plan. If you're on a personal plan, the Admin keys section won't exist in your console.

---

## Step 2 — Create an Admin key

1. In the Anthropic console, go to **Settings → API keys**.

2. Click the **Admin keys** tab (separate from regular API keys).

3. Click **Create Admin key**.

4. Give it a name, e.g. `Stream Deck`.

5. Copy the key — it starts with `sk-ant-admin…` and is only shown once.

> **How to tell Admin keys apart**
> Admin keys start with `sk-ant-admin`. Regular API keys start with `sk-ant-api`. The plugin validates the prefix: if you accidentally paste a regular key the tile will show "Admin key required" immediately without making a network call.

---

## Step 3 — Paste the key into Stream Deck

1. Click your **API Tracker** tile in the Stream Deck app.
2. Scroll to the **Claude (Anthropic)** section in the property inspector.
3. Paste the `sk-ant-admin…` key into the **API Key** field.
4. *(Optional)* Enter a **Budget ($)** for monthly tracking.
5. *(Optional)* Enter **Balance ($)** from the Claude billing dashboard. Anthropic's Admin API exposes usage and cost reports, but not prepaid credit balance, so this field is the reliable way to show dashboard balance when Budget is blank.

---

## Step 4 — Verify it works

Tap the tile to trigger a refresh. You should see today's spend, month-to-date spend, and either budget remaining or your configured dashboard balance within a few seconds.

If the tile flashes ⚠ after using an `sk-ant-admin…` key:
- Confirm the key has not been revoked in the console.
- Make sure the key belongs to an organization with active usage (a brand-new team account with no usage may return an empty report on the first fetch — this is normal and will clear up once you have API activity).

---

## What the tile shows

| Field | Value |
|-------|-------|
| Line 1 | Provider name |
| Line 2 | Dashboard balance or budget remaining, or today's spend when neither is set |
| Line 3 | Month-to-date spend, e.g. `$0.86 /mo` |

When neither Budget nor Balance is set, line 2 shows today's spend. Line 3 always shows month-to-date spend.

The spend total comes from Anthropic's cost report. The token count is read from the usage report and is mainly used for diagnostics and future display modes.
