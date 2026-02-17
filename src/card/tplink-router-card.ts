import { LitElement, html, nothing } from "lit";
import { cardStyles } from "./styles";
import { localize } from "../i18n";
import { buildDiagnosticPackage } from "../utils/export-utils";
import { matchAction } from "../utils/action-matcher";
import { formatSpeed } from "../utils/format";
import {
  buildOmadaClientMetrics,
  mapOmadaStateToRow,
  selectOmadaTrackers,
} from "../adapters/omada";
import {
  detectLinkRateUnit,
  mapTrackerStateToRow,
  normalizeMac,
  preferredRouterDeviceIds,
  selectRouterTrackers,
  toNumber,
} from "../adapters/tplink";
import {
  ALL_COLUMN_KEYS,
  getAllowedColumnsForDomain,
} from "../adapters/integration-profile";
import type { MappedTrackerRow } from "../adapters/tplink";
import type {
  ConfigEntry,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassEntity,
  HomeAssistant,
  TplinkRouterCardConfig,
} from "../core/types";

const inferSpeedScaleMax = (values: number[]) => {
  const max = values.length > 0 ? Math.max(...values) : 0;
  if (max <= 120) return 100;
  if (max <= 600) return 300;
  if (max <= 1200) return 1000;
  if (max <= 2500) return 2000;
  if (max <= 5000) return 5000;
  return 10000;
};

const resolveSpeedScale = (values: number[], maxOverride?: number) => {
  const autoMax = inferSpeedScaleMax(values);
  const min = 0;
  const max = typeof maxOverride === "number" ? maxOverride : autoMax;
  if (max <= min) {
    return { min, max: Math.max(min + 1, autoMax) };
  }
  return { min, max };
};

const updownRateClass = (mbps: number | null, min: number, max: number) => {
  if (mbps === null || !Number.isFinite(mbps) || mbps <= 0) return "rate--na";
  const clamped = Math.min(Math.max(mbps, min), max);
  const span = Math.max(max - min, 1);
  const ratio = (clamped - min) / span;
  if (ratio < 0.1) return "ud-rate--bad";
  if (ratio < 0.22) return "ud-rate--poor";
  if (ratio < 0.38) return "ud-rate--fair";
  if (ratio < 0.54) return "ud-rate--good";
  if (ratio < 0.66) return "ud-rate--great";
  if (ratio < 0.75) return "ud-rate--excellent";
  return "ud-rate--ultra";
};

const formatTooltipMetric = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

const txrxRateClass = (mbps: number | null) => {
  if (mbps === null || !Number.isFinite(mbps) || mbps <= 0) return "rate--na";
  if (mbps < 10) return "rate--bad";
  if (mbps < 30) return "rate--poor";
  if (mbps < 100) return "rate--fair";
  if (mbps < 300) return "rate--good";
  if (mbps < 1000) return "rate--great";
  if (mbps < 2000) return "rate--excellent";
  return "rate--ultra";
};

type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection };
type FilterState = {
  band: "all" | "2g" | "5g" | "6g";
  connection: "all" | "wifi" | "wired" | "iot" | "guest";
  status: "all" | "online" | "offline";
};
type FilterBand = FilterState["band"];
type FilterConnection = FilterState["connection"];
type FilterStatus = FilterState["status"];
const DEFAULT_FILTERS: FilterState = {
  band: "all",
  connection: "all",
  status: "all",
};
const FILTER_BAND_VALUES = new Set<FilterBand>(["all", "2g", "5g", "6g"]);
const FILTER_CONNECTION_VALUES = new Set<FilterConnection>([
  "all",
  "wifi",
  "wired",
  "iot",
  "guest",
]);
const FILTER_STATUS_VALUES = new Set<FilterStatus>(["all", "online", "offline"]);

type ActionItem = {
  entity_id: string;
  domain: "switch" | "button";
  kind: "host" | "guest" | "iot" | "router";
  band?: "2g" | "5g" | "6g";
  label: string;
  icon: string;
  isOn: boolean;
  available: boolean;
  requiresHold: boolean;
  deviceId?: string;
  deviceName?: string;
  isGlobalCommon: boolean;
};

type SpeedTooltipState = {
  visible: boolean;
  x: number;
  y: number;
  percent: string;
  transfer: string;
  mbps: string;
  max: string;
};

const HOLD_DURATION_MS = 1000;
const CARD_VERSION = import.meta.env.VITE_CARD_VERSION ?? "dev";
type RowData = MappedTrackerRow;
type ActionDeviceOption = { deviceId: string; deviceName: string };
const ROWS_CACHE_BY_ENTRY = new Map<string, RowData[]>();
const ENTRY_TITLE_CACHE = new Map<string, string>();
const DEFAULT_FILTER_UNSET = "__saved__";
type EntityRegistryEntriesResponse = Record<string, Record<string, unknown> | null>;
const SUPPORTED_ENTRY_DOMAINS = new Set([
  "tplink_router",
  "tplink_deco",
  "omada",
  "tplink_omada",
]);
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;// minutes

const looksLikeMac = (value: string) => /^[0-9a-f:-]+$/i.test(value);

const looksLikeIp = (value: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value);

const extractIp = (value?: string) => {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (looksLikeIp(raw)) return raw;
  try {
    const url = new URL(raw);
    if (looksLikeIp(url.hostname)) return url.hostname;
  } catch {
    // ignore
  }
  const match = raw.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return match ? match[1] : undefined;
};

const compareValues = (a: unknown, b: unknown) => {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return collator.compare(String(a), String(b));
};

const isEmptySortValue = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 || trimmed === "—";
  }
  return false;
};

