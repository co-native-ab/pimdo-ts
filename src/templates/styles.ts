// Shared CSS and HTML utilities for browser-facing pages.
// All CSS is built from design tokens — see ADR-0002.

import {
  purple,
  grey,
  complementary,
  dark,
  fontFamily,
  fontFamilyMono,
  fontWeight,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from "./tokens.js";

// ---------------------------------------------------------------------------
// Base stylesheet (shared by all served pages)
// ---------------------------------------------------------------------------

export const BASE_STYLE = `
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }
    body {
      font-family: ${fontFamily};
      background: linear-gradient(160deg, ${purple.minus3} 0%, ${grey.grey1} 100%);
      color: ${grey.grey4};
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 40px 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .card {
      background: ${grey.white};
      border-radius: 16px;
      padding: 48px 40px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
      animation: slideUp 0.4s ease-out;
    }
    .brand-footer {
      display: block;
      height: 12px;
      margin: ${spacing.xxl} auto 0;
      opacity: 0.18;
      animation: slideUp 0.4s ease-out 0.1s both;
    }
    h1 {
      font-size: 1.4rem;
      font-weight: ${fontWeight.bold};
      color: ${purple.plus2};
      margin-bottom: ${spacing.sm};
    }
    .subtitle {
      color: ${grey.grey4};
      font-size: ${fontSize.base};
      line-height: 1.6;
      margin-bottom: ${spacing.xxl};
    }
    .message {
      color: ${grey.grey4};
      font-size: ${fontSize.base};
      line-height: 1.6;
    }
    .countdown {
      color: ${grey.grey3};
      margin-top: ${spacing.xl};
      font-size: ${fontSize.sm};
    }
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: ${spacing.md};
      width: 100%;
    }
    .cancel-btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: transparent;
      cursor: pointer;
      color: ${grey.grey4};
      border: 1.5px solid ${grey.grey1};
      border-radius: ${borderRadius.lg};
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      font-weight: ${fontWeight.regular};
      transition: all 0.2s ease;
    }
    .cancel-btn:hover {
      background: ${grey.grey1};
      border-color: ${grey.grey2};
    }
    .cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (prefers-color-scheme: dark) {
      body {
        background: linear-gradient(160deg, ${dark.bg1} 0%, ${dark.bg2} 100%);
        color: ${dark.text};
      }
      .card {
        background: ${dark.surface};
        box-shadow: ${dark.cardShadow};
      }
      h1 { color: ${dark.heading}; }
      .subtitle, .message { color: ${dark.text}; }
      .countdown { color: ${dark.textMuted}; }
      .brand-footer { opacity: 0.3; }
      .cancel-btn {
        color: ${dark.text};
        border-color: ${dark.border};
      }
      .cancel-btn:hover {
        background: ${dark.surfaceHover};
        border-color: ${dark.borderHover};
      }
    }`;

// ---------------------------------------------------------------------------
// Login-specific styles
// ---------------------------------------------------------------------------

export const LOGIN_STYLE = `
    .sign-in-btn {
      display: block;
      width: 100%;
      padding: 16px;
      background: ${purple.brand};
      cursor: pointer;
      color: ${grey.white};
      border: none;
      border-radius: ${borderRadius.lg};
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      font-weight: ${fontWeight.semibold};
      text-decoration: none;
      text-align: center;
      transition: all 0.2s ease;
    }
    .sign-in-btn:hover {
      background: ${purple.plus1};
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(102, 89, 167, 0.3);
    }
    .sign-in-btn:active {
      background: ${purple.plus2};
      transform: translateY(0);
    }
    @media (prefers-color-scheme: dark) {
      .sign-in-btn:hover {
        box-shadow: 0 6px 20px rgba(102, 89, 167, 0.4);
      }
    }`;

export const SUCCESS_STYLE = `
    .checkmark {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${complementary.teal.light};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto ${spacing.xl};
      font-size: 1.5rem;
      color: ${complementary.teal.base};
    }
    h1.success { color: ${complementary.teal.base}; }
    #manual-close {
      margin-top: ${spacing.lg};
      color: ${grey.grey4};
      font-size: ${fontSize.base};
    }
    @media (prefers-color-scheme: dark) {
      .checkmark { background: rgba(170, 189, 181, 0.15); }
      #manual-close { color: ${dark.text}; }
    }`;

export const ERROR_STYLE = `
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${complementary.peach.light};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto ${spacing.xl};
      font-size: 1.5rem;
      color: ${complementary.peach.base};
    }
    h1.error { color: ${complementary.peach.base}; }
    .error-detail {
      margin-top: ${spacing.xl};
      padding: ${spacing.lg};
      background: ${complementary.peach.light};
      border-left: 3px solid ${complementary.peach.base};
      border-radius: ${borderRadius.md};
      font-size: ${fontSize.sm};
      color: ${complementary.peach.base};
      text-align: left;
      word-break: break-word;
    }
    @media (prefers-color-scheme: dark) {
      .icon { background: rgba(249, 170, 143, 0.12); }
      .error-detail {
        background: rgba(249, 170, 143, 0.08);
        border-left-color: ${complementary.peach.base};
      }
    }`;

export const LOGOUT_CONFIRM_STYLE = `
    .sign-out-btn {
      display: block;
      width: 100%;
      padding: 16px;
      background: ${complementary.peach.base};
      cursor: pointer;
      color: ${grey.white};
      border: none;
      border-radius: ${borderRadius.lg};
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      font-weight: ${fontWeight.semibold};
      transition: all 0.2s ease;
    }
    .sign-out-btn:hover {
      background: ${complementary.peach.hover};
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(249, 170, 143, 0.3);
    }
    .sign-out-btn:active { transform: translateY(0); }
    .sign-out-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    @media (prefers-color-scheme: dark) {
      .sign-out-btn:hover {
        box-shadow: 0 6px 20px rgba(249, 170, 143, 0.4);
      }
    }`;

// ---------------------------------------------------------------------------
// Picker-specific styles
// ---------------------------------------------------------------------------

export const PICKER_STYLE = `
    .container { max-width: 440px; }
    .card { text-align: left; }
    .card h1 { text-align: center; }
    .subtitle { text-align: center; }
    .option-btn {
      display: block;
      width: 100%;
      padding: 16px 18px;
      margin-bottom: ${spacing.sm};
      background: ${grey.white};
      border: 1.5px solid ${grey.grey2};
      border-radius: ${borderRadius.lg};
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      cursor: pointer;
      text-align: left;
      transition: all 0.2s ease;
    }
    .option-btn:hover {
      border-color: ${purple.brand};
      background: ${purple.minus3};
      transform: translateY(-1px);
      box-shadow: ${shadow.hoverLight};
    }
    .option-btn:active { transform: translateY(0); background: ${purple.minus3}; }
    .option-btn.selected {
      border-color: ${purple.brand};
      background: ${purple.minus3};
      pointer-events: none;
    }
    .option-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .done { text-align: center; }
    .done h1 { color: ${complementary.teal.base}; }
    .done .message { margin-bottom: 0; }
    .error { color: ${complementary.peach.base}; margin-top: ${spacing.lg}; text-align: center; }
    #manual-close {
      margin-top: ${spacing.lg};
      color: ${grey.grey4};
      font-size: ${fontSize.base};
    }
    @media (prefers-color-scheme: dark) {
      .option-btn {
        background: ${dark.surface};
        border-color: ${dark.border};
        color: ${dark.text};
      }
      .option-btn:hover {
        border-color: ${purple.brand};
        background: ${dark.surfaceHover};
      }
      .option-btn:active { background: ${dark.surfaceHover}; }
      .option-btn.selected {
        border-color: ${purple.brand};
        background: ${dark.surfaceHover};
      }
      #manual-close { color: ${dark.text}; }
    }
    .toolbar {
      display: flex;
      gap: ${spacing.sm};
      align-items: center;
      margin-bottom: ${spacing.sm};
    }
    .filter-input {
      flex: 1;
      padding: 10px 12px;
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      border: 1.5px solid ${grey.grey2};
      border-radius: ${borderRadius.md};
      background: ${grey.white};
      color: inherit;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .filter-input:focus { border-color: ${purple.brand}; }
    .refresh-btn {
      padding: 10px 14px;
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      background: ${grey.white};
      border: 1.5px solid ${grey.grey2};
      border-radius: ${borderRadius.md};
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .refresh-btn:hover { border-color: ${purple.brand}; background: ${purple.minus3}; }
    .refresh-btn:disabled { opacity: 0.5; cursor: wait; }
    .no-match {
      text-align: center;
      color: ${grey.grey4};
      padding: 12px 0;
      font-size: ${fontSize.base};
    }
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: ${spacing.sm};
      margin-top: ${spacing.sm};
      padding-top: ${spacing.sm};
      border-top: 1px solid ${grey.grey2};
    }
    .page-btn {
      padding: 6px 12px;
      background: ${purple.minus3};
      border: 1px solid ${grey.grey2};
      border-radius: ${borderRadius.md};
      color: ${purple.brand};
      font-size: ${fontSize.sm};
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .page-btn:hover:not(:disabled) { border-color: ${purple.brand}; background: ${purple.minus3}; }
    .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .page-status {
      color: ${grey.grey4};
      font-size: ${fontSize.sm};
      min-width: 140px;
      text-align: center;
    }
    .create-link-box {
      margin-top: ${spacing.md};
      padding: ${spacing.sm} 12px;
      border: 1px dashed ${grey.grey2};
      border-radius: ${borderRadius.md};
      font-size: ${fontSize.base};
      color: ${grey.grey4};
    }
    .create-link-box a {
      color: ${purple.brand};
      text-decoration: none;
      font-weight: 600;
    }
    .create-link-box a:hover { text-decoration: underline; }
    .create-link-desc { margin: 4px 0 0; color: ${grey.grey4}; }
    @media (prefers-color-scheme: dark) {
      .filter-input, .refresh-btn {
        background: ${dark.surface};
        border-color: ${dark.border};
        color: ${dark.text};
      }
      .filter-input:focus, .refresh-btn:hover { border-color: ${purple.brand}; }
      .refresh-btn:hover { background: ${dark.surfaceHover}; }
      .no-match, .create-link-desc { color: ${dark.text}; }
      .create-link-box { border-color: ${dark.border}; color: ${dark.text}; }
      .pagination { border-top-color: ${dark.border}; }
      .page-btn { background: ${dark.surface}; border-color: ${dark.border}; color: ${dark.text}; }
      .page-btn:hover:not(:disabled) { border-color: ${purple.brand}; background: ${dark.surfaceHover}; }
      .page-status { color: ${dark.text}; }
    }`;

// ---------------------------------------------------------------------------
// Navigator-specific styles (workspace folder picker)
// ---------------------------------------------------------------------------

export const NAVIGATOR_STYLE = `
    .container { max-width: 480px; }
    .card { text-align: left; }
    .card h1 { text-align: center; }
    .subtitle { text-align: center; }

    .drive-label {
      display: block;
      font-size: ${fontSize.xs};
      font-weight: ${fontWeight.semibold};
      color: ${grey.grey3};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: ${spacing.sm};
      text-align: center;
    }

    .breadcrumbs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px;
      justify-content: center;
      margin-bottom: ${spacing.md};
      font-size: ${fontSize.base};
      color: ${grey.grey4};
      min-height: 28px;
    }
    .crumb-btn {
      background: none;
      border: none;
      padding: 4px 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      color: ${purple.brand};
      border-radius: ${borderRadius.sm};
      transition: background 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .crumb-btn:hover { background: ${purple.minus3}; }
    .crumb-current {
      padding: 4px 8px;
      font-weight: ${fontWeight.semibold};
      color: ${grey.grey4};
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .crumb-sep {
      color: ${grey.grey3};
      user-select: none;
      font-size: ${fontSize.md};
      line-height: 1;
    }
    .crumb-icon {
      width: 14px;
      height: 14px;
      display: inline-block;
      vertical-align: -2px;
    }

    .nav-toolbar {
      display: flex;
      gap: ${spacing.sm};
      align-items: center;
      margin-bottom: ${spacing.sm};
    }

    .filter-input {
      flex: 1;
      min-width: 0;
      padding: 10px 12px;
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      border: 1.5px solid ${grey.grey2};
      border-radius: ${borderRadius.md};
      background: ${grey.white};
      color: inherit;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .filter-input:focus { border-color: ${purple.brand}; }

    .folder-list {
      max-height: 360px;
      overflow-y: auto;
      border: 1px solid ${grey.grey1};
      border-radius: ${borderRadius.md};
      background: ${grey.white};
      margin-bottom: ${spacing.sm};
    }
    .folder-item {
      display: flex;
      align-items: center;
      gap: ${spacing.md};
      padding: 12px 14px;
      border: none;
      border-bottom: 1px solid ${grey.grey1};
      background: transparent;
      cursor: pointer;
      width: 100%;
      text-align: left;
      font-family: inherit;
      font-size: ${fontSize.md};
      color: inherit;
      transition: background 0.15s ease;
    }
    .folder-item:last-child { border-bottom: none; }
    .folder-item:hover { background: ${purple.minus3}; }
    .folder-item:focus { outline: none; background: ${purple.minus3}; }
    .folder-icon {
      flex: 0 0 20px;
      width: 20px;
      height: 20px;
      color: ${purple.brand};
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .folder-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .folder-chevron {
      flex: 0 0 auto;
      color: ${grey.grey3};
      font-size: ${fontSize.lg};
      line-height: 1;
    }
    .folder-empty {
      padding: 18px 14px;
      text-align: center;
      color: ${grey.grey3};
      font-size: ${fontSize.base};
    }

    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: ${spacing.sm};
      margin-bottom: ${spacing.md};
    }
    .page-btn {
      padding: 6px 12px;
      background: ${purple.minus3};
      border: 1px solid ${grey.grey2};
      border-radius: ${borderRadius.md};
      color: ${purple.brand};
      font-size: ${fontSize.sm};
      font-weight: ${fontWeight.semibold};
      cursor: pointer;
      font-family: inherit;
    }
    .page-btn:hover:not(:disabled) { border-color: ${purple.brand}; }
    .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .page-status {
      color: ${grey.grey4};
      font-size: ${fontSize.sm};
      min-width: 140px;
      text-align: center;
    }

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: ${spacing.md};
      margin-top: ${spacing.md};
    }
    .primary-btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: ${purple.brand};
      cursor: pointer;
      color: ${grey.white};
      border: none;
      border-radius: ${borderRadius.lg};
      font-size: ${fontSize.md};
      font-family: ${fontFamily};
      font-weight: ${fontWeight.semibold};
      transition: all 0.2s ease;
    }
    .primary-btn:hover:not(:disabled) {
      background: ${purple.plus1};
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(102, 89, 167, 0.3);
    }
    .primary-btn:active { background: ${purple.plus2}; transform: translateY(0); }
    .primary-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .error-message {
      background: ${complementary.peach.light};
      color: ${complementary.peach.base};
      border-left: 3px solid ${complementary.peach.base};
      padding: ${spacing.md};
      border-radius: ${borderRadius.md};
      margin-bottom: ${spacing.md};
      font-size: ${fontSize.base};
      text-align: left;
      word-break: break-word;
    }

    .done { text-align: center; }
    .done h1 { color: ${complementary.teal.base}; }
    .done .selected-path {
      display: inline-block;
      margin-top: ${spacing.sm};
      padding: 6px 12px;
      background: ${purple.minus3};
      border-radius: ${borderRadius.md};
      color: ${purple.brand};
      font-size: ${fontSize.base};
      word-break: break-all;
    }
    .done .post-message { margin-top: ${spacing.lg}; }

    @media (prefers-color-scheme: dark) {
      .drive-label, .page-status, .folder-empty { color: ${dark.textMuted}; }
      .crumb-current { color: ${dark.text}; }
      .crumb-sep { color: ${dark.textMuted}; }
      .crumb-btn:hover { background: ${dark.surfaceHover}; }
      .filter-input {
        background: ${dark.surface};
        border-color: ${dark.border};
        color: ${dark.text};
      }
      .filter-input:focus { border-color: ${purple.brand}; }
      .folder-list {
        background: ${dark.surface};
        border-color: ${dark.border};
      }
      .folder-item {
        border-bottom-color: ${dark.border};
        color: ${dark.text};
      }
      .folder-item:hover, .folder-item:focus { background: ${dark.surfaceHover}; }
      .folder-icon { color: ${purple.minus1}; }
      .folder-chevron { color: ${dark.textMuted}; }
      .page-btn {
        background: ${dark.surface};
        border-color: ${dark.border};
        color: ${dark.text};
      }
      .page-btn:hover:not(:disabled) {
        border-color: ${purple.brand};
        background: ${dark.surfaceHover};
      }
      .error-message {
        background: rgba(249, 170, 143, 0.08);
        border-left-color: ${complementary.peach.base};
      }
      .primary-btn:hover:not(:disabled) {
        box-shadow: 0 6px 20px rgba(102, 89, 167, 0.4);
      }
      .done .selected-path {
        background: ${dark.surfaceHover};
        color: ${purple.minus1};
      }
    }`;

// ---------------------------------------------------------------------------
// Row-form styles (shared by requester / approver / confirmer flows)
// ---------------------------------------------------------------------------
//
// These pages diverge from the centred login/logout/picker shell on
// purpose — they're a high-density review surface, more akin to a
// console / DevOps dashboard than a marketing card. See ADR-0002 §7
// for the rationale.

export const ROW_FORM_STYLE = `
    body { align-items: flex-start; padding: 24px 16px; }
    .container { max-width: 1080px; text-align: left; }
    .card {
      padding: 18px 22px 14px;
      border-radius: ${borderRadius.lg};
      text-align: left;
    }
    .card h1 {
      font-size: ${fontSize.lg};
      color: ${purple.plus2};
      font-weight: ${fontWeight.semibold};
      letter-spacing: -0.01em;
      margin-bottom: 2px;
    }
    .card .subtitle {
      font-size: ${fontSize.sm};
      color: ${grey.grey3};
      margin-bottom: ${spacing.md};
      line-height: 1.5;
    }

    /* Slim CommandBar above the table */
    .bulk-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      margin-bottom: ${spacing.sm};
      border: 1px solid ${grey.grey2};
      border-radius: ${borderRadius.sm};
      background: ${grey.grey1};
    }
    .bulk-toolbar-label {
      font-family: ${fontFamilyMono};
      font-size: ${fontSize.xs};
      font-weight: ${fontWeight.semibold};
      color: ${grey.grey3};
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0 6px;
    }
    .bulk-btn {
      padding: 3px 10px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: ${borderRadius.sm};
      color: ${purple.brand};
      font-family: ${fontFamily};
      font-size: ${fontSize.sm};
      font-weight: ${fontWeight.semibold};
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .bulk-btn:hover {
      background: ${grey.white};
      border-color: ${grey.grey2};
    }
    .row-summary {
      margin-left: auto;
      font-family: ${fontFamilyMono};
      font-size: ${fontSize.xs};
      color: ${grey.grey4};
      padding: 0 6px;
    }

    /* Table */
    .row-table-wrap {
      border: 1px solid ${grey.grey2};
      border-radius: ${borderRadius.sm};
      overflow: auto;
      background: ${grey.white};
      max-height: calc(100vh - 240px);
    }
    .row-table {
      width: 100%;
      border-collapse: collapse;
      font-size: ${fontSize.sm};
    }
    .row-table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      text-align: left;
      padding: 7px 10px;
      background: ${grey.grey1};
      color: ${grey.grey3};
      font-family: ${fontFamilyMono};
      font-size: 0.7rem;
      font-weight: ${fontWeight.semibold};
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid ${grey.grey2};
      white-space: nowrap;
    }
    .row-table thead th.col-include { width: 28px; }
    .row-table thead th.col-decision { width: 200px; }
    .row-table thead th.col-duration { width: 170px; }

    .row-table tbody tr.row {
      border-top: 1px solid ${grey.grey1};
      transition: background 0.1s ease;
    }
    .row-table tbody tr.row:first-child { border-top: none; }
    .row-table tbody tr.row:hover { background: ${purple.minus3}; }
    .row-table tbody tr.row:hover .row-subtitle,
    .row-table tbody tr.row:hover .cell-quote { color: ${grey.grey4}; }

    .row-table td {
      padding: 6px 10px;
      vertical-align: top;
      line-height: 1.45;
    }

    .cell-primary { min-width: 180px; }
    .row-label {
      font-size: ${fontSize.base};
      font-weight: ${fontWeight.semibold};
      color: ${purple.plus2};
      word-break: break-word;
      line-height: 1.35;
    }
    .row-subtitle {
      font-family: ${fontFamilyMono};
      font-size: ${fontSize.xs};
      color: ${grey.grey3};
      word-break: break-all;
      margin-top: 1px;
    }
    .cell-meta { color: ${grey.grey4}; }
    .cell-meta-name { font-weight: ${fontWeight.semibold}; color: ${grey.grey4}; }
    .cell-quote {
      display: block;
      margin-top: 1px;
      font-style: italic;
      color: ${grey.grey3};
      font-size: ${fontSize.xs};
    }
    .cell-num {
      font-family: ${fontFamilyMono};
      color: ${grey.grey3};
      font-size: ${fontSize.xs};
    }

    /* Compact include checkbox cell */
    .cell-include {
      text-align: center;
      vertical-align: middle;
    }
    .cell-include input[type="checkbox"] {
      margin: 0;
      width: 15px;
      height: 15px;
      accent-color: ${purple.brand};
      cursor: pointer;
    }

    /* Compact segmented decision control */
    .decision-group {
      display: inline-flex;
      align-self: flex-start;
      border: 1px solid ${grey.grey2};
      border-radius: ${borderRadius.sm};
      background: ${grey.white};
      overflow: hidden;
      font-family: ${fontFamilyMono};
    }
    .decision-group label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 10px;
      margin: 0;
      cursor: pointer;
      font-size: ${fontSize.xs};
      font-weight: ${fontWeight.semibold};
      color: ${grey.grey4};
      border-right: 1px solid ${grey.grey2};
      background: transparent;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      transition: background 0.1s ease, color 0.1s ease;
      min-height: 22px;
    }
    .decision-group label:last-child { border-right: none; }
    .decision-group label:hover { background: ${purple.minus3}; }
    .decision-group input[type="radio"] {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .decision-group label:has(input[type="radio"]:checked) {
      background: ${purple.minus3};
      color: ${purple.brand};
    }
    .decision-group label:focus-within {
      box-shadow: inset 0 0 0 2px ${purple.brand};
    }

    /* Inline text inputs */
    .row-table textarea,
    .row-table input[type="text"],
    .row-table input[type="number"],
    .row-table select {
      width: 100%;
      padding: 3px 6px;
      border: 1px solid ${grey.grey2};
      border-radius: ${borderRadius.sm};
      font-family: ${fontFamily};
      font-size: ${fontSize.sm};
      background: ${grey.white};
      color: inherit;
      outline: none;
      box-sizing: border-box;
      line-height: 1.4;
      resize: vertical;
      transition: border-color 0.15s ease;
    }
    .row-table textarea {
      min-height: 26px;
      max-height: 120px;
      font-family: ${fontFamily};
    }
    .row-table textarea:focus,
    .row-table input:focus,
    .row-table select:focus { border-color: ${purple.brand}; }

    .duration-group {
      display: inline-flex;
      gap: 4px;
      width: 100%;
      max-width: 160px;
    }
    .duration-group .duration-value { width: 60px; flex: 0 0 60px; }
    .duration-group .duration-unit { flex: 1 1 auto; min-width: 0; }
    .duration-max {
      display: block;
      margin-top: 2px;
      font-family: ${fontFamilyMono};
      font-size: 0.7rem;
      color: ${grey.grey3};
      letter-spacing: 0.04em;
    }

    .row-error {
      display: block;
      margin-top: 3px;
      font-family: ${fontFamilyMono};
      color: ${complementary.peach.base};
      font-size: ${fontSize.xs};
    }

    /* Skipped state — strikethrough + dim, never opacity */
    tr.row.skipped .row-label { text-decoration: line-through; color: ${grey.grey3}; }
    tr.row.skipped .row-subtitle,
    tr.row.skipped .cell-meta,
    tr.row.skipped .cell-quote { color: ${grey.grey3}; }

    /* Sticky form-actions footer */
    .form-actions {
      display: flex;
      gap: ${spacing.sm};
      align-items: center;
      margin-top: ${spacing.md};
      padding-top: ${spacing.sm};
      position: sticky;
      bottom: 0;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, ${grey.white} 30%);
      z-index: 2;
    }
    .form-actions .submit-btn {
      flex: 1;
      padding: 10px 16px;
      background: ${purple.brand};
      color: ${grey.white};
      border: none;
      border-radius: ${borderRadius.sm};
      font-family: ${fontFamily};
      font-size: ${fontSize.base};
      font-weight: ${fontWeight.semibold};
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .form-actions .submit-btn:hover:not(:disabled) { background: ${purple.plus1}; }
    .form-actions .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .form-actions .cancel-btn {
      flex: 0 0 100px;
      padding: 10px 16px;
      border-radius: ${borderRadius.sm};
    }

    .empty-state {
      text-align: center;
      color: ${grey.grey3};
      padding: ${spacing.xl} 0;
      font-family: ${fontFamilyMono};
      font-size: ${fontSize.sm};
    }
    .done { text-align: center; padding: ${spacing.xxl} ${spacing.xl}; }
    .done h1 { color: ${complementary.teal.base}; text-align: center; }
    .done .message, .done .countdown, .done #manual-close { text-align: center; }
    #manual-close { margin-top: ${spacing.lg}; color: ${grey.grey4}; font-size: ${fontSize.base}; }
    .error-banner {
      color: ${complementary.peach.base};
      text-align: center;
      margin-top: ${spacing.sm};
      font-size: ${fontSize.sm};
    }

    /* Narrow viewports — collapse the multi-column controls into a more
       readable stack. The table still works because <td>s wrap, but we
       widen the input columns and wrap meta inline. */
    @media (max-width: 640px) {
      body { padding: 12px 8px; }
      .card { padding: 14px 12px 12px; }
      .row-table { font-size: ${fontSize.sm}; }
      .row-table thead th.col-decision { width: auto; }
      .row-table thead th.col-duration { width: auto; }
      .row-table td { padding: 6px 8px; }
      .duration-group { max-width: 100%; }
    }

    @media (prefers-color-scheme: dark) {
      .card h1 { color: ${dark.heading}; }
      .card .subtitle { color: ${dark.textMuted}; }
      .bulk-toolbar {
        background: ${dark.bg2};
        border-color: ${dark.border};
      }
      .bulk-toolbar-label, .row-summary { color: ${dark.textMuted}; }
      .bulk-btn { color: ${purple.minus1}; }
      .bulk-btn:hover {
        background: ${dark.surfaceHover};
        border-color: ${dark.border};
      }
      .row-table-wrap {
        background: ${dark.surface};
        border-color: ${dark.border};
      }
      .row-table thead th {
        background: ${dark.bg2};
        color: ${dark.textMuted};
        border-bottom-color: ${dark.border};
      }
      .row-table tbody tr.row { border-top-color: ${dark.border}; }
      .row-table tbody tr.row:hover { background: ${dark.surfaceHover}; }
      .row-label { color: ${dark.heading}; }
      .row-subtitle, .cell-quote, .cell-num, .duration-max { color: ${dark.textMuted}; }
      .cell-meta { color: ${dark.text}; }
      .cell-meta-name { color: ${dark.heading}; }
      tr.row.skipped .row-label,
      tr.row.skipped .row-subtitle,
      tr.row.skipped .cell-meta,
      tr.row.skipped .cell-quote { color: ${dark.textMuted}; }
      .row-table textarea,
      .row-table input[type="text"],
      .row-table input[type="number"],
      .row-table select {
        background: ${dark.bg2};
        border-color: ${dark.border};
        color: ${dark.text};
      }
      .decision-group {
        background: ${dark.bg2};
        border-color: ${dark.border};
      }
      .decision-group label {
        color: ${dark.text};
        border-right-color: ${dark.border};
      }
      .decision-group label:hover { background: ${dark.surfaceHover}; }
      .decision-group label:has(input[type="radio"]:checked) {
        background: ${dark.surfaceHover};
        color: ${purple.minus1};
      }
      .empty-state { color: ${dark.textMuted}; }
      #manual-close { color: ${dark.text}; }
      .form-actions {
        background: linear-gradient(to bottom, rgba(28, 27, 41, 0) 0%, ${dark.surface} 30%);
      }
    }`;
