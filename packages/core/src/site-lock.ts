/**
 * In-process, per-site mutual exclusion for the read-file → patch → write-file → git-commit
 * sequence every content-mutating operation goes through. Without this, two requests touching the
 * same site's repo at once can race: both read the same "before" file, both compute a patch
 * against it, and whichever writes second silently overwrites the first's change — or their
 * concurrent `git commit`s collide on .git/index.lock and one fails outright with a generic
 * "Unexpected server error".
 *
 * Confirmed live: firing two image-replace requests at the same page at once reproducibly lost
 * one of the two edits — this is what "the image uploads fine but the page's HTML still has the
 * old href" turned out to be, on sites/pages where a user's workflow happens to fire more than
 * one edit close together (e.g. replacing several images in a row without waiting for each to
 * finish redirecting).
 *
 * In-memory only — sufficient because this app runs as a single Node process per environment (see
 * docker-compose.yml); it would need to move to something shared (e.g. a lock record in state.json,
 * or OS file locking) if this were ever horizontally scaled to multiple `web` instances.
 */
const queues = new Map<string, Promise<unknown>>();

export function withSiteLock<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(siteId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  queues.set(
    siteId,
    run.catch(() => undefined)
  );
  return run;
}
