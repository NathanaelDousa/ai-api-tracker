# Gemini (Google) Setup

Google's Gemini API doesn't expose a usage or billing endpoint accessible with a simple API key. Instead, the plugin reads daily **request counts** from **Google Cloud Monitoring**, which requires a **GCP service account**.

> **What's shown**: Gemini tiles display today's successful **request count** (2xx API calls). If you enter an average **Cost/request ($)** in settings, the tile converts request counts into an estimated spend and prefixes estimated dollar values with `~`.

This setup takes about 10 minutes and only needs to be done once.

---

## Prerequisites

- A Google account with an active GCP project  
  (or create a free one at [console.cloud.google.com](https://console.cloud.google.com))
- You must have at least **Editor** or **Owner** role on the project to create service accounts

---

## Step 1 — Enable the required APIs

1. Open [console.cloud.google.com](https://console.cloud.google.com) and select your project.

2. In the search bar at the top, search for **Generative Language API** and click **Enable**.
   *(This is the API behind Gemini — skip if you're already using Gemini on this project.)*

3. Search for **Cloud Monitoring API** and click **Enable**.
   *(This is what the plugin reads usage data from.)*

---

## Step 2 — Create a service account

1. In the GCP console left menu, go to **IAM & Admin → Service Accounts**.

2. Click **+ Create Service Account** at the top.

3. Fill in:
   - **Name**: `stream-deck-monitor` (or any name)
   - **Description**: `Read-only access to Cloud Monitoring for Stream Deck plugin`

4. Click **Create and Continue**.

5. In the **Grant this service account access to project** step, click **Select a role** and choose:
   - **Monitoring → Monitoring Viewer**

   This is a read-only role — it can only read metrics, not modify anything in your project.

6. Click **Continue**, then **Done**.

---

## Step 3 — Download the JSON key file

1. Back on the Service Accounts list, click the service account you just created.

2. Go to the **Keys** tab.

3. Click **Add Key → Create new key**.

4. Select **JSON** and click **Create**.

5. A `.json` file is downloaded to your computer. **Move it somewhere stable** — the plugin reads it every time it starts up. A good location is your home directory, e.g.:
   - macOS/Linux: `/Users/yourname/gemini-sa.json`
   - Windows: `C:\Users\yourname\gemini-sa.json`

> **Keep this file safe.** It grants read-only monitoring access to your GCP project. Don't commit it to git or share it. Add its path to your `.gitignore` if you store it inside a project folder.

---

## Step 4 — Find your GCP Project ID

Your project ID is the short identifier (not the display name) — for example `my-project-123456`. You can find it:

- In the project selector dropdown at the top of the GCP console (shown under the project name)
- In the JSON key file itself, as the `"project_id"` field

The plugin can read the project ID directly from the JSON file, so this step is optional — but entering it manually means the plugin starts faster.

---

## Step 5 — Configure in Stream Deck

1. Click your **API Tracker** tile in the Stream Deck app.
2. Scroll to the **Gemini (Google)** section in the property inspector.
3. In **SA JSON**, click **Choose JSON** and select the service account key file you downloaded.
4. In **GCP Project**, enter your project ID only if you want to override the `"project_id"` in the JSON.
5. Optional: enter **Cost/request ($)** if you want spend estimates instead of raw request count.
6. Optional: enter **Budget ($)** to show estimated monthly remaining budget when Cost/request is set.

The JSON is imported into local Stream Deck settings, similar to the API keys
for the other providers. Keep the downloaded key file private.

---

## Step 6 — Verify it works

Tap the tile to trigger a manual refresh. If everything is configured correctly, you'll see today's request count within a few seconds.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Tile flashes ⚠ on first use | Service account JSON was not imported or is invalid | Re-select the JSON file in the Gemini section |
| ⚠ flash + tile shows "Auth error" | Service account key was revoked or project IAM changed | Re-download the JSON key from GCP |
| Tile shows `0 req` even though you've made calls | Cloud Monitoring API not enabled | Enable it in Step 1 |
| Tile shows `0 req` for a brand-new project | No data yet — monitoring can lag | Wait and tap to refresh |

---

## Understanding the numbers

Cloud Monitoring aggregates request counts in **1-day windows** (UTC). The plugin sums today's window, so counts reset at midnight UTC. If you make calls at 11 PM and midnight crosses, the count restarts — this is a Google-side limitation.

Google Cloud service runtime metrics can take several minutes and sometimes longer to appear in Cloud Monitoring. The tile should be treated as a recent operational signal, not an instant billing ledger.
