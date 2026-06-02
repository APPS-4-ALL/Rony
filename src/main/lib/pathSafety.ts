/**
 * Path-containment safety check (pure, dependency-free).
 *
 * Used to enforce that a file the app is about to act on (e.g. open with the
 * OS) really lives inside an authorized directory — defense-in-depth against
 * path traversal (`../`) and absolute/other-volume escapes when the candidate
 * path originated from, or was influenced by, an untrusted source.
 */
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * True only if `target` resolves to a location strictly INSIDE `dir`.
 *
 * Both paths are resolved to absolutes first, then we derive the relative path
 * from `dir` to `target`. It is contained iff that relative path:
 *   - is non-empty (`''` means target IS dir — a directory, not a file in it),
 *   - does not start with `..` (would step outside `dir`), and
 *   - is not itself absolute (on Windows, a different drive yields an absolute
 *     relative path — i.e. there is no containment).
 */
export function isPathInsideDir(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target))
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}
