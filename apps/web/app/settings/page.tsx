import Link from "next/link";

export default async function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <section className="card" style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>VPS servers</h2>
        <p className="muted">Registering, testing, and restricting deploy servers now lives on its own page.</p>
        <Link href="/servers" className="button" style={{ justifySelf: "start" }}>
          Go to Servers
        </Link>
      </section>
    </>
  );
}
