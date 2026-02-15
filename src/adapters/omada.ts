import {
  formatBytes,
  formatDuration,
  formatLinkSpeed,
  formatNumber,
  safeString,
} from "../utils/format";
import {
  normalizeMac,
  signalColor,
  toNumber,
  type MappedTrackerRow,
} from "./tplink";
import type { EntityRegistryEntry, HassEntity } from "../core/types";

const STATUS_ONLINE = new Set(["home", "on", "connected"]);

type OmadaBandType = MappedTrackerRow["bandType"];
type OmadaConnectionType = MappedTrackerRow["connectionType"];

type OmadaClientMetrics = {
  downloadedMB: number | null;
  uploadedMB: number | null;
  rxActivityMBps: number | null;
  txActivityMBps: number | null;
  rssi: number | null;
  uptimeSeconds: number | null;
};

const defaultMetrics = (): OmadaClientMetrics => ({
  downloadedMB: null,
  uploadedMB: null,
  rxActivityMBps: null,
  txActivityMBps: null,
  rssi: null,
  uptimeSeconds: null,
});

const isOmadaTracker = (state: HassEntity) => {
  if (!state.entity_id.startsWith("device_tracker.")) return false;
  const attrs = state.attributes as Record<string, unknown>;
  if (attrs.source_type !== "router") return false;
  return (
    "wireless" in attrs ||
    "guest" in attrs ||
    "ssid" in attrs ||
    "ap_name" in attrs ||
    "ap_mac" in attrs ||
    "switch_port" in attrs
  );
};

const normalizeBand = (attrs: Record<string, unknown>): OmadaBandType => {
  const candidates = [attrs.band, attrs.radio, attrs.wifi_mode, attrs.ssid]
    .map((value) => String(value ?? "").toLowerCase())
    .filter((value) => value.length > 0);

  for (const text of candidates) {
    if (
      text.includes("6g") ||
      text.includes("6ghz") ||
      text.includes("6 ghz") ||
      text.includes("11bea")
    ) {
      return "6g";
    }
    if (
      text.includes("5g") ||
      text.includes("5ghz") ||
      text.includes("5 ghz") ||
      text.includes("11ac") ||
      text.includes("11axa")
    ) {
      return "5g";
    }
    if (
      text.includes("2.4") ||
      text.includes("2g") ||
      text.includes("2ghz") ||
      text.includes("11ng")
    ) {
      return "2g";
    }
  }

  return "unknown";
};

const resolveConnection = (
  attrs: Record<string, unknown>,
): { label: string; type: OmadaConnectionType } => {
  const guest = attrs.guest === true || String(attrs.guest).toLowerCase() === "true";
  const wireless =
    attrs.wireless === true || String(attrs.wireless).toLowerCase() === "true";

  if (guest) return { label: "Guest", type: "guest" };
  if (wireless) return { label: "WiFi", type: "wifi" };
  if (attrs.wireless === false || String(attrs.wireless).toLowerCase() === "false") {
    return { label: "Wired", type: "wired" };
  }
  return { label: safeString(attrs.connection ?? "WiFi"), type: "wifi" };
};

const parseUptimeSeconds = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const asNumber = toNumber(value);
  if (asNumber !== null) return asNumber;
  if (typeof value === "string") {
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, Math.floor((Date.now() - dateMs) / 1000));
    }
  }
  return null;
};

const formatTransferSpeed = (mbPerSecond: number | null, unit: "MBps" | "Mbps") => {
  if (mbPerSecond === null || !Number.isFinite(mbPerSecond)) return "—";

  if (unit === "MBps") {
    if (mbPerSecond >= 1000) {
      const gb = mbPerSecond / 1000;
      const decimals = gb >= 100 ? 0 : gb >= 10 ? 1 : 2;
      return `${gb.toFixed(decimals)} GB/s`;
    }
    const decimals = mbPerSecond >= 100 ? 0 : mbPerSecond >= 10 ? 1 : 2;
    return `${mbPerSecond.toFixed(decimals)} MB/s`;
  }

  const mbps = mbPerSecond * 8;
  if (mbps >= 1000) {
    const gbps = mbps / 1000;
    const decimals = gbps >= 100 ? 0 : gbps >= 10 ? 1 : 2;
    return `${gbps.toFixed(decimals)} Gbps`;
  }
  const decimals = mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2;
  return `${mbps.toFixed(decimals)} Mbps`;
};

const mapSensorMetric = (state: HassEntity, target: OmadaClientMetrics) => {
  const id = state.entity_id.toLowerCase();
  const name = String((state.attributes as Record<string, unknown>).friendly_name ?? "")
    .toLowerCase()
    .trim();
  const text = `${id} ${name}`;

  if (text.includes("downloaded")) {
    target.downloadedMB = toNumber(state.state);
    return;
  }
  if (text.includes("uploaded")) {
    target.uploadedMB = toNumber(state.state);
    return;
  }
  if (text.includes("rx_activity") || text.includes("rx activity")) {
    target.rxActivityMBps = toNumber(state.state);
    return;
  }
  if (text.includes("tx_activity") || text.includes("tx activity")) {
    target.txActivityMBps = toNumber(state.state);
    return;
  }
  if (text.includes("rssi")) {
    target.rssi = toNumber(state.state);
    return;
  }
  if (text.includes("uptime")) {
    target.uptimeSeconds = parseUptimeSeconds(state.state);
  }
};

