import Link from "next/link";
import QRCode from "qrcode";
import { buildTotpOtpauthUrl } from "@igle/core";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{
    twoFactorEnabled?: string;
    twoFactorDisabled?: string;
    twoFactorError?: string;
    telegramSaved?: string;
    telegramError?: string;
  }>;
}) {
  const actor = await requireActorOrRedirect();
  const { twoFactorEnabled, twoFactorDisabled, twoFactorError, telegramSaved, telegramError } = await searchParams;

  const state = await runtime.stateStore.read();
  const user = state.users.find((item) => item.id === actor.id);
  const isEnabled = Boolean(user?.twoFactorEnabled);
  const isPending = Boolean(user?.twoFactorSecret) && !isEnabled;
  const backupCodesRemaining = user?.twoFactorBackupCodeHashes?.length ?? 0;

  let qrDataUrl: string | undefined;
  if (isPending && user?.twoFactorSecret) {
    const otpauthUrl = buildTotpOtpauthUrl(actor.email, user.twoFactorSecret);
    qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  }

  return (
    <>
      <h1>Settings</h1>

      <section className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>VPS servers</h2>
        <p className="muted">Registering, testing, and restricting deploy servers now lives on its own page.</p>
        <Link href="/servers" className="button" style={{ justifySelf: "start" }}>
          Go to Servers
        </Link>
      </section>

      <section className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Telegram notifications</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Get pinged on Telegram when a task is assigned to you. Message{" "}
          <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">
            @userinfobot
          </a>{" "}
          on Telegram to get your numeric chat ID, paste it below, then message the team&apos;s bot once so it&apos;s
          allowed to send you messages.
        </p>
        {telegramSaved ? (
          <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
            Saved.
          </article>
        ) : null}
        {telegramError ? (
          <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 14 }}>
            {telegramError}
          </article>
        ) : null}
        <form method="post" action="/api/account/telegram" style={{ display: "grid", gap: 8, maxWidth: 260 }}>
          <label className="muted" htmlFor="chatId" style={{ fontSize: 12.5 }}>
            Your Telegram chat ID
          </label>
          <input type="text" id="chatId" name="chatId" defaultValue={user?.telegramChatId ?? ""} placeholder="123456789" />
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Save
          </button>
        </form>
      </section>

      <section className="card" style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>Two-factor authentication</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Required for every account — signing in always needs the shared password and a 6-digit code from an
          authenticator app (Google Authenticator, Authy, 1Password, etc.), set up individually per person. Resetting
          it here doesn&apos;t opt out — your next sign-in just walks you through setup again.
        </p>

        {twoFactorEnabled ? (
          <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
            Two-factor authentication is on.
          </article>
        ) : null}
        {twoFactorDisabled ? (
          <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
            Reset — you&apos;ll set it up again the next time you sign in.
          </article>
        ) : null}
        {twoFactorError ? (
          <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 14 }}>
            {twoFactorError}
          </article>
        ) : null}

        {isEnabled ? (
          <>
            <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
              <span className="badge badge-current">On</span>
              Your account is protected with an authenticator code.
            </p>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13.5 }}>
                <strong>{backupCodesRemaining}</strong> backup code{backupCodesRemaining === 1 ? "" : "s"} remaining —
                use one instead of an authenticator code if you ever lose your device, no administrator needed.
              </p>
              <form method="post" action="/api/account/2fa/backup-codes" style={{ display: "grid", gap: 8, maxWidth: 260 }}>
                <label className="muted" htmlFor="backupCodesCode" style={{ fontSize: 12.5 }}>
                  Enter your current code to generate a fresh set
                </label>
                <input
                  type="text"
                  id="backupCodesCode"
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  style={{ letterSpacing: "0.2em" }}
                />
                <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", justifySelf: "start" }}>
                  {backupCodesRemaining > 0 ? "Regenerate backup codes" : "Generate backup codes"}
                </button>
              </form>
            </div>

            <form method="post" action="/api/account/2fa/disable" style={{ display: "grid", gap: 8, maxWidth: 260 }}>
              <label className="muted" htmlFor="disableCode" style={{ fontSize: 12.5 }}>
                Enter your current code to turn it off
              </label>
              <input
                type="text"
                id="disableCode"
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                style={{ letterSpacing: "0.2em" }}
              />
              <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", justifySelf: "start" }}>
                Reset — set it up again on next sign-in
              </button>
            </form>
          </>
        ) : isPending && qrDataUrl ? (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Scan this with your authenticator app, then enter the 6-digit code it shows to finish turning it on.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Two-factor authentication QR code" width={220} height={220} style={{ borderRadius: 8 }} />
            <p className="muted" style={{ margin: 0, fontSize: 11.5, wordBreak: "break-all" }}>
              Can&apos;t scan it? Enter this code manually: <code>{user?.twoFactorSecret}</code>
            </p>
            <form method="post" action="/api/account/2fa/confirm" style={{ display: "grid", gap: 8, maxWidth: 260 }}>
              <label className="muted" htmlFor="confirmCode" style={{ fontSize: 12.5 }}>
                6-digit code
              </label>
              <input
                type="text"
                id="confirmCode"
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                style={{ letterSpacing: "0.2em" }}
              />
              <button className="button" type="submit" style={{ justifySelf: "start" }}>
                Confirm and turn on
              </button>
            </form>
            <form method="post" action="/api/account/2fa/begin">
              <button type="submit" className="button" style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: 0 }}>
                Show a different QR code
              </button>
            </form>
          </div>
        ) : (
          <form method="post" action="/api/account/2fa/begin">
            <button className="button" type="submit" style={{ justifySelf: "start" }}>
              Set up two-factor authentication
            </button>
          </form>
        )}
      </section>
    </>
  );
}
