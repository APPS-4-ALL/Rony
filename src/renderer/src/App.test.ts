// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import App from './App.vue'
import type { Invoice, ScanResult } from '@shared/types'

const list = vi.fn<() => Promise<Invoice[]>>()
const count = vi.fn<() => Promise<number>>()
const scanRun = vi.fn<() => Promise<ScanResult>>()

function stubApi(): void {
  vi.stubGlobal('api', {
    ping: vi.fn().mockResolvedValue('pong'),
    invoices: {
      list,
      count,
      addSample: vi.fn(),
      openFile: vi.fn().mockResolvedValue('')
    },
    scan: { run: scanRun }
  })
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([])
  count.mockReset().mockResolvedValue(0)
  scanRun.mockReset()
  stubApi()
})

afterEach(() => vi.unstubAllGlobals())

/** Find a button by its (trimmed) visible text. */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string): DOMWrapper<Element> {
  return wrapper.findAll('button').find((b) => b.text().includes(text))!
}

describe('App.vue — RONY-14 Scan now', () => {
  it('runs a scan, shows a loading state, then refreshes the table and shows a summary', async () => {
    // A scan we control, so we can observe the loading state mid-flight.
    let resolveScan: (r: ScanResult) => void = () => {}
    scanRun.mockReturnValue(new Promise<ScanResult>((res) => (resolveScan = res)))

    const wrapper = mount(App)
    await flushPromises() // onMounted refresh
    expect(count).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(1)

    await buttonByText(wrapper, 'Scan now').trigger('click')
    // Loading state is visible and the button is disabled.
    const scanBtn = buttonByText(wrapper, 'Scanning')
    expect(scanBtn.text()).toContain('Scanning')
    expect((scanBtn.element as HTMLButtonElement).disabled).toBe(true)
    expect(scanRun).toHaveBeenCalledTimes(1)

    // Finish the scan: a new invoice now exists in the (mocked) DB.
    list.mockResolvedValue([
      {
        id: 1,
        messageId: 'm',
        date: '2026-05-01',
        vendor: 'Acme',
        amount: 50,
        currency: 'ILS',
        localFilePath: 'C:/Docs/Rony Invoices/a.pdf',
        status: 'downloaded',
        engineType: 'deterministic',
        createdAt: '2026-05-01T00:00:00Z'
      }
    ])
    resolveScan({ scanned: 12, matched: 1, downloaded: 1, errors: 0 })
    await flushPromises()

    // Table was refreshed from SQLite (list called again) and summary shown.
    expect(list).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('downloaded')
    expect(wrapper.text()).toContain('Acme')
    // Back to idle.
    expect(buttonByText(wrapper, 'Scan now').text()).toContain('Scan now')
  })

  it('surfaces a scan error inline without crashing the UI', async () => {
    scanRun.mockRejectedValue(new Error('Not connected to Gmail.'))

    const wrapper = mount(App)
    await flushPromises()

    await buttonByText(wrapper, 'Scan now').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Not connected to Gmail.')
    // Button recovered to idle and is clickable again.
    const btn = buttonByText(wrapper, 'Scan now')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })
})
