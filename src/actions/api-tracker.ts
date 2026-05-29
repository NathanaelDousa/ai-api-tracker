import fs from "node:fs";
import path from "node:path";
import streamDeck, {
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  KeyDownEvent,
  KeyUpEvent,
  DidReceiveSettingsEvent,
  action,
} from "@elgato/streamdeck";
import type { UsageData, FetchError, ActionSettings, GlobalSettings } from "../services/types";
import { getProvider, DEFAULT_PROVIDER_ID, ALL_PROVIDERS } from "../services/providerRegistry";

const LOG = (msg: string) => streamDeck.logger.info(`[AI Tracker] ${msg}`);

const HOLD_MS = 800;

// Per-tile state — one entry per visible tile instance, keyed by action.id.
interface TileState {
  /**
   * The SDK action handle for this tile, stored so the global-settings listener
   * can restart auto-refresh timers for all tiles when the interval changes.
   */
  action: WillAppearEvent<ActionSettings>["action"] | null;
  keyDownTime: number;
  refreshTimer: ReturnType<typeof setInterval> | null;
  displayTimer: ReturnType<typeof setInterval> | null;
  currentProviderId: string;
  lastSuccessData: { data: UsageData; providerName: string } | null;
  fetchInProgress: boolean;
  /**
   * Set to true while cycleProvider() is running so onDidReceiveSettings
   * (which fires as a side-effect of action.setSettings inside cycleProvider)
   * knows to back off and not restart timers that cycleProvider is managing.
   */
  cycling: boolean;
}

@action({ UUID: "com.nathanaeldousa.ai-api-tracker.tracker" })
export class ApiTrackerAction extends SingletonAction<ActionSettings> {
  private readonly tiles = new Map<string, TileState>();

  /**
   * Cached copy of global settings.
   *
   * CRITICAL: startAutoRefresh() must NEVER call getGlobalSettings() when
   * executing inside onDidReceiveSettings's call chain. Doing so causes an
   * infinite loop: getGlobalSettings() sends a WebSocket request and Stream
   * Deck responds with a didReceiveSettings event, which re-enters
   * onDidReceiveSettings, which calls startAutoRefresh, which calls
   * getGlobalSettings() again — and so on until the 15-second SDK timeout
   * fires a crash and the whole cycle restarts.
   *
   * Instead we keep a local cache and update it via onDidReceiveGlobalSettings,
   * which only fires on the separate didReceiveGlobalSettings channel and is
   * therefore safe.
   */
  private cachedGlobalSettings: GlobalSettings = {};

