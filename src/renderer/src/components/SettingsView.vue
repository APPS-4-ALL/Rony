<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AiProvider, AuthStatus, EngineType, Settings } from '@shared/types'
import { connectionDisplay, ENGINE_OPTIONS, PROVIDER_OPTIONS } from '../lib/settingsView'

const status = ref<AuthStatus>({ connected: false, email: null })
const settings = ref<Settings>({
  defaultEngine: 'deterministic',
  aiProvider: 'openai',
  downloadDir: null
})
const busy = ref(false)
const error = ref('')

// --- RONY-16: API key state ---
const apiKeyInput = ref('')
const apiKeySet = ref(false)

const conn = computed(() => connectionDisplay(status.value))
const showAi = computed(() => settings.value.defaultEngine === 'ai')
const providerLabel = computed(
  () => PROVIDER_OPTIONS.find((p) => p.value === settings.value.aiProvider)?.label ?? ''
)

/** Hebrew label for an engine option. */
function engineLabel(v: EngineType): string {
  return v === 'ai' ? 'סריקה חכמה' : 'סריקה רגילה'
}

/** Hebrew description for an engine option. */
function engineDesc(v: EngineType): string {
  return v === 'ai'
    ? 'שולח את טקסט המייל למודל שפה לצורך סיווג וחילוץ שדות. דורש מפתח API.'
    : 'התאמת מילות מפתח/Regex מקומית ומהירה. ללא מפתח API — עובד לחלוטין במצב לא מקוון.'
}

async function refreshKeyStatus(): Promise<void> {
  apiKeySet.value = await window.api.settings.hasApiKey(settings.value.aiProvider)
}

async function load(): Promise<void> {
  status.value = await window.api.auth.status()
  settings.value = await window.api.settings.get()
  await refreshKeyStatus()
}

async function guarded(fn: () => Promise<void>): Promise<void> {
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

const onLogin = (): Promise<void> =>
  guarded(async () => {
    status.value = await window.api.auth.login()
  })

const onLogout = (): Promise<void> =>
  guarded(async () => {
    status.value = await window.api.auth.logout()
  })

const selectEngine = (engine: EngineType): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({ defaultEngine: engine })
    await refreshKeyStatus()
  })

const selectProvider = (provider: AiProvider): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({ aiProvider: provider })
    apiKeyInput.value = ''
    await refreshKeyStatus()
  })

/** Open the OS folder picker and save the chosen download folder (optional). */
const chooseFolder = (): Promise<void> =>
  guarded(async () => {
    const dir = await window.api.dialog.pickFolder()
    if (dir) settings.value = await window.api.settings.set({ downloadDir: dir })
  })

/** Clear the custom folder → fall back to the default Documents folder. */
const resetFolder = (): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({ downloadDir: null })
  })

const saveApiKey = (): Promise<void> =>
  guarded(async () => {
    const key = apiKeyInput.value.trim()
    if (!key) return
    await window.api.settings.setApiKey(settings.value.aiProvider, key)
    apiKeyInput.value = ''
    await refreshKeyStatus()
  })

const clearKey = (): Promise<void> =>
  guarded(async () => {
    await window.api.settings.clearApiKey(settings.value.aiProvider)
    await refreshKeyStatus()
  })

onMounted(() => guarded(load))
</script>

