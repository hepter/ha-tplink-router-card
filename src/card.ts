import { LitElement, html } from "lit";
import { cardStyles } from "./styles";
import {
  formatBytes,
  formatDuration,
  formatLinkSpeed,
  formatMbps,
  formatNumber,
  formatSpeed,
  normalizeLinkMbps,
  normalizeMbps,
  safeString,
} from "./format";
import { localize } from "./i18n";
import type {
  ConfigEntry,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassEntity,
  HomeAssistant,
  TplinkRouterCardConfig,
} from "./types";

const STATUS_ONLINE = new Set(["home", "on", "connected"]);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const signalColor = (dbm: number | null) => {
  if (dbm === null) return "var(--secondary-text-color)";
  if (dbm <= -80) return "var(--signal-bad)";
  if (dbm <= -70) return "var(--signal-poor)";
  if (dbm <= -65) return "var(--signal-fair)";
  if (dbm <= -60) return "var(--signal-good)";
  return "var(--signal-excellent)";
};

type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection };
type FilterState = {
  band: "all" | "2g" | "5g" | "6g";
  connection: "all" | "wifi" | "wired" | "iot" | "guest";
  status: "all" | "online" | "offline";
};

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
};

const HOLD_DURATION_MS = 1000;

type RowData = {
  entity_id: string;
  name: string;
  nameRaw: string;
  macNormalized: string;
  isOnline: boolean;
  statusValue: number;
  statusColor: string;
  connection: string;
  connectionType: "wifi" | "wired" | "iot" | "guest" | "unknown";
  band: string;
  bandType: "2g" | "5g" | "6g" | "unknown";
  ip: string;
  mac: string;
  hostname: string;
  packetsSent: string;
  packetsSentValue: number | null;
  packetsReceived: string;
  packetsReceivedValue: number | null;
  upSpeed: string;
  upSpeedValue: number | null;
  downSpeed: string;
  downSpeedValue: number | null;
  txRate: string;
  txRateValue: number | null;
  rxRate: string;
  rxRateValue: number | null;
  onlineTime: string;
  onlineTimeValue: number | null;
  trafficUsage: string;
  trafficUsageValue: number | null;
  signal: string;
  signalValue: number | null;
  signalColor: string;
};

const normalizeBand = (value: unknown): RowData["bandType"] => {
  if (value === null || value === undefined) return "unknown";
  const text = String(value).toLowerCase();
  if (text.includes("2.4") || text.includes("2g")) return "2g";
  if (text.includes("5g")) return "5g";
  if (text.includes("6g")) return "6g";
  return "unknown";
};

const normalizeConnection = (value: unknown): RowData["connectionType"] => {
  if (value === null || value === undefined) return "unknown";
  const text = String(value).toLowerCase();
  if (text.includes("guest")) return "guest";
  if (text.includes("iot")) return "iot";
  if (text.includes("wired") || text.includes("lan") || text.includes("ethernet")) return "wired";
  return "wifi";
};

const normalizeMac = (value: string) =>
  value.replace(/[^0-9a-f]/gi, "").toLowerCase();

const looksLikeMac = (value: string) => /^[0-9a-f:\-]+$/i.test(value);

const looksLikeIp = (value: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value);

