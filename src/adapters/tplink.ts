import {
  formatBytes,
  formatDuration,
  formatLinkSpeed,
  formatNumber,
  formatSpeed,
  normalizeThroughputMbps,
  normalizeLinkMbps,
  safeString,
} from "../utils/format";
import type { EntityRegistryEntry, HassEntity } from "../core/types";

export const STATUS_ONLINE = new Set(["home", "on", "connected"]);

export type BandType = "2g" | "5g" | "6g" | "unknown";
export type ConnectionType = "wifi" | "wired" | "iot" | "guest" | "unknown";
export type LinkRateUnitHint = "auto" | "kbps";

export interface MappedTrackerRow {
  entity_id: string;
  name: string;
  nameRaw: string;
  macNormalized: string;
  isOnline: boolean;
  statusValue: number;
  statusColor: string;
  connection: string;
  connectionType: ConnectionType;
  band: string;
  bandType: BandType;
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
}

export const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const normalizeBand = (value: unknown): BandType => {
  if (value === null || value === undefined) return "unknown";
  const text = String(value).toLowerCase();
  if (text.includes("2.4") || text.includes("2g")) return "2g";
  if (text.includes("5g")) return "5g";
  if (text.includes("6g")) return "6g";
  return "unknown";
};

export const normalizeConnection = (value: unknown): ConnectionType => {
  if (value === null || value === undefined) return "unknown";
  const text = String(value).toLowerCase();
  if (text.includes("guest")) return "guest";
  if (text.includes("iot")) return "iot";
  if (text.includes("wired") || text.includes("lan") || text.includes("ethernet")) return "wired";
  return "wifi";
};

export const normalizeMac = (value: string) =>
  value.replace(/[^0-9a-f]/gi, "").toLowerCase();

export const signalColor = (dbm: number | null) => {
  if (dbm === null) return "var(--secondary-text-color)";
  if (dbm <= -80) return "var(--signal-bad)";
  if (dbm <= -70) return "var(--signal-poor)";
  if (dbm <= -65) return "var(--signal-fair)";
  if (dbm <= -60) return "var(--signal-good)";
  return "var(--signal-excellent)";
};

export const detectLinkRateUnit = (states: HassEntity[]): LinkRateUnitHint => {
  let max = 0;
  let max2g = 0;
  for (const state of states) {
    const attrs = state.attributes as Record<string, unknown>;
    const band = normalizeBand(attrs.band ?? attrs.bandwidth ?? attrs.frequency);
    const txRate = toNumber(attrs.tx_rate);
    const rxRate = toNumber(attrs.rx_rate);
    for (const value of [txRate, rxRate]) {
      if (value === null) continue;
      const abs = Math.abs(value);
      if (abs > max) max = abs;
      if (band === "2g" && abs > max2g) max2g = abs;
    }
  }
  if (max >= 10_000) return "kbps";
  if (max2g >= 1_000) return "kbps";
  return "auto";
};

export const selectRouterTrackers = (
  allStates: Record<string, HassEntity>,
  entityRegistry: EntityRegistryEntry[],
  entryId: string | undefined,
  registryFailed: boolean,
): HassEntity[] => {
  const allRouterTrackers = Object.values(allStates).filter((state) => {
    if (!state.entity_id.startsWith("device_tracker.")) return false;
    const source = (state.attributes as Record<string, unknown>).source_type;
    return source === "router";
  });

  if (!entryId || registryFailed || entityRegistry.length === 0) return allRouterTrackers;

  const registryTrackersForEntry = entityRegistry
    .filter((entry) => entry.config_entry_id === entryId)
    .filter((entry) => entry.entity_id.startsWith("device_tracker."));

  const selected = registryTrackersForEntry
    .map((entry) => allStates[entry.entity_id])
    .filter((state) => state !== undefined);

  if (selected.length > 0) return selected;

  const byEntityId = new Map(entityRegistry.map((entry) => [entry.entity_id, entry.config_entry_id]));
  const matchedByRegistry = allRouterTrackers.filter(
    (state) => byEntityId.get(state.entity_id) === entryId,
  );
  return matchedByRegistry.length > 0 ? matchedByRegistry : allRouterTrackers;
};

