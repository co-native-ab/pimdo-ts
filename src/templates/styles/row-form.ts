// Row-form styles — shared by the requester / approver / confirmer flows.
//
// These pages diverge from the centred login/logout shell on purpose —
// they're a high-density review surface, more akin to a console / DevOps
// dashboard than a marketing card. See ADR-0002 §7 for the rationale.

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
} from "../tokens.js";

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
