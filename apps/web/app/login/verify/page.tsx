import { redirect } from "next/navigation";
import { getCurrentActor, getPendingTwoFactorToken } from "../../../lib/session";

export default async function VerifyTwoFactorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect("/");

  const pendingToken = await getPendingTwoFactorToken();
  if (!pendingToken) redirect("/login");

  const { error } = await searchParams;

  return (
    <div className="login-shell">
      <form className="card login-card" method="post" action="/api/auth/login/verify-2fa" style={{ display: "grid", gap: 14 }}>
        <div>
          <div className="brand" style={{ marginBottom: 2 }}>
            Igle CMS
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>

        {error ? <p style={{ margin: 0, fontSize: 13, color: "var(--warn)" }}>{error}</p> : null}

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
          Verify
        </button>

        <a href="/login" className="muted" style={{ fontSize: 12.5, textAlign: "center" }}>
          Back to sign in
        </a>
      </form>
    </div>
  );
}
