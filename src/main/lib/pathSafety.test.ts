import { describe, it, expect } from 'vitest'
import { join, resolve, sep } from 'node:path'
import { isPathInsideDir } from './pathSafety'

// Build absolute paths relative to cwd so the tests are platform-agnostic
// (path.resolve / join use the host separator on every OS).
const DIR = resolve('rony-invoices-test')

describe('isPathInsideDir', () => {
  it('accepts a direct child file', () => {
    expect(isPathInsideDir(DIR, join(DIR, 'msg1__invoice.pdf'))).toBe(true)
  })

  it('accepts a nested descendant', () => {
    expect(isPathInsideDir(DIR, join(DIR, 'sub', 'deep', 'a.pdf'))).toBe(true)
  })

  it('rejects the directory itself (not a file inside it)', () => {
    expect(isPathInsideDir(DIR, DIR)).toBe(false)
  })

  it('rejects a traversal escape with ../', () => {
    expect(isPathInsideDir(DIR, join(DIR, '..', '..', 'evil.exe'))).toBe(false)
  })

  it('rejects a sibling directory that shares a prefix', () => {
    // `${DIR}-evil` starts with DIR as a string but is NOT contained.
    expect(isPathInsideDir(DIR, `${DIR}-evil${sep}x.pdf`)).toBe(false)
  })

  it('rejects an unrelated absolute path', () => {
    expect(isPathInsideDir(DIR, resolve('somewhere', 'else', 'a.pdf'))).toBe(false)
  })

  it('normalizes redundant segments before judging', () => {
    expect(isPathInsideDir(DIR, join(DIR, 'a', '..', 'b.pdf'))).toBe(true)
  })
})
