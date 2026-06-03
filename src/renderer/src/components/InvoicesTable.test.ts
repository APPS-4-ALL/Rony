// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import InvoicesTable from './InvoicesTable.vue'
import { setLocale } from '../lib/useI18n'
import type { Invoice } from '@shared/types'

/** Build an Invoice with sensible defaults; override only what a test needs. */
function inv(over: Partial<Invoice>): Invoice {
  return {
    id: 1,
    messageId: null,
    date: '2026-01-01',
    vendor: 'Acme',
    amount: 100,
    currency: 'ILS',
    localFilePath: null,
    status: 'downloaded',
    engineType: 'deterministic',
    createdAt: '2026-01-01T00:00:00Z',
    ...over
  }
}

const openFile = vi.fn<(id: number) => Promise<string>>()
const saveFile = vi.fn<(req: { defaultName: string; content: string }) => Promise<string | null>>()

beforeEach(() => {
  setLocale('en') // assertions below check the English strings
  openFile.mockReset()
  openFile.mockResolvedValue('')
  saveFile.mockReset()
  saveFile.mockResolvedValue('C:/Docs/invoices-2026-06-02.csv')
  // The component calls window.api.invoices.openFile + window.api.dialog.saveFile.
  vi.stubGlobal('api', { invoices: { openFile }, dialog: { saveFile } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Vendor cell (2nd column) text for every rendered body row, in order. */
function vendorOrder(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('tbody tr').map((tr) => tr.findAll('td')[1].text())
}

describe('InvoicesTable.vue', () => {
  it('renders one row per invoice and a count summary', () => {
    const wrapper = mount(InvoicesTable, {
      props: { invoices: [inv({ id: 1 }), inv({ id: 2 }), inv({ id: 3 })] }
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.text()).toContain('Showing 3 of 3')
  })

  it('shows the empty state when there are no invoices', () => {
    const wrapper = mount(InvoicesTable, { props: { invoices: [] } })
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.text()).toContain('No invoices yet')
  })

  it('disables Open file when there is no local file, enables it otherwise', () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [
          inv({ id: 1, vendor: 'NoFile', localFilePath: null }),
          inv({ id: 2, vendor: 'HasFile', localFilePath: 'C:/Docs/Rony Invoices/a.pdf' })
        ]
      }
    })
    // Map each row's vendor → whether its Open-file button is disabled.
    const state = new Map(
      wrapper.findAll('tbody tr').map((tr) => {
        const vendor = tr.findAll('td')[1].text()
        const disabled = (tr.find('button').element as HTMLButtonElement).disabled
        return [vendor, disabled] as const
      })
    )
    expect(state.get('NoFile')).toBe(true) // null path → disabled
    expect(state.get('HasFile')).toBe(false) // has path → enabled
  })

  it('calls window.api.invoices.openFile with the invoice id when clicked', async () => {
    const wrapper = mount(InvoicesTable, {
      props: { invoices: [inv({ id: 42, localFilePath: 'C:/Docs/Rony Invoices/x.pdf' })] }
    })
    await wrapper.find('tbody tr button').trigger('click')
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(openFile).toHaveBeenCalledWith(42)
  })

  it('sorts by amount when the Amount header is clicked', async () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [
          inv({ id: 1, amount: 30, vendor: 'C30' }),
          inv({ id: 2, amount: 10, vendor: 'A10' }),
          inv({ id: 3, amount: 20, vendor: 'B20' })
        ]
      }
    })
    const amountHeader = wrapper.findAll('thead th').find((th) => th.text().includes('Amount'))!
    await amountHeader.trigger('click') // first click → ascending
    expect(vendorOrder(wrapper)).toEqual(['A10', 'B20', 'C30'])
    await amountHeader.trigger('click') // second click → descending
    expect(vendorOrder(wrapper)).toEqual(['C30', 'B20', 'A10'])
  })

  it('filters rows by the search box and shows a no-match state', async () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [inv({ id: 1, vendor: 'Electric Co' }), inv({ id: 2, vendor: 'Water Ltd' })]
      }
    })
    await wrapper.find('input[type="search"]').setValue('electric')
    expect(vendorOrder(wrapper)).toEqual(['Electric Co'])
    expect(wrapper.text()).toContain('Showing 1 of 2')

    await wrapper.find('input[type="search"]').setValue('zzzz')
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.text()).toContain('No invoices match')
  })

  it('exports the filtered rows to CSV via the save dialog (RONY-15)', async () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [inv({ id: 1, vendor: 'Electric Co' }), inv({ id: 2, vendor: 'Water Ltd' })]
      }
    })
    // Narrow to one row, then export — only the shown row should be in the CSV.
    await wrapper.find('input[type="search"]').setValue('electric')

    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('Export'))!
    await exportBtn.trigger('click')
    await flushPromises()

    expect(saveFile).toHaveBeenCalledTimes(1)
    const { defaultName, content } = saveFile.mock.calls[0][0]
    expect(defaultName).toMatch(/^invoices-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(content).toContain('Date,Vendor,Amount,Currency,Found by,Status,File')
    expect(content).toContain('Electric Co')
    expect(content).not.toContain('Water Ltd') // filtered out
    expect(wrapper.text()).toContain('Exported 1 row')
  })

  it('disables Export when there are no rows', () => {
    const wrapper = mount(InvoicesTable, { props: { invoices: [] } })
    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('Export'))!
    expect((exportBtn.element as HTMLButtonElement).disabled).toBe(true)
  })
})
