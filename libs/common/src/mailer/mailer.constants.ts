export const DEFAULT_SMTP_PORT = 465;

export const SMTP_TIMEOUT_MS = 15000;

/**
 * Recipient domains that can never accept mail.
 *
 * Sending to one is NOT a harmless no-op. A relay like Gmail answers `250` to
 * `RCPT TO`, queues the message, discovers the failure asynchronously, and then
 * mails a bounce notice back to the authenticated SMTP account — repeatedly,
 * for ~45h of retries. So every reset code addressed to a fixture account like
 * `chgpw_test@trybuy.com` turns into a stream of "Delivery incomplete" mail in
 * the project owner's own inbox.
 *
 * `trybuy.com` is this project's fixture domain (most of `test-accounts.md`
 * uses it and it has no mailbox). The rest are reserved as undeliverable by
 * RFC 2606 / RFC 6761. Matching is exact or on a dot-suffix, so `foo.invalid`
 * is covered by `invalid`.
 *
 * Override with `MAIL_UNDELIVERABLE_DOMAINS` (comma-separated). Setting it to
 * an empty string disables the guard.
 */
export const DEFAULT_UNDELIVERABLE_MAIL_DOMAINS = [
  "trybuy.com",
  "example.com",
  "example.org",
  "example.net",
  "example",
  "invalid",
  "localhost",
  "test",
];
