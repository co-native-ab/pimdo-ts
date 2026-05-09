// Feedback styles — green checkmark for success, peach icon for errors.
// Shared by both the login flow (login success / login error) and the
// logout flow (logout success).

import { complementary, dark, grey, spacing, fontSize, borderRadius } from "../tokens.js";

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
