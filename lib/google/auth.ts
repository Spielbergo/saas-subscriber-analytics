import "server-only";
import { google } from "googleapis";

/**
 * Shared service-account auth for both GA4 and Search Console. One
 * Google Cloud service account, granted Viewer access in both GA4 and
 * Search Console, covers both — no per-user OAuth consent needed since
 * this is a server-side admin tool, not something end users sign into
 * with their own Google account.
 *
 * Setup (see docs/marketing-setup.md for the full walkthrough):
 *  1. Create a service account in Google Cloud Console.
 *  2. Download its JSON key.
 *  3. Add the service account's email as a Viewer in GA4
 *     (Admin > Property Access Management) and in Search Console
 *     (Settings > Users and permissions).
 *  4. Put the email + private key in .env.local.
 */
export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

export function getGoogleAuth(scopes: string[]) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "Google service account not configured — set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
    );
  }

  // .env files can't hold real newlines in a value, so the key is stored
  // with literal "\n" sequences and unescaped here.
  const privateKey = rawKey.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes,
  });
}
