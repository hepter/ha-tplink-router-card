import {
  formatBytes,
  formatDuration,
  formatLinkSpeed,
  formatNumber,
  normalizeLinkMbps,
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

const isDeviceTrackerEntity = (state: HassEntity) =>
  state.entity_id.startsWith("device_tracker.");

const toText = (value: unknown) => String(value ?? "").trim();

const isOmadaTracker = (state: HassEntity) => {
  if (!isDeviceTrackerEntity(state)) return false;
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
  const switchLinked =
    attrs.switch_port !== undefined ||
    attrs.switchPort !== undefined ||
    attrs.standard_port !== undefined ||
    attrs.switch_name !== undefined ||
    attrs.switchName !== undefined ||
    attrs.switch_mac !== undefined ||
    attrs.switchMac !== undefined;
  const apLinked =
    attrs.ap_name !== undefined ||
    attrs.apName !== undefined ||
    attrs.ap_mac !== undefined ||
    attrs.apMac !== undefined ||
    attrs.ssid !== undefined;
  const connectionText = [
    attrs.connection,
    attrs.connect_type,
    attrs.connectType,
    attrs.connect_dev_type,
    attrs.connectDevType,
    attrs.network_name,
    attrs.networkName,
  ]
    .map((value) => toText(value).toLowerCase())
    .join(" ");
  const deviceTypeText = toText(attrs.type).toLowerCase();

  if (guest) return { label: "Guest", type: "guest" };
  if (wireless) return { label: "WiFi", type: "wifi" };
  if (switchLinked) return { label: "Wired", type: "wired" };
  if (apLinked) return { label: "WiFi", type: "wifi" };
  if (attrs.wireless === false || String(attrs.wireless).toLowerCase() === "false") {
    return { label: "Wired", type: "wired" };
  }
  if (
    connectionText.includes("wired") ||
    connectionText.includes("ethernet") ||
    connectionText.includes("lan") ||
    connectionText.includes("switch") ||
    connectionText.includes("gateway")
  ) {
    return { label: "Wired", type: "wired" };
  }
  if (
    connectionText.includes("wifi") ||
    connectionText.includes("wireless") ||
    connectionText.includes("wlan") ||
    connectionText.includes("ap")
  ) {
    return { label: "WiFi", type: "wifi" };
  }
  if (deviceTypeText === "gateway") return { label: "Gateway", type: "unknown" };
  if (deviceTypeText === "switch") return { label: "Switch", type: "unknown" };
  if (deviceTypeText === "ap") return { label: "Access Point", type: "unknown" };
  if (attrs.ip !== undefined || attrs.ip_address !== undefined || attrs.mac !== undefined) {
    return { label: "Wired", type: "wired" };
  }
  return { label: safeString(attrs.connection ?? attrs.type ?? "—"), type: "unknown" };
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

const resolveLinkRateRaw = (
  attrs: Record<string, unknown>,
  aliases: string[],
): number | null => {
  for (const key of aliases) {
    const value = toNumber(attrs[key]);
    if (value !== null) return value;
  }
  return null;
};

const mapSensorMetric = (state: HassEntity, target: OmadaClientMetrics) => {
  const id = state.entity_id.toLowerCase();
  const name = String((state.attributes as Record<string, unknown>).friendly_name ?? "")
    .toLowerCase()
    .trim();
  const text = `${id} ${name}`;

  if (text.includes("downloaded") || /\bdownload\b/.test(text)) {
    target.downloadedMB = toNumber(state.state);
    return;
  }
  if (text.includes("uploaded") || /\bupload\b/.test(text)) {
    target.uploadedMB = toNumber(state.state);
    return;
  }
  if (
    text.includes("rx_activity") ||
    text.includes("rx activity") ||
    (/\brx\b/.test(text) && !text.includes("utilization"))
  ) {
    target.rxActivityMBps = toNumber(state.state);
    return;
  }
  if (
    text.includes("tx_activity") ||
    text.includes("tx activity") ||
    (/\btx\b/.test(text) && !text.includes("utilization"))
  ) {
    target.txActivityMBps = toNumber(state.state);
    return;
  }
  if (text.includes("rssi") || text.includes("signal")) {
    target.rssi = toNumber(state.state);
    return;
  }
  if (text.includes("uptime") || text.includes("duration") || text.includes("connected")) {
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

  if (!entryId) return allOmadaTrackers;
  if (!registryFailed && entityRegistry.length === 0) return [];
  if (registryFailed || entityRegistry.length === 0) return allOmadaTrackers;

  const registryTrackersForEntry = entityRegistry
    .filter((entry) => entry.config_entry_id === entryId)
    .filter((entry) => entry.entity_id.startsWith("device_tracker."));

  const selected = registryTrackersForEntry
    .map((entry) => allStates[entry.entity_id])
    .filter((state): state is HassEntity => state !== undefined)
    .filter((state) => isDeviceTrackerEntity(state));

  if (selected.length > 0) return selected;

  const byEntityId = new Map(entityRegistry.map((entry) => [entry.entity_id, entry.config_entry_id]));
  const matchedByRegistry = allOmadaTrackers.filter(
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
    const trackerByDevice = allOmadaTrackers.filter((state) => {
      const deviceId = trackerDeviceByEntity.get(state.entity_id);
      return deviceId ? entryDeviceIds.has(deviceId) : false;
    });
    if (trackerByDevice.length > 0) return trackerByDevice;
  }

  return [];
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
  const mac = safeString(attrs.mac ?? attrs.mac_address ?? attrs.client_mac ?? "—");
  const hostname = safeString(
    attrs.host_name ?? attrs.hostname ?? attrs.hostName ?? attrs.name ?? attrs.model ?? "—",
  );

  const packetsSentValue = toNumber(attrs.packets_sent ?? attrs.up_packet ?? attrs.upPacket);
  const packetsReceivedValue = toNumber(
    attrs.packets_received ?? attrs.down_packet ?? attrs.downPacket,
  );

  const upMBps = metrics?.txActivityMBps ?? null;
  const downMBps = metrics?.rxActivityMBps ?? null;
  const upSpeedValue = upMBps !== null ? upMBps * 8 : null;
  const downSpeedValue = downMBps !== null ? downMBps * 8 : null;

  const txRateRaw = resolveLinkRateRaw(attrs, [
    "tx_rate",
    "txRate",
    "link_tx_rate",
    "linkTxRate",
    "tx_link_speed",
    "txLinkSpeed",
  ]);
  const rxRateRaw = resolveLinkRateRaw(attrs, [
    "rx_rate",
    "rxRate",
    "link_rx_rate",
    "linkRxRate",
    "rx_link_speed",
    "rxLinkSpeed",
  ]);
  const txRateValue = normalizeLinkMbps(txRateRaw, bandType, "auto");
  const rxRateValue = normalizeLinkMbps(rxRateRaw, bandType, "auto");

  const downloadedMB = metrics?.downloadedMB ?? null;
  const uploadedMB = metrics?.uploadedMB ?? null;
  const trafficDownBytes = toNumber(attrs.traffic_down ?? attrs.trafficDown);
  const trafficUpBytes = toNumber(attrs.traffic_up ?? attrs.trafficUp);
  const fallbackTraffic = toNumber(attrs.traffic_usage);
  const totalTrafficMB =
    downloadedMB !== null || uploadedMB !== null ? (downloadedMB ?? 0) + (uploadedMB ?? 0) : null;
  const trafficUsageValue =
    totalTrafficMB !== null
      ? totalTrafficMB * 1024 * 1024
      : trafficDownBytes !== null || trafficUpBytes !== null
        ? (trafficDownBytes ?? 0) + (trafficUpBytes ?? 0)
        : fallbackTraffic;

  const onlineTimeValue =
    metrics?.uptimeSeconds ??
    parseUptimeSeconds(attrs.uptime ?? attrs.online_time ?? attrs.connected_since) ??
    null;
  const signalValue = toNumber(attrs.rssi ?? attrs.signal) ?? metrics?.rssi ?? null;
  const deviceTypeRaw = toText(attrs.type);
  const deviceType =
    deviceTypeRaw.toLowerCase() === "ap"
      ? "Access Point"
      : deviceTypeRaw.toLowerCase() === "gateway"
        ? "Gateway"
        : deviceTypeRaw.toLowerCase() === "switch"
          ? "Switch"
          : safeString(attrs.connect_dev_type ?? attrs.connectDevType ?? "—");
  const deviceModel = safeString(attrs.model ?? attrs.device_model ?? "—");
  const deviceFirmware = safeString(attrs.firmware ?? attrs.firmware_version ?? "—");
  const deviceStatus = safeString(attrs.status ?? attrs.status_category ?? "—");

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
    txRate: formatLinkSpeed(txRateRaw, bandType, "auto"),
    txRateValue,
    rxRate: formatLinkSpeed(rxRateRaw, bandType, "auto"),
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
