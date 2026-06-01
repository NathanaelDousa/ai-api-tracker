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
import { formatUsageTitle } from "./titleFormatter";

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
  /** One-shot timer that retries after a bad-api-key / coming-soon error so
   *  temporary API hiccups auto-recover without user intervention. */
  retryTimer:   ReturnType<typeof setTimeout>  | null;
  currentProviderId: string;
  lastSuccessData: { data: UsageData; providerName: string } | null;
  fetchInProgress: boolean;
  displayMode: string;
  showTrend: boolean;
  /** True when the last fetch ended in a permanent-ish error (bad key, no key).
   *  Used by onDidReceiveGlobalSettings to trigger an immediate retry as soon
   *  as the user saves new settings. */
  lastFetchWasError: boolean;
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
      for (const [, tile] of this.tiles) {
        if (tile.action && !tile.cycling) {
          // Always restart the interval timer so a changed refresh rate takes
          // effect immediately.
          this.stopRetryTimer(tile);
          this.startAutoRefresh(tile, tile.action);
          this.startDisplayRefresh(tile, tile.action);
          // If the tile was stuck in an error state, retry right away — this
          // handles the "user just fixed their API key" case without needing
          // a manual tap. Safe because fetchers no longer call getGlobalSettings()
          // internally, so there is no risk of re-triggering this listener.
          if (tile.lastFetchWasError) {
            this.refreshTile(tile, tile.action).catch(() => {});
          }
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
        retryTimer:        null,
        currentProviderId: DEFAULT_PROVIDER_ID,
        lastSuccessData:   null,
        fetchInProgress:   false,
        lastFetchWasError: false,
        cycling:           false,
        displayMode:       "standard",
        showTrend:         true,
      };
      this.tiles.set(id, s);
    }
    return s;
  }

  private isTrendEnabled(value: ActionSettings["showTrend"]): boolean {
    return value !== "no" && value !== false;
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
      tile.displayMode       = ev.payload.settings.displayMode ?? "standard";
      tile.showTrend         = this.isTrendEnabled(ev.payload.settings.showTrend);

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
        this.stopRetryTimer(tile);
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
      LOG(`onDidReceiveSettings provider=${ev.payload.settings.provider} display=${ev.payload.settings.displayMode} trend=${ev.payload.settings.showTrend}`);
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

      // Any settings change clears the retry timer — we'll start fresh below.
      this.stopRetryTimer(tile);

      // Use ev.payload.settings directly — calling action.getSettings() here
      // would cause Stream Deck to fire onDidReceiveSettings again, creating
      // an infinite loop.
      const newProvider    = ev.payload.settings.provider    ?? DEFAULT_PROVIDER_ID;
      const newDisplayMode = ev.payload.settings.displayMode ?? "standard";
      const newShowTrend   = this.isTrendEnabled(ev.payload.settings.showTrend);
      const providerChanged = newProvider    !== tile.currentProviderId;
      const modeChanged     = newDisplayMode !== tile.displayMode;
      const trendChanged    = newShowTrend   !== tile.showTrend;

      if (providerChanged) {
        tile.currentProviderId = newProvider;
        tile.lastSuccessData   = null;
        tile.lastFetchWasError = false;
        await this.showProviderReady(tile, action);
      }

      if (modeChanged || trendChanged) {
        tile.displayMode = newDisplayMode;
        tile.showTrend   = newShowTrend;
        // Re-render immediately using cached data so the new layout appears
        // without waiting for the next data fetch.
        if (tile.lastSuccessData && !providerChanged) {
          const { data, providerName } = tile.lastSuccessData;
          await this.safeSetTitle(action, formatUsageTitle(providerName, data, {
            displayMode: newDisplayMode,
            showTrend:   newShowTrend,
          }));
        }
      }

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
    this.stopRetryTimer(tile);

    const idx  = ALL_PROVIDERS.findIndex(p => p.id === tile.currentProviderId);
    const next = ALL_PROVIDERS[(idx + 1) % ALL_PROVIDERS.length];
    tile.currentProviderId = next.id;
    tile.lastSuccessData   = null;
    tile.lastFetchWasError = false;

    // Guard: tell onDidReceiveSettings to back off while we're in control,
    // but ONLY until the setSettings() response has been received — not for
    // the duration of the network fetch (which can take up to 30s for OpenAI).
    // Holding cycling=true through refreshTile blocks dropdown changes made
    // while the tile is loading.
    tile.cycling = true;
    try {
      await action.setSettings({
        provider:    next.id,
        displayMode: tile.displayMode,
        showTrend:   tile.showTrend ? "yes" : "no",
      } satisfies ActionSettings);
      await this.showProviderReady(tile, action);
      this.startAutoRefresh(tile, action);
      this.startDisplayRefresh(tile, action);
      LOG(`cycleProvider → ${next.id}`);
    } finally {
      // Release before the network fetch so the property inspector remains
      // responsive while the data is loading.
      tile.cycling = false;
    }
    // suppressAlert=true: if the cycled-to provider has no key configured,
    // show the error text but skip the yellow ⚠ flash — it's too alarming
    // when the user is just browsing through providers.
    await this.refreshTile(tile, action, true);
  }

  // =========================================================================
  // TILE REFRESH
  // =========================================================================

  private async refreshTile(tile: TileState, action: WillAppearEvent["action"], suppressAlert = false): Promise<void> {
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
      const data = await provider.fetcher(this.cachedGlobalSettings);
      const wasInError = tile.lastFetchWasError;
      tile.lastFetchWasError = false;
      this.stopRetryTimer(tile);
      tile.lastSuccessData = { data, providerName: provider.name };
      await action.setTitle(formatUsageTitle(provider.name, data, {
        displayMode: tile.displayMode,
        showTrend:   tile.showTrend,
      }));
      if (wasInError) {
        // Recovered from an error state — restart the normal refresh cycle.
        this.startAutoRefresh(tile, action);
        this.startDisplayRefresh(tile, action);
      }
      LOG("refreshTile END (success)");
    } catch (err: unknown) {
      LOG(`refreshTile FETCH ERROR: ${String(err)}`);
      tile.lastFetchWasError = true;
      const fe = await this.handleFetchError(action, provider.name, err, suppressAlert);
      if (fe.kind === "bad-api-key" || fe.kind === "admin-key-required" || fe.kind === "service-account-invalid" || fe.kind === "coming-soon") {
        // Likely a configuration issue, but could be a temporary API glitch.
        // Stop normal refresh and schedule a retry in 10 min so it auto-recovers
        // without user intervention if the key was just temporarily rejected.
        this.stopAutoRefresh(tile);
        this.stopDisplayRefresh(tile);
        this.startRetryTimer(tile, action);
        LOG(`refreshTile: retry in 10 min (${fe.kind})`);
      } else if (fe.kind === "no-api-key" || fe.kind === "service-account-missing") {
        // No key configured — retrying is pointless. Will recover as soon as
        // the user saves a key (onDidReceiveGlobalSettings fires and refreshes).
        this.stopAutoRefresh(tile);
        this.stopDisplayRefresh(tile);
        LOG("refreshTile: paused until key is added");
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
    suppressAlert = false,
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
      // Flash the yellow ⚠ alert for key errors — but only on manual taps,
      // not when cycling (suppressAlert=true), where the error text is enough.
      if (!suppressAlert && (
        fe.kind === "bad-api-key" ||
        fe.kind === "admin-key-required" ||
        fe.kind === "no-api-key" ||
        fe.kind === "service-account-missing" ||
        fe.kind === "service-account-invalid" ||
        fe.kind === "coming-soon"
      )) {
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
  // ERROR FORMATTING
  // =========================================================================

  private formatError(name: string, err: FetchError): string {
    const short = name.length > 7 ? name.slice(0, 6) + "…" : name;

    switch (err.kind) {
      case "no-api-key":    return `${short}\nAdd API key\nin settings`;
      case "admin-key-required": return `${short}\nAdmin key\nrequired`;
      case "service-account-missing": return `${short}\nAdd SA file\nin settings`;
      case "service-account-invalid": {
        // Show the first ~14 chars of the reason so the tile is diagnostic.
        const reason = err.message.slice(0, 14);
        return `${short}\nSA error:\n${reason}`;
      }
      case "bad-api-key":   return err.status === 403
        ? `${short}\nAdmin key\nin settings`
        : `${short}\nCheck API key\nin settings`;
      case "rate-limited":  return `${short}\nRate limited\nTry later`;
      case "network-error": return `${short}\nOffline?\nCheck network`;
      case "api-error":     return `${short}\nAPI err ${err.status}`;
      case "billing-unavailable": return `${short}\nNo billing\nAPI — check console`;
      case "coming-soon":   return `${short}\nAdmin key req.\nTeam plan only`;
      default:              return `${short}\nError\n${err.message.slice(0, 12)}`;
    }
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
    const gs  = this.cachedGlobalSettings;
    const raw = gs.refreshInterval;

    // "manual" = new explicit off value (sdpi-select saves non-falsy strings reliably).
    // "0" / 0  = legacy stored value from old installs.
    // undefined/null = setting never saved → default to 2 min (matches HTML selected).
    // Number("manual") = NaN, NaN > 0 = false → no timer (correct).
    const mins = (raw === undefined || raw === null) ? 2 : Number(raw);
    LOG(`startAutoRefresh: refreshInterval=${JSON.stringify(raw)} → mins=${mins}`);

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
        this.safeSetTitle(action, formatUsageTitle(providerName, data, {
          displayMode: tile.displayMode,
          showTrend:   tile.showTrend,
        }));
      }
    }, 10_000);
  }

  private stopDisplayRefresh(tile: TileState): void {
    if (tile.displayTimer !== null) {
      clearInterval(tile.displayTimer);
      tile.displayTimer = null;
    }
  }

  // =========================================================================
  // RETRY TIMER (bad-key / coming-soon errors)
  // =========================================================================

  /** Schedule a single retry attempt after 10 minutes.
   *  If the fetch succeeds, normal auto-refresh restarts automatically.
   *  If it fails again, another retry is scheduled. */
  private startRetryTimer(tile: TileState, action: WillAppearEvent["action"]): void {
    this.stopRetryTimer(tile);
    tile.retryTimer = setTimeout(() => {
      tile.retryTimer = null;
      LOG("retryTimer fired — retrying fetch");
      this.refreshTile(tile, action).catch(() => {});
    }, 10 * 60_000);
  }

  private stopRetryTimer(tile: TileState): void {
    if (tile.retryTimer !== null) {
      clearTimeout(tile.retryTimer);
      tile.retryTimer = null;
    }
  }
}
