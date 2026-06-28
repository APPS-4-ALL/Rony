<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AiProvider, AuthStatus, EngineType, Settings } from '@shared/types'
import {
  AI_CONSENT_POINTS,
  AI_CONSENT_TITLE,
  connectionDisplay,
  ENGINE_OPTIONS,
  PROVIDER_OPTIONS
} from '../lib/settingsView'

const status = ref<AuthStatus>({ connected: false, email: null })
const settings = ref<Settings>({
  defaultEngine: 'deterministic',
  aiProvider: 'openai',
  downloadDir: null,
  aiConsent: false,
  followLinks: false,
  installConsent: false,
  theme: 'dark',
  businessNameHe: null,
  businessNameEn: null,
  taxId: null,
  onboardingComplete: false
})
const busy = ref(false)
const error = ref('')

// --- Delete account ---
const showDeleteConfirm = ref(false)
const deleting = ref(false)
const deleteError = ref('')

async function resetAccount(): Promise<void> {
  deleting.value = true
  deleteError.value = ''
  try {
    await window.api.invoices.deleteAll()
    await window.api.auth.logout()
    for (const provider of ['openai', 'gemini', 'claude', 'groq'] as const) {
      await window.api.settings.clearApiKey(provider)
    }
    await window.api.settings.set({
      onboardingComplete: false,
      businessNameHe: null,
      businessNameEn: null,
      taxId: null,
      aiConsent: false,
      followLinks: false,
      installConsent: false,
      defaultEngine: 'deterministic'
    })
    window.location.reload()
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : String(e)
    deleting.value = false
  }
}

// Privacy consent dialog — shown when enabling the AI engine without prior opt-in.
const consentPoints = AI_CONSENT_POINTS
const consentTitle = AI_CONSENT_TITLE
const showConsent = ref(false)

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
    : 'התאמת מילות מפתח/Regex מקומית ומהירה. ללא מפתח API — סריקה חינמית לחלוטין.'
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
    // Privacy: enabling the AI engine requires explicit opt-in. If the user
    // hasn't consented yet, open the consent dialog instead of switching — the
    // switch happens only on confirm (see confirmConsent). Already-consented
    // users (and switching back to deterministic) proceed immediately.
    if (engine === 'ai' && !settings.value.aiConsent) {
      showConsent.value = true
      return
    }
    settings.value = await window.api.settings.set({ defaultEngine: engine })
    await refreshKeyStatus()
  })

/** Consent accepted → record it AND switch to the AI engine in one update. */
const confirmConsent = (): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({ defaultEngine: 'ai', aiConsent: true })
    showConsent.value = false
    await refreshKeyStatus()
  })

/** Consent declined → leave the engine unchanged. */
function cancelConsent(): void {
  showConsent.value = false
}

/**
 * Revoke AI consent. Since the AI engine cannot run without consent, we also
 * switch the default engine back to the local deterministic one in the same
 * update, so the app is never left in an "AI selected but not allowed" state.
 */
const revokeConsent = (): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({
      aiConsent: false,
      defaultEngine: 'deterministic'
    })
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

/** RONY-18: toggle the opt-in "follow invoice download links" setting. */
const toggleFollowLinks = (): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({ followLinks: !settings.value.followLinks })
  })

