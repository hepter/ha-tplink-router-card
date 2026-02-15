const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-f:]+$/i;
const MAC_REGEX = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const URL_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LONG_SECRET_REGEX = /^[A-Za-z0-9+/_=-]{24,}$/;
const SENSITIVE_KEY_REGEX =
  /(password|passwd|token|secret|auth|cookie|session|ssid|host|hostname|name|url|ip|mac|email)/i;

export type ExportSanitizeLimits = {
  maxDepth: number;
  maxNodes: number;
  maxArrayLength: number;
  maxObjectKeys: number;
  maxStringLength: number;
};

export type ExportSanitizeStats = {
  visitedNodes: number;
  circularRefs: number;
  depthTruncations: number;
  arrayTruncations: number;
  objectKeyTruncations: number;
  stringTruncations: number;
  maxNodeHits: number;
};

export type RedactionStats = {
  totalMasked: number;
  maskedByKey: number;
  maskedIp: number;
  maskedMac: number;
  maskedUrl: number;
  maskedToken: number;
  maskedEmail: number;
};

export type DiagnosticPackage = {
  schema_version: string;
  generated_at: string;
  limits: ExportSanitizeLimits;
  sanitize_stats: ExportSanitizeStats;
  redaction_stats: RedactionStats;
  masked: unknown;
};

const DEFAULT_LIMITS: ExportSanitizeLimits = {
  maxDepth: 8,
  maxNodes: 30_000,
  maxArrayLength: 4_000,
  maxObjectKeys: 300,
  maxStringLength: 2_000,
};

const defaultSanitizeStats = (): ExportSanitizeStats => ({
  visitedNodes: 0,
  circularRefs: 0,
  depthTruncations: 0,
  arrayTruncations: 0,
  objectKeyTruncations: 0,
  stringTruncations: 0,
  maxNodeHits: 0,
});

const defaultRedactionStats = (): RedactionStats => ({
  totalMasked: 0,
  maskedByKey: 0,
  maskedIp: 0,
  maskedMac: 0,
  maskedUrl: 0,
  maskedToken: 0,
  maskedEmail: 0,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resolveLimits = (limits?: Partial<ExportSanitizeLimits>): ExportSanitizeLimits => ({
  maxDepth: clamp(limits?.maxDepth ?? DEFAULT_LIMITS.maxDepth, 2, 20),
  maxNodes: clamp(limits?.maxNodes ?? DEFAULT_LIMITS.maxNodes, 500, 200_000),
  maxArrayLength: clamp(limits?.maxArrayLength ?? DEFAULT_LIMITS.maxArrayLength, 1, 20_000),
  maxObjectKeys: clamp(limits?.maxObjectKeys ?? DEFAULT_LIMITS.maxObjectKeys, 1, 5_000),
  maxStringLength: clamp(
    limits?.maxStringLength ?? DEFAULT_LIMITS.maxStringLength,
    32,
    100_000,
  ),
});

const truncationMarker = (label: string, extra?: string) =>
  `[truncated:${label}${extra ? `:${extra}` : ""}]`;

export const maskMiddle = (value: string, keepStart = 2, keepEnd = 2) => {
  const text = value.trim();
  if (!text) return text;
  if (text.length <= 2) return `${text.slice(0, 1)}*`;
  if (text.length <= keepStart + keepEnd) return `${text.slice(0, 1)}***${text.slice(-1)}`;
  return `${text.slice(0, keepStart)}***${text.slice(-keepEnd)}`;
};

export const redactIp = (value: string) => {
  const parts = value.split(".");
  if (parts.length !== 4) return maskMiddle(value);
  return `${parts[0]}.xxx.xxx.${parts[3]}`;
};

export const redactMac = (value: string) => {
  const separator = value.includes("-") ? "-" : ":";
  const parts = value.split(/[:-]/);
  if (parts.length !== 6) return maskMiddle(value);
  return `${parts[0]}${separator}**${separator}**${separator}**${separator}**${separator}${parts[5]}`;
};

export const redactUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const host = IPV4_REGEX.test(parsed.hostname)
      ? redactIp(parsed.hostname)
      : maskMiddle(parsed.hostname, 2, 2);
    const query = parsed.search ? "?***" : "";
    const hash = parsed.hash ? "#***" : "";
    return `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}${query}${hash}`;
  } catch {
    return maskMiddle(value);
  }
};

