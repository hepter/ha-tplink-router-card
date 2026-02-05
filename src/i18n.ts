import type { HomeAssistant } from "./types";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

type Translations = Record<string, string | Translations>;

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
