import { expect, it } from "vitest";
import { AuthError, authResult, isSsoRequired } from "../src/lib/auth-client";

// @req R-DASH-34
it("keeps the SSO_REQUIRED code so the sign-in form can guide members to their provider", () => {
  // An SSO-only organization refuses a password with a 403 carrying this code.
  let caught: unknown;
  try {
    authResult(
      {
        data: null,
        error: {
          message: "This organization requires SSO sign-in.",
          code: "SSO_REQUIRED",
        },
      },
      "Sign-in failed.",
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AuthError);
  expect(isSsoRequired(caught)).toBe(true);
});

// @req R-DASH-34
it("treats other sign-in failures and non-errors as ordinary, not SSO-only", () => {
  expect(
    isSsoRequired(
      new AuthError("Invalid email or password.", "INVALID_EMAIL_OR_PASSWORD"),
    ),
  ).toBe(false);
  // A plain Error carrying the same words must not be mistaken for the coded case.
  expect(
    isSsoRequired(new Error("This organization requires SSO sign-in.")),
  ).toBe(false);
  expect(isSsoRequired(null)).toBe(false);
  expect(isSsoRequired(undefined)).toBe(false);
});
