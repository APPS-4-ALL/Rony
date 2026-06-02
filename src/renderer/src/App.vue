<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Invoice, ScanOptions, ScanResult } from '@shared/types'
import InvoicesTable from './components/InvoicesTable.vue'
import SettingsView from './components/SettingsView.vue'
import { useI18n } from './lib/useI18n'

const { t, locale, setLocale } = useI18n()

/** Flip between the two languages from the header toggle. */
function toggleLocale(): void {
  setLocale(locale.value === 'he' ? 'en' : 'he')
}

type View = 'dashboard' | 'settings'
const view = ref<View>('dashboard')

const pingResult = ref<string>('')
const invoices = ref<Invoice[]>([])
const count = ref<number>(0)
const busy = ref(false)
const error = ref<string>('')

// --- RONY-14: Scan now ---
const scanning = ref(false)
const scanSummary = ref<ScanResult | null>(null)
const scanError = ref<string>('')

// Per-run scan controls (count + optional date range). Empty dates → the
// engine's default 1-year look-back; the main process re-validates these.
const scanMax = ref<number>(50)
const scanFrom = ref<string>('')
const scanTo = ref<string>('')

/** Build the options payload, omitting blank/invalid fields. */
function scanOptions(): ScanOptions {
  const opts: ScanOptions = {}
  if (Number.isFinite(scanMax.value) && scanMax.value > 0) opts.maxResults = scanMax.value
  if (scanFrom.value) opts.after = scanFrom.value
  if (scanTo.value) opts.before = scanTo.value
  return opts
}

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
    scanSummary.value = await window.api.scan.run(scanOptions())
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

/** Apply the persisted language as early as possible, then load the table. */
onMounted(() =>
  withGuard(async () => {
    const settings = await window.api.settings.get()
    setLocale(settings.locale)
    await refresh()
  })
)
</script>

<template>
  <div class="min-h-full bg-slate-950 text-slate-100">
    <div class="mx-auto max-w-3xl px-6 py-10">
      <!-- Header -->
      <header class="mb-8">
        <div class="flex items-start justify-between gap-4">
          <p class="text-sm font-semibold uppercase tracking-widest text-emerald-400">
            {{ t('app.tagline') }}
          </p>
          <button
            class="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300"
            :title="locale === 'he' ? 'Switch to English' : 'מעבר לעברית'"
            @click="toggleLocale"
          >
            {{ locale === 'he' ? 'English' : 'עברית' }}
          </button>
        </div>
        <h1 class="mt-1 text-3xl font-bold">{{ t('app.title') }}</h1>
        <p class="mt-2 text-slate-400">{{ t('app.subtitle') }}</p>
      </header>

      <!-- View tabs (RONY-12) -->
      <nav class="mb-8 flex gap-1 border-b border-slate-800">
        <button
          v-for="tab in ['dashboard', 'settings'] as const"
          :key="tab"
          class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition"
          :class="
            view === tab
              ? 'border-emerald-400 text-emerald-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          "
          @click="view = tab"
        >
          {{ t(`nav.${tab}`) }}
        </button>
      </nav>

      <template v-if="view === 'settings'">
        <SettingsView />
      </template>

      <template v-else>
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
          <h2 class="text-lg font-semibold">{{ t('backend.title') }}</h2>
          <p class="mt-1 text-sm text-slate-400">{{ t('backend.desc') }}</p>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              :disabled="busy"
              @click="onPing"
            >
              {{ t('backend.ping') }}
            </button>
            <span v-if="pingResult" class="text-sm text-emerald-400">
              {{ t('backend.replied') }} <code class="font-mono">{{ pingResult }}</code>
            </span>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              class="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-600 disabled:opacity-50"
              :disabled="busy"
              @click="onAddSample"
            >
              {{ t('backend.addSample') }}
            </button>
            <button
              class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
              :disabled="busy"
              @click="() => withGuard(refresh)"
            >
              {{ t('backend.refresh') }}
            </button>
            <span class="text-sm text-slate-400">
              {{ t('backend.rows') }} <span class="font-semibold text-slate-100">{{ count }}</span>
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
              <h2 class="text-lg font-semibold">{{ t('scan.title') }}</h2>
              <p class="mt-1 text-sm text-slate-400">{{ t('scan.desc') }}</p>
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
              {{ scanning ? t('scan.scanning') : t('scan.now') }}
            </button>
          </div>

          <!-- Per-run controls: message cap + optional date range -->
          <div class="mt-4 flex flex-wrap items-end gap-4">
            <label class="text-sm text-slate-400">
              <span class="mb-1 block">{{ t('scan.maxLabel') }}</span>
              <input
                v-model.number="scanMax"
                type="number"
                min="1"
                max="1000"
                :disabled="scanning"
                class="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </label>
            <label class="text-sm text-slate-400">
              <span class="mb-1 block">{{ t('scan.fromLabel') }}</span>
              <input
                v-model="scanFrom"
                type="date"
                :disabled="scanning"
                class="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </label>
            <label class="text-sm text-slate-400">
              <span class="mb-1 block">{{ t('scan.toLabel') }}</span>
              <input
                v-model="scanTo"
                type="date"
                :disabled="scanning"
                class="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
          <p class="mt-2 text-xs text-slate-500">{{ t('scan.rangeHint') }}</p>

          <p
            v-if="scanSummary"
            class="mt-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
          >
            {{ t('scan.scanned') }}
            <span class="font-semibold text-slate-100">{{ scanSummary.scanned }}</span> ·
            {{ t('scan.matched') }}
            <span class="font-semibold text-slate-100">{{ scanSummary.matched }}</span> ·
            {{ t('scan.downloaded') }}
            <span class="font-semibold text-emerald-300">{{ scanSummary.downloaded }}</span>
            <span v-if="scanSummary.errors > 0" class="text-amber-300">
              · {{ t('scan.errors', { count: scanSummary.errors }) }}
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
      </template>
    </div>
  </div>
</template>
