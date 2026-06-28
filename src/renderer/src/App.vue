<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { Invoice, ScanOptions, ScanProgress, ScanResult, Theme } from '@shared/types'
import InvoicesTable from './components/InvoicesTable.vue'
import SettingsView from './components/SettingsView.vue'
import {
  progressLabel,
  COUNT_OPTIONS,
  RANGE_PRESETS,
  isoDaysAgo,
  rangeDays,
  type RangeKey
} from './lib/scanControls'
import logoUrl from './assets/logo.png'

type View = 'dashboard' | 'settings'
const view = ref<View>('dashboard')

// --- Theme (dark/light) ---
const theme = ref<Theme>('dark')

/** Apply the theme to the document root: the `.light` class flips the palette. */
function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle('light', t === 'light')
}

/** Toggle dark/light, persist the choice, and apply it immediately. */
async function toggleTheme(): Promise<void> {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme(theme.value)
  try {
    await window.api.settings.set({ theme: theme.value })
  } catch (e) {
    console.error('Failed to save theme:', e)
  }
}

/** Load the saved theme on startup and apply it. */
async function loadTheme(): Promise<void> {
  try {
    const settings = await window.api.settings.get()
    theme.value = settings.theme
    applyTheme(settings.theme)
  } catch (e) {
    console.error('Failed to load theme:', e)
  }
}

/** Top-level tabs (Hebrew labels). */
const tabs = [
  { key: 'dashboard', label: 'לוח בקרה' },
  { key: 'settings', label: 'הגדרות' }
] as const

const invoices = ref<Invoice[]>([])
/** IDs added by the most recent scan — rows stay tinted until the next scan. */
const newInvoiceIds = ref<Set<number>>(new Set())
/** The "חדש" badge shows only briefly (the row tint is the lasting marker). */
const showNewBadge = ref(false)
let badgeTimer: ReturnType<typeof setTimeout> | null = null

// --- RONY-14 + scan robustness: Scan now, live progress ---
const scanning = ref(false)
/** True from the moment the user clicks "Cancel" until the scan actually stops. */
const cancelling = ref(false)
const scanSummary = ref<ScanResult | null>(null)
const scanError = ref<string>('')
const scanProgress = ref<ScanProgress | null>(null)

// Per-run scan controls: how many messages, and the time range. A preset window
// (week/month/…) covers the common cases; 'custom' reveals explicit From/To
// pickers. The main process re-validates everything.
const scanMax = ref<number>(50)
const rangePreset = ref<RangeKey>('year')
const scanFrom = ref<string>('')
const scanTo = ref<string>('')

/** Build the options payload from the selected count + range. */
function scanOptions(): ScanOptions {
  const opts: ScanOptions = {}
  if (scanMax.value > 0) opts.maxResults = scanMax.value
  if (rangePreset.value === 'custom') {
    if (scanFrom.value) opts.after = scanFrom.value
    if (scanTo.value) opts.before = scanTo.value
  } else {
    const days = rangeDays(rangePreset.value)
    if (days) opts.after = isoDaysAgo(days)
  }
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
  // Clear last run's highlights (tint + badge) before starting.
  newInvoiceIds.value = new Set()
  showNewBadge.value = false
  if (badgeTimer) clearTimeout(badgeTimer)
  // Remember what was already there so we can mark whatever the scan adds.
  const before = new Set(invoices.value.map((inv) => inv.id))
  try {
    scanSummary.value = await window.api.scan.run(scanOptions())
    await refresh()
    newInvoiceIds.value = new Set(
      invoices.value.filter((inv) => !before.has(inv.id)).map((inv) => inv.id)
    )
    if (newInvoiceIds.value.size > 0) {
      // Flash the "חדש" badge for 10s; the row tint lingers until the next scan.
      showNewBadge.value = true
      badgeTimer = setTimeout(() => (showNewBadge.value = false), 10_000)
    }
  } catch (e) {
    scanError.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanning.value = false
    cancelling.value = false
    scanProgress.value = null
  }
}

/**
 * Ask the main process to stop the running scan. Cooperative — the scan finishes
 * its current item, then `scan.run()` resolves with partial counts (`cancelled`).
 */
async function onCancelScan(): Promise<void> {
  if (!scanning.value || cancelling.value) return
  cancelling.value = true
  try {
    await window.api.scan.cancel()
  } catch (e) {
    console.error('Failed to cancel scan:', e)
    cancelling.value = false // let the user try again
  }
}

async function refresh(): Promise<void> {
  invoices.value = await window.api.invoices.list()
}

/** Reload the table (used on mount and after a row is deleted). */
function reloadInvoices(): void {
  refresh().catch((e) => console.error('Failed to load invoices:', e))
}

let unsubscribeProgress: (() => void) | null = null
/** Subscribe to live progress, then load the table. */
onMounted(() => {
  loadTheme()
  unsubscribeProgress = window.api.scan.onProgress((p) => {
    scanProgress.value = p
  })
  reloadInvoices()
})
onUnmounted(() => {
  unsubscribeProgress?.()
  if (badgeTimer) clearTimeout(badgeTimer)
})
</script>