export const buildOmadaClientMetrics = (
  allStates: Record<string, HassEntity>,
  entityRegistry: EntityRegistryEntry[],
  entryId: string | undefined,
) => {
  const byDevice = new Map<string, OmadaClientMetrics>();
  if (!entryId || entityRegistry.length === 0) return byDevice;

  for (const entry of entityRegistry) {
    if (entry.config_entry_id !== entryId) continue;
    if (!entry.device_id) continue;
    if (!entry.entity_id.startsWith("sensor.")) continue;
    const state = allStates[entry.entity_id];
    if (!state) continue;
    if (!byDevice.has(entry.device_id)) byDevice.set(entry.device_id, defaultMetrics());
    mapSensorMetric(state, byDevice.get(entry.device_id) as OmadaClientMetrics);
  }

  return byDevice;
};

export const selectOmadaTrackers = (
  allStates: Record<string, HassEntity>,
  entityRegistry: EntityRegistryEntry[],
  entryId: string | undefined,
  registryFailed: boolean,
) => {
  const allOmadaTrackers = Object.values(allStates).filter((state) => isOmadaTracker(state));

  if (!entryId || registryFailed || entityRegistry.length === 0) return allOmadaTrackers;

  const registryTrackersForEntry = entityRegistry
    .filter((entry) => entry.config_entry_id === entryId)
    .filter((entry) => entry.entity_id.startsWith("device_tracker."));

  const selected = registryTrackersForEntry
    .map((entry) => allStates[entry.entity_id])
    .filter((state): state is HassEntity => state !== undefined)
    .filter((state) => isOmadaTracker(state));

  if (selected.length > 0) return selected;

  const byEntityId = new Map(entityRegistry.map((entry) => [entry.entity_id, entry.config_entry_id]));
  const matchedByRegistry = allOmadaTrackers.filter(
    (state) => byEntityId.get(state.entity_id) === entryId,
  );
  return matchedByRegistry.length > 0 ? matchedByRegistry : allOmadaTrackers;
};

export const mapOmadaStateToRow = (
  state: HassEntity,
  speedUnit: "MBps" | "Mbps",
  metrics?: OmadaClientMetrics,
): MappedTrackerRow => {
  const attrs = state.attributes as Record<string, unknown>;
  const nameRaw = safeString(attrs.friendly_name ?? attrs.name ?? state.entity_id);
  const isOnline = STATUS_ONLINE.has(state.state);
  const { label: connection, type: connectionType } = resolveConnection(attrs);
  const bandType = normalizeBand(attrs);
  const band =
    bandType === "2g" ? "2G" : bandType === "5g" ? "5G" : bandType === "6g" ? "6G" : "—";

  const ip = safeString(attrs.ip ?? attrs.ip_address ?? "—");
  const mac = safeString(attrs.mac ?? attrs.mac_address ?? "—");
  const hostname = safeString(attrs.host_name ?? attrs.hostname ?? attrs.name ?? "—");

  const packetsSentValue = toNumber(attrs.packets_sent ?? attrs.up_packet);
  const packetsReceivedValue = toNumber(attrs.packets_received ?? attrs.down_packet);

  const upMBps = metrics?.txActivityMBps ?? null;
  const downMBps = metrics?.rxActivityMBps ?? null;
  const upSpeedValue = upMBps !== null ? upMBps * 8 : null;
  const downSpeedValue = downMBps !== null ? downMBps * 8 : null;

  const txRateValue = upSpeedValue;
  const rxRateValue = downSpeedValue;

  const downloadedMB = metrics?.downloadedMB ?? null;
  const uploadedMB = metrics?.uploadedMB ?? null;
  const totalTrafficMB =
    downloadedMB !== null || uploadedMB !== null
      ? (downloadedMB ?? 0) + (uploadedMB ?? 0)
      : null;
  const trafficUsageValue =
    totalTrafficMB !== null ? totalTrafficMB * 1024 * 1024 : null;

  const onlineTimeValue = metrics?.uptimeSeconds ?? null;
  const signalValue = toNumber(attrs.rssi ?? attrs.signal) ?? metrics?.rssi ?? null;

  return {
    entity_id: state.entity_id,
    name: nameRaw,
    nameRaw,
    macNormalized: normalizeMac(mac),
    isOnline,
    statusValue: isOnline ? 1 : 0,
    statusColor: isOnline ? "#3aa45b" : "#9aa0a6",
    connection,
    connectionType,
    band,
    bandType,
    ip,
    mac,
    hostname,
    packetsSent: formatNumber(packetsSentValue ?? Number.NaN),
    packetsSentValue,
    packetsReceived: formatNumber(packetsReceivedValue ?? Number.NaN),
    packetsReceivedValue,
    upSpeed: formatTransferSpeed(upMBps, speedUnit),
    upSpeedValue,
    downSpeed: formatTransferSpeed(downMBps, speedUnit),
    downSpeedValue,
    txRate: formatLinkSpeed(txRateValue, bandType, "mbps"),
    txRateValue,
    rxRate: formatLinkSpeed(rxRateValue, bandType, "mbps"),
    rxRateValue,
    onlineTime: formatDuration(onlineTimeValue),
    onlineTimeValue,
    trafficUsage: formatBytes(trafficUsageValue),
    trafficUsageValue,
    signal: signalValue !== null ? `${signalValue} dBm` : "—",
    signalValue,
    signalColor: signalColor(signalValue),
  };
};
