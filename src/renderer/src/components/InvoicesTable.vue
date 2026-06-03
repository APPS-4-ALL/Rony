<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Invoice } from '@shared/types'
import {
  filterInvoices,
  formatAmount,
  formatDate,
  invoicesToCsv,
  sortInvoices,
  type SortDir,
  type SortKey
} from '../lib/invoiceTable'

const props = defineProps<{ invoices: Invoice[] }>()
/** Tell the parent to reload after a row is deleted (it owns the list). */
const emit = defineEmits<{ deleted: [] }>()

const search = ref('')
const sortKey = ref<SortKey>('date')
const sortDir = ref<SortDir>('desc')

/** Filter then sort — both pure, both unit-tested in invoiceTable.test.ts. */
const rows = computed<Invoice[]>(() =>
  sortInvoices(filterInvoices(props.invoices, search.value), sortKey.value, sortDir.value)
)

/** Sortable column definitions, in display order (Hebrew labels). */
const columns: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'date', label: 'תאריך' },
  { key: 'vendor', label: 'ספק' },
  { key: 'amount', label: 'סכום' },
  { key: 'engineType', label: 'סוג סריקה' },
  { key: 'status', label: 'סטטוס' }
]

/** Hebrew label for which engine catalogued a row. */
function engineLabel(engine: Invoice['engineType']): string {
  return engine === 'ai' ? 'חכמה' : 'רגילה'
}

/** Hebrew label for an invoice's processing status. */
function statusLabel(status: Invoice['status']): string {
  switch (status) {
    case 'pending':
      return 'ממתין'
    case 'downloaded':
      return 'הורד'
    case 'exported':
      return 'יוצא'
    case 'error':
      return 'שגיאה'
  }
}

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '▲' : '▼'
}

/** Tooltip explaining where a row's date came from (empty for legacy rows). */
function dateSourceTitle(source: Invoice['dateSource']): string {
  if (source === 'document') return 'תאריך מהחשבונית'
  if (source === 'email') return 'תאריך קבלת המייל'
  return ''
}

const openError = ref('')

/** Open the invoice's local file via the OS (RONY-13 DoD button). We send only
 * the invoice id — the main process resolves + validates the path (security). */
async function openFile(inv: Invoice): Promise<void> {
  openError.value = ''
  if (!inv.localFilePath) return
  const err = await window.api.invoices.openFile(inv.id)
  if (err) openError.value = err
}

/** Delete the invoice (row + its file). Confirms first — it removes the file. */
async function removeInvoice(inv: Invoice): Promise<void> {
  openError.value = ''
  const name = inv.vendor ?? 'חשבונית זו'
  if (!window.confirm(`למחוק את "${name}"? הפעולה תמחק גם את הקובץ מהמחשב ואינה הפיכה.`)) return
  const err = await window.api.invoices.delete(inv.id)
  if (err) {
    openError.value = err
    return
  }
  emit('deleted')
}

const exporting = ref(false)
const exportNote = ref('')

/**
 * Export the currently displayed rows (filtered + sorted) to a CSV via the OS
 * save dialog (RONY-15). A UTF-8 BOM is prepended so Excel renders Hebrew
 * vendor names correctly.
 */
async function exportCsv(): Promise<void> {
  if (exporting.value || rows.value.length === 0) return
  exporting.value = true
  exportNote.value = ''
  try {
    const BOM = '﻿' // helps Excel detect UTF-8 (Hebrew vendor names)
    const csv = BOM + invoicesToCsv(rows.value)
    const defaultName = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
    const savedPath = await window.api.dialog.saveFile({ defaultName, content: csv })
    exportNote.value = savedPath ? `יוצאו ${rows.value.length} שורות אל ${savedPath}` : '' // user cancelled the dialog — say nothing
  } catch (e) {
    exportNote.value = e instanceof Error ? e.message : String(e)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">חשבוניות</h2>
      <div class="flex items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="סינון לפי ספק, תאריך, סכום…"
          class="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="exporting || rows.length === 0"
          :title="rows.length === 0 ? 'אין מה לייצא' : 'ייצוא השורות המוצגות לקובץ CSV'"
          @click="exportCsv"
        >
          {{ exporting ? 'מייצא…' : 'ייצוא ל-CSV' }}
        </button>
      </div>
    </div>

    <p class="mt-1 text-sm text-slate-400">
      מציג {{ rows.length }} מתוך {{ props.invoices.length }} חשבוניות השמורות במחשב.
    </p>

    <div v-if="props.invoices.length === 0" class="mt-4 text-sm text-slate-500">
      אין עדיין חשבוניות — הרץ סריקה (או הוסף דוגמה) כדי למלא את הטבלה.
    </div>
    <div v-else-if="rows.length === 0" class="mt-4 text-sm text-slate-500">
      אין חשבוניות התואמות ל“{{ search }}”.
    </div>

    <table v-else class="mt-4 w-full text-center text-sm">
      <thead class="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="cursor-pointer select-none py-2 px-3 hover:text-slate-200"
            @click="toggleSort(col.key)"
          >
            {{ col.label }}
            <span class="text-emerald-400">{{ sortIndicator(col.key) }}</span>
          </th>
          <th class="py-2 px-3">פעולות</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        <tr v-for="inv in rows" :key="inv.id" class="hover:bg-slate-800/40">
          <td class="whitespace-nowrap py-2 px-3 text-slate-400">
            <span
              class="inline-flex items-center justify-center gap-1.5"
              :title="dateSourceTitle(inv.dateSource)"
            >
              {{ formatDate(inv.date) }}
              <!-- Provenance: 📄 = read off the invoice, ✉️ = the email's date -->
              <svg
                v-if="inv.date && inv.dateSource === 'document'"
                class="h-3.5 w-3.5 text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-label="תאריך מהחשבונית"
              >
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5" />
              </svg>
              <svg
                v-else-if="inv.date && inv.dateSource === 'email'"
                class="h-3.5 w-3.5 text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-label="תאריך קבלת המייל"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </span>
          </td>
          <td class="py-2 px-3">{{ inv.vendor ?? '—' }}</td>
          <td class="py-2 px-3 font-mono">{{ formatAmount(inv.amount, inv.currency) }}</td>
          <td class="py-2 px-3">
            <span
              class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
              :class="
                inv.engineType === 'ai'
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'bg-emerald-500/15 text-emerald-300'
              "
            >
              {{ engineLabel(inv.engineType) }}
            </span>
          </td>
          <td class="py-2 px-3 text-slate-400">{{ statusLabel(inv.status) }}</td>
          <td class="py-2 px-3">
            <div class="flex items-center justify-center gap-2">
              <button
                class="whitespace-nowrap rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-200"
                :disabled="!inv.localFilePath"
                :title="inv.localFilePath ?? 'טרם הורד'"
                @click="openFile(inv)"
              >
                פתיחת קובץ
              </button>
              <button
                class="rounded-md border border-slate-700 p-1.5 text-slate-300 transition hover:border-red-500 hover:text-red-300"
                title="מחיקת החשבונית והקובץ"
                aria-label="מחיקה"
                @click="removeInvoice(inv)"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="openError" class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
      לא ניתן לפתוח את הקובץ: {{ openError }}
    </p>
    <p v-if="exportNote" class="mt-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
      {{ exportNote }}
    </p>
  </section>
</template>
