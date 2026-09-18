import Link from "next/link";
import { peekBackupCodesRevealCookie, requireActorOrRedirect } from "../../lib/session";

export default async function BackupCodesPage() {
  await requireActorOrRedirect();
  const codes = await peekBackupCodesRevealCookie();

  return (
    <div className="login-shell">
      <div className="card login-card" style={{ maxWidth: 420 }}>
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true">
            IC
          </span>
          <span className="brand">Igle CMS</span>
        </div>

        {codes ? (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Save your backup codes</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Each code signs you in once, in place of your authenticator app, if you ever lose access to it — no
              administrator needed. They&apos;re shown only this once; save them somewhere safe (a password manager
              is ideal).
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px 16px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 14,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 16,
                margin: "6px 0"
              }}
            >
              {codes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              Using one retires it immediately and walks you straight back through setup with a new QR code. You can
              generate a fresh set anytime from Settings.
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Nothing to show — backup codes are only displayed once, right after they&apos;re generated. Go to
            Settings to generate a fresh set.
          </p>
        )}

        <Link href="/" className="button" style={{ justifySelf: "start", marginTop: 6 }}>
          Continue
        </Link>
      </div>
    </div>
  );
}