export class TplinkRouterCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _entries: { state: true },
    _entityRegistry: { state: true },
    _error: { state: true },
    _filter: { state: true },
    _sorts: { state: true },
    _filters: { state: true },
    _showExportButton: { state: true },
    _speedTooltip: { state: true },
    _selectedActionDeviceId: { state: true },
  } as const;

  static styles = cardStyles;

  hass?: HomeAssistant;
  private _config?: TplinkRouterCardConfig;
  private _entries: ConfigEntry[] = [];
  private _entityRegistry: EntityRegistryEntry[] = [];
  private _error: string | null = null;
  private _filter = "";
  private _sorts: SortState[] = [];
  private _filters: FilterState = { ...DEFAULT_FILTERS };
  private _holdStates: Record<string, { progress: number; completed: boolean }> = {};
  private _holdTimers: Record<string, number> = {};
  private _holdAnimationIds: Record<string, number> = {};
  private _loading = false;
  private _loaded = false;
  private _registryFailed = false;
  private _deviceRegistry: DeviceRegistryEntry[] = [];
  private _filtersLoaded = false;
  private _showExportButton = false;
  private _speedTooltip: SpeedTooltipState | null = null;
  private _selectedActionDeviceId: string | null = null;
  private _speedTooltipOpenTimer?: number;
  private _speedTooltipHideTimer?: number;
  private _refreshTimer?: number;
  private _lastRegistryRefreshAt = 0;
  private _pendingVisibilityRefresh = false;
  private _isPageVisible = true;
  private _isCardVisible = true;
  private _visibilityObserver?: IntersectionObserver;

  setConfig(config: TplinkRouterCardConfig): void {
    const previousEntryId = this._config?.entry_id;
    const previousConfig = this._config ?? {};
    const normalizedInput = {
      ...previousConfig,
      ...(config ?? {}),
      type: "custom:tplink-router-card",
    };
    const normalized = normalizedInput;
    const normalizedDefaultFilters = this._resolveConfiguredDefaultFilters(normalizedInput);
    const uploadSpeedColorMax =
      typeof normalized.upload_speed_color_max === "number"
        ? normalized.upload_speed_color_max
        : 1000;
    const downloadSpeedColorMax =
      typeof normalized.download_speed_color_max === "number"
        ? normalized.download_speed_color_max
        : 100;
    this._config = {
      speed_unit: "MBps",
      txrx_color: true,
      updown_color: true,
      ...normalized,
      default_filters: normalizedDefaultFilters ?? undefined,
      upload_speed_color_max: uploadSpeedColorMax,
      download_speed_color_max: downloadSpeedColorMax,
    };
    this._initializeFilters(previousEntryId);
    this._loadRegistries();
    if (this._loaded && previousEntryId !== this._config.entry_id) {
      if (this._isVisibleForRefresh()) {
        void this._refreshRegistriesIncremental();
      } else {
        this._pendingVisibilityRefresh = true;
      }
    }
    this._updateRefreshScheduling();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("hass")) {
      this._loadRegistries();
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof document !== "undefined") {
      this._isPageVisible = !document.hidden;
      document.addEventListener("visibilitychange", this._handleVisibilityChange);
    }
    this._attachVisibilityObserver();
    this._updateRefreshScheduling();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._speedTooltipOpenTimer !== undefined) {
      window.clearTimeout(this._speedTooltipOpenTimer);
      this._speedTooltipOpenTimer = undefined;
    }
    if (this._speedTooltipHideTimer !== undefined) {
      window.clearTimeout(this._speedTooltipHideTimer);
      this._speedTooltipHideTimer = undefined;
    }
    this._clearRefreshTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._handleVisibilityChange);
    }
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
      this._visibilityObserver = undefined;
    }
  }

  private _handleVisibilityChange = () => {
    this._isPageVisible = typeof document === "undefined" ? true : !document.hidden;
    if (this._isPageVisible) {
      this._maybeRefreshOnVisible();
    }
    this._updateRefreshScheduling();
  };

  private _attachVisibilityObserver() {
    if (typeof IntersectionObserver === "undefined") {
      this._isCardVisible = true;
      return;
    }
    if (this._visibilityObserver) return;
    this._visibilityObserver = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === this);
      if (!entry) return;
      const visible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (visible === this._isCardVisible) return;
      this._isCardVisible = visible;
      if (visible) {
        this._maybeRefreshOnVisible();
      }
      this._updateRefreshScheduling();
    });
    this._visibilityObserver.observe(this);
  }

  private _isVisibleForRefresh() {
    return this._isPageVisible && this._isCardVisible;
  }

  private _clearRefreshTimer() {
    if (this._refreshTimer !== undefined) {
      window.clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  private _updateRefreshScheduling() {
    this._clearRefreshTimer();
    if (!this._loaded || !this._isVisibleForRefresh()) return;
    const elapsed = Date.now() - this._lastRegistryRefreshAt;
    const delay = Math.max(AUTO_REFRESH_INTERVAL_MS - elapsed, 0);
    this._refreshTimer = window.setTimeout(() => {
      void this._runScheduledRefresh();
    }, delay);
  }

  private _maybeRefreshOnVisible() {
    if (!this._loaded || !this._isVisibleForRefresh()) return;
    const due = Date.now() - this._lastRegistryRefreshAt >= AUTO_REFRESH_INTERVAL_MS;
    if (!due && !this._pendingVisibilityRefresh) return;
    if (this._loading) {
      this._pendingVisibilityRefresh = true;
      return;
    }
    this._pendingVisibilityRefresh = false;
    void this._refreshRegistriesIncremental();
  }

  private async _runScheduledRefresh() {
    this._refreshTimer = undefined;
    try {
      if (!this._loaded || !this._isVisibleForRefresh()) return;
      const due = Date.now() - this._lastRegistryRefreshAt >= AUTO_REFRESH_INTERVAL_MS;
      if (!due) return;
      if (this._loading) {
        this._pendingVisibilityRefresh = true;
        return;
      }
      await this._refreshRegistriesIncremental();
    } finally {
      this._updateRefreshScheduling();
    }
  }

  private _looksLikeOmadaTracker(state: HassEntity) {
    if (!state.entity_id.startsWith("device_tracker.")) return false;
    const attrs = state.attributes as Record<string, unknown>;
    const sourceType = String(attrs.source_type ?? "").toLowerCase();
    if (sourceType && sourceType !== "router") return false;
    return (
      "wireless" in attrs ||
      "guest" in attrs ||
      "ssid" in attrs ||
      "ap_name" in attrs ||
      "ap_mac" in attrs ||
      "switch_port" in attrs ||
      "channel_width" in attrs ||
      "radio" in attrs
    );
  }

  private _buildIncrementalEntityCandidates(entryId: string, entryDomain?: string) {
    const knownEntryEntityIds = this._entityRegistry
      .filter((entry) => entry.config_entry_id === entryId)
      .map((entry) => entry.entity_id);
    const trackerCandidateIds = Object.values(this.hass?.states ?? {})
      .filter((state) => state.entity_id.startsWith("device_tracker."))
      .filter((state) => {
        if (entryDomain === "omada" || entryDomain === "tplink_omada") {
          return this._looksLikeOmadaTracker(state);
        }
        const attrs = state.attributes as Record<string, unknown>;
        return attrs.source_type === "router";
      })
      .map((state) => state.entity_id);

    return Array.from(new Set([...knownEntryEntityIds, ...trackerCandidateIds]));
  }

  private _mergeEntityRegistryFromResponse(
    requestedEntityIds: string[],
    response: EntityRegistryEntriesResponse,
  ) {
    const byId = new Map(this._entityRegistry.map((entry) => [entry.entity_id, entry] as const));
    for (const entityId of requestedEntityIds) {
      const raw = response[entityId];
      if (!raw || typeof raw !== "object") {
        byId.delete(entityId);
        continue;
      }
      const mapped: EntityRegistryEntry = {
        entity_id:
          typeof raw.entity_id === "string" && raw.entity_id.trim()
            ? raw.entity_id
            : entityId,
        platform:
          typeof raw.platform === "string" && raw.platform.trim()
            ? raw.platform
            : byId.get(entityId)?.platform ?? "",
        config_entry_id:
          typeof raw.config_entry_id === "string" ? raw.config_entry_id : undefined,
        device_id: typeof raw.device_id === "string" ? raw.device_id : undefined,
      };
      if (!mapped.platform) continue;
      byId.set(entityId, mapped);
    }
    this._entityRegistry = [...byId.values()];
  }

  private async _refreshRegistriesIncremental() {
    if (!this.hass || this._loading) return;
    const entryId = this._selectedEntryId;
    if (!entryId) return;
    this._loading = true;
    try {
      const entryDomain = this._resolveEntryDomain(entryId);
      try {
        if (entryDomain) {
          const refreshedEntries = await this.hass.callWS<ConfigEntry[]>({
            type: "config_entries/get",
            domain: entryDomain,
          });
          const nextEntries = refreshedEntries.filter((entry) =>
            SUPPORTED_ENTRY_DOMAINS.has(entry.domain),
          );
          if (nextEntries.length > 0) {
            const mergedEntries = new Map(
              this._entries.map((entry) => [entry.entry_id, entry] as const),
            );
            nextEntries.forEach((entry) => mergedEntries.set(entry.entry_id, entry));
            this._entries = [...mergedEntries.values()];
            this._entries.forEach((entry) => ENTRY_TITLE_CACHE.set(entry.entry_id, entry.title));
          }
        }
      } catch {
        // Best-effort incremental refresh
      }

      const requestedEntityIds = this._buildIncrementalEntityCandidates(entryId, entryDomain);
      if (requestedEntityIds.length > 0) {
        try {
          const response = await this.hass.callWS<EntityRegistryEntriesResponse>({
            type: "config/entity_registry/get_entries",
            entity_ids: requestedEntityIds,
          });
          this._mergeEntityRegistryFromResponse(requestedEntityIds, response);
        } catch {
          // Best-effort incremental refresh
        }
      }
      this._lastRegistryRefreshAt = Date.now();
    } finally {
      this._loading = false;
      if (this._pendingVisibilityRefresh) {
        this._maybeRefreshOnVisible();
      }
      this._updateRefreshScheduling();
    }
  }

  private async _loadRegistries() {
    if (!this.hass || this._loading || this._loaded) return;
    this._loading = true;
    this._error = null;
    try {
      let entries: ConfigEntry[] | null = null;
      let entities: EntityRegistryEntry[] | null = null;
      let devices: DeviceRegistryEntry[] | null = null;

      try {
        entries = await this.hass.callWS<ConfigEntry[]>({ type: "config_entries/get" });
      } catch {
        if (this.hass.callApi) {
          try {
            entries = await this.hass.callApi<ConfigEntry[]>(
              "GET",
              "config/config_entries/entry",
            );
          } catch {
            entries = null;
          }
        }
      }

      try {
        entities = await this.hass.callWS<EntityRegistryEntry[]>({
          type: "config/entity_registry/list",
        });
      } catch {
        entities = null;
      }

      try {
        devices = await this.hass.callWS<DeviceRegistryEntry[]>({
          type: "config/device_registry/list",
        });
      } catch {
        devices = null;
      }

      if (entries) {
        this._entries = entries.filter((entry) => SUPPORTED_ENTRY_DOMAINS.has(entry.domain));
        this._entries.forEach((entry) => ENTRY_TITLE_CACHE.set(entry.entry_id, entry.title));
      }

      if (entities) {
        this._entityRegistry = entities;
        this._registryFailed = false;
      } else {
        this._registryFailed = true;
      }

      if (devices) {
        this._deviceRegistry = devices;
      }

      if (!this._filtersLoaded) {
        this._restoreFilters(this._selectedEntryId);
      }

      if (!entries && !entities) {
        this._error = localize(this.hass, "errors.lists");
      }
      this._loaded = true;
      this._lastRegistryRefreshAt = Date.now();
    } catch {
      this._error = localize(this.hass, "errors.lists");
    } finally {
      this._loading = false;
      this._updateRefreshScheduling();
    }
  }

  private get _selectedEntryId(): string | undefined {
    if (this._config?.entry_id) return this._config.entry_id;
    const entityId = this._config?.entity_id;
    if (entityId && this._entityRegistry.length > 0) {
      const entry = this._entityRegistry.find((item) => item.entity_id === entityId);
      return entry?.config_entry_id;
    }
    return undefined;
  }

  private _resolveEntryDomain(entryId: string | undefined) {
    if (!entryId) return undefined;
    const fromEntries = this._entries.find((entry) => entry.entry_id === entryId)?.domain;
    if (fromEntries) return fromEntries;

    const registryRows = this._entityRegistry.filter((entry) => entry.config_entry_id === entryId);
    if (registryRows.length === 0) return undefined;
    const platforms = new Set(
      registryRows
        .map((entry) => (entry.platform ? String(entry.platform).toLowerCase() : ""))
        .filter((value) => value.length > 0),
    );

    if (platforms.has("omada") || platforms.has("tplink_omada")) return "omada";
    if (platforms.has("tplink_router")) return "tplink_router";
    if (platforms.has("tplink_deco")) return "tplink_deco";
    return undefined;
  }

  private _normalizeBandFilter(value: unknown): FilterBand | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return FILTER_BAND_VALUES.has(normalized as FilterBand) ? (normalized as FilterBand) : null;
  }

  private _normalizeConnectionFilter(value: unknown): FilterConnection | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "lan") return "wired";
    return FILTER_CONNECTION_VALUES.has(normalized as FilterConnection)
      ? (normalized as FilterConnection)
      : null;
  }

  private _normalizeStatusFilter(value: unknown): FilterStatus | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return FILTER_STATUS_VALUES.has(normalized as FilterStatus)
      ? (normalized as FilterStatus)
      : null;
  }

  private _resolveConfiguredDefaultFilters(
    config?: TplinkRouterCardConfig,
  ): FilterState | null {
    if (!config) return null;
    const nested = (config.default_filters ?? {}) as Record<string, unknown>;
    const sanitize = (value: unknown) =>
      typeof value === "string" &&
      (value.trim().length === 0 || value.trim() === DEFAULT_FILTER_UNSET)
        ? undefined
        : value;
    const rawBand =
      config.default_filter_band !== undefined ? config.default_filter_band : nested.band;
    const rawConnection =
      config.default_filter_connection !== undefined
        ? config.default_filter_connection
        : nested.connection;
    const rawStatus =
      config.default_filter_status !== undefined ? config.default_filter_status : nested.status;
    const bandValue = sanitize(rawBand);
    const connectionValue = sanitize(rawConnection);
    const statusValue = sanitize(rawStatus);

    const hasAny =
      bandValue !== undefined || connectionValue !== undefined || statusValue !== undefined;
    if (!hasAny) return null;

    return {
      band: this._normalizeBandFilter(bandValue) ?? DEFAULT_FILTERS.band,
      connection: this._normalizeConnectionFilter(connectionValue) ?? DEFAULT_FILTERS.connection,
      status: this._normalizeStatusFilter(statusValue) ?? DEFAULT_FILTERS.status,
    };
  }

  private _hasConfiguredDefaultFilters(config?: TplinkRouterCardConfig) {
    return this._resolveConfiguredDefaultFilters(config ?? this._config) !== null;
  }

  private _initializeFilters(previousEntryId?: string) {
    const defaults = this._resolveConfiguredDefaultFilters(this._config);
    if (defaults) {
      this._filters = { ...defaults };
      this._filtersLoaded = true;
      return;
    }

    this._filtersLoaded = false;
    if (previousEntryId !== this._config?.entry_id) {
      this._filters = { ...DEFAULT_FILTERS };
    }

    this._restoreFilters(this._config?.entry_id);
  }

  private _filterChanged(ev: Event) {
    const target = ev.target as HTMLInputElement;
    this._filter = target.value ?? "";
  }

  private _matchesFilter(text: string): boolean {
    const needle = this._filter.trim().toLowerCase();
    if (!needle) return true;
    return text.toLowerCase().includes(needle);
  }

  private _setFilter(group: keyof FilterState, value: FilterState[keyof FilterState]) {
    this._filters = { ...this._filters, [group]: value } as FilterState;
    this._saveFilters();
  }

  private _filterButtonClick(ev: Event) {
    const target = ev.currentTarget as HTMLElement;
    const group = target.dataset.group as keyof FilterState | undefined;
    const value = target.dataset.value as FilterState[keyof FilterState] | undefined;
    if (!group || value === undefined) return;
    this._setFilter(group, value);
  }

  private _filtersStorageKey(entryId?: string) {
    const key = entryId ?? this._selectedEntryId ?? "global";
    return `tplink-router-card:filters:${key}`;
  }

  private _restoreFilters(entryId?: string) {
    if (this._filtersLoaded) return;
    if (this._hasConfiguredDefaultFilters()) {
      this._filtersLoaded = true;
      return;
    }
    try {
      const raw = localStorage.getItem(this._filtersStorageKey(entryId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<FilterState>;
      if (!parsed || typeof parsed !== "object") return;
      const band = this._normalizeBandFilter(parsed.band) ?? DEFAULT_FILTERS.band;
      const connection =
        this._normalizeConnectionFilter(parsed.connection) ?? DEFAULT_FILTERS.connection;
      const status = this._normalizeStatusFilter(parsed.status) ?? DEFAULT_FILTERS.status;
      this._filters = { band, connection, status };
      this._filtersLoaded = true;
    } catch {
      // ignore storage errors
    }
  }

  private _saveFilters() {
    if (this._hasConfiguredDefaultFilters()) return;
    try {
      localStorage.setItem(this._filtersStorageKey(), JSON.stringify(this._filters));
      this._filtersLoaded = true;
    } catch {
      // ignore storage errors
    }
  }

  private _toggleExportButton(ev: MouseEvent) {
    ev.preventDefault();
    this._showExportButton = !this._showExportButton;
  }

  private _toggleSort(ev: MouseEvent, key: string) {
    const shift = ev.shiftKey;
    const existingIndex = this._sorts.findIndex((sort) => sort.key === key);
    const existing = existingIndex >= 0 ? this._sorts[existingIndex] : null;
    let nextDirection: SortDirection | null = "asc";
    if (existing) {
      nextDirection = existing.direction === "asc" ? "desc" : null;
    }

    if (!shift) {
      this._sorts = nextDirection ? [{ key, direction: nextDirection }] : [];
      return;
    }

    const nextSorts = [...this._sorts];
    if (!nextDirection) {
      if (existingIndex >= 0) nextSorts.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      nextSorts[existingIndex] = { key, direction: nextDirection };
    } else {
      nextSorts.push({ key, direction: nextDirection });
    }
    this._sorts = nextSorts;
  }

  private _openSpeedTooltip(
    event: MouseEvent,
    details: Omit<SpeedTooltipState, "visible" | "x" | "y">,
  ) {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    if (this._speedTooltipHideTimer !== undefined) {
      window.clearTimeout(this._speedTooltipHideTimer);
      this._speedTooltipHideTimer = undefined;
    }
    if (this._speedTooltipOpenTimer !== undefined) {
      window.clearTimeout(this._speedTooltipOpenTimer);
      this._speedTooltipOpenTimer = undefined;
    }
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 180;
    const viewportPadding = 10;
    const centerX = rect.left + rect.width / 2;
    const minX = tooltipWidth / 2 + viewportPadding;
    const maxX = window.innerWidth - tooltipWidth / 2 - viewportPadding;
    const clampedX = Math.max(minX, Math.min(maxX, centerX));
    const nextTooltip: SpeedTooltipState = {
      visible: false,
      x: clampedX,
      y: rect.top - 8,
      ...details,
    };
    this._speedTooltip = nextTooltip;
    this._speedTooltipOpenTimer = window.setTimeout(() => {
      this._speedTooltip = { ...nextTooltip, visible: true };
      this._speedTooltipOpenTimer = undefined;
    }, 160);
  }

  private _closeSpeedTooltip() {
    if (this._speedTooltipOpenTimer !== undefined) {
      window.clearTimeout(this._speedTooltipOpenTimer);
      this._speedTooltipOpenTimer = undefined;
    }
    if (!this._speedTooltip) return;
    this._speedTooltip = { ...this._speedTooltip, visible: false };
    if (this._speedTooltipHideTimer !== undefined) {
      window.clearTimeout(this._speedTooltipHideTimer);
    }
    this._speedTooltipHideTimer = window.setTimeout(() => {
      this._speedTooltip = null;
      this._speedTooltipHideTimer = undefined;
    }, 200);
  }

  private _showMoreInfo(entityId: string) {
    this.dispatchEvent(
      new CustomEvent("hass-action", {
        detail: {
          config: {
            entity: entityId,
            tap_action: { action: "more-info" },
          },
          action: "tap",
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _showDeviceInfo(deviceId: string) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { deviceId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  private _openDevicePage(deviceId: string) {
    const base = window.location.origin;
    this._openUrl(`${base}/config/devices/device/${deviceId}`);
  }

  private _getEntityRows(): RowData[] {
    if (!this.hass) return [];

    const entryId = this._selectedEntryId;
    if (!entryId) return [];
    const cachedRows = ROWS_CACHE_BY_ENTRY.get(entryId);
    const registryPending =
      this._loading && this._entityRegistry.length === 0 && !this._registryFailed;
    if (registryPending && cachedRows) {
      return cachedRows;
    }
    const entryDomain = this._resolveEntryDomain(entryId);
    if (!entryDomain) {
      if (cachedRows) return cachedRows;
      return [];
    }
    let rows: RowData[] = [];

    if (entryDomain === "omada" || entryDomain === "tplink_omada") {
      const trackers = selectOmadaTrackers(
        this.hass.states,
        this._entityRegistry,
        entryId,
        this._registryFailed,
      );
      const metricsByDevice = buildOmadaClientMetrics(
        this.hass.states,
        this._entityRegistry,
        entryId,
      );
      const trackerDeviceIdByEntity = new Map(
        this._entityRegistry
          .filter((item) => item.entity_id.startsWith("device_tracker."))
          .map((item) => [item.entity_id, item.device_id] as const),
      );

      rows = trackers.map((state) => {
        const deviceId = trackerDeviceIdByEntity.get(state.entity_id);
        return mapOmadaStateToRow(
          state,
          this._config?.speed_unit ?? "MBps",
          deviceId ? metricsByDevice.get(deviceId) : undefined,
        );
      });
    } else {
      const entities = selectRouterTrackers(
        this.hass.states,
        this._entityRegistry,
        entryId,
        this._registryFailed,
      );

      const linkRateUnit = detectLinkRateUnit(entities);

      rows = entities.map((state) =>
        mapTrackerStateToRow(state, this._config?.speed_unit ?? "MBps", linkRateUnit),
      );
    }

    if (rows.length > 0 || !this._loading) {
      ROWS_CACHE_BY_ENTRY.set(entryId, rows);
    }

    if (rows.length === 0 && cachedRows && this._loading) {
      return cachedRows;
    }
    return rows;
  }

  private _getActionItems(entryId: string | undefined, entryDomain?: string): ActionItem[] {
    if (!this.hass || !entryId || this._entityRegistry.length === 0) return [];
    const registry = this._entityRegistry.filter((entry) => entry.config_entry_id === entryId);
    const registryByEntity = new Map(registry.map((entry) => [entry.entity_id, entry] as const));
    const deviceById = new Map(this._deviceRegistry.map((device) => [device.id, device] as const));
    const states = registry
      .map((entry) => this.hass?.states[entry.entity_id])
      .filter((state) => state !== undefined)
      .filter((state) =>
        state.entity_id.startsWith("switch.") || state.entity_id.startsWith("button."),
      ) as HassEntity[];

    return states
      .map((state) => {
        const domain = state.entity_id.split(".")[0] as ActionItem["domain"];
        const friendly = String(
          (state.attributes as Record<string, unknown>).friendly_name ?? state.entity_id,
        );
        const text = `${state.entity_id} ${friendly}`.toLowerCase();
        const matched = matchAction(domain, state.entity_id, friendly, entryDomain);
        if (!matched) return null;

        const registryEntry = registryByEntity.get(state.entity_id);
        const deviceId = registryEntry?.device_id;
        const device = deviceId ? deviceById.get(deviceId) : undefined;
        const isGlobalCommon =
          text.includes("data fetching") ||
          text.includes("scanning") ||
          text.includes("wlan optimization") ||
          text.includes("rf planning") ||
          text.includes("ai optimization");

        const icon = String(
          (state.attributes as Record<string, unknown>).icon ??
          (domain === "button" ? "mdi:restart" : "mdi:wifi"),
        );
        const isOn = state.state === "on";
        const available =
          domain === "button" ? state.state !== "unavailable" : state.state !== "unavailable";

        return {
          entity_id: state.entity_id,
          domain,
          kind: matched.kind,
          band: matched.band,
          label: friendly,
          icon,
          isOn,
          available,
          requiresHold: matched.requiresHold,
          deviceId,
          deviceName: device?.name_by_user ?? device?.name,
          isGlobalCommon,
        } as ActionItem;
      })
      .filter((item): item is ActionItem => item !== null);
  }

  private _isRouterLikeActionDevice(device: DeviceRegistryEntry | undefined) {
    if (!device) return false;
    const manufacturer = `${device.manufacturer ?? ""}`.toLowerCase();
    const model = `${device.model ?? ""}`.toLowerCase();
    const name = `${device.name_by_user ?? device.name ?? ""}`.toLowerCase();
    const text = `${manufacturer} ${model} ${name}`;
    if (manufacturer.includes("tp-link") || manufacturer.includes("tplink")) return true;
    return /(archer|deco|omada|gateway|switch|access point|eap|er|sg|router)/i.test(text);
  }

  private _buildActionDeviceOptions(actionItems: ActionItem[]): ActionDeviceOption[] {
    const byDevice = new Map<string, ActionDeviceOption>();
    const deviceById = new Map(this._deviceRegistry.map((device) => [device.id, device] as const));
    for (const item of actionItems) {
      if (item.isGlobalCommon) continue;
      if (!item.deviceId) continue;
      if (byDevice.has(item.deviceId)) continue;
      const device = deviceById.get(item.deviceId);
      byDevice.set(item.deviceId, {
        deviceId: item.deviceId,
        deviceName:
          item.deviceName ??
          device?.name_by_user ??
          device?.name ??
          item.deviceId.slice(0, 8),
      });
    }
    const options = [...byDevice.values()];
    const routerLike = options.filter((option) =>
      this._isRouterLikeActionDevice(deviceById.get(option.deviceId)),
    );
    const selected = routerLike.length > 0 ? routerLike : options;
    return selected.sort((a, b) => compareValues(a.deviceName, b.deviceName));
  }

  private _actionDeviceChanged(ev: Event) {
    const target = ev.target as HTMLSelectElement;
    const value = target.value?.trim();
    this._selectedActionDeviceId = value ? value : null;
  }

  private _getRouterEntityId(entryId: string | undefined): string | undefined {
    if (!entryId || this._entityRegistry.length === 0 || !this.hass) return undefined;
    const registry = this._entityRegistry.filter((entry) => entry.config_entry_id === entryId);
    const nonTracker = registry.filter(
      (entry) => !entry.entity_id.startsWith("device_tracker."),
    );
    const list = nonTracker.length > 0 ? nonTracker : registry;
    const candidates = list
      .map((entry) => this.hass?.states[entry.entity_id])
      .filter((state) => state !== undefined)
      .map((state) => state.entity_id);
    const pickPreferred = (ids: string[]) =>
      ids.find((id) => /(router|device|status|wan)/i.test(id)) ?? ids[0];
    return (
      pickPreferred(candidates.filter((id) => id.startsWith("sensor."))) ||
      pickPreferred(candidates.filter((id) => id.startsWith("switch."))) ||
      pickPreferred(candidates.filter((id) => id.startsWith("button."))) ||
      pickPreferred(candidates.filter((id) => id.startsWith("device_tracker."))) ||
      candidates[0]
    );
  }

  private async _handleAction(item: ActionItem) {
    if (!this.hass?.callService || !item.available) return;
    if (item.domain === "button") {
      await this._callServiceWithRetry("button", "press", { entity_id: item.entity_id });
      return;
    }
    const service = item.isOn ? "turn_off" : "turn_on";
    await this._callServiceWithRetry("switch", service, { entity_id: item.entity_id });
  }

  private async _callServiceWithRetry(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ) {
    if (!this.hass?.callService) return;
    try {
      await this.hass.callService(domain, service, data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : typeof error === "object" &&
              error !== null &&
              "message" in (error as Record<string, unknown>)
              ? String((error as Record<string, unknown>).message ?? "")
              : "";
      if (message.toLowerCase().includes("session is closed")) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 300);
        });
        await this.hass.callService(domain, service, data);
        return;
      }
      throw error;
    }
  }

  private _invokeAction(item: ActionItem) {
    void this._handleAction(item).catch((error) => {
      // Keep the UI responsive and log action failures for diagnostics.
      console.error("[tplink-router-card] action failed", {
        entity_id: item.entity_id,
        domain: item.domain,
        kind: item.kind,
        error,
      });
    });
  }

  private _getEntryStates(entryId: string | undefined): HassEntity[] {
    if (!entryId || !this.hass) return [];
    const registry = this._entityRegistry.filter((entry) => entry.config_entry_id === entryId);
    return registry
      .map((entry) => this.hass?.states[entry.entity_id])
      .filter((state) => state !== undefined) as HassEntity[];
  }

  private _getDeviceIdForEntity(entityId: string): string | undefined {
    return this._entityRegistry.find((entry) => entry.entity_id === entityId)?.device_id;
  }

  private _findDeviceIdByIp(states: HassEntity[], ip: string): string | undefined {
    const matchIp = (value: unknown) =>
      typeof value === "string" && value.trim() !== "" && value.trim() === ip;
    for (const state of states) {
      const attrs = state.attributes as Record<string, unknown>;
      const candidates = [
        attrs.ip,
        attrs.ip_address,
        attrs.local_ip,
        attrs.router_ip,
        attrs.wan_ip,
        attrs.host,
        attrs.hostname,
        attrs.host_name,
        state.state,
      ];
      if (candidates.some(matchIp)) {
        const deviceId = this._getDeviceIdForEntity(state.entity_id);
        if (deviceId) return deviceId;
      }
    }
    return undefined;
  }

  private _getStatesForDevice(entryId: string | undefined, deviceId: string | undefined) {
    if (!entryId || !deviceId || !this.hass) return [];
    const registry = this._entityRegistry.filter(
      (entry) => entry.config_entry_id === entryId && entry.device_id === deviceId,
    );
    return registry
      .map((entry) => this.hass?.states[entry.entity_id])
      .filter((state) => state !== undefined) as HassEntity[];
  }

  private _getRouterDevice(entryId: string | undefined): DeviceRegistryEntry | undefined {
    if (!entryId || this._entityRegistry.length === 0) return undefined;
    const devices = preferredRouterDeviceIds(this._entityRegistry, entryId)
      .map((id) => this._deviceRegistry.find((device) => device.id === id))
      .filter((device) => device !== undefined) as DeviceRegistryEntry[];
    if (devices.length === 0) return undefined;

    const entryTitle = this._entries.find((entry) => entry.entry_id === entryId)?.title ?? "";
    const byConfigUrl = devices.find((device) => device.configuration_url);
    if (byConfigUrl) return byConfigUrl;
    const byManufacturer = devices.find((device) =>
      (device.manufacturer ?? "").toLowerCase().includes("tp"),
    );
    if (byManufacturer) return byManufacturer;
    const byModel = devices.find((device) =>
      (device.model ?? "").toLowerCase().includes("archer"),
    );
    if (byModel) return byModel;
    const byName = devices.find((device) => {
      const name = (device.name_by_user ?? device.name ?? "").toLowerCase();
      return entryTitle && name.includes(entryTitle.toLowerCase());
    });
    if (byName) return byName;
    return devices[0];
  }

  private _getPublicIp(states: HassEntity[]): string | undefined {
    for (const state of states) {
      const id = state.entity_id.toLowerCase();
      const attrs = state.attributes as Record<string, unknown>;
      const candidates = [
        typeof attrs.public_ip === "string" ? attrs.public_ip : null,
        typeof attrs.wan_ip === "string" ? attrs.wan_ip : null,
        typeof attrs.wan_ipaddr === "string" ? attrs.wan_ipaddr : null,
        typeof attrs.external_ip === "string" ? attrs.external_ip : null,
        typeof attrs.internet_ip === "string" ? attrs.internet_ip : null,
        typeof attrs.ip === "string" ? attrs.ip : null,
        typeof state.state === "string" ? state.state : null,
      ].filter(Boolean) as string[];
      if (id.includes("public") || id.includes("wan") || id.includes("external")) {
        const match = candidates.find((value) => looksLikeIp(value));
        if (match) return match;
      }
    }
    return undefined;
  }

  private _getRouterStats(states: HassEntity[]) {
    const parseStat = (value: unknown) => {
      const numeric = toNumber(value);
      if (numeric !== null) return numeric;
      if (typeof value === "string") {
        const match = value.match(/-?\d+(\.\d+)?/);
        if (match) {
          const parsed = Number(match[0]);
          return Number.isFinite(parsed) ? parsed : null;
        }
      }
      return null;
    };
    const findStat = (keywords: string[]) => {
      for (const state of states) {
        const id = state.entity_id.toLowerCase();
        if (!keywords.some((key) => id.includes(key))) continue;
        const attrs = state.attributes as Record<string, unknown>;
        const value =
          parseStat(state.state) ??
          parseStat(attrs.value) ??
          parseStat(attrs.native_value) ??
          parseStat(attrs.state);
        if (value !== null) return value;
      }
      return null;
    };
    const cpu = findStat(["cpu"]);
    const mem = findStat(["mem", "memory", "ram"]);
    return {
      cpu: cpu !== null ? `${cpu.toFixed(0)}%` : undefined,
      mem: mem !== null ? `${mem.toFixed(0)}%` : undefined,
    };
  }

  private _findAttr(states: HassEntity[], keys: string[]): string | undefined {
    for (const state of states) {
      const attrs = state.attributes as Record<string, unknown>;
      for (const key of keys) {
        const value = attrs[key];
        if (typeof value === "string" && value.trim().length > 0) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
      }
    }
    return undefined;
  }

  private _normalizeUrl(value?: string): string | undefined {
    if (!value) return undefined;
    const text = value.trim();
    if (!text) return undefined;
    if (text.startsWith("http://") || text.startsWith("https://")) return text;
    if (looksLikeIp(text)) return `http://${text}`;
    return undefined;
  }

  private _getLocalUrl(
    entryTitle: string | undefined,
    device: DeviceRegistryEntry | undefined,
    states: HassEntity[],
  ): string | undefined {
    const titleIp = extractIp(entryTitle);
    if (titleIp) return `http://${titleIp}`;
    const fromDevice = this._normalizeUrl(device?.configuration_url);
    if (fromDevice) return fromDevice;
    const fromAttrs = this._findAttr(states, [
      "configuration_url",
      "router_url",
      "url",
      "host",
      "ip",
      "ip_address",
      "router_ip",
      "local_ip",
    ]);
    const fromAttrUrl = this._normalizeUrl(fromAttrs);
    if (fromAttrUrl) return fromAttrUrl;
    return this._normalizeUrl(entryTitle);
  }

  private _getRouterDetails(states: HassEntity[], device?: DeviceRegistryEntry) {
    const model =
      device?.model ??
      this._findAttr(states, ["model", "router_model", "device_model", "product_model"]);
    const manufacturer =
      device?.manufacturer ?? this._findAttr(states, ["manufacturer", "vendor", "brand"]);
    const swVersion =
      device?.sw_version ??
      this._findAttr(states, ["sw_version", "firmware", "firmware_version", "fw_version"]);
    const hwVersion =
      device?.hw_version ??
      this._findAttr(states, ["hw_version", "hardware", "hardware_version"]);
    const mac =
      device?.connections?.find((conn) => conn[0].toLowerCase().includes("mac"))?.[1] ??
      this._findAttr(states, ["mac", "mac_address", "router_mac", "wan_mac"]);
    return { model, manufacturer, swVersion, hwVersion, mac };
  }

  private _buildDebugExportPayload() {
    const entryId = this._selectedEntryId;
    const selectedEntry = entryId
      ? this._entries.find((entry) => entry.entry_id === entryId)
      : undefined;
    const resolvedDomain = this._resolveEntryDomain(entryId);
    const entryRegistry = entryId
      ? this._entityRegistry.filter((entry) => entry.config_entry_id === entryId)
      : this._entityRegistry;
    const relatedDeviceIds = new Set(
      entryRegistry
        .map((entry) => entry.device_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );
    const relatedDevices = this._deviceRegistry.filter((device) => relatedDeviceIds.has(device.id));
    const states = entryRegistry
      .map((entry) => this.hass?.states[entry.entity_id])
      .filter((state): state is HassEntity => state !== undefined);
    const rows = this._getEntityRows();

    return {
      meta: {
        card: "ha-tplink-router-card",
        version: CARD_VERSION,
        exported_at: new Date().toISOString(),
        selected_adapter:
          resolvedDomain === "omada" || resolvedDomain === "tplink_omada"
            ? "omada"
            : resolvedDomain === "tplink_deco"
              ? "tplink_deco"
              : "tplink_router",
      },
      selection: {
        entry_id: entryId ?? null,
        entry_title: selectedEntry?.title ?? null,
        entry_domain: resolvedDomain ?? null,
      },
      ui_state: {
        search: this._filter,
        filters: this._filters,
        sorts: this._sorts,
      },
      config: this._config ?? null,
      capture_summary: {
        rows: rows.length,
        entity_registry: entryRegistry.length,
        device_registry: relatedDevices.length,
        states: states.length,
      },
      rows,
      entity_registry: entryRegistry,
      device_registry: relatedDevices,
      states,
    };
  }

  private _downloadDebugExport() {
    const payload = buildDiagnosticPackage(this._buildDebugExportPayload(), {
      limits: {
        maxDepth: 8,
        maxNodes: 30_000,
        maxArrayLength: 4_000,
        maxObjectKeys: 300,
        maxStringLength: 2_000,
      },
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = href;
    anchor.download = `tplink-router-card-export-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  private _startHold(ev: PointerEvent, item: ActionItem) {
    if (!item.requiresHold) return;
    if (!item.available) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = item.entity_id;
    if (this._holdAnimationIds[id]) {
      cancelAnimationFrame(this._holdAnimationIds[id]);
      delete this._holdAnimationIds[id];
    }
    if (this._holdTimers[id]) {
      window.clearTimeout(this._holdTimers[id]);
      delete this._holdTimers[id];
    }
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      this._holdStates[id] = { progress, completed: progress >= 1 };
      this.requestUpdate();
      if (progress >= 1) {
        delete this._holdAnimationIds[id];
        this._invokeAction(item);
        this._holdTimers[id] = window.setTimeout(() => {
          this._holdStates[id] = { progress: 0, completed: false };
          this.requestUpdate();
          delete this._holdTimers[id];
        }, 800);
        return;
      }
      this._holdAnimationIds[id] = requestAnimationFrame(tick);
    };
    this._holdAnimationIds[id] = requestAnimationFrame(tick);
  }

  private _cancelHold(ev: PointerEvent, item: ActionItem) {
    if (!item.requiresHold) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = item.entity_id;
    if (this._holdStates[id]?.completed) return;
    if (this._holdAnimationIds[id]) {
      cancelAnimationFrame(this._holdAnimationIds[id]);
      delete this._holdAnimationIds[id];
    }
    if (this._holdTimers[id]) {
      window.clearTimeout(this._holdTimers[id]);
      delete this._holdTimers[id];
    }
    if (this._holdStates[id]?.progress) {
      this._holdStates[id] = { progress: 0, completed: false };
      this.requestUpdate();
    }
  }

  render() {
    if (!this._config) return html``;
    const t = (key: string, vars?: Record<string, string | number>) =>
      localize(this.hass, key, vars);

    const entryId = this._selectedEntryId;
    const selectedEntry = entryId
      ? this._entries.find((entry) => entry.entry_id === entryId)
      : undefined;
    const cachedEntryTitle = entryId ? ENTRY_TITLE_CACHE.get(entryId) : undefined;
    const entryDomain = this._resolveEntryDomain(entryId);
    const rows = this._getEntityRows();
    const availableBands = new Set(rows.map((row) => row.bandType).filter((b) => b !== "unknown"));
    const availableConnections = new Set(
      rows.map((row) => row.connectionType).filter((c) => c !== "unknown"),
    );
    const needle = this._filter.trim().toLowerCase();
    const needleMac = normalizeMac(needle);
    const isMacSearch = needle.length > 1 && looksLikeMac(needle);

    const filtered = rows.filter((row) => {
      const haystack = [row.name, row.ip, row.mac, row.hostname, row.entity_id].join(" ");
      if (needle) {
        if (isMacSearch) {
          if (!row.macNormalized.includes(needleMac)) return false;
        } else if (!this._matchesFilter(haystack)) {
          return false;
        }
      }

      const bandFilter = this._filters.band;
      if (bandFilter !== "all" && row.bandType !== bandFilter) return false;

      const connFilter = this._filters.connection;
      const connType = row.connectionType;
      if (connFilter !== "all" && connType !== connFilter) return false;

      const statusFilter = this._filters.status;
      if (statusFilter !== "all") {
        if (statusFilter === "online" && !row.isOnline) return false;
        if (statusFilter === "offline" && row.isOnline) return false;
      }

      return true;
    });

    type ColumnDef = {
      key: string;
      label: string;
      sort: (row: RowData) => unknown;
    };

    const columns: ColumnDef[] = [
      { key: "name", label: t("columns.name"), sort: (row: RowData) => row.nameRaw },
      { key: "status", label: t("columns.status"), sort: (row: RowData) => row.statusValue },
      {
        key: "connection",
        label: t("columns.connection"),
        sort: (row: RowData) => row.connection,
      },
      {
        key: "band",
        label: t("columns.band"),
        sort: (row: RowData) =>
          row.band === "—"
            ? null
            : ({ "2g": 1, "5g": 2, "6g": 3, unknown: 99 } as const)[row.bandType],
      },
      { key: "ip", label: t("columns.ip"), sort: (row: RowData) => row.ip },
      { key: "mac", label: t("columns.mac"), sort: (row: RowData) => row.mac },
      {
        key: "hostname",
        label: t("columns.hostname"),
        sort: (row: RowData) => row.hostname,
      },
      {
        key: "packetsSent",
        label: t("columns.packetsSent"),
        sort: (row: RowData) => row.packetsSentValue,
      },
      {
        key: "packetsReceived",
        label: t("columns.packetsReceived"),
        sort: (row: RowData) => row.packetsReceivedValue,
      },
      {
        key: "down",
        label: t("columns.down"),
        sort: (row: RowData) => row.downSpeedValue,
      },
      { key: "up", label: t("columns.up"), sort: (row: RowData) => row.upSpeedValue },
      { key: "tx", label: t("columns.tx"), sort: (row: RowData) => row.txRateValue },
      { key: "rx", label: t("columns.rx"), sort: (row: RowData) => row.rxRateValue },
      {
        key: "online",
        label: t("columns.online"),
        sort: (row: RowData) => row.onlineTimeValue,
      },
      {
        key: "traffic",
        label: t("columns.traffic"),
        sort: (row: RowData) => row.trafficUsageValue,
      },
      { key: "signal", label: t("columns.signal"), sort: (row: RowData) => row.signalValue },
      {
        key: "deviceType",
        label: t("columns.deviceType"),
        sort: (row: RowData) => row.deviceType,
      },
      {
        key: "deviceModel",
        label: t("columns.deviceModel"),
        sort: (row: RowData) => row.deviceModel,
      },
      {
        key: "deviceFirmware",
        label: t("columns.deviceFirmware"),
        sort: (row: RowData) => row.deviceFirmware,
      },
      {
        key: "deviceStatus",
        label: t("columns.deviceStatus"),
        sort: (row: RowData) => row.deviceStatus,
      },
    ];
    const configuredColumns = Array.isArray(this._config?.columns) ? this._config.columns : [];
    const allowedColumns = new Set<string>([
      "name",
      ...getAllowedColumnsForDomain(entryDomain),
      ...configuredColumns,
    ]);
    const columnMap = new Map(columns.map((col) => [col.key, col]));
    const defaultColumnKeys = columns
      .filter((col) => col.key !== "name" && allowedColumns.has(col.key))
      .map((col) => col.key);
    const selectedColumns =
      this._config?.columns && this._config.columns.length > 0
        ? this._config.columns
        : defaultColumnKeys;
    const deduped = Array.from(new Set(selectedColumns)).filter(
      (key) => key !== "name" && allowedColumns.has(key),
    );
    const displayColumns = [
      columnMap.get("name"),
      ...deduped.map((key) => columnMap.get(key)),
    ].filter((col): col is (typeof columns)[number] => col !== undefined);

    const allowedSortKeys = new Set(displayColumns.map((col) => col.key));
    const activeSorts = this._sorts.filter((sort) => allowedSortKeys.has(sort.key));

    const sorted = [...filtered].sort((a, b) => {
      for (const sort of activeSorts) {
        const col = columnMap.get(sort.key);
        if (!col) continue;
        const aVal = col.sort(a);
        const bVal = col.sort(b);
        const aEmpty = isEmptySortValue(aVal);
        const bEmpty = isEmptySortValue(bVal);
        if (aEmpty && bEmpty) continue;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        const cmp = compareValues(aVal, bVal);
        if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });

    const onlineCount = rows.filter((row) => row.isOnline).length;
    const colorizeRates = Boolean(this._config?.txrx_color);
    const colorizeUpDown = Boolean(this._config?.updown_color);
    const upSpeedValues = rows
      .filter((row) => row.isOnline)
      .map((row) => row.upSpeedValue)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const downSpeedValues = rows
      .filter((row) => row.isOnline)
      .map((row) => row.downSpeedValue)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const upSpeedScale = resolveSpeedScale(
      upSpeedValues,
      this._config?.upload_speed_color_max,
    );
    const downSpeedScale = resolveSpeedScale(
      downSpeedValues,
      this._config?.download_speed_color_max,
    );
    const renderSpeedCell = (
      mbps: number | null,
      displayValue: string,
      scaleMax: number,
      colorized: boolean,
    ) => {
      if (mbps === null || !Number.isFinite(mbps) || mbps <= 0) return displayValue;
      const safeMax = Math.max(scaleMax, 1);
      const percent = Math.max(0, Math.min(100, (mbps / safeMax) * 100));
      const tooltipDetails = {
        percent: percent.toFixed(1),
        transfer: formatSpeed((mbps * 1_000_000) / 8, "MBps"),
        mbps: formatTooltipMetric(mbps),
        max: formatTooltipMetric(safeMax),
      };
      return html`
        <span
          class="speed-value"
          @mouseenter=${(ev: MouseEvent) => this._openSpeedTooltip(ev, tooltipDetails)}
          @mouseleave=${() => this._closeSpeedTooltip()}
        >
          ${colorized
          ? html`<span class="rate ${updownRateClass(mbps, 0, safeMax)}">${displayValue}</span>`
          : displayValue}
        </span>
      `;
    };
    const actionItems = this._getActionItems(entryId, entryDomain);
    const holdSeconds = Math.max(1, Math.round(HOLD_DURATION_MS / 1000));
    const routerEntityId = this._getRouterEntityId(entryId);
    const entryTitle = selectedEntry?.title ?? cachedEntryTitle;
    const entryStates = this._getEntryStates(entryId);
    const nonTrackerEntryStates = entryStates.filter(
      (state) => !state.entity_id.startsWith("device_tracker."),
    );
    const routerEntityDeviceId = routerEntityId
      ? this._getDeviceIdForEntity(routerEntityId)
      : undefined;
    const entryIp = extractIp(entryTitle);
    const preferredDeviceId = entryIp
      ? this._findDeviceIdByIp(nonTrackerEntryStates, entryIp)
      : undefined;
    const routerDevice =
      (routerEntityDeviceId
        ? this._deviceRegistry.find((device) => device.id === routerEntityDeviceId)
        : undefined) ??
      (preferredDeviceId
        ? this._deviceRegistry.find((device) => device.id === preferredDeviceId)
        : undefined) ?? this._getRouterDevice(entryId);
    const routerStatesForDevice = this._getStatesForDevice(entryId, routerDevice?.id);
    const routerStates =
      routerStatesForDevice.length > 0
        ? routerStatesForDevice.filter((state) => !state.entity_id.startsWith("device_tracker."))
        : nonTrackerEntryStates;
    const localUrl = this._getLocalUrl(entryTitle, routerDevice, routerStates);
    const publicIp = this._getPublicIp(routerStates);
    const stats = this._getRouterStats(routerStates);
    const routerDetails = this._getRouterDetails(routerStates, routerDevice);
    const routerInfoLines = [
      routerDetails.model ?? null,
      routerDetails.manufacturer ? `by ${routerDetails.manufacturer}` : null,
      routerDetails.swVersion ? `Firmware: ${routerDetails.swVersion}` : null,
      routerDetails.hwVersion ? `Hardware: ${routerDetails.hwVersion}` : null,
      routerDetails.mac ? `MAC: ${routerDetails.mac}` : null,
    ].filter(Boolean) as string[];
    const routerInfoText = routerInfoLines.join("\n");
    const routerLabel = entryId
      ? `${t("card.routerLabel")}: ${localUrl ?? entryTitle ?? entryId}`
      : t("card.routerNotSelected");
    const hideHeader = Boolean(this._config?.hide_header);
    const hideFilterSection = Boolean(this._config?.hide_filter_section);

    const actionDeviceOptions = this._buildActionDeviceOptions(actionItems);
    const selectedActionDeviceId =
      actionDeviceOptions.find((option) => option.deviceId === this._selectedActionDeviceId)
        ?.deviceId ??
      actionDeviceOptions[0]?.deviceId;
    const visibleActionItems = actionItems.filter((item) => {
      if (item.isGlobalCommon) return true;
      if (!selectedActionDeviceId) return true;
      return item.deviceId === selectedActionDeviceId;
    });

    const actionGroups = {
      host: visibleActionItems.filter((item) => item.kind === "host").sort((a, b) =>
        compareValues(
          { "2g": 1, "5g": 2, "6g": 3 }[a.band ?? "2g"],
          { "2g": 1, "5g": 2, "6g": 3 }[b.band ?? "2g"],
        ),
      ),
      guest: visibleActionItems.filter((item) => item.kind === "guest").sort((a, b) =>
        compareValues(
          { "2g": 1, "5g": 2, "6g": 3 }[a.band ?? "2g"],
          { "2g": 1, "5g": 2, "6g": 3 }[b.band ?? "2g"],
        ),
      ),
      iot: visibleActionItems.filter((item) => item.kind === "iot").sort((a, b) =>
        compareValues(
          { "2g": 1, "5g": 2, "6g": 3 }[a.band ?? "2g"],
          { "2g": 1, "5g": 2, "6g": 3 }[b.band ?? "2g"],
        ),
      ),
      router: visibleActionItems
        .filter((item) => item.kind === "router")
        .sort((a, b) => {
          const actionPriority = (item: ActionItem) => {
            const text = `${item.entity_id} ${item.label}`.toLowerCase();
            if (text.includes("reconnect")) return 0;
            if (text.includes("wlan optimization") || text.includes("rf planning")) return 1;
            if (text.includes("reboot") || text.includes("restart")) return 2;
            return 10;
          };
          const priorityDiff = actionPriority(a) - actionPriority(b);
          if (priorityDiff !== 0) return priorityDiff;
          return compareValues(a.label, b.label);
        }),
    };

    return html`
      <ha-card>
        <div class="header ${hideHeader ? "hidden" : ""}">
          <div class="title">
            <div
              class="title-main"
              @dblclick=${this._toggleExportButton}
            >
              <h2>${this._config.title ?? t("card.title")}</h2>
              ${this._showExportButton
        ? html`
                    <button
                      class="title-export-button"
                      title=${t("card.debugExport")}
                      @click=${(ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            this._downloadDebugExport();
          }}
                    >
                      <ha-icon icon="mdi:download"></ha-icon>
                    </button>
                  `
        : ""}
            </div>
            <div class="actions">
              ${actionDeviceOptions.length > 1
        ? html`
                    <select
                      class="action-device-select"
                      .value=${selectedActionDeviceId ?? ""}
                      @change=${this._actionDeviceChanged}
                      title=${t("actions.targetDevice")}
                    >
                      ${actionDeviceOptions.map(
          (option) => html`
                          <option value=${option.deviceId}>${option.deviceName}</option>
                        `,
        )}
                    </select>
                  `
        : nothing}
              ${actionGroups.host.length
        ? html`
                    <div class="action-group" title=${t("actions.wifi")}>
                      ${actionGroups.host.map(
          (item) => {
            const hold = this._holdStates[item.entity_id] ?? {
              progress: 0,
              completed: false,
            };
            return html`
                            <button
                              class="icon-toggle ${hold.progress > 0 ? "holding" : ""} ${hold.completed ? "completed" : ""}"
                              data-kind="host"
                              data-state=${item.isOn ? "on" : "off"}
                              title=${item.requiresHold
                ? t("actions.holdWithLabel", { seconds: holdSeconds, label: item.label })
                : item.label}
                              style=${`--hold-progress:${hold.progress}`}
                              ?disabled=${!item.available}
                              @pointerdown=${(ev: PointerEvent) => this._startHold(ev, item)}
                              @pointerup=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointerleave=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointercancel=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @click=${(ev: MouseEvent) => {
                if (ev.shiftKey) {
                  this._showMoreInfo(item.entity_id);
                  return;
                }
                if (item.requiresHold) {
                  ev.preventDefault();
                  return;
                }
                this._invokeAction(item);
              }}
                            >
                              <ha-icon .icon=${item.icon}></ha-icon>
                              ${item.band
                ? html`<span class="band-badge">${item.band === "2g" ? "2.4" : item.band.replace("g", "")}</span>`
                : ""}
                            </button>
                          `;
          },
        )}
                    </div>
                  `
        : ""}
              ${actionGroups.guest.length
        ? html`
                    <div class="action-group" title=${t("actions.guest")}>
                      ${actionGroups.guest.map(
          (item) => {
            const hold = this._holdStates[item.entity_id] ?? {
              progress: 0,
              completed: false,
            };
            return html`
                            <button
                              class="icon-toggle ${hold.progress > 0 ? "holding" : ""} ${hold.completed ? "completed" : ""}"
                              data-kind="guest"
                              data-state=${item.isOn ? "on" : "off"}
                              title=${item.requiresHold
                ? t("actions.holdWithLabel", { seconds: holdSeconds, label: item.label })
                : item.label}
                              style=${`--hold-progress:${hold.progress}`}
                              ?disabled=${!item.available}
                              @pointerdown=${(ev: PointerEvent) => this._startHold(ev, item)}
                              @pointerup=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointerleave=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointercancel=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @click=${(ev: MouseEvent) => {
                if (ev.shiftKey) {
                  this._showMoreInfo(item.entity_id);
                  return;
                }
                if (item.requiresHold) {
                  ev.preventDefault();
                  return;
                }
                this._invokeAction(item);
              }}
                            >
                              <ha-icon .icon=${item.icon}></ha-icon>
                              ${item.band
                ? html`<span class="band-badge">${item.band === "2g" ? "2.4" : item.band.replace("g", "")}</span>`
                : ""}
                            </button>
                          `;
          },
        )}
                    </div>
                  `
        : ""}
              ${actionGroups.iot.length
        ? html`
                    <div class="action-group" title=${t("actions.iot")}>
                      ${actionGroups.iot.map(
          (item) => {
            const hold = this._holdStates[item.entity_id] ?? {
              progress: 0,
              completed: false,
            };
            return html`
                            <button
                              class="icon-toggle ${hold.progress > 0 ? "holding" : ""} ${hold.completed ? "completed" : ""}"
                              data-kind="iot"
                              data-state=${item.isOn ? "on" : "off"}
                              title=${item.requiresHold
                ? t("actions.holdWithLabel", { seconds: holdSeconds, label: item.label })
                : item.label}
                              style=${`--hold-progress:${hold.progress}`}
                              ?disabled=${!item.available}
                              @pointerdown=${(ev: PointerEvent) => this._startHold(ev, item)}
                              @pointerup=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointerleave=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointercancel=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @click=${(ev: MouseEvent) => {
                if (ev.shiftKey) {
                  this._showMoreInfo(item.entity_id);
                  return;
                }
                if (item.requiresHold) {
                  ev.preventDefault();
                  return;
                }
                this._invokeAction(item);
              }}
                            >
                              <ha-icon .icon=${item.icon}></ha-icon>
                              ${item.band
                ? html`<span class="band-badge">${item.band === "2g" ? "2.4" : item.band.replace("g", "")}</span>`
                : ""}
                            </button>
                          `;
          },
        )}
                    </div>
                  `
        : ""}
              ${actionGroups.router.length
        ? html`
                    <div class="action-group" title=${t("actions.router")}>
                      ${actionGroups.router.map(
          (item) => {
            const hold = this._holdStates[item.entity_id] ?? {
              progress: 0,
              completed: false,
            };
            return html`
                            <button
                              class="icon-toggle ${hold.progress > 0 ? "holding" : ""} ${hold.completed ? "completed" : ""}"
                              data-kind="router"
                              data-state=${item.isOn ? "on" : "off"}
                              title=${item.requiresHold
                ? t("actions.holdWithLabel", { seconds: holdSeconds, label: item.label })
                : item.label}
                              style=${`--hold-progress:${hold.progress}`}
                              ?disabled=${!item.available}
                              @pointerdown=${(ev: PointerEvent) => this._startHold(ev, item)}
                              @pointerup=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointerleave=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @pointercancel=${(ev: PointerEvent) => this._cancelHold(ev, item)}
                              @click=${(ev: MouseEvent) => {
                if (ev.shiftKey) {
                  this._showMoreInfo(item.entity_id);
                  return;
                }
                if (item.requiresHold) {
                  ev.preventDefault();
                  return;
                }
                this._invokeAction(item);
              }}
                            >
                              <ha-icon .icon=${item.icon}></ha-icon>
                            </button>
                          `;
          },
        )}
                    </div>
                  `
        : ""}
            </div>
          </div>

          <div class="router-row">
            <div class="router-left">
              <span class="router-label">
                ${entryId && localUrl
        ? html`
                      ${t("card.routerLabel")}:
                      <a
                        class="router-link"
                        href=${localUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title=${routerInfoText || localUrl}
                      >
                        ${localUrl}
                      </a>
                    `
        : routerLabel}
              </span>
            </div>
            <div class="router-right">
              ${publicIp ? html`<span class="router-public">${publicIp}</span>` : ""}
            </div>
          </div>

          <div class="controls">
            <div class="search">
              <input
                type="search"
                placeholder=${t("card.searchPlaceholder")}
                .value=${this._filter}
                @input=${this._filterChanged}
              />
            </div>
            <div class="control-actions">
              <span class="chip">${t("card.devicesCount", { count: filtered.length })}</span>
              ${stats.cpu
        ? html`
                    <span
                      class="chip stat"
                      title=${t("card.cpuUsage", { value: stats.cpu })}
                    >
                      <ha-icon icon="mdi:cpu-64-bit"></ha-icon>${stats.cpu}
                    </span>
                  `
        : ""}
              ${stats.mem
        ? html`
                    <span
                      class="chip stat"
                      title=${t("card.memUsage", { value: stats.mem })}
                    >
                      <ha-icon icon="mdi:memory"></ha-icon>${stats.mem}
                    </span>
                  `
        : ""}
              ${routerDevice?.id || routerEntityId
        ? html`
                    <button
                      class="icon-button"
                      title=${t("actions.router")}
                      @click=${() => {
            if (routerDevice?.id) {
              this._openDevicePage(routerDevice.id);
            } else if (routerEntityId) {
              this._showMoreInfo(routerEntityId);
            }
          }}
                    >
                      <ha-icon icon="mdi:router-wireless"></ha-icon>
                    </button>
                  `
        : ""}
            </div>
          </div>
        </div>

        <div class="filter-row ${hideFilterSection ? "hidden" : ""}">
          <div class="filter-group">
            <button
              class="filter-button ${this._filters.band === "all" ? "active" : ""}"
              data-group="band"
              data-value="all"
              @click=${this._filterButtonClick}
            >
              ${t("filters.all")}
            </button>
            ${availableBands.has("2g")
        ? html`
                  <button
                    class="filter-button ${this._filters.band === "2g" ? "active" : ""}"
                    data-group="band"
                    data-value="2g"
                    @click=${this._filterButtonClick}
                  >
                    ${t("filters.band2")}
                  </button>
                `
        : ""}
            ${availableBands.has("5g")
        ? html`
                  <button
                    class="filter-button ${this._filters.band === "5g" ? "active" : ""}"
                    data-group="band"
                    data-value="5g"
                    @click=${this._filterButtonClick}
                  >
                    ${t("filters.band5")}
                  </button>
                `
        : ""}
            ${availableBands.has("6g")
        ? html`
                  <button
                    class="filter-button ${this._filters.band === "6g" ? "active" : ""}"
                    data-group="band"
                    data-value="6g"
                    @click=${this._filterButtonClick}
                  >
                    ${t("filters.band6")}
                  </button>
                `
        : ""}
          </div>

          <div class="filter-group">
            <button
              class="filter-button ${this._filters.connection === "all" ? "active" : ""}"
              data-group="connection"
              data-value="all"
              @click=${this._filterButtonClick}
            >
              ${t("filters.all")}
            </button>
            <button
              class="filter-button icon ${this._filters.connection === "wifi" ? "active" : ""}"
              data-group="connection"
              data-value="wifi"
              title=${t("filters.wifi")}
              @click=${this._filterButtonClick}
            >
              <ha-icon icon="mdi:wifi"></ha-icon>
            </button>
            <button
              class="filter-button icon ${this._filters.connection === "wired" ? "active" : ""}"
              data-group="connection"
              data-value="wired"
              title=${t("filters.wired")}
              @click=${this._filterButtonClick}
            >
              <ha-icon icon="mdi:lan"></ha-icon>
            </button>
            <button
              class="filter-button icon ${this._filters.connection === "iot" ? "active" : ""}"
              data-group="connection"
              data-value="iot"
              title=${t("filters.iot")}
              @click=${this._filterButtonClick}
            >
              <ha-icon icon="mdi:chip"></ha-icon>
            </button>
            ${availableConnections.has("guest")
        ? html`
                  <button
                    class="filter-button icon ${this._filters.connection === "guest" ? "active" : ""}"
                    data-group="connection"
                    data-value="guest"
                    title=${t("filters.guest")}
                    @click=${this._filterButtonClick}
                  >
                    <ha-icon icon="mdi:account-key"></ha-icon>
                  </button>
                `
        : ""}
          </div>

          <div class="filter-group">
            <button
              class="filter-button ${this._filters.status === "all" ? "active" : ""}"
              data-group="status"
              data-value="all"
              @click=${this._filterButtonClick}
            >
              ${t("filters.all")}
            </button>
            <button
              class="filter-button ${this._filters.status === "online" ? "active" : ""}"
              data-group="status"
              data-value="online"
              @click=${this._filterButtonClick}
            >
              ${t("filters.online")}
            </button>
            <button
              class="filter-button ${this._filters.status === "offline" ? "active" : ""}"
              data-group="status"
              data-value="offline"
              @click=${this._filterButtonClick}
            >
              ${t("filters.offline")}
            </button>
          </div>
          <span class="chip compact">${t("card.onlineCount", { online: onlineCount, total: rows.length })}</span>
        </div>

        ${this._error
        ? html`<div class="empty">${this._error}</div>`
        : !entryId
          ? html`<div class="empty">${t("card.selectRouter")}</div>`
          : sorted.length === 0
            ? html`<div class="empty">${t("card.noDevices")}</div>`
            : html`
                  <div class="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          ${displayColumns.map((col) => {
              const index = activeSorts.findIndex((sort) => sort.key === col.key);
              const direction = index >= 0 ? activeSorts[index].direction : null;
              return html`
                              <th>
                                <button
                                  class="sort-button"
                                  aria-sort=${direction ? (direction === "asc" ? "ascending" : "descending") : "none"}
                                  @click=${(ev: MouseEvent) => this._toggleSort(ev, col.key)}
                                >
                                  <span>${col.label}</span>
                                  ${direction
                  ? html`
                                        <span class="sort-indicator ${direction}">
                                          ${direction === "asc" ? "▲" : "▼"}
                                        </span>
                                        ${this._sorts.length > 1
                      ? html`<span class="sort-order">${index + 1}</span>`
                      : ""}
                                      `
                  : ""}
                                </button>
                              </th>
                            `;
            })}
                        </tr>
                      </thead>
                      <tbody>
                        ${sorted.map(
              (row) => {
                const isOffline = !row.isOnline;
                const cells: Record<string, unknown> = {
                  name: html`
                                <button class="link" @click=${() => this._showMoreInfo(row.entity_id)}>
                                  ${row.name}
                                </button>
                              `,
                  status: html`
                                <span class="status">
                                  <span class="status-dot" style=${`background:${row.statusColor}`}></span>
                                  ${row.isOnline ? t("status.online") : t("status.offline")}
                                </span>
                              `,
                  connection: row.connection,
                  band: isOffline
                    ? "—"
                    : row.connectionType === "wired"
                      ? html`
                                      <span class="band-pill band-wired">
                                        <ha-icon class="band-icon" icon="mdi:lan"></ha-icon>
                                        <span class="band-label">LAN</span>
                                      </span>
                                    `
                      : row.band === "—"
                        ? "—"
                        : html`
                                      <span class="band-pill band-${row.bandType}">
                                        <ha-icon class="band-icon" icon="mdi:wifi"></ha-icon>
                                        <span class="band-label">
                                          ${row.bandType === "2g"
                            ? "2.4G"
                            : row.bandType === "5g"
                              ? "5G"
                              : row.bandType === "6g"
                                ? "6G"
                                : row.band}
                                        </span>
                                      </span>
                                    `,
                  ip: row.ip,
                  mac: row.mac,
                  hostname: row.hostname,
                  packetsSent: row.packetsSent,
                  packetsReceived: row.packetsReceived,
                  up: isOffline
                    ? "—"
                    : renderSpeedCell(
                      row.upSpeedValue,
                      row.upSpeed,
                      upSpeedScale.max,
                      colorizeUpDown,
                    ),
                  down: isOffline
                    ? "—"
                    : renderSpeedCell(
                      row.downSpeedValue,
                      row.downSpeed,
                      downSpeedScale.max,
                      colorizeUpDown,
                    ),
                  tx: isOffline
                    ? "—"
                    : colorizeRates
                      ? html`
                                      <span class="rate ${txrxRateClass(row.txRateValue)}">
                                        ${row.txRate}
                                      </span>
                                    `
                      : row.txRate,
                  rx: isOffline
                    ? "—"
                    : colorizeRates
                      ? html`
                                      <span class="rate ${txrxRateClass(row.rxRateValue)}">
                                        ${row.rxRate}
                                      </span>
                                    `
                      : row.rxRate,
                  online: row.onlineTime,
                  traffic: row.trafficUsage,
                  deviceType: row.deviceType ?? "—",
                  deviceModel: row.deviceModel ?? "—",
                  deviceFirmware: row.deviceFirmware ?? "—",
                  deviceStatus: row.deviceStatus ?? "—",
                  signal: isOffline || row.connectionType === "wired"
                    ? "—"
                    : html`
                                    <span class="signal">
                                      <span class="signal-dot" style=${`background:${row.signalColor}`}></span>
                                      ${row.signal}
                                    </span>
                                  `,
                };
                return html`
                              <tr>
                                ${displayColumns.map(
                  (col) => html`<td>${cells[col.key]}</td>`,
                )}
                              </tr>
                            `;
              },
            )}
                      </tbody>
                    </table>
                  </div>
                `}
        ${this._speedTooltip
        ? html`
              <span
                class="speed-tooltip speed-tooltip--portal ${this._speedTooltip.visible
            ? "speed-tooltip--visible"
            : ""}"
                role="tooltip"
                style=${`left:${this._speedTooltip.x}px; top:${this._speedTooltip.y}px;`}
              >
                <span class="speed-tooltip-bar-track">
                  <span
                    class="speed-tooltip-bar-fill"
                    style=${`--fill:${this._speedTooltip.percent}%`}
                  ></span>
                </span>
                <span class="speed-tooltip-line">
                  ${t("card.speedTooltipUsage", { value: this._speedTooltip.percent })}
                </span>
                <span class="speed-tooltip-line">
                  ${t("card.speedTooltipTransfer", { value: this._speedTooltip.transfer })}
                </span>
                <span class="speed-tooltip-line">
                  ${t("card.speedTooltipMbps", {
              value: this._speedTooltip.mbps,
              max: this._speedTooltip.max,
            })}
                </span>
              </span>
            `
        : nothing}
      </ha-card>
    `;
  }

  static getStubConfig() {
    return {
      type: "custom:tplink-router-card",
    };
  }

  getGridOptions() {
    return {
      columns: "full",
    } as const;
  }

  static getConfigForm() {
    const getHass = () =>
      (document.querySelector("home-assistant") as { hass?: HomeAssistant } | null)?.hass;
    const t = (key: string) => localize(getHass(), key);
    const columnOptions = ALL_COLUMN_KEYS.map((value) => ({
      value,
      label: t(`columns.${value}`),
    }));
    const defaultBandOptions = [
      { value: DEFAULT_FILTER_UNSET, label: t("editor.defaultFilterUnset") },
      { value: "all", label: t("filters.all") },
      { value: "2g", label: t("filters.band2") },
      { value: "5g", label: t("filters.band5") },
      { value: "6g", label: t("filters.band6") },
    ];
    const defaultConnectionOptions = [
      { value: DEFAULT_FILTER_UNSET, label: t("editor.defaultFilterUnset") },
      { value: "all", label: t("filters.all") },
      { value: "wifi", label: t("filters.wifi") },
      { value: "wired", label: t("filters.wired") },
      { value: "iot", label: t("filters.iot") },
      { value: "guest", label: t("filters.guest") },
    ];
    const defaultStatusOptions = [
      { value: DEFAULT_FILTER_UNSET, label: t("editor.defaultFilterUnset") },
      { value: "all", label: t("filters.all") },
      { value: "online", label: t("filters.online") },
      { value: "offline", label: t("filters.offline") },
    ];
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        {
          name: "entry_id",
          selector: { config_entry: {} },
        },
        {
          name: "speed_unit",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "MBps", label: t("editor.speedMBps") },
                { value: "Mbps", label: t("editor.speedMbps") },
              ],
            },
          },
        },
        { name: "txrx_color", selector: { boolean: {} } },
        { name: "updown_color", selector: { boolean: {} } },
        { name: "hide_header", selector: { boolean: {} } },
        { name: "hide_filter_section", selector: { boolean: {} } },
        {
          name: "default_filter_band",
          selector: {
            select: {
              mode: "dropdown",
              options: defaultBandOptions,
            },
          },
        },
        {
          name: "default_filter_connection",
          selector: {
            select: {
              mode: "dropdown",
              options: defaultConnectionOptions,
            },
          },
        },
        {
          name: "default_filter_status",
          selector: {
            select: {
              mode: "dropdown",
              options: defaultStatusOptions,
            },
          },
        },
        {
          name: "upload_speed_color_max",
          selector: {
            number: {
              mode: "box",
              min: 0,
              max: 10000,
              step: 10,
            },
          },
        },
        {
          name: "download_speed_color_max",
          selector: {
            number: {
              mode: "box",
              min: 0,
              max: 10000,
              step: 10,
            },
          },
        },
        {
          name: "columns",
          selector: {
            select: {
              multiple: true,
              mode: "dropdown",
              sort: false,
              options: columnOptions,
            },
          },
        },
      ],
      computeLabel: (schema: { name?: string }) => {
        switch (schema.name) {
          case "title":
            return t("editor.title");
          case "entry_id":
            return t("editor.router");
          case "speed_unit":
            return t("editor.speedUnit");
          case "txrx_color":
            return t("editor.txrxColor");
          case "updown_color":
            return t("editor.updownColor");
          case "hide_header":
            return t("editor.hideHeader");
          case "hide_filter_section":
            return t("editor.hideFilterSection");
          case "default_filter_band":
            return t("editor.defaultFilterBand");
          case "default_filter_connection":
            return t("editor.defaultFilterConnection");
          case "default_filter_status":
            return t("editor.defaultFilterStatus");
          case "upload_speed_color_max":
            return t("editor.uploadSpeedColorMax");
          case "download_speed_color_max":
            return t("editor.downloadSpeedColorMax");
          case "columns":
            return t("editor.columns");
          default:
            return schema.name ?? "";
        }
      },
      computeHelper: (schema: { name?: string }) => {
        if (schema.name === "columns") {
          return t("editor.columnsHelp");
        }
        if (schema.name === "txrx_color") {
          return t("editor.txrxColorHelp");
        }
        if (schema.name === "updown_color") {
          return t("editor.updownColorHelp");
        }
        if (schema.name === "hide_header") {
          return t("editor.hideHeaderHelp");
        }
        if (schema.name === "hide_filter_section") {
          return t("editor.hideFilterSectionHelp");
        }
        if (
          schema.name === "default_filter_band" ||
          schema.name === "default_filter_connection" ||
          schema.name === "default_filter_status"
        ) {
          return t("editor.defaultFilterHelp");
        }
        if (
          schema.name === "upload_speed_color_max" ||
          schema.name === "download_speed_color_max"
        ) {
          return t("editor.speedColorHelp");
        }
        if (schema.name === "entry_id") {
          return t("editor.routerHelp");
        }
        return "";
      },
    };
  }
}

if (!customElements.get("tplink-router-card")) {
  customElements.define("tplink-router-card", TplinkRouterCard);
}