/** RONY-20: toggle the opt-in "count my install" setting (anonymous ping). */
const toggleInstallConsent = (): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({
      installConsent: !settings.value.installConsent
    })
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
    <section class="rounded-none border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">חיבור ל-Gmail</h2>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="inline-block h-2.5 w-2.5 rounded-none" :class="conn.badgeColor" />
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
          class="rounded-none border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="onLogout"
        >
          התנתקות
        </button>
        <button
          v-else
          class="rounded-none bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
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
    <section class="rounded-none border border-slate-800 bg-slate-900/60 p-6">
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
          class="rounded-none bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy"
          @click="chooseFolder"
        >
          בחירת תיקייה
        </button>
        <button
          v-if="settings.downloadDir"
          class="rounded-none border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="resetFolder"
        >
          איפוס לברירת מחדל
        </button>
      </div>
    </section>

    <!-- Anonymous install count (RONY-20) — opt-in -->
    <section class="rounded-none border border-slate-800 bg-slate-900/60 p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="max-w-xl">
          <h2 class="text-lg font-semibold">אני מאשר שידעו שהתקנתי את רוני</h2>
          <p class="mt-1 text-sm text-slate-400">
            כשהאפשרות פעילה, רוני שולח פעם אחת דיווח אנונימי שהאפליקציה הותקנה, כדי שנוכל לספור כמה
            אנשים מתקינים את רוני.
            <span class="text-slate-300">
              לא נשלח שום מידע אישי — לא חשבוניות, לא מיילים ולא פרטים. רק מזהה אקראי, גרסת
              האפליקציה וסוג מערכת ההפעלה.
            </span>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          dir="ltr"
          :aria-checked="settings.installConsent"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-none transition disabled:opacity-50"
          :class="settings.installConsent ? 'bg-emerald-500' : 'bg-slate-700'"
          :disabled="busy"
          @click="toggleInstallConsent"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-none bg-white transition"
            :class="settings.installConsent ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>
      <p class="mt-3 text-xs text-slate-500">
        כבוי כברירת מחדל. אפשר לכבות בכל עת — רוני נשאר מקומי וללא מעקב.
      </p>
    </section>

    <!-- Follow invoice download links (RONY-18) — opt-in -->
    <section class="rounded-none border border-slate-800 bg-slate-900/60 p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="max-w-xl">
          <h2 class="text-lg font-semibold">הורדת חשבוניות מקישור</h2>
          <p class="mt-1 text-sm text-slate-400">
            חלק מהספקים לא מצרפים את החשבונית אלא שולחים קישור להורדה. כשהאפשרות פעילה, רוני יעקוב
            אחרי קישור ההורדה שבמייל ויוריד את המסמך.
            <span class="text-slate-300">
              שים/י לב: הפעלה מבצעת פניות רשת לאתרי הספקים שאליהם המייל מפנה.
            </span>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          dir="ltr"
          :aria-checked="settings.followLinks"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-none transition disabled:opacity-50"
          :class="settings.followLinks ? 'bg-emerald-500' : 'bg-slate-700'"
          :disabled="busy"
          @click="toggleFollowLinks"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-none bg-white transition"
            :class="settings.followLinks ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>
      <p class="mt-3 text-xs text-slate-500">
        מאובטח: רק כתובות https, חסימת כתובות פנימיות, ללא שליחת עוגיות, הגבלת גודל וזמן. כל קובץ
        שמורד עובר את אותה בדיקת אימות.
      </p>
    </section>

    <!-- Default scan engine -->
    <section class="rounded-none border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">מנוע סריקה כברירת מחדל</h2>
      <p class="mt-1 text-sm text-slate-400">
        איזה מנוע ירוץ כברירת מחדל כשתסרוק. ניתן לשנות זאת בכל עת.
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          v-for="opt in ENGINE_OPTIONS"
          :key="opt.value"
          class="rounded-none border p-4 text-start transition disabled:opacity-50"
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
    <section v-if="showAi" class="rounded-none border border-slate-800 bg-slate-900/60 p-6">
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
          class="rounded-none border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
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
          class="w-72 rounded-none border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          class="rounded-none bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy || !apiKeyInput.trim()"
          @click="saveApiKey"
        >
          שמירה
        </button>
        <button
          v-if="apiKeySet"
          class="rounded-none border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
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

      <!-- Privacy consent status + revoke (RONY-10 privacy) -->
      <div class="mt-5 border-t border-slate-800 pt-4">
        <p class="text-sm text-emerald-400">✓ אישרת שליחת תוכן מיילים לספק ה-AI.</p>
        <p class="mt-1 text-xs text-slate-500">
          מזהים רגישים (טלפון, דוא"ל, מספרי חשבון/כרטיס, ת"ז) מוסתרים אוטומטית מהטקסט לפני השליחה.
        </p>
        <button
          class="mt-2 rounded-none border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="revokeConsent"
        >
          ביטול הסכמה ומעבר לסריקה רגילה
        </button>
      </div>
    </section>

    <p v-if="error" class="rounded-none bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {{ error }}
    </p>

    <!-- Danger zone -->
    <section class="rounded-none border border-red-900/60 bg-red-950/10 p-6">
      <h2 class="text-lg font-semibold text-red-300">אזור מסוכן</h2>
      <p class="mt-1 text-sm text-slate-400">פעולות בלתי הפיכות. קרא/י בעיון לפני שמבצע/ת.</p>

      <div class="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-slate-200">מחיקת כל הנתונים והרישום</p>
          <p class="mt-1 text-sm text-slate-500">
            מוחק את כל החשבוניות, מנתק את Gmail, מוחק מפתחות API ומאפס את האפליקציה לגמרי. בפתיחה
            הבאה תוצג מסך ההרשמה מחדש.
          </p>
        </div>
        <button
          class="shrink-0 border border-red-700 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || deleting"
          @click="showDeleteConfirm = true"
        >
          מחק את כל הנתונים
        </button>
      </div>
    </section>

    <!-- Consent dialog: shown when enabling the AI engine without prior opt-in.
         The AI engine cannot be selected (UI) nor run (main process) until the
         user accepts this. -->
    <div
      v-if="showConsent"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      @click.self="cancelConsent"
    >
      <div class="w-full max-w-lg rounded-none border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 class="text-lg font-bold text-slate-100">{{ consentTitle }}</h3>
        <p class="mt-2 text-sm text-slate-400">
          הסריקה החכמה משתמשת בשירות חיצוני. לפני ההפעלה, חשוב שתדע/י:
        </p>
        <ul class="mt-3 space-y-2 text-sm text-slate-300">
          <li v-for="(point, i) in consentPoints" :key="i" class="flex gap-2">
            <span class="mt-1 text-emerald-400">•</span>
            <span>{{ point }}</span>
          </li>
        </ul>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <button
            class="rounded-none border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            :disabled="busy"
            @click="cancelConsent"
          >
            ביטול
          </button>
          <button
            class="rounded-none bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            :disabled="busy"
            @click="confirmConsent"
          >
            אני מאשר/ת — הפעל סריקה חכמה
          </button>
        </div>
      </div>
    </div>
    <!-- Delete account confirmation dialog -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
    >
      <div
        class="w-full max-w-md rounded-none border border-red-700/60 bg-slate-900 p-6 shadow-2xl"
      >
        <h3 class="text-lg font-bold text-red-300">מחיקת כל הנתונים</h3>
        <p class="mt-3 text-sm text-slate-300">פעולה זו תמחק לצמיתות:</p>
        <ul class="mt-2 space-y-1.5 text-sm text-slate-400">
          <li class="flex gap-2">
            <span class="text-red-400">•</span> את כל רשומות החשבוניות וקבצי ההורדה
          </li>
          <li class="flex gap-2"><span class="text-red-400">•</span> את חיבור ה‑Gmail</li>
          <li class="flex gap-2"><span class="text-red-400">•</span> את מפתחות ה‑API השמורים</li>
          <li class="flex gap-2"><span class="text-red-400">•</span> את פרטי העסק וכל ההגדרות</li>
        </ul>
        <p class="mt-4 text-sm font-semibold text-red-300">לא ניתן לשחזר פעולה זו.</p>

        <p v-if="deleteError" class="mt-3 bg-red-950/60 px-3 py-2 text-xs text-red-300">
          {{ deleteError }}
        </p>

        <div class="mt-6 flex justify-end gap-3">
          <button
            class="border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            :disabled="deleting"
            @click="showDeleteConfirm = false"
          >
            ביטול
          </button>
          <button
            class="bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="deleting"
            @click="resetAccount"
          >
            {{ deleting ? 'מוחק…' : 'כן, מחק הכל' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
