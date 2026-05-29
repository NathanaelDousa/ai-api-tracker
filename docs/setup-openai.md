# OpenAI Setup

The plugin uses OpenAI's **Organization Costs API** (`/v1/organization/costs`), which returns your actual billed USD amounts per day. This endpoint requires an **Admin key** — a regular project key (`sk-proj-…`) will receive a 403 Forbidden error.

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
4. *(Optional)* Enter a **Budget ($)** — the tile will show how much budget remains for the month.

---

## Step 3 — Verify it works

Tap the tile once to trigger a manual refresh. If the key is correct you'll see your daily spend and budget remaining within a few seconds.

If the tile flashes ⚠:
- Double-check the key was created with **Admin** role.
- Make sure you're logged in as an **Owner or Admin** of the organization (Personal accounts don't have the Organization Costs API).

---

## What the tile shows

| Field | Value |
|-------|-------|
| Line 1 | Provider name |
| Line 2 | Today's spend, e.g. `$0.84 today` |
| Line 3 | Budget remaining or monthly total, e.g. `$12.40 left` |

When no budget is set, line 3 shows your total month-to-date spend instead.
