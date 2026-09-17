import Link from "next/link";
import QRCode from "qrcode";
import { buildTotpOtpauthUrl } from "@igle/core";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ twoFactorEnabled?: string; twoFactorDisabled?: string; twoFactorError?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { twoFactorEnabled, twoFactorDisabled, twoFactorError } = await searchParams;

  const state = await runtime.stateStore.read();
  const user = state.users.find((item) => item.id === actor.id);
  const isEnabled = Boolean(user?.twoFactorEnabled);
  const isPending = Boolean(user?.twoFactorSecret) && !isEnabled;

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

      <section className="card" style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>Two-factor authentication</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Once turned on, signing in to your account needs your password and a 6-digit code from an authenticator
          app (Google Authenticator, Authy, 1Password, etc.) — the extra step applies only to your own account.
        </p>

        {twoFactorEnabled ? (
          <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
            Two-factor authentication is on.
          </article>
        ) : null}
        {twoFactorDisabled ? (
          <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
            Two-factor authentication is off.
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
                Turn off two-factor authentication
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
