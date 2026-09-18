import { runtime } from "../../lib/runtime";

export default async function JobsPage() {
  const jobs = (await runtime.stateStore.read()).jobs.slice().reverse();

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Jobs</h1>
        </div>
      </div>
      <section className="grid">
        {jobs.map((job) => (
          <article className="card" key={job.id}>
            <h2>{job.type}</h2>
            <p>{job.progress}% · {job.status}</p>
            <p className="muted">{job.message}</p>
          </article>
        ))}
        {jobs.length === 0 ? (
          <article className="card">
            <h2>No jobs</h2>
            <p className="muted">No background work has run.</p>
          </article>
        ) : null}
      </section>
    </>
  );
}
