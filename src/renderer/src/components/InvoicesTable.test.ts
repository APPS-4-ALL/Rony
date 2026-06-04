// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import InvoicesTable from './InvoicesTable.vue'
import type { Invoice } from '@shared/types'

/** Build an Invoice with sensible defaults; override only what a test needs. */
function inv(over: Partial<Invoice>): Invoice {
  return {
    id: 1,
    messageId: null,
    date: '2026-01-01',
    dateSource: 'email',
    vendor: 'Acme',
    amount: 100,
    currency: 'ILS',
    localFilePath: null,
    emailBody: null,
    generated: false,
    status: 'downloaded',
    engineType: 'deterministic',
    createdAt: '2026-01-01T00:00:00Z',
    ...over
  }
}

const openFile = vi.fn<(id: number) => Promise<string>>()
const deleteInvoice = vi.fn<(id: number) => Promise<string>>()
const saveFile = vi.fn<(req: { defaultName: string; content: string }) => Promise<string | null>>()

beforeEach(() => {
  openFile.mockReset()
  openFile.mockResolvedValue('')
  deleteInvoice.mockReset()
  deleteInvoice.mockResolvedValue('')
  saveFile.mockReset()
  saveFile.mockResolvedValue('C:/Docs/invoices-2026-06-02.csv')
  // Confirm "yes" by default; cancel-path tests override this.
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  )
  // The component calls window.api.invoices.openFile/delete + window.api.dialog.saveFile.
  vi.stubGlobal('api', { invoices: { openFile, delete: deleteInvoice }, dialog: { saveFile } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Vendor cell (2nd column) text for every rendered body row, in order. */
function vendorOrder(wrapper: ReturnType<typeof mount>): string[] {
  // Cells: [0] marker, [1] date, [2] vendor, …
  return wrapper.findAll('tbody tr').map((tr) => tr.findAll('td')[2].text())
}

describe('InvoicesTable.vue', () => {
  it('renders one row per invoice and a count summary', () => {
    const wrapper = mount(InvoicesTable, {
      props: { invoices: [inv({ id: 1 }), inv({ id: 2 }), inv({ id: 3 })] }
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.text()).toContain('מציג 3 מתוך 3')
  })

  it('shows the empty state when there are no invoices', () => {
    const wrapper = mount(InvoicesTable, { props: { invoices: [] } })
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.text()).toContain('אין עדיין חשבוניות')
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
        const vendor = tr.findAll('td')[2].text()
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
    const amountHeader = wrapper.findAll('thead th').find((th) => th.text().includes('סכום'))!
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
    expect(wrapper.text()).toContain('מציג 1 מתוך 2')

    await wrapper.find('input[type="search"]').setValue('zzzz')
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    expect(wrapper.text()).toContain('אין חשבוניות התואמות')
  })

  it('exports the filtered rows to CSV via the save dialog (RONY-15)', async () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [inv({ id: 1, vendor: 'Electric Co' }), inv({ id: 2, vendor: 'Water Ltd' })]
      }
    })
    // Narrow to one row, then export — only the shown row should be in the CSV.
    await wrapper.find('input[type="search"]').setValue('electric')

    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('ייצוא'))!
    await exportBtn.trigger('click')
    await flushPromises()

    expect(saveFile).toHaveBeenCalledTimes(1)
    const { defaultName, content } = saveFile.mock.calls[0][0]
    expect(defaultName).toMatch(/^invoices-\d{4}-\d{2}-\d{2}\.csv$/)
    // CSV header stays English for stable, portable data interchange.
    expect(content).toContain('Date,Vendor,Amount,Currency,Found by,Status,File')
    expect(content).toContain('Electric Co')
    expect(content).not.toContain('Water Ltd') // filtered out
    expect(wrapper.text()).toContain('יוצאו 1 שורות')
  })

  it('disables Export when there are no rows', () => {
    const wrapper = mount(InvoicesTable, { props: { invoices: [] } })
    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('ייצוא'))!
    expect((exportBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('deletes an invoice after confirming and emits "deleted"', async () => {
    const wrapper = mount(InvoicesTable, { props: { invoices: [inv({ id: 7 })] } })
    await wrapper.find('button[aria-label="מחיקה"]').trigger('click')
    await flushPromises()
    expect(deleteInvoice).toHaveBeenCalledWith(7)
    expect(wrapper.emitted('deleted')).toHaveLength(1)
  })

  it('does not delete (or emit) when the user cancels the confirm', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    )
    const wrapper = mount(InvoicesTable, { props: { invoices: [inv({ id: 7 })] } })
    await wrapper.find('button[aria-label="מחיקה"]').trigger('click')
    await flushPromises()
    expect(deleteInvoice).not.toHaveBeenCalled()
    expect(wrapper.emitted('deleted')).toBeUndefined()
  })

  it('shows the error and does not emit when delete fails (e.g. file locked)', async () => {
    deleteInvoice.mockResolvedValue(
      'לא ניתן למחוק — הקובץ כנראה פתוח בתוכנה אחרת. סגור/י אותו ונסה/י שוב.'
    )
    const wrapper = mount(InvoicesTable, { props: { invoices: [inv({ id: 7 })] } })
    await wrapper.find('button[aria-label="מחיקה"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('deleted')).toBeUndefined()
    expect(wrapper.text()).toContain('הקובץ כנראה פתוח בתוכנה אחרת')
  })

  it('shows a date-provenance tooltip per row (document vs email)', () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [
          inv({ id: 1, vendor: 'Doc', dateSource: 'document' }),
          inv({ id: 2, vendor: 'Mail', dateSource: 'email' })
        ]
      }
    })
    const titles = wrapper
      .findAll('tbody tr')
      .map((tr) => tr.find('td span[title]').attributes('title'))
    expect(titles).toContain('תאריך מהחשבונית')
    expect(titles).toContain('תאריך קבלת המייל')
  })

  it('tints rows added by the latest scan and badges them while showBadge is on', () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [inv({ id: 1, vendor: 'Old' }), inv({ id: 2, vendor: 'Fresh' })],
        newIds: new Set([2]),
        showBadge: true
      }
    })
    const rows = wrapper.findAll('tbody tr')
    const newRow = rows.find((r) => r.text().includes('Fresh'))!
    const oldRow = rows.find((r) => r.text().includes('Old'))!
    expect(newRow.classes()).toContain('bg-emerald-500/10') // tint
    expect(newRow.text()).toContain('חדש') // badge
    expect(oldRow.classes()).not.toContain('bg-emerald-500/10')
    expect(oldRow.text()).not.toContain('חדש')
  })

  it('keeps the tint but drops the badge once showBadge is off (after the flash)', () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [inv({ id: 2, vendor: 'Fresh' })],
        newIds: new Set([2]),
        showBadge: false
      }
    })
    const row = wrapper.find('tbody tr')
    expect(row.classes()).toContain('bg-emerald-500/10') // still tinted
    expect(row.text()).not.toContain('חדש') // badge gone
  })

  it('shows a "מהמייל" status and a "הצג מייל" popup for a body-only receipt', async () => {
    const wrapper = mount(InvoicesTable, {
      props: { invoices: [inv({ id: 1, localFilePath: null, emailBody: 'סך הכל: 64.00 ₪' })] }
    })
    expect(wrapper.text()).toContain('מהמייל') // status, not "הורד"
    const viewBtn = wrapper.findAll('button').find((b) => b.text().includes('הצג מייל'))!
    expect(viewBtn).toBeTruthy()
    await viewBtn.trigger('click')
    expect(wrapper.text()).toContain('סך הכל: 64.00 ₪') // body shown in the popup
  })

  it('shows "הופק מהמייל" and a working open button for a generated-PDF row', () => {
    const wrapper = mount(InvoicesTable, {
      props: {
        invoices: [
          inv({ id: 1, localFilePath: 'C:/Docs/Rony Invoices/m__email.pdf', generated: true })
        ]
      }
    })
    expect(wrapper.text()).toContain('הופק מהמייל') // not "הורד", not "מהמייל"
    const buttons = wrapper.findAll('button')
    expect(buttons.some((b) => b.text().includes('פתיחת קובץ'))).toBe(true)
    expect(buttons.some((b) => b.text().includes('הצג מייל'))).toBe(false) // popup not needed
  })
})