<template>
  <div class="space-y-6">
    <!-- Gmail connection -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">חיבור ל-Gmail</h2>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="inline-block h-2.5 w-2.5 rounded-full" :class="conn.badgeColor" />
          <div>
            <p class="font-medium" :class="conn.textColor">
              {{ conn.connected ? 'מחובר' : 'מנותק' }}
            </p>
            <p class="text-sm text-slate-400">
              {{ conn.connected ? (status.email ?? 'חשבון Gmail') : 'לא מחובר ל-Gmail' }}
            </p>
          </div>
        </div>

        <button
          v-if="conn.connected"
          class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="onLogout"
        >
          התנתקות
        </button>
        <button
          v-else
          class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy"
          @click="onLogin"
        >
          {{ busy ? 'מתחבר…' : 'התחברות ל-Gmail' }}
        </button>
      </div>

      <p v-if="!conn.connected && busy" class="mt-3 text-sm text-slate-400">
        נפתח חלון דפדפן — אשר/י שם את הגישה כדי להשלים את ההתחברות.
      </p>
    </section>

    <!-- Download folder (optional) -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">תיקיית הורדות</h2>
      <p class="mt-1 text-sm text-slate-400">
        היכן לשמור את קובצי החשבוניות שיורדו. אופציונלי — כברירת מחדל הם נשמרים בתיקיית המסמכים.
      </p>

      <p class="mt-4 text-sm">
        <span class="text-slate-400">תיקייה נוכחית: </span>
        <code v-if="settings.downloadDir" class="font-mono text-slate-100" dir="ltr">{{
          settings.downloadDir
        }}</code>
        <span v-else class="text-slate-300">ברירת מחדל (תיקיית המסמכים)</span>
      </p>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          class="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy"
          @click="chooseFolder"
        >
          בחירת תיקייה
        </button>
        <button
          v-if="settings.downloadDir"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="resetFolder"
        >
          איפוס לברירת מחדל
        </button>
      </div>
    </section>

    <!-- Default scan engine -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">מנוע סריקה כברירת מחדל</h2>
      <p class="mt-1 text-sm text-slate-400">
        איזה מנוע ירוץ כברירת מחדל כשתסרוק. ניתן לשנות זאת בכל עת.
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          v-for="opt in ENGINE_OPTIONS"
          :key="opt.value"
          class="rounded-lg border p-4 text-start transition disabled:opacity-50"
          :class="
            settings.defaultEngine === opt.value
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-700 bg-slate-950 hover:border-slate-500'
          "
          :disabled="busy"
          @click="selectEngine(opt.value)"
        >
          <div class="flex items-center justify-between">
            <span class="font-medium text-slate-100">{{ engineLabel(opt.value) }}</span>
            <span
              v-if="settings.defaultEngine === opt.value"
              class="text-xs font-semibold text-emerald-400"
              >נבחר</span
            >
          </div>
          <p class="mt-1 text-sm text-slate-400">{{ engineDesc(opt.value) }}</p>
        </button>
      </div>
    </section>

    <!-- AI provider + API key (RONY-16) — only when the AI engine is selected -->
    <section v-if="showAi" class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">ספק בינה מלאכותית ומפתח API</h2>
      <p class="mt-1 text-sm text-slate-400">
        מנוע ה-AI שולח את טקסט המייל לספק שבחרת. המפתח שלך נשמר
        <span class="text-slate-200">מוצפן על המחשב הזה</span> ולא עוזב אותו, פרט לקריאה לספק.
      </p>

      <!-- Provider -->
      <div class="mt-4 flex gap-2">
        <button
          v-for="p in PROVIDER_OPTIONS"
          :key="p.value"
          class="rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
          :class="
            settings.aiProvider === p.value
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          "
          :disabled="busy"
          @click="selectProvider(p.value)"
        >
          {{ p.label }}
        </button>
      </div>

      <!-- Key -->
      <label class="mt-4 block text-sm text-slate-400">מפתח API של {{ providerLabel }}</label>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <input
          v-model="apiKeyInput"
          type="password"
          autocomplete="off"
          :placeholder="apiKeySet ? '•••••••• (מפתח שמור)' : 'הדבק/י את מפתח ה-API'"
          class="w-72 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          class="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy || !apiKeyInput.trim()"
          @click="saveApiKey"
        >
          שמירה
        </button>
        <button
          v-if="apiKeySet"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="clearKey"
        >
          מחיקה
        </button>
      </div>
      <p class="mt-2 text-sm" :class="apiKeySet ? 'text-emerald-400' : 'text-slate-500'">
        {{
          apiKeySet
            ? `✓ מפתח שמור באופן מאובטח עבור ${providerLabel}.`
            : 'אין עדיין מפתח שמור — מנוע ה-AI זקוק לאחד כדי לפעול.'
        }}
      </p>
    </section>

    <p v-if="error" class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {{ error }}
    </p>
  </div>
</template>
