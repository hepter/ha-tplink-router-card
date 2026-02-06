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

  .band-pill.band-unknown {
    color: var(--secondary-text-color);
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.1);
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
  }
`;
