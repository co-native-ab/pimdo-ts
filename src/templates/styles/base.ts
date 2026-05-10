// Base stylesheet shared by every served page (login / logout / row-form).
//
// Defines the page shell — body gradient, centred .container/.card,
// h1/.subtitle/.message typography, the [hidden] visibility primitive,
// and the dark-mode overrides for all of the above. Per-flow stylesheets
// extend this with their own buttons, tables, and feedback states.
//
// All CSS is built from design tokens — see ADR-0002.

import {
  purple,
  grey,
  dark,
  fontFamily,
  fontWeight,
  fontSize,
  spacing,
  borderRadius,
} from "../tokens.js";

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
