<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Invoice, ScanResult } from '@shared/types'
import InvoicesTable from './components/InvoicesTable.vue'

const pingResult = ref<string>('')
const invoices = ref<Invoice[]>([])
const count = ref<number>(0)
const busy = ref(false)
const error = ref<string>('')

// --- RONY-14: Scan now ---
const scanning = ref(false)
const scanSummary = ref<ScanResult | null>(null)
const scanError = ref<string>('')

/**
 * Run a Gmail scan in the background (RONY-14). Shows a loading state, then
 * refreshes the table from SQLite on completion. Errors are surfaced inline so
 * the UI never crashes (e.g. "not connected" or "AI key not configured").
 */
async function onScan(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  scanError.value = ''
  scanSummary.value = null
  try {
    scanSummary.value = await window.api.scan.run()
    await refresh()
  } catch (e) {
    scanError.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanning.value = false
  }
}

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
          <button
            class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
            :disabled="busy"
            @click="() => withGuard(refresh)"
          >
            Refresh
          </button>
          <span class="text-sm text-slate-400">
            Rows in local DB: <span class="font-semibold text-slate-100">{{ count }}</span>
          </span>
        </div>

        <p v-if="error" class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {{ error }}
        </p>
      </section>

      <!-- Scan now (RONY-14) — triggers the Gmail sync pipeline over IPC -->
      <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">Scan your inbox</h2>
            <p class="mt-1 text-sm text-slate-400">
              Fetch recent Gmail messages, detect invoices &amp; receipts, and download them
              locally.
            </p>
          </div>
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="scanning"
            @click="onScan"
          >
            <svg
              v-if="scanning"
              class="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            {{ scanning ? 'Scanning…' : 'Scan now' }}
          </button>
        </div>

        <p
          v-if="scanSummary"
          class="mt-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
        >
          Scanned <span class="font-semibold text-slate-100">{{ scanSummary.scanned }}</span> ·
          matched <span class="font-semibold text-slate-100">{{ scanSummary.matched }}</span> ·
          downloaded
          <span class="font-semibold text-emerald-300">{{ scanSummary.downloaded }}</span>
          <span v-if="scanSummary.errors > 0" class="text-amber-300">
            · {{ scanSummary.errors }} error{{ scanSummary.errors === 1 ? '' : 's' }}
          </span>
        </p>
        <p v-if="scanError" class="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {{ scanError }}
        </p>
      </section>

      <!-- Invoices dashboard table (RONY-13) — renders directly from SQLite -->
      <div class="mt-6">
        <InvoicesTable :invoices="invoices" />
      </div>
    </div>
  </div>
</template>
