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

---

## Step 4 — Verify it works

Tap the tile to trigger a refresh. You should see today's spend and budget remaining within a few seconds.

If the tile flashes ⚠ after using an `sk-ant-admin…` key:
- Confirm the key has not been revoked in the console.
- Make sure the key belongs to an organization with active usage (a brand-new team account with no usage may return an empty report on the first fetch — this is normal and will clear up once you have API activity).

---

## What the tile shows

| Field | Value |
|-------|-------|
| Line 1 | Provider name |
| Line 2 | Today's spend, e.g. `$2.10 today` |
| Line 3 | Budget remaining or monthly total |

When no budget is set, line 3 shows your total month-to-date spend.

The spend total comes from Anthropic's cost report. The token count is read from the usage report and is mainly used for diagnostics and future display modes.
