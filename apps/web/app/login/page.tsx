import { redirect } from "next/navigation";
import { getCurrentActor } from "../../lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect("/");

  const { error } = await searchParams;

  return (
    <div className="login-shell">
      <form className="card login-card" method="post" action="/api/auth/login" style={{ display: "grid", gap: 14 }}>
        <div>
          <div className="brand" style={{ marginBottom: 2 }}>
            Igle CMS
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Sign in with your registered email and the team password.
          </p>
        </div>

        {error ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--warn)" }}>{error}</p>
        ) : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input type="email" id="email" name="email" required autoFocus autoComplete="username" />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input type="password" id="password" name="password" required autoComplete="current-password" />
        </div>

        <button className="button" type="submit">
          Sign in
        </button>
      </form>
    </div>
  );
}
