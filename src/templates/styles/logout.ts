// Logout-flow styles — the peach "Sign out" confirmation button.

import { complementary, grey, fontFamily, fontWeight, fontSize, borderRadius } from "../tokens.js";

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