  constructor() {
    super();

    // Keep the cache fresh whenever global settings change (either because
    // the user edited them in the property inspector, or because we called
    // getGlobalSettings() ourselves in onWillAppear).
    streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
      this.cachedGlobalSettings = ev.settings as unknown as GlobalSettings;
      LOG("global settings cache updated");
      // Restart auto-refresh for every visible tile so the new interval takes
      // effect immediately without waiting for the next onDidReceiveSettings.
      for (const [, tile] of this.tiles) {
        if (tile.action && !tile.cycling) {
          this.startAutoRefresh(tile, tile.action);
        }
      }
    });
  }

  private getOrCreateTile(id: string): TileState {
    let s = this.tiles.get(id);
    if (!s) {
      s = {
        action:            null,
        keyDownTime:       0,
        refreshTimer:      null,
        displayTimer:      null,
        currentProviderId: DEFAULT_PROVIDER_ID,
        lastSuccessData:   null,
        fetchInProgress:   false,
        cycling:           false,
      };
      this.tiles.set(id, s);
    }
    return s;
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
    try {
      LOG("onWillAppear START");
      const { action } = ev;
      const tile = this.getOrCreateTile(action.id);

      // Keep the action handle so the global-settings listener can reach it.
      tile.action = action;

      // Use ev.payload.settings directly — calling action.getSettings() here
      // would cause Stream Deck to fire onDidReceiveSettings again.
      tile.currentProviderId = ev.payload.settings.provider ?? DEFAULT_PROVIDER_ID;

      // Eagerly populate the global settings cache on first tile appearance.
      // This call is safe here — it is NOT inside onDidReceiveSettings's call
      // chain, so the didReceiveSettings response it provokes cannot loop.
      if (Object.keys(this.cachedGlobalSettings).length === 0) {
        try {
          const raw = await streamDeck.settings.getGlobalSettings();
          this.cachedGlobalSettings = raw as unknown as GlobalSettings;
        } catch {
          // Non-fatal — startAutoRefresh will fall back to a 2-minute default.
        }
      }

      await this.showProviderReady(tile, action);
      this.startAutoRefresh(tile, action);   // synchronous — uses cache
      this.startDisplayRefresh(tile, action);
      await this.refreshTile(tile, action);
      LOG("onWillAppear END");
    } catch (err: unknown) {
      LOG(`onWillAppear CRASH: ${String(err)}`);
    }
  }

  override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
    try {
      const tile = this.tiles.get(ev.action.id);
      if (tile) {
        this.stopAutoRefresh(tile);
        this.stopDisplayRefresh(tile);
        tile.action = null;
        this.tiles.delete(ev.action.id);
      }
    } catch (err: unknown) {
      LOG(`onWillDisappear CRASH: ${String(err)}`);
    }
  }

  // =========================================================================
  // KEY EVENTS
  // =========================================================================

  override onKeyDown(ev: KeyDownEvent<ActionSettings>): void {
    try {
      const tile = this.getOrCreateTile(ev.action.id);
      tile.keyDownTime = Date.now();
    } catch (err: unknown) {
      LOG(`onKeyDown CRASH: ${String(err)}`);
    }
  }

  override async onKeyUp(ev: KeyUpEvent<ActionSettings>): Promise<void> {
    try {
      LOG("onKeyUp START");
      const { action } = ev;
      const tile = this.getOrCreateTile(action.id);
      const held = Date.now() - tile.keyDownTime >= HOLD_MS;

      if (held) {
        await this.cycleProvider(tile, action);
      } else {
        await action.setTitle("Checking...");
        await this.refreshTile(tile, action);
      }
      LOG("onKeyUp END");
    } catch (err: unknown) {
      LOG(`onKeyUp CRASH: ${String(err)}`);
      this.safeSetTitle(ev.action, "Plugin Error\nCheck logs");
    }
  }

  // =========================================================================
  // SETTINGS
  // =========================================================================

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
    try {
      LOG("onDidReceiveSettings START");
      const { action } = ev;
      const tile = this.getOrCreateTile(action.id);

      // Keep the action handle current.
      tile.action = action;

      // cycleProvider() drives its own full lifecycle — if it called
      // action.setSettings() it will have already handled timers and the
      // initial fetch. Letting onDidReceiveSettings run concurrently would
      // restart timers that cycleProvider may have intentionally stopped
      // (e.g. after a permanent error).
      if (tile.cycling) {
        LOG("onDidReceiveSettings: skipped (cycleProvider in progress)");
        return;
      }

      // Use ev.payload.settings directly — calling action.getSettings() here
      // would cause Stream Deck to fire onDidReceiveSettings again, creating
      // an infinite loop.
      const newProvider = ev.payload.settings.provider ?? DEFAULT_PROVIDER_ID;
      const providerChanged = newProvider !== tile.currentProviderId;

      if (providerChanged) {
        tile.currentProviderId = newProvider;
        tile.lastSuccessData   = null;
        await this.showProviderReady(tile, action);
      }

      // startAutoRefresh is now synchronous and uses the cached global
      // settings — it MUST NOT call getGlobalSettings() here because that
      // would re-trigger onDidReceiveSettings and create an infinite loop.
      this.stopAutoRefresh(tile);
      this.startAutoRefresh(tile, action);
      this.startDisplayRefresh(tile, action);

      // Fetch immediately when the provider is changed via the dropdown so
      // the user doesn't have to wait for the next auto-refresh tick.
      if (providerChanged) {
        await this.refreshTile(tile, action);
      }

      LOG("onDidReceiveSettings END");
    } catch (err: unknown) {
      LOG(`onDidReceiveSettings CRASH: ${String(err)}`);
    }
  }

  // =========================================================================
  // PROVIDER CYCLING (long-hold)
  // =========================================================================

  private async cycleProvider(tile: TileState, action: WillAppearEvent["action"]): Promise<void> {
    this.stopAutoRefresh(tile);
    this.stopDisplayRefresh(tile);

    const idx  = ALL_PROVIDERS.findIndex(p => p.id === tile.currentProviderId);
    const next = ALL_PROVIDERS[(idx + 1) % ALL_PROVIDERS.length];
    tile.currentProviderId = next.id;
    tile.lastSuccessData   = null;

    // Guard: tell onDidReceiveSettings to back off while we're in control.
    tile.cycling = true;
    try {
      await action.setSettings({ provider: next.id } satisfies ActionSettings);
      await this.showProviderReady(tile, action);
      this.startAutoRefresh(tile, action);   // synchronous — uses cache
      this.startDisplayRefresh(tile, action);
      LOG(`cycleProvider → ${next.id}`);
      await this.refreshTile(tile, action);
    } finally {
      tile.cycling = false;
    }
  }

  // =========================================================================
  // TILE REFRESH
  // =========================================================================

  private async refreshTile(tile: TileState, action: WillAppearEvent["action"]): Promise<void> {
    LOG(`refreshTile START (provider=${tile.currentProviderId})`);

    const provider = getProvider(tile.currentProviderId);
    if (!provider) {
      await action.setTitle("Unknown\nprovider\nCheck settings");
      return;
    }

    if (!provider.implemented) {
      const short = provider.name.length > 7 ? provider.name.slice(0, 6) + "…" : provider.name;
      await action.setTitle(`${short}\nComing soon\nNot implemented`);
      LOG("refreshTile END (placeholder)");
      return;
    }

    await this.safeSetImage(action, provider.iconPath);

    tile.fetchInProgress = true;
    try {
      const data = await provider.fetcher();
      await action.setTitle(this.formatSuccess(provider.name, data));
      tile.lastSuccessData = { data, providerName: provider.name };
      LOG("refreshTile END (success)");
    } catch (err: unknown) {
      LOG(`refreshTile FETCH ERROR: ${String(err)}`);
      const fe = await this.handleFetchError(action, provider.name, err);
      if (fe.kind === "bad-api-key" || fe.kind === "no-api-key" || fe.kind === "coming-soon") {
        this.stopAutoRefresh(tile);
        this.stopDisplayRefresh(tile);
        LOG(`refreshTile: stopped auto-refresh (permanent error: ${fe.kind})`);
      }
    } finally {
      tile.fetchInProgress = false;
    }
  }

  // =========================================================================
  // PROVIDER READY STATE
  // =========================================================================

  private async showProviderReady(tile: TileState, action: WillAppearEvent["action"]): Promise<void> {
    const provider = getProvider(tile.currentProviderId);
    if (!provider) {
      await action.setTitle("Unknown\nprovider\nCheck settings");
      return;
    }

    const short = provider.name.length > 7 ? provider.name.slice(0, 6) + "…" : provider.name;
    await this.safeSetImage(action, provider.iconPath);

    if (!provider.implemented) {
      await action.setTitle(`${short}\nComing soon`);
    } else {
      await action.setTitle(`${short}\nChecking…`);
    }
  }

  // =========================================================================
  // SAFETY HELPERS
  // =========================================================================

  private async safeSetTitle(action: WillAppearEvent["action"], title: string): Promise<void> {
    try { await action.setTitle(title); } catch { /* ignore */ }
  }

  private async safeSetImage(action: WillAppearEvent["action"], iconPath: string): Promise<void> {
    try {
      const filePath = path.join(process.cwd(), iconPath + ".png");
      LOG(`safeSetImage trying: ${filePath}`);
      const data = await fs.promises.readFile(filePath);
      const b64  = `data:image/png;base64,${data.toString("base64")}`;
      await action.setImage(b64);
      LOG(`safeSetImage OK`);
    } catch (err: unknown) {
      LOG(`safeSetImage WARN (${iconPath}): ${String(err)}`);
    }
  }

  private async handleFetchError(
    action: WillAppearEvent["action"],
    providerName: string,
    err: unknown,
  ): Promise<FetchError> {
    const fe = this.normalizeError(err);

    streamDeck.logger.warn(
      `[AI Tracker] fetch failed (${providerName}): ${fe.kind}` +
        ("status" in fe ? ` HTTP ${(fe as { status: number }).status}` : "") +
        ("message" in fe ? ` - ${(fe as { message: string }).message}` : ""),
    );

    try {
      const title = this.formatError(providerName, fe);
      await action.setTitle(title);
      // For key-setup errors, flash the built-in yellow ⚠ alert so it's
      // clear this needs attention without leaving alarming text permanently.
      if (fe.kind === "bad-api-key" || fe.kind === "no-api-key" || fe.kind === "coming-soon") {
        await action.showAlert();
      }
    } catch {
      await action.setTitle(`${providerName.slice(0, 7)}\nError\nCheck logs`);
    }

    return fe;
  }

  private normalizeError(err: unknown): FetchError {
    if (
      err && typeof err === "object" && "kind" in err &&
      typeof (err as Record<string, unknown>).kind === "string"
    ) {
      return err as FetchError;
    }
    const message = err instanceof Error ? err.message : String(err ?? "Unknown");
    return { kind: "unknown-error", message };
  }

  // =========================================================================
  // TITLE FORMATTING
  // =========================================================================

  private formatSuccess(name: string, d: UsageData): string {
    const short = name.length > 7 ? name.slice(0, 6) + "…" : name;
    const age   = this.timeAgo(d.lastUpdated);

    if (d.unit === "requests") {
      if (d.dailyTokens === 0) return `${short}\n0 req today\n${age}`;
      return `${short}\n${d.dailyTokens} req today\n${age}`;
    }

    if (d.budgetTotal === 0) {
      if (d.dailyCost === 0 && d.dailyTokens === 0) return `${short}\n$0 today\n${age}`;
      return `${short}\n$${d.dailyCost.toFixed(2)} today\n${age}`;
    }

    if (d.budgetRemaining <= 0) {
      const over = Math.abs(d.budgetRemaining).toFixed(2);
      return `${short}\n⚠ Over limit\n+$${over} over`;
    }

    if (d.dailyCost === 0 && d.dailyTokens === 0) {
      return `${short}\n$${d.budgetRemaining.toFixed(2)} left\n${age}`;
    }

    const pct    = (d.budgetRemaining / d.budgetTotal) * 100;
    const prefix = pct <= 10 ? "⚠ " : pct <= 25 ? "⚡ " : "";
    return `${prefix}${short}\n$${d.budgetRemaining.toFixed(2)} left\n${age}`;
  }

  private formatError(name: string, err: FetchError): string {
    const short = name.length > 7 ? name.slice(0, 6) + "…" : name;

    switch (err.kind) {
      case "no-api-key":    return `${short}\nAdd API key\nin settings`;
      case "bad-api-key":   return err.status === 403
        ? `${short}\nAdmin key\nin settings`
        : `${short}\nCheck API key\nin settings`;
      case "rate-limited":  return `${short}\nRate limited\nTry later`;
      case "network-error": return `${short}\nOffline?\nCheck network`;
      case "api-error":     return `${short}\nAPI err ${err.status}`;
      case "coming-soon":   return `${short}\nAdmin key\nin settings`;
      default:              return `${short}\nError\n${err.message.slice(0, 12)}`;
    }
  }

  private timeAgo(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60)  return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  }

  // =========================================================================
  // AUTO-REFRESH
  // =========================================================================

  /**
   * Starts the auto-refresh timer using the cached global settings.
   *
   * IMPORTANT: this method is synchronous and must stay that way. It is called
   * from inside onDidReceiveSettings. Any await inside this method that sends a
   * WebSocket message to Stream Deck (e.g. getGlobalSettings) will cause Stream
   * Deck to send back a didReceiveSettings event, which re-enters
   * onDidReceiveSettings and creates an infinite loop.
   */
  private startAutoRefresh(tile: TileState, action: WillAppearEvent["action"]): void {
    // Use nullish coalescing so "0" (manual only) is respected, not treated as falsy.
    const gs   = this.cachedGlobalSettings;
    const mins = gs.refreshInterval != null ? Number(gs.refreshInterval) : 2;
    this.stopAutoRefresh(tile);
    if (mins > 0) {
      tile.refreshTimer = setInterval(() => {
        this.refreshTile(tile, action).catch(() => {});
      }, mins * 60_000);
    }
  }

  private stopAutoRefresh(tile: TileState): void {
    if (tile.refreshTimer !== null) {
      clearInterval(tile.refreshTimer);
      tile.refreshTimer = null;
    }
  }

  private startDisplayRefresh(tile: TileState, action: WillAppearEvent["action"]): void {
    this.stopDisplayRefresh(tile);
    tile.displayTimer = setInterval(() => {
      if (tile.fetchInProgress) return;
      if (tile.lastSuccessData) {
        const { data, providerName } = tile.lastSuccessData;
        this.safeSetTitle(action, this.formatSuccess(providerName, data));
      }
    }, 10_000);
  }

  private stopDisplayRefresh(tile: TileState): void {
    if (tile.displayTimer !== null) {
      clearInterval(tile.displayTimer);
      tile.displayTimer = null;
    }
  }
}