const sanitizeString = (value: string, limits: ExportSanitizeLimits, stats: ExportSanitizeStats) => {
  if (value.length <= limits.maxStringLength) return value;
  stats.stringTruncations += 1;
  return `${value.slice(0, limits.maxStringLength)}${truncationMarker(
    "string",
    String(value.length - limits.maxStringLength),
  )}`;
};

const sanitizePrimitive = (value: unknown): unknown => {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") return `[function:${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return `[symbol:${String(value.description || "")}]`;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  return value;
};

export const sanitizeForExport = (
  value: unknown,
  limitsInput?: Partial<ExportSanitizeLimits>,
): { value: unknown; limits: ExportSanitizeLimits; stats: ExportSanitizeStats } => {
  const limits = resolveLimits(limitsInput);
  const stats = defaultSanitizeStats();
  const visited = new WeakMap<object, string>();

  const walk = (input: unknown, depth: number, path: string): unknown => {
    if (stats.visitedNodes >= limits.maxNodes) {
      stats.maxNodeHits += 1;
      return truncationMarker("max_nodes");
    }

    if (input === null || input === undefined) return input;
    const primitive = sanitizePrimitive(input);
    if (primitive !== input) {
      stats.visitedNodes += 1;
      return primitive;
    }

    if (typeof input === "string") {
      stats.visitedNodes += 1;
      return sanitizeString(input, limits, stats);
    }

    if (typeof input !== "object") {
      stats.visitedNodes += 1;
      return input;
    }

    if (visited.has(input)) {
      stats.visitedNodes += 1;
      stats.circularRefs += 1;
      return `[circular:${visited.get(input) ?? "root"}]`;
    }

    if (depth >= limits.maxDepth) {
      stats.visitedNodes += 1;
      stats.depthTruncations += 1;
      return truncationMarker("depth", path);
    }

    if (input instanceof Date) {
      stats.visitedNodes += 1;
      return Number.isNaN(input.getTime()) ? "[date:invalid]" : input.toISOString();
    }
    if (input instanceof RegExp) {
      stats.visitedNodes += 1;
      return String(input);
    }
    if (input instanceof Error) {
      stats.visitedNodes += 1;
      return {
        name: input.name,
        message: sanitizeString(input.message, limits, stats),
        stack: input.stack ? sanitizeString(input.stack, limits, stats) : undefined,
      };
    }

    visited.set(input, path);

    if (Array.isArray(input)) {
      const limitedLength = Math.min(input.length, limits.maxArrayLength);
      const out: unknown[] = [];
      for (let i = 0; i < limitedLength; i += 1) {
        out.push(walk(input[i], depth + 1, `${path}[${i}]`));
      }
      if (input.length > limitedLength) {
        stats.arrayTruncations += 1;
        out.push(truncationMarker("array", String(input.length - limitedLength)));
      }
      stats.visitedNodes += 1;
      return out;
    }

    if (input instanceof Map) {
      const mapObj: Record<string, unknown> = {};
      const entries = Array.from(input.entries());
      const limited = entries.slice(0, limits.maxObjectKeys);
      limited.forEach(([k, v], idx) => {
        mapObj[String(k)] = walk(v, depth + 1, `${path}.map_${idx}`);
      });
      if (entries.length > limited.length) {
        stats.objectKeyTruncations += 1;
        mapObj.__truncated_entries__ = entries.length - limited.length;
      }
      stats.visitedNodes += 1;
      return mapObj;
    }

    if (input instanceof Set) {
      const values = Array.from(input.values());
      const limited = values.slice(0, limits.maxArrayLength);
      const out = limited.map((v, idx) => walk(v, depth + 1, `${path}.set_${idx}`));
      if (values.length > limited.length) {
        stats.arrayTruncations += 1;
        out.push(truncationMarker("set", String(values.length - limited.length)));
      }
      stats.visitedNodes += 1;
      return out;
    }

    const source = input as Record<string, unknown>;
    const keys = Object.keys(source);
    const limitedKeys = keys.slice(0, limits.maxObjectKeys);
    const out: Record<string, unknown> = {};
    limitedKeys.forEach((key) => {
      out[key] = walk(source[key], depth + 1, `${path}.${key}`);
    });
    if (keys.length > limitedKeys.length) {
      stats.objectKeyTruncations += 1;
      out.__truncated_keys__ = keys.length - limitedKeys.length;
    }
    stats.visitedNodes += 1;
    return out;
  };

  return { value: walk(value, 0, "$"), limits, stats };
};

