<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Invoice } from '@shared/types'
import {
  engineLabel,
  filterInvoices,
  formatAmount,
  formatDate,
  sortInvoices,
  type SortDir,
  type SortKey
} from '../lib/invoiceTable'

const props = defineProps<{ invoices: Invoice[] }>()

const search = ref('')
const sortKey = ref<SortKey>('date')
const sortDir = ref<SortDir>('desc')

/** Filter then sort — both pure, both unit-tested in invoiceTable.test.ts. */
const rows = computed<Invoice[]>(() =>
  sortInvoices(filterInvoices(props.invoices, search.value), sortKey.value, sortDir.value)
)

/** Sortable column definitions, in display order. */
const columns: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'date', label: 'Date' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'amount', label: 'Amount' },
  { key: 'engineType', label: 'Found by' },
  { key: 'status', label: 'Status' }
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
</script>

<template>
  <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Invoices</h2>
      <input
        v-model="search"
        type="search"
        placeholder="Filter by vendor, date, amount…"
        class="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
      />
    </div>

    <p class="mt-1 text-sm text-slate-400">
      Showing <span class="font-semibold text-slate-100">{{ rows.length }}</span> of
      {{ props.invoices.length }} invoice{{ props.invoices.length === 1 ? '' : 's' }} stored
      locally.
    </p>

    <div v-if="props.invoices.length === 0" class="mt-4 text-sm text-slate-500">
      No invoices yet — run a scan (or add a sample) to populate the table.
    </div>
    <div v-else-if="rows.length === 0" class="mt-4 text-sm text-slate-500">
      No invoices match “{{ search }}”.
    </div>

    <table v-else class="mt-4 w-full text-left text-sm">
      <thead class="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="cursor-pointer select-none py-2 pr-4 hover:text-slate-200"
            @click="toggleSort(col.key)"
          >
            {{ col.label }}
            <span class="text-emerald-400">{{ sortIndicator(col.key) }}</span>
          </th>
          <th class="py-2">File</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        <tr v-for="inv in rows" :key="inv.id" class="hover:bg-slate-800/40">
          <td class="py-2 pr-4 text-slate-400">{{ formatDate(inv.date) }}</td>
          <td class="py-2 pr-4">{{ inv.vendor ?? '—' }}</td>
          <td class="py-2 pr-4 font-mono">{{ formatAmount(inv.amount, inv.currency) }}</td>
          <td class="py-2 pr-4">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="
                inv.engineType === 'ai'
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'bg-emerald-500/15 text-emerald-300'
              "
            >
              {{ engineLabel(inv.engineType) }}
            </span>
          </td>
          <td class="py-2 pr-4 text-slate-400">{{ inv.status }}</td>
          <td class="py-2">
            <button
              class="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-200"
              :disabled="!inv.localFilePath"
              :title="inv.localFilePath ?? 'Not downloaded yet'"
              @click="openFile(inv)"
            >
              Open file
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="openError" class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
      Couldn’t open file: {{ openError }}
    </p>
  </section>
</template>
