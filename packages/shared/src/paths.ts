import path from "node:path";
import { IgleError } from "./errors.js";

export function normalizeSitePath(input: string): string {
  if (input.includes("\0")) {
    throw new IgleError("INVALID_PATH", "Path contains a null byte.", 400, { input });
  }

  const slashNormalized = input.replaceAll("\\", "/");
  if (path.posix.isAbsolute(slashNormalized)) {
    throw new IgleError("INVALID_PATH", "Absolute paths are not allowed.", 400, { input });
  }

  const normalized = slashNormalized.replace(/^\/+/, "");
  const resolved = path.posix.normalize(normalized);

  if (resolved === "." || resolved.startsWith("../") || resolved === ".." || path.posix.isAbsolute(resolved)) {
    throw new IgleError("INVALID_PATH", "Path escapes the site root.", 400, { input });
  }

  return resolved;
}

export function resolveInside(root: string, input: string): string {
  const normalized = normalizeSitePath(input);
  const resolved = path.resolve(root, normalized);
  const rootWithSep = path.resolve(root) + path.sep;

  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSep)) {
    throw new IgleError("INVALID_PATH", "Path escapes the site root.", 400, { input });
  }

  return resolved;
}
