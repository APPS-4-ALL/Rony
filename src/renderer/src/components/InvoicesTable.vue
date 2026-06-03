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
import { useI18n } from '../lib/useI18n'
import type { MessageKey } from '../lib/i18n'

const { t } = useI18n()

const props = defineProps<{ invoices: Invoice[] }>()

const search = ref('')
const sortKey = ref<SortKey>('date')
const sortDir = ref<SortDir>('desc')

/** Filter then sort — both pure, both unit-tested in invoiceTable.test.ts. */
const rows = computed<Invoice[]>(() =>
  sortInvoices(filterInvoices(props.invoices, search.value), sortKey.value, sortDir.value)
)

/** Sortable column definitions, in display order. `label` is an i18n key. */
const columns: ReadonlyArray<{ key: SortKey; label: MessageKey }> = [
  { key: 'date', label: 'col.date' },
  { key: 'vendor', label: 'col.vendor' },
  { key: 'amount', label: 'col.amount' },
  { key: 'engineType', label: 'col.foundBy' },
  { key: 'status', label: 'col.status' }
]

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

const openError = ref('')

/** Open the invoice's local file via the OS (RONY-13 DoD button). We send only
 * the invoice id — the main process resolves + validates the path (security). */
async function openFile(inv: Invoice): Promise<void> {
  openError.value = ''
  if (!inv.localFilePath) return
  const err = await window.api.invoices.openFile(inv.id)
  if (err) openError.value = err
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
    exportNote.value = savedPath
      ? t('table.exported', { count: rows.value.length, path: savedPath })
      : '' // user cancelled the dialog — say nothing
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
      <h2 class="text-lg font-semibold">{{ t('table.title') }}</h2>
      <div class="flex items-center gap-2">
        <input
          v-model="search"
          type="search"
          :placeholder="t('table.search')"
          class="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="exporting || rows.length === 0"
          :title="rows.length === 0 ? t('table.exportTitleEmpty') : t('table.exportTitle')"
          @click="exportCsv"
        >
          {{ exporting ? t('table.exporting') : t('table.export') }}
        </button>
      </div>
    </div>

    <p class="mt-1 text-sm text-slate-400">
      {{ t('table.showing', { shown: rows.length, total: props.invoices.length }) }}
    </p>

    <div v-if="props.invoices.length === 0" class="mt-4 text-sm text-slate-500">
      {{ t('table.empty') }}
    </div>
    <div v-else-if="rows.length === 0" class="mt-4 text-sm text-slate-500">
      {{ t('table.noMatch', { query: search }) }}
    </div>

    <table v-else class="mt-4 w-full text-start text-sm">
      <thead class="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="cursor-pointer select-none py-2 pe-4 hover:text-slate-200"
            @click="toggleSort(col.key)"
          >
            {{ t(col.label) }}
            <span class="text-emerald-400">{{ sortIndicator(col.key) }}</span>
          </th>
          <th class="py-2">{{ t('col.file') }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        <tr v-for="inv in rows" :key="inv.id" class="hover:bg-slate-800/40">
          <td class="py-2 pe-4 text-slate-400">{{ formatDate(inv.date) }}</td>
          <td class="py-2 pe-4">{{ inv.vendor ?? '—' }}</td>
          <td class="py-2 pe-4 font-mono">{{ formatAmount(inv.amount, inv.currency) }}</td>
          <td class="py-2 pe-4">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="
                inv.engineType === 'ai'
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'bg-emerald-500/15 text-emerald-300'
              "
            >
              {{ t(`engine.${inv.engineType}`) }}
            </span>
          </td>
          <td class="py-2 pe-4 text-slate-400">{{ t(`status.${inv.status}`) }}</td>
          <td class="py-2">
            <button
              class="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-200"
              :disabled="!inv.localFilePath"
              :title="inv.localFilePath ?? t('table.notDownloaded')"
              @click="openFile(inv)"
            >
              {{ t('table.open') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="openError" class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {{ t('table.openError', { error: openError }) }}
    </p>
    <p v-if="exportNote" class="mt-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
      {{ exportNote }}
    </p>
  </section>
</template>
