// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import App from './App.vue'
import type { Invoice, ScanResult } from '@shared/types'

const list = vi.fn<() => Promise<Invoice[]>>()
const scanRun = vi.fn<() => Promise<ScanResult>>()

function stubApi(): void {
  vi.stubGlobal('api', {
    invoices: {
      list,
      openFile: vi.fn().mockResolvedValue('')
    },
    scan: { run: scanRun, onProgress: vi.fn(() => () => {}) }
  })
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([])
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
    expect(list).toHaveBeenCalledTimes(1)

    await buttonByText(wrapper, 'סרוק עכשיו').trigger('click')
    // Loading state is visible and the button is disabled.
    const scanBtn = buttonByText(wrapper, 'סורק')
    expect(scanBtn.text()).toContain('סורק')
    expect((scanBtn.element as HTMLButtonElement).disabled).toBe(true)
    expect(scanRun).toHaveBeenCalledTimes(1)

    // Finish the scan: a new invoice now exists in the (mocked) DB.
    list.mockResolvedValue([
      {
        id: 1,
        messageId: 'm',
        date: '2026-05-01',
        dateSource: 'document',
        vendor: 'Acme',
        amount: 50,
        currency: 'ILS',
        localFilePath: 'C:/Docs/Rony Invoices/a.pdf',
        emailBody: null,
        generated: false,
        status: 'downloaded',
        engineType: 'deterministic',
        createdAt: '2026-05-01T00:00:00Z'
      }
    ])
    resolveScan({ scanned: 12, matched: 1, downloaded: 1, rejected: 0, errors: 0 })
    await flushPromises()

    // Table was refreshed from SQLite (list called again) and summary shown.
    expect(list).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('הורדו')
    expect(wrapper.text()).toContain('Acme')
    // Back to idle.
    expect(buttonByText(wrapper, 'סרוק עכשיו').text()).toContain('סרוק עכשיו')
  })

  it('surfaces a scan error inline without crashing the UI', async () => {
    scanRun.mockRejectedValue(new Error('Not connected to Gmail.'))

    const wrapper = mount(App)
    await flushPromises()

    await buttonByText(wrapper, 'סרוק עכשיו').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Not connected to Gmail.')
    // Button recovered to idle and is clickable again.
    const btn = buttonByText(wrapper, 'סרוק עכשיו')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the RONY-17 filtered-files count when documents were rejected', async () => {
    scanRun.mockResolvedValue({ scanned: 20, matched: 5, downloaded: 3, rejected: 2, errors: 0 })

    const wrapper = mount(App)
    await flushPromises()

    await buttonByText(wrapper, 'סרוק עכשיו').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('2 קבצים סוננו')
  })

  it('hides the filtered count when nothing was rejected', async () => {
    scanRun.mockResolvedValue({ scanned: 20, matched: 5, downloaded: 5, rejected: 0, errors: 0 })

    const wrapper = mount(App)
    await flushPromises()

    await buttonByText(wrapper, 'סרוק עכשיו').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('סוננו')
  })
})