<template>
  <div class="min-h-full bg-slate-950 text-slate-100">
    <div class="mx-auto max-w-5xl px-6 py-10">
      <!-- Header -->
      <header class="mb-10">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <img
              :src="logoUrl"
              alt="רוני"
              class="h-12 w-12 object-cover shadow-lg shadow-emerald-500/20"
            />
            <div>
              <p class="text-lg font-bold leading-none text-slate-100">רוני</p>
              <p class="mt-1 text-xs font-medium tracking-wide text-emerald-400">
                כל החשבוניות שלך במקום אחד
              </p>
            </div>
          </div>

          <!-- Dark / light theme toggle -->
          <button
            type="button"
            class="rounded-none border border-slate-700 p-2.5 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            :title="theme === 'dark' ? 'מצב בהיר' : 'מצב כהה'"
            :aria-label="theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'"
            @click="toggleTheme"
          >
            <!-- Sun (shown in dark mode → click to go light) -->
            <svg
              v-if="theme === 'dark'"
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" />
              <path
                d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
              />
            </svg>
            <!-- Moon (shown in light mode → click to go dark) -->
            <svg
              v-else
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </button>
        </div>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-slate-50">סורק חשבוניות וקבלות</h1>
        <p class="mt-3 max-w-2xl text-slate-400">
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
        <!-- Scan now (RONY-14) — triggers the Gmail sync pipeline over IPC -->
        <section class="mt-6 rounded-none border border-slate-800 bg-slate-900/60 p-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold">סריקת תיבת הדואר</h2>
              <p class="mt-1 text-sm text-slate-400">
                משיכת הודעות אחרונות מ-Gmail, זיהוי חשבוניות וקבלות, והורדתן למחשב.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <button
                class="inline-flex items-center gap-2 rounded-none bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
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
              <!-- Cancel: shown only mid-scan; stops the run cooperatively. -->
              <button
                v-if="scanning"
                class="inline-flex items-center gap-2 rounded-none border border-red-500/60 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="cancelling"
                @click="onCancelScan"
              >
                {{ cancelling ? 'מבטל…' : 'ביטול' }}
              </button>
            </div>
          </div>

          <!-- Per-run controls: message count + time range, as quick chips -->
          <div class="mt-5 space-y-4">
            <!-- How many messages -->
            <div>
              <span class="mb-2 block text-sm font-medium text-slate-300">כמה הודעות לסרוק</span>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="n in COUNT_OPTIONS"
                  :key="n"
                  type="button"
                  :disabled="scanning"
                  class="rounded-none border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
                  :class="
                    scanMax === n
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  "
                  @click="scanMax = n"
                >
                  {{ n === 1000 ? 'מקסימום' : n }}
                </button>
              </div>
            </div>

            <!-- Time range -->
            <div>
              <span class="mb-2 block text-sm font-medium text-slate-300">טווח זמן</span>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="preset in RANGE_PRESETS"
                  :key="preset.key"
                  type="button"
                  :disabled="scanning"
                  class="rounded-none border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
                  :class="
                    rangePreset === preset.key
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  "
                  @click="rangePreset = preset.key"
                >
                  {{ preset.label }}
                </button>
              </div>

              <!-- Custom From/To — only when "custom" is selected -->
              <div v-if="rangePreset === 'custom'" class="mt-3 flex flex-wrap items-end gap-4">
                <label class="text-sm text-slate-400">
                  <span class="mb-1 block">מתאריך</span>
                  <input
                    v-model="scanFrom"
                    type="date"
                    :disabled="scanning"
                    class="rounded-none border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </label>
                <label class="text-sm text-slate-400">
                  <span class="mb-1 block">עד תאריך</span>
                  <input
                    v-model="scanTo"
                    type="date"
                    :disabled="scanning"
                    class="rounded-none border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </label>
              </div>
              <p v-if="rangePreset === 'custom'" class="mt-2 text-xs text-slate-500">
                ניתן להשאיר תאריך ריק לחיפוש פתוח מצד אחד.
              </p>
            </div>
          </div>

          <!-- Live progress (scan robustness) -->
          <div v-if="scanning && scanProgress" class="mt-4">
            <p class="text-sm text-slate-300">{{ progressLabel(scanProgress) }}</p>
            <div
              v-if="scanProgress.total > 0"
              class="mt-2 h-1.5 w-full overflow-hidden rounded-none bg-slate-800"
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
            class="mt-4 rounded-none bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
          >
            <span v-if="scanSummary.cancelled" class="font-semibold text-amber-300"
              >הסריקה בוטלה ·
            </span>
            נסרקו
            <span class="font-semibold text-slate-100">{{ scanSummary.scanned }}</span> · התאמות
            <span class="font-semibold text-slate-100">{{ scanSummary.matched }}</span> · הורדו
            <span class="font-semibold text-emerald-300">{{ scanSummary.downloaded }}</span>
            <span v-if="scanSummary.rejected > 0" class="text-slate-400">
              · {{ scanSummary.rejected }} קבצים סוננו (לא תקינים)
            </span>
            <span v-if="scanSummary.errors > 0" class="text-amber-300">
              · {{ scanSummary.errors }} שגיאות
            </span>
          </p>
          <p
            v-if="scanSummary && scanSummary.errors > 0 && scanSummary.errorSample"
            class="mt-2 rounded-none bg-amber-950/40 px-3 py-2 text-xs text-amber-300"
          >
            {{ scanSummary.errorSample }}
          </p>
          <p v-if="scanError" class="mt-4 rounded-none bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {{ scanError }}
          </p>
        </section>

        <!-- Invoices dashboard table (RONY-13) — renders directly from SQLite -->
        <div class="mt-6">
          <InvoicesTable
            :invoices="invoices"
            :new-ids="newInvoiceIds"
            :show-badge="showNewBadge"
            @deleted="reloadInvoices"
          />
        </div>
      </template>
    </div>
  </div>
</template>
