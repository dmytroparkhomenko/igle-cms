export default function TemplatesPage() {
  return <StatusPage title="Templates" body="No templates have been uploaded." />;
}

function StatusPage({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1>{title}</h1>
      <section className="card">
        <p>{body}</p>
      </section>
    </>
  );
}
