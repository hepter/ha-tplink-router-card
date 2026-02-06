import "./card";

const VERSION =
  import.meta.env.VITE_CARD_VERSION ??
  "dev";

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tplink-router-card",
  name: "TP-Link Router Devices",
  description: "List TP-Link router clients with live stats",
  preview: true,
});

console.info(`TPLINK-ROUTER-CARD ${VERSION} loaded`);
