import { redirect } from "next/navigation";
import { getCurrentActor } from "../../lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect("/");

  const { error } = await searchParams;

  return (
    <div className="login-shell">
      <form className="card login-card" method="post" action="/api/auth/login">
        <div className="login-brand">
          <span className="login-mark" aria-hidden="true">
            IC
          </span>
          <span className="brand">Igle CMS</span>
        </div>

        {error ? <p className="login-error">{error}</p> : null}

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
