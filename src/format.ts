const BYTES_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

export const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
};

export const formatBytes = (value?: number | null, perSecond = false) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let unitIndex = 0;
  let scaled = abs;
  while (scaled >= 1024 && unitIndex < BYTES_UNITS.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = `${scaled.toFixed(decimals)} ${BYTES_UNITS[unitIndex]}`;
  return perSecond ? `${formatted}/s` : formatted;
};

export const formatBits = (value?: number | null, perSecond = false) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const units = ["b", "Kb", "Mb", "Gb", "Tb"] as const;
  const abs = Math.abs(value);
  let unitIndex = 0;
  let scaled = abs;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = `${scaled.toFixed(decimals)} ${units[unitIndex]}`;
  return perSecond ? `${formatted}/s` : formatted;
};

export const normalizeMbps = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return value / 1_000_000; // assume bps
  if (abs >= 1_000) return value / 1_000; // assume Kbps
  return value; // assume already Mbps
};

export const normalizeLinkMbps = (
  value?: number | null,
  band?: "2g" | "5g" | "6g" | "unknown",
) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return value / 1_000_000; // assume bps
  if (abs >= 10_000) return value / 1_000; // assume Kbps
  if (abs >= 5_000 && abs < 10_000 && band && band !== "6g") {
    return value / 1_000; // high but plausible Kbps for 2G/5G/unknown
  }
  return value; // assume already Mbps (link rate often reported as Mbps)
};

export const formatDuration = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const daysTotal = Math.floor(total / 86400);
  const months = Math.floor(daysTotal / 30);
  const days = daysTotal % 30;
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const monthPart = months > 0 ? `${months}mo ` : "";
  const dayPart = days > 0 ? `${days}d ` : "";
  const pad = (v: number) => v.toString().padStart(2, "0");
  return `${monthPart}${dayPart}${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
};

export const formatTrafficUsage = (
  value?: number | null,
  unit: "auto" | "bytes" | "seconds" = "auto",
) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "seconds") return formatDuration(value);
  if (unit === "bytes") return formatBytes(value);
  // auto heuristic: treat very large values as bytes
  if (value >= 10_000_000) return formatBytes(value);
  return formatDuration(value);
};

export const formatRate = (
  value?: number | null,
  unit: "bytes" | "bits" = "bytes",
) => {
  if (unit === "bits") return formatBits(value, true);
  return formatBytes(value, true);
};

export const formatMbps = (value?: number | null) => {
  const mbps = normalizeMbps(value);
  if (mbps === null) return "—";
  const decimals = mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2;
  return `${mbps.toFixed(decimals)} Mbps`;
};

export const formatLinkSpeed = (
  value?: number | null,
  band?: "2g" | "5g" | "6g" | "unknown",
) => {
  const mbps = normalizeLinkMbps(value, band);
  if (mbps === null) return "—";
  const decimals = mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2;
  return `${mbps.toFixed(decimals)} Mbps`;
};

export const formatSpeed = (value?: number | null, unit: "MBps" | "Mbps" = "MBps") => {
  const mbps = normalizeMbps(value);
  if (mbps === null) return "—";
  const raw = unit === "MBps" ? mbps / 8 : mbps;
  if (unit === "MBps" && raw >= 1000) {
    const gb = raw / 1000;
    const decimals = gb >= 100 ? 0 : gb >= 10 ? 1 : 2;
    return `${gb.toFixed(decimals)} GB/s`;
  }
  if (unit === "Mbps" && raw >= 1000) {
    const gbps = raw / 1000;
    const decimals = gbps >= 100 ? 0 : gbps >= 10 ? 1 : 2;
    return `${gbps.toFixed(decimals)} Gbps`;
  }
  const decimals = raw >= 100 ? 0 : raw >= 10 ? 1 : 2;
  return unit === "MBps" ? `${raw.toFixed(decimals)} MB/s` : `${raw.toFixed(decimals)} Mbps`;
};

export const safeString = (value: unknown) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim().length === 0) return "—";
  return String(value);
};
