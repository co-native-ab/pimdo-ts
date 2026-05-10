// Login-flow styles — the large purple "Sign in with Microsoft" button.

import { purple, grey, fontFamily, fontWeight, fontSize, borderRadius } from "../tokens.js";

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
