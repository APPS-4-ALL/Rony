<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Invoice } from '@shared/types'

const pingResult = ref<string>('')
const invoices = ref<Invoice[]>([])
const count = ref<number>(0)
const busy = ref(false)
const error = ref<string>('')

async function refresh(): Promise<void> {
  count.value = await window.api.invoices.count()
  invoices.value = await window.api.invoices.list()
}

async function withGuard(fn: () => Promise<void>): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

const onPing = (): Promise<void> =>
  withGuard(async () => {
    pingResult.value = await window.api.ping()
  })

const onAddSample = (): Promise<void> =>
  withGuard(async () => {
    await window.api.invoices.addSample()
    await refresh()
  })

onMounted(() => withGuard(refresh))
</script>

<template>
  <div class="min-h-full bg-slate-950 text-slate-100">
    <div class="mx-auto max-w-3xl px-6 py-10">
      <!-- Header -->
      <header class="mb-8">
        <p class="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          Roni · Local-first
        </p>
        <h1 class="mt-1 text-3xl font-bold">Invoice &amp; Receipt Scanner</h1>
        <p class="mt-2 text-slate-400">
          Scans your Gmail for invoices and receipts, downloads them locally, and centralises them
          in one dashboard.
        </p>
      </header>

      <!-- Stack badges -->
      <div class="mb-8 flex flex-wrap gap-2">
        <span
          v-for="tech in ['Electron', 'Vue 3', 'Vite', 'TypeScript', 'TailwindCSS', 'SQLite']"
          :key="tech"
          class="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300"
        >
          {{ tech }}
        </span>
      </div>

      <!-- Backend self-check: exercises IPC (RONY-4) + SQLite (RONY-3) -->
      <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 class="text-lg font-semibold">Backend connectivity</h2>
        <p class="mt-1 text-sm text-slate-400">
          These buttons call the Electron main process over a secure IPC bridge, which reads and
          writes the local SQLite database.
        </p>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            :disabled="busy"
            @click="onPing"
          >
            Ping main process
          </button>
          <span v-if="pingResult" class="text-sm text-emerald-400">
            → main replied: <code class="font-mono">{{ pingResult }}</code>
          </span>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            class="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-600 disabled:opacity-50"
            :disabled="busy"
            @click="onAddSample"
          >
            Add sample invoice
          </button>
          <span class="text-sm text-slate-400">
            Rows in local DB: <span class="font-semibold text-slate-100">{{ count }}</span>
          </span>
        </div>

        <p v-if="error" class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {{ error }}
        </p>
      </section>

      <!-- Invoices table -->
      <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 class="text-lg font-semibold">Stored invoices</h2>
        <div v-if="invoices.length === 0" class="mt-3 text-sm text-slate-500">
          No invoices yet — add a sample above.
        </div>
        <table v-else class="mt-3 w-full text-left text-sm">
          <thead class="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="py-2 pr-4">#</th>
              <th class="py-2 pr-4">Vendor</th>
              <th class="py-2 pr-4">Date</th>
              <th class="py-2 pr-4">Amount</th>
              <th class="py-2 pr-4">Engine</th>
              <th class="py-2">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            <tr v-for="inv in invoices" :key="inv.id">
              <td class="py-2 pr-4 font-mono text-slate-500">{{ inv.id }}</td>
              <td class="py-2 pr-4">{{ inv.vendor ?? '—' }}</td>
              <td class="py-2 pr-4 text-slate-400">{{ inv.date ?? '—' }}</td>
              <td class="py-2 pr-4">
                {{ inv.amount != null ? `${inv.amount} ${inv.currency ?? ''}`.trim() : '—' }}
              </td>
              <td class="py-2 pr-4 text-slate-400">{{ inv.engineType }}</td>
              <td class="py-2 text-slate-400">{{ inv.status }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
