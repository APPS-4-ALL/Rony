<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { Invoice, ScanOptions, ScanProgress, ScanResult } from '@shared/types'
import InvoicesTable from './components/InvoicesTable.vue'
import SettingsView from './components/SettingsView.vue'
import { progressLabel } from './lib/scanControls'

type View = 'dashboard' | 'settings'
const view = ref<View>('dashboard')

/** Top-level tabs (Hebrew labels). */
const tabs = [
  { key: 'dashboard', label: 'לוח בקרה' },
  { key: 'settings', label: 'הגדרות' }
] as const

const pingResult = ref<string>('')
const invoices = ref<Invoice[]>([])
const count = ref<number>(0)
const busy = ref(false)
const error = ref<string>('')

// --- RONY-14 + scan robustness: Scan now, live progress ---
const scanning = ref(false)
const scanSummary = ref<ScanResult | null>(null)
const scanError = ref<string>('')
const scanProgress = ref<ScanProgress | null>(null)

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
 * Run a Gmail scan. Shows live progress, then refreshes the table on
 * completion. Errors surface inline (the UI never crashes).
 */
async function onScan(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  scanError.value = ''
  scanSummary.value = null
  scanProgress.value = null
  try {
    scanSummary.value = await window.api.scan.run(scanOptions())
    await refresh()
  } catch (e) {
    scanError.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanning.value = false
    scanProgress.value = null
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

let unsubscribeProgress: (() => void) | null = null
/** Subscribe to live progress, then load the table. */
onMounted(() => {
  unsubscribeProgress = window.api.scan.onProgress((p) => {
    scanProgress.value = p
  })
  void withGuard(refresh)
})
onUnmounted(() => unsubscribeProgress?.())
</script>

<template>
  <div class="min-h-full bg-slate-950 text-slate-100">
    <div class="mx-auto max-w-3xl px-6 py-10">
      <!-- Header -->
      <header class="mb-8">
        <p class="text-sm font-semibold uppercase tracking-widest text-emerald-400">
          רוני · מבוסס-מקומי
        </p>
        <h1 class="mt-1 text-3xl font-bold">סורק חשבוניות וקבלות</h1>
        <p class="mt-2 text-slate-400">
          סורק את ה-Gmail שלך לאיתור חשבוניות וקבלות, מוריד אותן למחשב ומרכז את כולן בלוח בקרה אחד.
        </p>
      </header>

      <!-- View tabs (RONY-12) -->
      <nav class="mb-8 flex gap-1 border-b border-slate-800">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition"
          :class="
            view === tab.key
              ? 'border-emerald-400 text-emerald-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          "
          @click="view = tab.key"
        >
          {{ tab.label }}
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
          <h2 class="text-lg font-semibold">תקשורת עם השרת</h2>
          <p class="mt-1 text-sm text-slate-400">
            הכפתורים האלה קוראים לתהליך הראשי של Electron דרך גשר IPC מאובטח, שקורא וכותב למסד
            הנתונים המקומי (SQLite).
          </p>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              :disabled="busy"
              @click="onPing"
            >
              בדיקת תקשורת
            </button>
            <span v-if="pingResult" class="text-sm text-emerald-400">
              תשובת השרת: <code class="font-mono">{{ pingResult }}</code>
            </span>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              class="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-600 disabled:opacity-50"
              :disabled="busy"
              @click="onAddSample"
            >
              הוספת חשבונית לדוגמה
            </button>
            <button
              class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
              :disabled="busy"
              @click="() => withGuard(refresh)"
            >
              רענון
            </button>
            <span class="text-sm text-slate-400">
              שורות במסד הנתונים המקומי:
              <span class="font-semibold text-slate-100">{{ count }}</span>
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
              <h2 class="text-lg font-semibold">סריקת תיבת הדואר</h2>
              <p class="mt-1 text-sm text-slate-400">
                משיכת הודעות אחרונות מ-Gmail, זיהוי חשבוניות וקבלות, והורדתן למחשב.
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
              {{ scanning ? 'סורק…' : 'סרוק עכשיו' }}
            </button>
          </div>

          <!-- Per-run controls: message cap + optional date range -->
          <div class="mt-4 flex flex-wrap items-end gap-4">
            <label class="text-sm text-slate-400">
              <span class="mb-1 block">מספר הודעות מרבי</span>
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
              <span class="mb-1 block">מתאריך</span>
              <input
                v-model="scanFrom"
                type="date"
                :disabled="scanning"
                class="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </label>
            <label class="text-sm text-slate-400">
              <span class="mb-1 block">עד תאריך</span>
              <input
                v-model="scanTo"
                type="date"
                :disabled="scanning"
                class="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
          <p class="mt-2 text-xs text-slate-500">
            השאר/י את התאריכים ריקים כדי לסרוק את השנה האחרונה.
          </p>

          <!-- Live progress (scan robustness) -->
          <div v-if="scanning && scanProgress" class="mt-4">
            <p class="text-sm text-slate-300">{{ progressLabel(scanProgress) }}</p>
            <div
              v-if="scanProgress.total > 0"
              class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
            >
              <div
                class="h-full bg-emerald-500 transition-all"
                :style="{
                  width: `${Math.round((scanProgress.processed / scanProgress.total) * 100)}%`
                }"
              />
            </div>
          </div>

          <p
            v-if="scanSummary"
            class="mt-4 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
          >
            נסרקו
            <span class="font-semibold text-slate-100">{{ scanSummary.scanned }}</span> · התאמות
            <span class="font-semibold text-slate-100">{{ scanSummary.matched }}</span> · הורדו
            <span class="font-semibold text-emerald-300">{{ scanSummary.downloaded }}</span>
            <span v-if="scanSummary.errors > 0" class="text-amber-300">
              · {{ scanSummary.errors }} שגיאות
            </span>
          </p>
          <p
            v-if="scanSummary && scanSummary.errors > 0 && scanSummary.errorSample"
            class="mt-2 rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-300"
          >
            {{ scanSummary.errorSample }}
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
