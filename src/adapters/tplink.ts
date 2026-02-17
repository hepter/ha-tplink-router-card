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
  deviceType?: string;
  deviceModel?: string;
  deviceFirmware?: string;
  deviceStatus?: string;
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

  if (!entryId) return allRouterTrackers;
  if (!registryFailed && entityRegistry.length === 0) return [];
  if (registryFailed || entityRegistry.length === 0) return allRouterTrackers;

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
  if (matchedByRegistry.length > 0) return matchedByRegistry;

  const entryDeviceIds = new Set(
    entityRegistry
      .filter((entry) => entry.config_entry_id === entryId && entry.device_id)
      .map((entry) => entry.device_id as string),
  );
  if (entryDeviceIds.size > 0) {
    const trackerDeviceByEntity = new Map(
      entityRegistry
        .filter((entry) => entry.entity_id.startsWith("device_tracker.") && entry.device_id)
        .map((entry) => [entry.entity_id, entry.device_id as string] as const),
    );
    const trackerByDevice = allRouterTrackers.filter((state) => {
      const deviceId = trackerDeviceByEntity.get(state.entity_id);
      return deviceId ? entryDeviceIds.has(deviceId) : false;
    });
    if (trackerByDevice.length > 0) return trackerByDevice;
  }

  return [];
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

const toJoinedText = (value: unknown) =>
  safeString(Array.isArray(value) ? value.join(",") : value);

type ThroughputDirection = "up" | "down";
const THROUGHPUT_FIELD_ALIASES: Record<
  ThroughputDirection,
  { bytesPerSecond: readonly string[]; kiloBytesPerSecond: readonly string[] }
> = {
  up: {
    bytesPerSecond: ["up_speed"],
    kiloBytesPerSecond: ["up_kilobytes_per_s"],
  },
  down: {
    bytesPerSecond: ["down_speed"],
    kiloBytesPerSecond: ["down_kilobytes_per_s"],
  },
};

const resolveFirstNumber = (
  attrs: Record<string, unknown>,
  keys: readonly string[],
) => {
  for (const key of keys) {
    const value = toNumber(attrs[key]);
    if (value !== null) return value;
  }
  return null;
};

const TX_RATE_FIELD_ALIASES = [
  "tx_rate",
  "txRate",
  "tx_mbps",
  "txMbps",
  "tx_speed",
  "txSpeed",
] as const;

const RX_RATE_FIELD_ALIASES = [
  "rx_rate",
  "rxRate",
  "rx_mbps",
  "rxMbps",
  "rx_speed",
  "rxSpeed",
] as const;

const SIGNAL_FIELD_ALIASES = [
  "signal",
  "rssi",
  "signal_dbm",
  "signalDbm",
  "dbm",
] as const;

const normalizeInterfaceLabel = (value: unknown) => {
  const text = toJoinedText(value).toLowerCase();
  if (text === "—") return "";
  if (text.includes("main")) return "host";
  if (text.includes("guest")) return "guest";
  if (text.includes("iot")) return "iot";
  return text;
};

const normalizeWireType = (value: unknown) => {
  const text = toJoinedText(value).toLowerCase();
  if (text === "—") return "";
  if (text.includes("wired") || text.includes("ethernet") || text.includes("lan")) return "wired";
  if (text.includes("wireless") || text.includes("wifi") || text.includes("wlan")) return "wifi";
  return text;
};

const inferBandLabelFromConnection = (value: string) => {
  const text = value.toLowerCase();
  if (text.includes("band2_4") || text.includes("2.4")) return "2G";
  if (text.includes("band5")) return "5G";
  if (text.includes("band6")) return "6G";
  return "—";
};

const inferConnectionLabel = (
  interfaceLabel: string,
  connectionText: string,
  wireTypeText: string,
) => {
  const normalizedConnection = connectionText.toLowerCase();
  if (wireTypeText === "wired") return "wired";
  if (
    normalizedConnection.includes("wired") ||
    normalizedConnection.includes("ethernet") ||
    normalizedConnection.includes("lan")
  ) {
    return "wired";
  }
  if (interfaceLabel) return interfaceLabel;
  if (
    wireTypeText === "wifi" ||
    normalizedConnection.includes("band2_4") ||
    normalizedConnection.includes("band5") ||
    normalizedConnection.includes("band6") ||
    normalizedConnection.includes("wifi") ||
    normalizedConnection.includes("wireless") ||
    normalizedConnection.includes("wlan")
  ) {
    return "wifi";
  }
  return connectionText;
};

const titleCase = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter((item) => item.length > 0)
    .map((item) => item[0].toUpperCase() + item.slice(1))
    .join(" ");

const mapDeviceType = (value: unknown) => {
  const text = toJoinedText(value).toLowerCase();
  if (text === "—") return "—";
  if (text === "deco") return "Deco";
  if (text === "client") return "Client";
  return titleCase(text);
};

