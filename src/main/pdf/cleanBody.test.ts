import { describe, it, expect } from 'vitest'
import { cleanReceiptBody } from './cleanBody'

describe('cleanReceiptBody', () => {
  it('keeps only the latest message and drops the quoted reply thread', () => {
    const raw = [
      'מאושר',
      ']cid:image001.png@01DCDDFD.93DEAA60[',
      '>From: Cindy Benarouche <bcindy@amanet.co.il',
      'Sent: Thursday, May 7, 2026 6:48 AM',
      '>To: Juli Madaee',
      'Subject: Re: הצעת עבודה',
      'היי ג׳ולי, ההצעה תעודכן…'
    ].join('\n')

    const out = cleanReceiptBody(raw)
    expect(out).toBe('מאושר') // top message only; cid ref + thread removed
    expect(out).not.toContain('cid:')
    expect(out).not.toContain('From:')
  })

  it('cuts a Hebrew "מאת:" reply header too', () => {
    const raw = ['תודה, אישרנו את ההצעה.', 'מאת: ספק כלשהו', 'נשלח: יום ראשון'].join('\n')
    expect(cleanReceiptBody(raw)).toBe('תודה, אישרנו את ההצעה.')
  })

  it('strips Checkpoint tracking URLs and base64 continuation lines', () => {
    const raw = [
      'סה"כ לתשלום 1,200 ש"ח.',
      'www.aman-amanet.co.il<https://protect.checkpoint.com/v2/r02/___http:/www.aman.co.il',
      'YzJlOnVuaW9uZ3JvdXA6YzpvOjY4NzZlYmY1NWZhMzA4Y2QxMDFkZTRmZDk3ZGEyYTM1Ojc6ODY1NToyZGUz'
    ].join('\n')

    const out = cleanReceiptBody(raw)
    expect(out).toBe('סה"כ לתשלום 1,200 ש"ח.')
    expect(out).not.toContain('checkpoint')
  })

  it('leaves a clean, single-message receipt untouched', () => {
    const body = 'תודה על רכישתך!\nסך הכל: 64.00 ₪'
    expect(cleanReceiptBody(body)).toBe(body)
  })

  it('removes an inline cid reference embedded mid-text', () => {
    expect(cleanReceiptBody('חשבונית [cid:logo@x] מצורפת')).toBe('חשבונית  מצורפת')
  })

  it('caps an extremely long body', () => {
    const out = cleanReceiptBody('א'.repeat(5000))
    expect(out.length).toBeLessThanOrEqual(2001) // 2000 chars + the … ellipsis
    expect(out.endsWith('…')).toBe(true)
  })
})