export const preferredRouterDeviceIds = (
  entityRegistry: EntityRegistryEntry[],
  entryId: string | undefined,
): string[] => {
  if (!entryId || entityRegistry.length === 0) return [];
  const entryRegistry = entityRegistry.filter((entry) => entry.config_entry_id === entryId);
  const deviceIds = new Set(
    entryRegistry.filter((entry) => entry.device_id).map((entry) => entry.device_id as string),
  );
  const nonTrackerDeviceIds = new Set(
    entryRegistry
      .filter((entry) => !entry.entity_id.startsWith("device_tracker.") && entry.device_id)
      .map((entry) => entry.device_id as string),
  );
  return [...(nonTrackerDeviceIds.size > 0 ? nonTrackerDeviceIds : deviceIds)];
};

export const mapTrackerStateToRow = (
  state: HassEntity,
  speedUnit: "MBps" | "Mbps",
  linkRateUnit: LinkRateUnitHint,
): MappedTrackerRow => {
  const attrs = state.attributes as Record<string, unknown>;
  const nameRaw = safeString(attrs.friendly_name ?? state.entity_id);
  const isOnline = STATUS_ONLINE.has(state.state);
  const connection = safeString(attrs.connection ?? "—");
  const band = safeString(attrs.band ?? "—");
  const bandType = normalizeBand(band);
  const ip = safeString(attrs.ip ?? attrs.ip_address ?? attrs.ipaddr ?? "—");
  const mac = safeString(attrs.mac ?? attrs.mac_address ?? attrs.macaddr ?? "—");
  const hostname = safeString(attrs.host_name ?? attrs.hostname ?? attrs.host ?? "—");
  const packetsSentValue = toNumber(attrs.packets_sent);
  const packetsReceivedValue = toNumber(attrs.packets_received);
  const upSpeedRaw = toNumber(attrs.up_speed);
  const downSpeedRaw = toNumber(attrs.down_speed);
  const txRateRaw = toNumber(attrs.tx_rate);
  const rxRateRaw = toNumber(attrs.rx_rate);
  const upSpeedValue = normalizeThroughputMbps(upSpeedRaw);
  const downSpeedValue = normalizeThroughputMbps(downSpeedRaw);
  const txRateValue = normalizeLinkMbps(txRateRaw, bandType, linkRateUnit);
  const rxRateValue = normalizeLinkMbps(rxRateRaw, bandType, linkRateUnit);
  const onlineTimeValue = toNumber(attrs.online_time);
  const trafficUsageValue = toNumber(attrs.traffic_usage);
  const signalValue = toNumber(attrs.signal);

  return {
    entity_id: state.entity_id,
    name: nameRaw,
    nameRaw,
    macNormalized: normalizeMac(mac),
    isOnline,
    statusValue: isOnline ? 1 : 0,
    statusColor: isOnline ? "#3aa45b" : "#9aa0a6",
    connection,
    connectionType: normalizeConnection(connection),
    band,
    bandType,
    ip,
    mac,
    hostname,
    packetsSent: formatNumber(packetsSentValue ?? Number.NaN),
    packetsSentValue,
    packetsReceived: formatNumber(packetsReceivedValue ?? Number.NaN),
    packetsReceivedValue,
    upSpeed: formatSpeed(upSpeedRaw, speedUnit),
    upSpeedValue,
    downSpeed: formatSpeed(downSpeedRaw, speedUnit),
    downSpeedValue,
    txRate: formatLinkSpeed(txRateRaw, bandType, linkRateUnit),
    txRateValue,
    rxRate: formatLinkSpeed(rxRateRaw, bandType, linkRateUnit),
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