const mapDeviceStatus = (attrs: Record<string, unknown>) => {
  const internetOnline = attrs.internet_online;
  if (typeof internetOnline === "boolean") return internetOnline ? "Online" : "Offline";
  if (typeof internetOnline === "string") {
    const text = internetOnline.trim().toLowerCase();
    if (text === "true" || text === "online") return "Online";
    if (text === "false" || text === "offline") return "Offline";
  }
  const statusText = toJoinedText(attrs.status);
  return statusText === "—" ? "—" : statusText;
};

const resolveThroughputRaw = (
  attrs: Record<string, unknown>,
  direction: ThroughputDirection,
) => {
  const fields = THROUGHPUT_FIELD_ALIASES[direction];
  const bytesPerSecond = resolveFirstNumber(attrs, fields.bytesPerSecond);
  if (bytesPerSecond !== null) return bytesPerSecond;

  const kiloBytesPerSecond = resolveFirstNumber(attrs, fields.kiloBytesPerSecond);
  return kiloBytesPerSecond === null ? null : kiloBytesPerSecond * 1_000;
};

export const mapTrackerStateToRow = (
  state: HassEntity,
  speedUnit: "MBps" | "Mbps",
  linkRateUnit: LinkRateUnitHint,
): MappedTrackerRow => {
  const attrs = state.attributes as Record<string, unknown>;
  const nameRaw = safeString(attrs.friendly_name ?? state.entity_id);
  const isOnline = STATUS_ONLINE.has(state.state);
  const rawInterface = attrs.interface ?? attrs.client_type ?? attrs.clientType;
  const rawWireType = attrs.wire_type ?? attrs.wireType;
  const normalizedInterface = normalizeInterfaceLabel(rawInterface);
  const normalizedWireType = normalizeWireType(rawWireType);

  const rawConnection = attrs.connection ?? attrs.connection_type ?? attrs.connectionType ?? "—";
  const connectionText = toJoinedText(rawConnection);
  const connection = safeString(
    inferConnectionLabel(normalizedInterface, connectionText, normalizedWireType),
  );
  const inferredBandFromConnection = inferBandLabelFromConnection(connectionText);
  const band = safeString(
    attrs.band ?? attrs.bandwidth ?? attrs.frequency ?? attrs.wifi_band ?? inferredBandFromConnection,
  );
  const bandType = normalizeBand(band);
  const ip = safeString(attrs.ip ?? attrs.ip_address ?? attrs.ipaddr ?? "—");
  const mac = safeString(attrs.mac ?? attrs.mac_address ?? attrs.macaddr ?? "—");
  const hostname = safeString(
    attrs.host_name ??
      attrs.hostname ??
      attrs.host ??
      attrs.name ??
      attrs.deco_device ??
      attrs.device_model ??
      "—",
  );
  const packetsSentValue = toNumber(attrs.packets_sent ?? attrs.up_packet ?? attrs.upPacket);
  const packetsReceivedValue = toNumber(
    attrs.packets_received ?? attrs.down_packet ?? attrs.downPacket,
  );
  const upSpeedRaw = resolveThroughputRaw(attrs, "up");
  const downSpeedRaw = resolveThroughputRaw(attrs, "down");
  const txRateRaw = resolveFirstNumber(attrs, TX_RATE_FIELD_ALIASES);
  const rxRateRaw = resolveFirstNumber(attrs, RX_RATE_FIELD_ALIASES);
  const upSpeedValue = normalizeThroughputMbps(upSpeedRaw);
  const downSpeedValue = normalizeThroughputMbps(downSpeedRaw);
  const txRateValue = normalizeLinkMbps(txRateRaw, bandType, linkRateUnit);
  const rxRateValue = normalizeLinkMbps(rxRateRaw, bandType, linkRateUnit);
  const onlineTimeValue = toNumber(attrs.online_time ?? attrs.uptime ?? attrs.connected_time);
  const trafficDown = toNumber(attrs.traffic_down ?? attrs.trafficDown);
  const trafficUp = toNumber(attrs.traffic_up ?? attrs.trafficUp);
  const trafficUsageValue =
    trafficDown !== null || trafficUp !== null
      ? (trafficDown ?? 0) + (trafficUp ?? 0)
      : toNumber(attrs.traffic_usage ?? attrs.total_traffic ?? attrs.traffic_total);
  const signalValue = resolveFirstNumber(attrs, SIGNAL_FIELD_ALIASES);
  const deviceType = mapDeviceType(attrs.device_type ?? attrs.type);
  const deviceModel = safeString(attrs.device_model ?? attrs.model ?? "—");
  const deviceFirmware = safeString(
    attrs.sw_version ?? attrs.firmware ?? attrs.firmware_version ?? "—",
  );
  const deviceStatus = mapDeviceStatus(attrs);

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
    deviceType,
    deviceModel,
    deviceFirmware,
    deviceStatus,
  };
};
