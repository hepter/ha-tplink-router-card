import { describe, expect, it } from "vitest";
import { localize, localizeLabel } from "./index";
import type { HomeAssistant } from "../core/types";

const hassFor = (language: string): HomeAssistant =>
  ({ states: {}, callWS: async () => undefined as never, language }) as HomeAssistant;

describe("label localization", () => {
  it("translates known adapter labels into the active language", () => {
    const tr = hassFor("tr");
    expect(localizeLabel(tr, "Wired")).toBe("Kablolu");
    expect(localizeLabel(tr, "Heartbeat Missed")).toBe("Sinyal kesildi");
    expect(localizeLabel(tr, "Deco (Satellite)")).toBe("Deco (Uydu)");
    expect(localizeLabel(tr, "Unknown")).toBe("Bilinmiyor");
    expect(localizeLabel(tr, "On")).toBe("Açık");
  });

  it("keeps English for English and passes unknown values through", () => {
    const en = hassFor("en");
    expect(localizeLabel(en, "Wired")).toBe("Wired");
    expect(localizeLabel(en, "Access Point")).toBe("Access Point");
    expect(localizeLabel(en, "—")).toBe("—");
    expect(localizeLabel(en, "SG2210MP")).toBe("SG2210MP");
    expect(localizeLabel(en, undefined)).toBe("—");
  });

  it("is case-insensitive for raw integration values", () => {
    expect(localizeLabel(hassFor("tr"), "wired")).toBe("Kablolu");
    expect(localizeLabel(hassFor("tr"), "HOST")).toBe("Ana ağ");
  });

  it("falls back to English strings for unknown languages", () => {
    expect(localize(hassFor("xx"), "columns.apName")).toBe("Access Point");
  });
});
