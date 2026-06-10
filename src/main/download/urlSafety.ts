/**
 * RONY-18 — URL safety for following invoice links from emails.
 *
 * Fetching a URL that arrived in an email is an SSRF/abuse risk: a malicious or
 * compromised sender could point Rony at an internal service (169.254.169.254
 * cloud metadata, 192.168.x.y routers, localhost admin panels) or a non-web
 * scheme. This module is the policy layer:
 *   - only `https:` URLs are fetchable,
 *   - any host that is (or resolves to) a private/loopback/link-local/reserved
 *     IP is rejected.
 *
 * Pure + dependency-free, so it unit-tests in isolation. The DNS resolution that
 * pins the *connected* IP (defeating DNS-rebinding) lives in the fetcher, which
 * calls {@link isPrivateIp} on the resolved address.
 */

/** Parse a dotted-quad IPv4 string to its 4 octets, or null if not IPv4. */
function ipv4Octets(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
  if (o.some((n) => n > 255)) return null
  return [o[0], o[1], o[2], o[3]]
}

/**
 * True for an IPv4 address that must NOT be fetched: private (RFC 1918),
 * loopback, link-local (incl. cloud metadata 169.254.169.254), CGNAT, and other
 * reserved/special ranges.
 */
function isPrivateIpv4(ip: string): boolean {
  const o = ipv4Octets(ip)
  if (!o) return false
  const [a, b] = o
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true // 192.0.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a >= 224) return true // 224+ multicast / reserved / 255.255.255.255
  return false
}

/** True for an IPv6 address that must NOT be fetched (loopback/ULA/link-local/mapped-private). */
function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (addr === '::1' || addr === '::') return true // loopback / unspecified
  if (
    addr.startsWith('fe80') ||
    addr.startsWith('fe9') ||
    addr.startsWith('fea') ||
    addr.startsWith('feb')
  )
    return true // fe80::/10 link-local
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(addr) || addr.startsWith('fc') || addr.startsWith('fd'))
    return true // fc00::/7 unique-local
  // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded IPv4.
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr)
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}

/** True when an IP literal (v4 or v6) is private/loopback/link-local/reserved. */
export function isPrivateIp(ip: string): boolean {
  return ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip)
}

/** Result of vetting a URL for fetching. */
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * Vet a URL string against the fetch policy: must be a valid absolute `https:`
 * URL, and if the host is an IP literal it must not be private/reserved. (A
 * hostname's resolved IP is checked separately at connect time.)
 */
export function checkFetchableUrl(raw: string): UrlCheck {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'not a valid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `unsupported scheme "${url.protocol}" (https only)` }
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host) return { ok: false, reason: 'missing host' }
  // Reject an IP-literal host that is private; a DNS name is vetted at connect time.
  if ((ipv4Octets(host) || host.includes(':')) && isPrivateIp(host)) {
    return { ok: false, reason: `host ${host} is a private/reserved address` }
  }
  return { ok: true, url }
}
