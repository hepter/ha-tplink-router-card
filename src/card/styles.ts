import { css } from "lit";

export const cardStyles = css`
  :host {
    display: block;
  }

  ha-card {
    padding: 0;
    overflow: hidden;
    border-radius: 16px;
  }

  .header {
    padding: 16px 18px 12px;
    background: linear-gradient(135deg, rgba(30, 60, 90, 0.28), rgba(0, 0, 0, 0));
    border-bottom: 1px solid var(--divider-color);
  }

  .header.hidden {
    display: none;
  }

  .title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .title h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .title-main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .title-main h2 {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title-export-button {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--secondary-text-color);
    padding: 0;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .title-export-button:hover {
    color: var(--primary-color);
    background: rgba(127, 127, 127, 0.12);
  }

  .title-export-button ha-icon {
    --mdc-icon-size: 14px;
  }

  .subtitle {
    margin-top: 4px;
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  .router-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 6px;
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  .router-left {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .router-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .router-link {
    color: var(--primary-color);
    text-decoration: none;
  }

  .router-link:hover {
    text-decoration: underline;
  }

  .router-right {
    white-space: nowrap;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
    align-items: center;
  }

  .control-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .search {
    flex: 1 1 200px;
  }

  input[type="search"] {
    width: 100%;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    padding: 8px 10px;
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font-size: 13px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgb(127 127 127 / 12%);
    font-size: 12px;
    color: var(--secondary-text-color);
  }

  .chip.stat ha-icon {
    --mdc-icon-size: 22px;
  }

  .chip.compact {
    padding: 2px 8px;
    font-size: 11px;
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .action-device-select {
    min-width: 140px;
    max-width: 220px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    color: var(--primary-text-color);
    padding: 0 8px;
    font-size: 12px;
  }

  .action-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .icon-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    color: var(--secondary-text-color);
    cursor: pointer;
    padding: 2px;
    overflow: hidden;
  }

  .icon-toggle ha-icon {
    --mdc-icon-size: 20px;
  }

  .icon-toggle::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--hold-progress, 0) * 100%);
    background: rgba(60, 180, 90, 0.25);
    transition: height 0.06s linear;
    pointer-events: none;
  }

  .icon-toggle.completed::after {
    background: rgba(60, 180, 90, 0.4);
    animation: holdComplete 0.8s ease-out forwards;
  }

  @keyframes holdComplete {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  .icon-toggle[data-state="on"] {
    color: var(--primary-color);
    border-color: rgba(0, 0, 0, 0.2);
    background: rgba(0, 0, 0, 0.08);
  }

  .icon-toggle:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon-toggle[data-kind="guest"] {
    border-color: rgba(255, 175, 0, 0.4);
  }

  .icon-toggle[data-kind="iot"] {
    border-color: rgba(0, 170, 255, 0.4);
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: nowrap;
  }

  .icon-toggle.row-action {
    width: 28px;
    height: 28px;
    padding: 2px;
  }

  .icon-toggle.row-action ha-icon {
    --mdc-icon-size: 20px;
  }

  td.actions-cell {
    padding: 2px 10px;
  }

  .band-badge {
    position: absolute;
    bottom: 0px;
    right: -2px;
    background: var(--card-background-color);
    border: none;
    border-radius: 8px;
    font-size: 9px;
    padding: 0 4px;
    color: var(--secondary-text-color);
  }

  .icon-button {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    color: var(--secondary-text-color);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }

  .icon-button.mini {
    width: 20px;
    height: 20px;
    border-radius: 6px;
  }


  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--divider-color);
    align-items: center;
    font-size: 12px;
  }

  .filter-row.hidden {
    display: none;
  }

  .filter-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 2px;
    border-radius: 999px;
    border: 1px solid var(--divider-color);
    background: rgba(0, 0, 0, 0.02);
  }

  .filter-button {
    border: none;
    background: transparent;
    color: var(--secondary-text-color);
    font-size: 11px;
    padding: 8px 8px;
    border-radius: 999px;
    cursor: pointer;
  }

  .filter-button.icon {
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .filter-button.icon ha-icon {
    --mdc-icon-size: 22px;
  }

  .filter-button.active {
    background: var(--primary-color);
    color: var(--text-primary-color, white);
  }

  .table-wrapper {
    overflow: auto;
    max-height: 70vh;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--card-background-color);
    box-shadow: 0 1px 0 var(--divider-color);
  }

  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--divider-color);
    white-space: nowrap;
  }

  .shift-mode.shift-underline-enabled td.shift-entity-clickable {
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
    text-decoration-color: color-mix(in srgb, currentColor 28%, transparent);
  }

  .shift-mode.shift-underline-enabled td.shift-entity-clickable .speed-value,
  .shift-mode.shift-underline-enabled td.shift-entity-clickable .rate,
  .shift-mode.shift-underline-enabled td.shift-entity-clickable .signal {
    text-decoration: inherit;
    text-decoration-color: inherit;
    text-decoration-thickness: inherit;
    text-underline-offset: inherit;
  }

  .sort-button {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .sort-indicator {
    font-size: 10px;
    color: var(--secondary-text-color);
  }

  .sort-order {
    font-size: 9px;
    color: var(--secondary-text-color);
  }

  tbody tr:nth-child(odd) {
    background: rgba(0, 0, 0, 0.02);
  }

  tbody tr:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .signal {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }

  .signal-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .band-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 11px;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .band-pill ha-icon {
    --mdc-icon-size: 14px;
  }

  .band-pill.band-2g {
    color: #0ea5e9;
    background: rgba(14, 165, 233, 0.15);
    border-color: rgba(14, 165, 233, 0.35);
  }

  .band-pill.band-5g {
    color: #22c55e;
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.35);
  }

  .band-pill.band-6g {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.18);
    border-color: rgba(245, 158, 11, 0.35);
  }

  .band-pill.band-wired {
    color: #8b5cf6;
    background: rgba(139, 92, 246, 0.18);
    border-color: rgba(139, 92, 246, 0.35);
  }

  .band-pill.band-unknown {
    color: var(--secondary-text-color);
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .band-pill.band-wifi {
    color: #0ea5e9;
    background: rgba(14, 165, 233, 0.15);
    border-color: rgba(14, 165, 233, 0.35);
  }

  .rate {
    font-weight: 600;
  }

  .rate--na {
    color: var(--secondary-text-color);
  }

  .rate--bad {
    color: var(--rate-bad);
  }

  .rate--poor {
    color: var(--rate-poor);
  }

  .rate--fair {
    color: var(--rate-fair);
  }

  .rate--good {
    color: var(--rate-good);
  }

  .rate--great {
    color: var(--rate-great);
  }

  .rate--excellent {
    color: var(--rate-excellent);
  }

  .rate--ultra {
    color: var(--rate-ultra);
  }

  .speed-value {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .speed-tooltip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 6px);
    transform: translateX(-50%) translateY(3px);
    min-width: 160px;
    border-radius: 8px;
    padding: 8px 9px;
    background: rgba(15, 23, 42, 0.96);
    color: #e2e8f0;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    font-size: 11px;
    line-height: 1.25;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.14s ease, transform 0.14s ease;
    z-index: 6;
  }

  .speed-value:hover .speed-tooltip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .speed-tooltip.speed-tooltip--portal {
    position: fixed;
    left: 0;
    top: 0;
    bottom: auto;
    opacity: 0;
    transform: translate(-50%, -96%);
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 1000;
  }

  .speed-tooltip.speed-tooltip--portal.speed-tooltip--visible {
    opacity: 1;
    transform: translate(-50%, -100%);
  }

  .speed-tooltip-bar-track {
    position: relative;
    display: block;
    height: 3px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.35);
    overflow: hidden;
    margin-bottom: 7px;
  }

  .speed-tooltip-bar-fill {
    position: absolute;
    inset: 0;
    width: 100%;
    border-radius: 999px;
    clip-path: inset(0 calc(100% - var(--fill, 0%)) 0 0 round 999px);
    background: linear-gradient(
      90deg,
      #38bdf8 0%,
      #38bdf8 55%,
      #f97316 82%,
      #ef4444 100%
    );
  }

  .speed-tooltip-line {
    display: block;
    margin-top: 2px;
  }

  .ud-rate--bad {
    color: var(--ud-rate-bad);
  }

  .ud-rate--poor {
    color: var(--ud-rate-poor);
  }

  .ud-rate--fair {
    color: var(--ud-rate-fair);
  }

  .ud-rate--good {
    color: var(--ud-rate-good);
  }

  .ud-rate--great {
    color: var(--ud-rate-great);
  }

  .ud-rate--excellent {
    color: var(--ud-rate-excellent);
  }

  .ud-rate--ultra {
    color: var(--ud-rate-ultra);
  }

  .muted {
    color: var(--secondary-text-color);
  }

  .link {
    border: none;
    background: transparent;
    color: var(--primary-color);
    padding: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .name-text {
    color: var(--primary-text-color);
  }

  .name-cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .name-device-link {
    border: none;
    background: transparent;
    color: var(--secondary-text-color);
    padding: 0;
    margin: 0;
    width: 14px;
    height: 14px;
    min-width: 14px;
    min-height: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.5;
  }

  .name-device-link ha-icon {
    --mdc-icon-size: 14px;
  }

  .name-device-link:hover {
    color: var(--primary-color);
    opacity: 1;
  }

  .empty {
    padding: 16px 18px 20px;
    color: var(--secondary-text-color);
  }

  :host {
    --signal-bad: #d64545;
    --signal-poor: #f08c2e;
    --signal-fair: #e0c341;
    --signal-good: #7bc46d;
    --signal-excellent: #3aa45b;
    --rate-bad: #d64545;
    --rate-poor: #f08c2e;
    --rate-fair: #e0c341;
    --rate-good: #7bc46d;
    --rate-great: #14b8a6;
    --rate-excellent: #3b82f6;
    --rate-ultra: #6366f1;
    --ud-rate-bad: #94a3b8;
    --ud-rate-poor: #60a5fa;
    --ud-rate-fair: #38bdf8;
    --ud-rate-good: #22d3ee;
    --ud-rate-great: #f59e0b;
    --ud-rate-excellent: #f97316;
    --ud-rate-ultra: #ef4444;
  }
`;
