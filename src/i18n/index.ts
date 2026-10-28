import type { HomeAssistant } from "../core/types";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

interface Translations {
  [key: string]: string | Translations;
}

const translations: Record<string, Translations> = {
  en: en as Translations,
  tr: tr as Translations,
};

const resolveLanguage = (hass?: HomeAssistant) => {
  const raw = (hass?.locale?.language || hass?.language || "en").toLowerCase();
  if (translations[raw]) return raw;
  const short = raw.split("-")[0];
  if (translations[short]) return short;
  return "en";
};

const getValue = (dictionary: Translations, key: string): string | null => {
  const parts = key.split(".");
  let cursor: Translations | string | undefined = dictionary;
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null) return null;
    cursor = cursor[part];
    if (cursor === undefined) return null;
  }
  return typeof cursor === "string" ? cursor : null;
};

export const localize = (
  hass: HomeAssistant | undefined,
  key: string,
  vars?: Record<string, string | number>,
) => {
  const lang = resolveLanguage(hass);
  let value = getValue(translations[lang], key) ?? getValue(translations.en, key) ?? key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    });
  }
  return value;
};

// Adapters emit stable English labels; the card translates the known ones at render time.
const LABEL_KEYS: Record<string, string> = {
  wifi: "wifi",
  wired: "wired",
  guest: "guest",
  iot: "iot",
  host: "host",
  gateway: "gateway",
  switch: "switch",
  "access point": "accessPoint",
  controller: "controller",
  online: "online",
  offline: "offline",
  unknown: "unknown",
  connected: "connected",
  disconnected: "disconnected",
  pending: "pending",
  "heartbeat missed": "heartbeatMissed",
  isolated: "isolated",
  provisioning: "provisioning",
  configuring: "configuring",
  upgrading: "upgrading",
  rebooting: "rebooting",
  adopting: "adopting",
  "adopt failed": "adoptFailed",
  "managed externally": "managedExternally",
  deco: "deco",
  "deco (master)": "decoMaster",
  "deco (satellite)": "decoSatellite",
  "main router": "mainRouter",
  satellite: "satellite",
  client: "client",
  on: "on",
  off: "off",
};

export const localizeLabel = (hass: HomeAssistant | undefined, value: string | undefined | null) => {
  if (value === null || value === undefined) return "—";
  const key = LABEL_KEYS[value.trim().toLowerCase()];
  return key ? localize(hass, `labels.${key}`) : value;
};