const bumpMask = (stats: RedactionStats, key: keyof RedactionStats) => {
  stats[key] += 1;
  stats.totalMasked += 1;
};

const redactString = (value: string, key: string | undefined, stats: RedactionStats) => {
  const text = value.trim();
  if (!text) return text;

  if (IPV4_REGEX.test(text)) {
    const masked = redactIp(text);
    if (masked !== text) bumpMask(stats, "maskedIp");
    return masked;
  }
  if (text.includes(":") && IPV6_REGEX.test(text) && text.length > 8) {
    const masked = maskMiddle(text, 4, 4);
    if (masked !== text) bumpMask(stats, "maskedIp");
    return masked;
  }
  if (MAC_REGEX.test(text)) {
    const masked = redactMac(text);
    if (masked !== text) bumpMask(stats, "maskedMac");
    return masked;
  }
  if (URL_REGEX.test(text)) {
    const masked = redactUrl(text);
    if (masked !== text) bumpMask(stats, "maskedUrl");
    return masked;
  }
  if (EMAIL_REGEX.test(text)) {
    const [user, host] = text.split("@");
    const masked = `${maskMiddle(user, 1, 1)}@${maskMiddle(host, 2, 2)}`;
    if (masked !== text) bumpMask(stats, "maskedEmail");
    return masked;
  }
  if (/^bearer\s+/i.test(text)) {
    const token = text.replace(/^bearer\s+/i, "");
    const masked = `Bearer ${maskMiddle(token, 3, 3)}`;
    if (masked !== text) bumpMask(stats, "maskedToken");
    return masked;
  }
  if (JWT_REGEX.test(text) || LONG_SECRET_REGEX.test(text)) {
    const masked = maskMiddle(text, 3, 3);
    if (masked !== text) bumpMask(stats, "maskedToken");
    return masked;
  }
  if (key && SENSITIVE_KEY_REGEX.test(key)) {
    const masked = maskMiddle(text, 2, 2);
    if (masked !== text) bumpMask(stats, "maskedByKey");
    return masked;
  }
  return text;
};

const redactValue = (value: unknown, key: string | undefined, stats: RedactionStats): unknown => {
  if (typeof value === "string") return redactString(value, key, stats);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key, stats));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.entries(source).forEach(([k, v]) => {
      out[k] = redactValue(v, k, stats);
    });
    return out;
  }
  return value;
};

export const redactExportDataWithStats = (value: unknown) => {
  const stats = defaultRedactionStats();
  const redacted = redactValue(value, undefined, stats);
  return { value: redacted, stats };
};

export const redactExportData = <T>(value: T): T => redactExportDataWithStats(value).value as T;

export const buildDiagnosticPackage = (
  value: unknown,
  options?: {
    limits?: Partial<ExportSanitizeLimits>;
  },
): DiagnosticPackage => {
  const sanitized = sanitizeForExport(value, options?.limits);
  const redacted = redactExportDataWithStats(sanitized.value);
  return {
    schema_version: "1",
    generated_at: new Date().toISOString(),
    limits: sanitized.limits,
    sanitize_stats: sanitized.stats,
    redaction_stats: redacted.stats,
    masked: redacted.value,
  };
};