const extractIp = (value?: string) => {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (looksLikeIp(raw)) return raw;
  try {
    const url = new URL(raw);
    if (looksLikeIp(url.hostname)) return url.hostname;
  } catch (_err) {
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
  } as const;

  static styles = cardStyles;

  hass?: HomeAssistant;
  private _config?: TplinkRouterCardConfig;
  private _entries: ConfigEntry[] = [];
  private _entityRegistry: EntityRegistryEntry[] = [];
  private _error: string | null = null;
  private _filter = "";
  private _sorts: SortState[] = [];
  private _filters: FilterState = {
    band: "all",
    connection: "all",
    status: "all",
  };
  private _holdStates: Record<string, { progress: number; completed: boolean }> = {};
  private _holdTimers: Record<string, number> = {};
  private _holdAnimationIds: Record<string, number> = {};
  private _loading = false;
  private _loaded = false;
  private _registryFailed = false;
  private _deviceRegistry: DeviceRegistryEntry[] = [];

  setConfig(config: TplinkRouterCardConfig): void {
    const normalized = {
      type: "custom:tplink-router-card",
      ...(config ?? {}),
    };
    this._config = {
      speed_unit: "MBps",
      ...normalized,
    };
    this._loadRegistries();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("hass")) {
      this._loadRegistries();
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
      } catch (err) {
        if (this.hass.callApi) {
          try {
            entries = await this.hass.callApi<ConfigEntry[]>(
              "GET",
              "config/config_entries/entry",
            );
          } catch (_apiErr) {
            entries = null;
          }
        }
      }

      try {
        entities = await this.hass.callWS<EntityRegistryEntry[]>({
          type: "config/entity_registry/list",
        });
      } catch (err) {
        entities = null;
      }

      try {
        devices = await this.hass.callWS<DeviceRegistryEntry[]>({
          type: "config/device_registry/list",
        });
      } catch (err) {
        devices = null;
      }

      if (entries) {
        this._entries = entries.filter((entry) => entry.domain === "tplink_router");
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

      if (!entries && !entities) {
        this._error = localize(this.hass, "errors.lists");
      }
      this._loaded = true;
    } catch (err) {
      this._error = localize(this.hass, "errors.lists");
    } finally {
      this._loading = false;
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
  }

  private _filterButtonClick(ev: Event) {
    const target = ev.currentTarget as HTMLElement;
    const group = target.dataset.group as keyof FilterState | undefined;
    const value = target.dataset.value as FilterState[keyof FilterState] | undefined;
    if (!group || value === undefined) return;
    this._setFilter(group, value);
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

  private _showMoreInfo(entityId: string) {
    const event = new Event("hass-action", { bubbles: true, composed: true });
    (event as CustomEvent).detail = {
      config: {
        entity: entityId,
        tap_action: { action: "more-info" },
      },
      action: "tap",
    };
    this.dispatchEvent(event);
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

    let entities: HassEntity[] = [];

    if (entryId && !this._registryFailed && this._entityRegistry.length > 0) {
      const registry = this._entityRegistry.filter(
        (entry) => entry.platform === "tplink_router" && entry.entity_id.startsWith("device_tracker."),
      );

      entities = registry
        .filter((entry) => entry.config_entry_id === entryId)
        .map((entry) => this.hass?.states[entry.entity_id])
        .filter((state) => state !== undefined);
    } else {
      entities = Object.values(this.hass.states).filter((state) => {
        if (!state.entity_id.startsWith("device_tracker.")) return false;
        const source = (state.attributes as Record<string, unknown>).source_type;
        return source === "router";
      });
    }

    return entities.map((state) => {
      const attrs = state.attributes as Record<string, unknown>;
      const nameRaw = safeString(attrs.friendly_name ?? state.entity_id);
      const isOnline = STATUS_ONLINE.has(state.state);
      const statusColor = isOnline ? "#3aa45b" : "#9aa0a6";
      const connection = safeString(attrs.connection ?? "—");
      const band = safeString(attrs.band ?? "—");
      const bandType = normalizeBand(band);
      const ip = safeString(attrs.ip ?? attrs.ip_address ?? attrs.ipaddr ?? "—");
      const mac = safeString(attrs.mac ?? attrs.mac_address ?? attrs.macaddr ?? "—");
      const hostname = safeString(attrs.host_name ?? attrs.hostname ?? attrs.host ?? "—");
      const macNormalized = normalizeMac(mac);
      const packetsSentValue = toNumber(attrs.packets_sent);
      const packetsReceivedValue = toNumber(attrs.packets_received);
      const upSpeedRaw = toNumber(attrs.up_speed);
      const downSpeedRaw = toNumber(attrs.down_speed);
      const txRateRaw = toNumber(attrs.tx_rate);
      const rxRateRaw = toNumber(attrs.rx_rate);
      const upSpeedValue = normalizeMbps(upSpeedRaw);
      const downSpeedValue = normalizeMbps(downSpeedRaw);
      const txRateValue = normalizeLinkMbps(txRateRaw, bandType);
      const rxRateValue = normalizeLinkMbps(rxRateRaw, bandType);
      const onlineTimeValue = toNumber(attrs.online_time);
      const trafficUsageValue = toNumber(attrs.traffic_usage);
      const signalValue = toNumber(attrs.signal);

      return {
        entity_id: state.entity_id,
        name: nameRaw,
        nameRaw,
        macNormalized,
        isOnline,
        statusValue: isOnline ? 1 : 0,
        statusColor,
        connection,
        connectionType: normalizeConnection(connection),
        band,
        bandType,
        ip,
        mac,
        hostname,
        packetsSent: formatNumber(packetsSentValue ?? NaN),
        packetsSentValue,
        packetsReceived: formatNumber(packetsReceivedValue ?? NaN),
        packetsReceivedValue,
        upSpeed: formatSpeed(upSpeedRaw, this._config?.speed_unit ?? "MBps"),
        upSpeedValue,
        downSpeed: formatSpeed(downSpeedRaw, this._config?.speed_unit ?? "MBps"),
        downSpeedValue,
        txRate: formatLinkSpeed(txRateRaw, bandType),
        txRateValue,
        rxRate: formatLinkSpeed(rxRateRaw, bandType),
        rxRateValue,
        onlineTime: formatDuration(onlineTimeValue),
        onlineTimeValue,
        trafficUsage: formatBytes(trafficUsageValue),
        trafficUsageValue,
        signal: signalValue !== null ? `${signalValue} dBm` : "—",
        signalValue,
        signalColor: signalColor(signalValue),
      };
    });
  }

  private _getActionItems(entryId: string | undefined): ActionItem[] {
    if (!this.hass || !entryId || this._entityRegistry.length === 0) return [];
    const registry = this._entityRegistry.filter((entry) => entry.config_entry_id === entryId);
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
        const lower = friendly.toLowerCase();
        let kind: ActionItem["kind"] = "router";
        if (lower.includes("guest")) kind = "guest";
        else if (lower.includes("iot")) kind = "iot";
        else if (lower.includes("wifi")) kind = "host";

        let band: ActionItem["band"] | undefined;
        if (lower.includes("2.4") || lower.includes("2g")) band = "2g";
        else if (lower.includes("5g")) band = "5g";
        else if (lower.includes("6g")) band = "6g";

        const icon = String(
          (state.attributes as Record<string, unknown>).icon ??
            (domain === "button" ? "mdi:restart" : "mdi:wifi"),
        );
        const isOn = state.state === "on";
        const available =
          domain === "button" ? state.state !== "unavailable" : state.state !== "unavailable";
        const requiresHold =
          domain === "button" ||
          lower.includes("wifi") ||
          lower.includes("guest") ||
          lower.includes("iot");
        const isScan = lower.includes("data fetching") || state.entity_id.includes("scanning");
        const holdRequired = isScan ? false : requiresHold;

        return {
          entity_id: state.entity_id,
          domain,
          kind,
          band,
          label: friendly,
          icon,
          isOn,
          available,
          requiresHold: holdRequired,
        } as ActionItem;
      })
      .filter((item) => {
        if (item.domain === "button") return true;
        if (item.kind === "router") return true;
        return Boolean(item.band);
      });
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
      await this.hass.callService("button", "press", { entity_id: item.entity_id });
      return;
    }
    const service = item.isOn ? "turn_off" : "turn_on";
    await this.hass.callService("switch", service, { entity_id: item.entity_id });
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
    const entryDevices = this._entityRegistry
      .filter((entry) => entry.config_entry_id === entryId && entry.device_id)
      .map((entry) => entry.device_id as string);
    const devices = entryDevices
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
        void this._handleAction(item);
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
      const connType = row.connectionType === "unknown" ? "wifi" : row.connectionType;
      if (connFilter !== "all" && connType !== connFilter) return false;

      const statusFilter = this._filters.status;
      if (statusFilter !== "all") {
        if (statusFilter === "online" && !row.isOnline) return false;
        if (statusFilter === "offline" && row.isOnline) return false;
      }

      return true;
    });

    const columns = [
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
      { key: "up", label: t("columns.up"), sort: (row: RowData) => row.upSpeedValue },
      {
        key: "down",
        label: t("columns.down"),
        sort: (row: RowData) => row.downSpeedValue,
      },
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
    ];
    const columnMap = new Map(columns.map((col) => [col.key, col]));
    const defaultColumnKeys = columns.filter((col) => col.key !== "name").map((col) => col.key);
    const selectedColumns =
      this._config?.columns && this._config.columns.length > 0
        ? this._config.columns
        : defaultColumnKeys;
    const deduped = Array.from(new Set(selectedColumns)).filter((key) => key !== "name");
    const displayColumns = [
      columnMap.get("name")!,
      ...deduped.map((key) => columnMap.get(key)).filter(Boolean),
    ];

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
    const actionItems = this._getActionItems(entryId);
    const holdSeconds = Math.max(1, Math.round(HOLD_DURATION_MS / 1000));
    const routerEntityId = this._getRouterEntityId(entryId);
    const entryTitle = entryId
      ? this._entries.find((entry) => entry.entry_id === entryId)?.title
      : undefined;
    const entryStates = this._getEntryStates(entryId);
    const entryIp = extractIp(entryTitle);
    const preferredDeviceId = entryIp ? this._findDeviceIdByIp(entryStates, entryIp) : undefined;
    const routerDevice =
      (preferredDeviceId
        ? this._deviceRegistry.find((device) => device.id === preferredDeviceId)
        : undefined) ?? this._getRouterDevice(entryId);
    const routerStatesForDevice = this._getStatesForDevice(entryId, routerDevice?.id);
    const routerStates =
      routerStatesForDevice.length > 0
        ? routerStatesForDevice
        : entryStates.filter((state) => !state.entity_id.startsWith("device_tracker."));
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

    const actionGroups = {
      host: actionItems.filter((item) => item.kind === "host").sort((a, b) =>
        compareValues(
          { "2g": 1, "5g": 2, "6g": 3 }[a.band ?? "2g"],
          { "2g": 1, "5g": 2, "6g": 3 }[b.band ?? "2g"],
        ),
      ),
      guest: actionItems.filter((item) => item.kind === "guest").sort((a, b) =>
        compareValues(
          { "2g": 1, "5g": 2, "6g": 3 }[a.band ?? "2g"],
          { "2g": 1, "5g": 2, "6g": 3 }[b.band ?? "2g"],
        ),
      ),
      iot: actionItems.filter((item) => item.kind === "iot").sort((a, b) =>
        compareValues(
          { "2g": 1, "5g": 2, "6g": 3 }[a.band ?? "2g"],
          { "2g": 1, "5g": 2, "6g": 3 }[b.band ?? "2g"],
        ),
      ),
      router: actionItems.filter((item) => item.kind === "router"),
    };

    return html`
      <ha-card>
        <div class="header">
          <div class="title">
            <h2>${this._config.title ?? t("card.title")}</h2>
            <div class="actions">
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
                                this._handleAction(item);
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
                                this._handleAction(item);
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
                                this._handleAction(item);
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
                                this._handleAction(item);
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

        <div class="filter-row">
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
                              band: row.band,
                              ip: row.ip,
                              mac: row.mac,
                              hostname: row.hostname,
                              packetsSent: row.packetsSent,
                              packetsReceived: row.packetsReceived,
                              up: row.upSpeed,
                              down: row.downSpeed,
                              tx: row.txRate,
                              rx: row.rxRate,
                              online: row.onlineTime,
                              traffic: row.trafficUsage,
                              signal: html`
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
      </ha-card>
    `;
  }

  static getStubConfig() {
    return {
      type: "custom:tplink-router-card",
    };
  }

  static getConfigForm() {
    const getHass = () =>
      (document.querySelector("home-assistant") as { hass?: HomeAssistant } | null)?.hass;
    const t = (key: string) => localize(getHass(), key);
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        {
          name: "entry_id",
          selector: { config_entry: { integration: "tplink_router" } },
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
        {
          name: "columns",
          selector: {
            select: {
              multiple: true,
              mode: "dropdown",
              sort: false,
              options: [
                { value: "status", label: t("columns.status") },
                { value: "connection", label: t("columns.connection") },
                { value: "band", label: t("columns.band") },
                { value: "ip", label: t("columns.ip") },
                { value: "mac", label: t("columns.mac") },
                { value: "hostname", label: t("columns.hostname") },
                { value: "packetsSent", label: t("columns.packetsSent") },
                { value: "packetsReceived", label: t("columns.packetsReceived") },
                { value: "up", label: t("columns.up") },
                { value: "down", label: t("columns.down") },
                { value: "tx", label: t("columns.tx") },
                { value: "rx", label: t("columns.rx") },
                { value: "online", label: t("columns.online") },
                { value: "traffic", label: t("columns.traffic") },
                { value: "signal", label: t("columns.signal") },
              ],
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
        return "";
      },
    };
  }
}

if (!customElements.get("tplink-router-card")) {
  customElements.define("tplink-router-card", TplinkRouterCard);
}
