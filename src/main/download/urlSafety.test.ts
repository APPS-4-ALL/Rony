import { describe, expect, it } from 'vitest'
import { checkFetchableUrl, isPrivateIp } from './urlSafety'

describe('isPrivateIp', () => {
  it('flags private / loopback / link-local / reserved IPv4', () => {
    for (const ip of [
      '10.0.0.1',
      '172.16.5.4',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '100.64.0.1', // CGNAT
      '224.0.0.1', // multicast
      '255.255.255.255'
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows ordinary public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })

  it('flags loopback / ULA / link-local / mapped-private IPv6', () => {
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('fd00::1')).toBe(true)
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false) // public (Cloudflare)
  })
})

describe('checkFetchableUrl', () => {
  it('accepts an ordinary https URL', () => {
    const r = checkFetchableUrl('https://vendor.co.il/invoice/55.pdf')
    expect(r.ok).toBe(true)
  })

  it('rejects non-https schemes', () => {
    expect(checkFetchableUrl('http://vendor.co.il/x').ok).toBe(false)
    expect(checkFetchableUrl('ftp://x/y').ok).toBe(false)
    expect(checkFetchableUrl('file:///etc/passwd').ok).toBe(false)
  })

  it('rejects an https URL whose host is a private IP literal (SSRF)', () => {
    expect(checkFetchableUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false)
    expect(checkFetchableUrl('https://127.0.0.1:8080/admin').ok).toBe(false)
    expect(checkFetchableUrl('https://192.168.1.1/').ok).toBe(false)
  })

  it('rejects garbage', () => {
    expect(checkFetchableUrl('not a url').ok).toBe(false)
  })
})
