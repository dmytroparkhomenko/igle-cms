import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { runtime } from "../../../lib/runtime";
import { getCurrentActor, getPendingTwoFactorToken } from "../../../lib/session";

export default async function VerifyTwoFactorPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; backupAccepted?: string }>;
}) {
  const actor = await getCurrentActor();
  if (actor) redirect("/");

  const pendingToken = await getPendingTwoFactorToken();
  if (!pendingToken) redirect("/login");

  const context = await runtime.authService.getPendingTwoFactorContext(pendingToken);
  if (!context) redirect("/login");

  const { error, backupAccepted } = await searchParams;
  const qrDataUrl = context.otpauthUrl ? await QRCode.toDataURL(context.otpauthUrl, { margin: 1, width: 220 }) : undefined;

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true">
            IC
          </span>
          <span className="brand">Igle CMS</span>
        </div>

        <p className="muted" style={{ margin: "-6px 0 16px", fontSize: 13 }}>
          {backupAccepted
            ? "Backup code accepted — scan this new QR code to finish signing in. Your old codes and authenticator entry no longer work."
            : context.setupRequired
              ? "Scan this with an authenticator app (Google Authenticator, Authy, 1Password), then enter the code it shows."
              : "Enter the 6-digit code from your authenticator app."}
        </p>

        <form method="post" action="/api/auth/login/verify-2fa" style={{ display: "grid", gap: 14 }}>
          {context.setupRequired && qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="Two-factor authentication QR code" width={220} height={220} style={{ borderRadius: 8, justifySelf: "center" }} />
          ) : null}

          {error ? <p className="login-error">{error}</p> : null}

          <div className="field">
            <label htmlFor="code">Authentication code</label>
            <input
              type="text"
              id="code"
              name="code"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              style={{ fontSize: 20, letterSpacing: "0.3em", textAlign: "center" }}
            />
          </div>

          <button className="button" type="submit">
            {context.setupRequired ? "Confirm and sign in" : "Verify"}
          </button>

          <a href="/login" className="muted" style={{ fontSize: 12.5, textAlign: "center" }}>
            Back to sign in
          </a>
        </form>

        {!context.setupRequired ? (
          <details style={{ marginTop: 16 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>
              Lost your device? Use a backup code
            </summary>
            <form method="post" action="/api/auth/login/verify-backup-code" style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <input
                type="text"
                name="code"
                placeholder="XXXXX-XXXXX"
                autoComplete="off"
                required
                style={{ textAlign: "center", letterSpacing: "0.05em" }}
              />
              <button className="button" type="submit" style={{ background: "none", color: "var(--accent)" }}>
                Use backup code
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </div>
  );
}
