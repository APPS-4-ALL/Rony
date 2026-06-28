<script setup lang="ts">
import { ref } from 'vue'
import type { AiProvider, EngineType } from '@shared/types'
import logoUrl from '../assets/logo.png'

const emit = defineEmits<{ done: [] }>()

// --- Step management ---
const TOTAL_STEPS = 6
const step = ref(1)

function next(): void {
  if (step.value < TOTAL_STEPS) step.value++
}
function back(): void {
  if (step.value > 1) step.value--
}

// --- Step 2: Business info ---
const businessNameHe = ref('')
const businessNameEn = ref('')
const taxId = ref('')

// --- Step 3: Privacy toggles ---
const installConsent = ref(false)
const followLinks = ref(false)

// --- Step 4: Scan engine ---
const defaultEngine = ref<EngineType>('deterministic')
const aiProvider = ref<AiProvider>('openai')
const aiConsent = ref(false)
const apiKeyInput = ref('')
const savingKey = ref(false)
const apiKeySaved = ref(false)
const apiKeyError = ref('')

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
  { value: 'groq', label: 'Groq' }
]

function selectEngine(engine: EngineType): void {
  defaultEngine.value = engine
  if (engine === 'deterministic') {
    aiConsent.value = false
  }
}

function selectProvider(provider: AiProvider): void {
  aiProvider.value = provider
  apiKeySaved.value = false
  apiKeyInput.value = ''
}

async function saveApiKey(): Promise<void> {
  const key = apiKeyInput.value.trim()
  if (!key) return
  savingKey.value = true
  apiKeyError.value = ''
  try {
    await window.api.settings.setApiKey(aiProvider.value, key)
    apiKeyInput.value = ''
    apiKeySaved.value = true
  } catch (e) {
    apiKeyError.value = e instanceof Error ? e.message : String(e)
  } finally {
    savingKey.value = false
  }
}

// Engine step can proceed when:
// - deterministic selected (always OK)
// - AI selected + user acknowledged consent (API key optional)
const engineStepValid = (): boolean => defaultEngine.value === 'deterministic' || aiConsent.value

// --- Step 5: Gmail ---
const authStatus = ref<{ connected: boolean; email: string | null }>({
  connected: false,
  email: null
})
const connectingGmail = ref(false)
const gmailError = ref('')

async function connectGmail(): Promise<void> {
  connectingGmail.value = true
  gmailError.value = ''
  try {
    authStatus.value = await window.api.auth.login()
  } catch (e) {
    gmailError.value = e instanceof Error ? e.message : String(e)
  } finally {
    connectingGmail.value = false
  }
}

// --- Step 6 / Finish ---
const saving = ref(false)

async function finish(): Promise<void> {
  saving.value = true
  try {
    await window.api.settings.set({
      businessNameHe: businessNameHe.value.trim() || null,
      businessNameEn: businessNameEn.value.trim() || null,
      taxId: taxId.value.trim() || null,
      installConsent: installConsent.value,
      followLinks: followLinks.value,
      defaultEngine: defaultEngine.value,
      aiProvider: aiProvider.value,
      aiConsent: aiConsent.value,
      onboardingComplete: true
    })
    emit('done')
  } catch (e) {
    console.error('Failed to save onboarding settings:', e)
    emit('done')
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-950" dir="rtl">
    <div class="flex min-h-full flex-col items-center justify-center px-4 py-8">
      <!-- Progress dots -->
      <div class="mb-10 flex items-center gap-2">
        <div
          v-for="n in TOTAL_STEPS"
          :key="n"
          class="h-1.5 transition-all"
          :class="[
            n === step ? 'w-6 bg-emerald-400' : n < step ? 'w-3 bg-emerald-700' : 'w-3 bg-slate-700'
          ]"
        />
      </div>

      <!-- ── Step 1: Welcome ── -->
      <template v-if="step === 1">
        <div class="flex max-w-md flex-col items-center text-center">
          <img
            :src="logoUrl"
            alt="רוני"
            class="mb-6 h-20 w-20 object-cover shadow-lg shadow-emerald-500/20"
          />
          <h1 class="text-3xl font-bold text-slate-50">ברוכים הבאים לרוני</h1>
          <p class="mt-3 text-base text-slate-400">
            רוני סורק את ה‑Gmail שלך, מזהה חשבוניות וקבלות ומרכז אותן במקום אחד — במחשב שלך, בלי ענן
            ובלי שרתים של צד שלישי.
          </p>
          <p class="mt-2 text-sm text-slate-500">ההגדרה תיקח כדקה.</p>
          <button
            class="mt-10 w-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            @click="next"
          >
            בואו נתחיל
          </button>
        </div>
      </template>

      <!-- ── Step 2: Business info ── -->
      <template v-if="step === 2">
        <div class="w-full max-w-md">
          <h2 class="text-2xl font-bold text-slate-50">פרטי העסק</h2>
          <p class="mt-2 text-sm text-slate-400">
            הפרטים ישמשו לזיהוי בדוחות ובייצוא CSV. לא נשלח מידע זה לאף שרת.
          </p>

          <div class="mt-8 space-y-5">
            <label class="block">
              <span class="mb-1.5 block text-sm font-medium text-slate-300">
                שם העסק בעברית
                <span class="text-emerald-400">*</span>
              </span>
              <input
                v-model="businessNameHe"
                type="text"
                placeholder="לדוגמה: מסעדת הגן"
                class="w-full border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                dir="rtl"
              />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-sm font-medium text-slate-300">
                שם העסק באנגלית
                <span class="mr-1 text-xs font-normal text-slate-500">(אופציונלי)</span>
              </span>
              <input
                v-model="businessNameEn"
                type="text"
                placeholder="e.g. The Garden Restaurant"
                class="w-full border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                dir="ltr"
              />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-sm font-medium text-slate-300">
                ח.פ / ת"ז
                <span class="mr-1 text-xs font-normal text-slate-500">(אופציונלי)</span>
              </span>
              <input
                v-model="taxId"
                type="text"
                placeholder="לדוגמה: 515123456"
                class="w-full border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                dir="ltr"
              />
            </label>
          </div>

          <div class="mt-8 flex gap-3">
            <button
              class="flex-1 border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              @click="back"
            >
              חזרה
            </button>
            <button
              class="flex-1 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!businessNameHe.trim()"
              @click="next"
            >
              המשך
            </button>
          </div>
        </div>
      </template>

      <!-- ── Step 3: Privacy ── -->
      <template v-if="step === 3">
        <div class="w-full max-w-md">
          <h2 class="text-2xl font-bold text-slate-50">פרטיות ואבטחה</h2>

          <div class="mt-4 border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div class="flex items-start gap-3">
              <svg
                class="mt-0.5 h-5 w-5 shrink-0 text-emerald-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div>
                <p class="text-sm font-semibold text-emerald-300">
                  רוני לא שולח שום מידע מהמחשב שלך לבעל התוכנה.
                </p>
                <p class="mt-1 text-xs text-slate-400">
                  כל הנתונים נשמרים מקומית על המחשב שלך בלבד. אין שרת מרכזי, אין ענן, אין מעקב.
                </p>
              </div>
            </div>
          </div>

          <p class="mt-5 text-sm text-slate-400">
            ישנם שני פריטים אופציונליים בלבד שניתן לאפשר. שניהם כבויים כברירת מחדל:
          </p>

          <div class="mt-4 space-y-4">
            <div class="border border-slate-800 bg-slate-900/60 p-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-slate-200">עדכונים אוטומטיים וספירת התקנות</p>
                  <p class="mt-1 text-xs text-slate-500">
                    שליחת פינג אנונימי הכולל: מזהה התקנה אקראי, גרסת האפליקציה ומערכת ההפעלה בלבד.
                    משמש לבדיקת עדכונים לגרסה חדשה של רוני ולספירת התקנות אנונימית. ללא שם, מייל,
                    נתוני חשבוניות או כל מידע מזהה אחר.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="installConsent"
                  class="relative mt-0.5 h-6 w-11 shrink-0 transition"
                  :class="installConsent ? 'bg-emerald-500' : 'bg-slate-700'"
                  @click="installConsent = !installConsent"
                >
                  <span
                    class="absolute top-0.5 h-5 w-5 bg-white transition-transform"
                    :class="installConsent ? 'translate-x-5' : 'translate-x-0.5'"
                  />
                </button>
              </div>
            </div>

            <div class="border border-slate-800 bg-slate-900/60 p-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-slate-200">מעקב אחר קישורי הורדה</p>
                  <p class="mt-1 text-xs text-slate-500">
                    מאפשר לרוני לגשת לקישורי הורדה של חשבוניות שמופיעים בגוף המיילים ולהוריד את
                    המסמך ישירות מאתר הספק. כבוי כברירת מחדל כי פעולה זו יוצרת תקשורת עם שרתי צד
                    שלישי.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="followLinks"
                  class="relative mt-0.5 h-6 w-11 shrink-0 transition"
                  :class="followLinks ? 'bg-emerald-500' : 'bg-slate-700'"
                  @click="followLinks = !followLinks"
                >
                  <span
                    class="absolute top-0.5 h-5 w-5 bg-white transition-transform"
                    :class="followLinks ? 'translate-x-5' : 'translate-x-0.5'"
                  />
                </button>
              </div>
            </div>
          </div>

          <p class="mt-4 text-xs text-slate-600">
            ניתן לשנות הגדרות אלו בכל עת דרך לשונית ההגדרות.
          </p>

          <div class="mt-6 flex gap-3">
            <button
              class="flex-1 border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              @click="back"
            >
              חזרה
            </button>
            <button
              class="flex-1 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              @click="next"
            >
              המשך
            </button>
          </div>
        </div>
      </template>

      <!-- ── Step 4: Scan engine ── -->
      <template v-if="step === 4">
        <div class="w-full max-w-lg">
          <h2 class="text-2xl font-bold text-slate-50">מנוע סריקה</h2>
          <p class="mt-2 text-sm text-slate-400">
            בחר/י איך רוני יזהה חשבוניות וקבלות. ניתן לשנות בכל עת בהגדרות.
          </p>

          <!-- Engine cards -->
          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <!-- Deterministic -->
            <button
              type="button"
              class="border p-4 text-start transition"
              :class="
                defaultEngine === 'deterministic'
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
              "
              @click="selectEngine('deterministic')"
            >
              <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-100">סריקה רגילה</span>
                <span
                  v-if="defaultEngine === 'deterministic'"
                  class="text-xs font-semibold text-emerald-400"
                  >נבחר</span
                >
              </div>
              <p class="mt-2 text-xs text-slate-400">
                התאמת מילות מפתח ו‑Regex מקומית ומהירה. ללא מפתח API — חינמי לחלוטין ופרטי.
              </p>
              <p class="mt-2 text-xs font-medium text-emerald-500">מומלץ למתחילים</p>
            </button>

            <!-- AI -->
            <button
              type="button"
              class="border p-4 text-start transition"
              :class="
                defaultEngine === 'ai'
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
              "
              @click="selectEngine('ai')"
            >
              <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-100">סריקה חכמה (AI)</span>
                <span v-if="defaultEngine === 'ai'" class="text-xs font-semibold text-emerald-400"
                  >נבחר</span
                >
              </div>
              <p class="mt-2 text-xs text-slate-400">
                שולח את טקסט המייל למודל שפה לסיווג וחילוץ שדות. דורש מפתח API ואישור פרטיות.
              </p>
              <p class="mt-2 text-xs font-medium text-violet-400">דיוק גבוה יותר</p>
            </button>
          </div>

          <!-- AI options (shown only when AI selected) -->
          <div v-if="defaultEngine === 'ai'" class="mt-5 space-y-4">
            <!-- Consent notice -->
            <div class="border border-amber-500/30 bg-amber-500/5 p-4">
              <p class="text-xs font-semibold text-amber-300">שים/י לב — שליחת תוכן לצד שלישי</p>
              <ul class="mt-2 space-y-1 text-xs text-slate-400">
                <li>• נושא וגוף המייל יישלחו לספק ה‑AI שתבחר/י לצורך סיווג.</li>
                <li>• קבצים מצורפים (PDF, תמונה) יישלחו גם הם.</li>
                <li>• מזהים רגישים (טלפון, ת"ז, כרטיס אשראי) מוסתרים אוטומטית לפני השליחה.</li>
                <li>• ניתן לחזור לסריקה רגילה בכל עת בהגדרות.</li>
              </ul>
              <!-- Consent checkbox -->
              <label class="mt-3 flex cursor-pointer items-start gap-2.5">
                <input
                  v-model="aiConsent"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                />
                <span class="text-xs text-slate-300">
                  קראתי והבנתי — אני מאשר/ת שליחת תוכן מיילים לספק ה‑AI שאבחר/י.
                </span>
              </label>
            </div>

            <!-- Provider selection -->
            <div v-if="aiConsent">
              <p class="mb-2 text-sm font-medium text-slate-300">ספק AI</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="p in PROVIDERS"
                  :key="p.value"
                  type="button"
                  class="border px-3 py-1.5 text-sm font-medium transition"
                  :class="
                    aiProvider === p.value
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  "
                  @click="selectProvider(p.value)"
                >
                  {{ p.label }}
                </button>
              </div>

              <!-- API key input -->
              <div class="mt-4">
                <p class="mb-1.5 text-sm font-medium text-slate-300">
                  מפתח API של {{ PROVIDERS.find((p) => p.value === aiProvider)?.label }}
                  <span class="mr-1 text-xs font-normal text-slate-500"
                    >(ניתן להוסיף מאוחר יותר)</span
                  >
                </p>
                <div class="flex gap-2">
                  <input
                    v-model="apiKeyInput"
                    type="password"
                    autocomplete="off"
                    placeholder="הדבק/י את מפתח ה‑API"
                    class="flex-1 border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                    dir="ltr"
                  />
                  <button
                    class="border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!apiKeyInput.trim() || savingKey"
                    @click="saveApiKey"
                  >
                    {{ savingKey ? '…' : 'שמור' }}
                  </button>
                </div>
                <p v-if="apiKeySaved" class="mt-1.5 text-xs text-emerald-400">
                  ✓ המפתח נשמר בצורה מאובטחת.
                </p>
                <p v-if="apiKeyError" class="mt-1.5 text-xs text-red-400">{{ apiKeyError }}</p>
              </div>
            </div>
          </div>

          <div class="mt-8 flex gap-3">
            <button
              class="flex-1 border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              @click="back"
            >
              חזרה
            </button>
            <button
              class="flex-1 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!engineStepValid()"
              @click="next"
            >
              המשך
            </button>
          </div>
        </div>
      </template>

      <!-- ── Step 5: Gmail connection ── -->
      <template v-if="step === 5">
        <div class="w-full max-w-md">
          <h2 class="text-2xl font-bold text-slate-50">חיבור Gmail</h2>
          <p class="mt-2 text-sm text-slate-400">
            רוני זקוק לגישה לתיבת ה‑Gmail שלך כדי לסרוק ולזהות חשבוניות וקבלות. הגישה מתבצעת דרך
            OAuth מאובטח של Google — הסיסמה שלך לא נשמרת בשום מקום.
          </p>

          <div
            v-if="authStatus.connected"
            class="mt-6 border border-emerald-500/40 bg-emerald-500/5 p-4"
          >
            <div class="flex items-center gap-3">
              <div class="h-2.5 w-2.5 shrink-0 bg-emerald-400" />
              <div>
                <p class="text-sm font-semibold text-emerald-300">מחובר בהצלחה</p>
                <p class="mt-0.5 text-xs text-slate-400">{{ authStatus.email }}</p>
              </div>
            </div>
          </div>

          <div v-else class="mt-6 space-y-4">
            <button
              class="flex w-full items-center justify-center gap-2.5 border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="connectingGmail"
              @click="connectGmail"
            >
              <svg
                v-if="connectingGmail"
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
              <svg
                v-else
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4.236l-8 4.882-8-4.882V6h16v2.236z"
                />
              </svg>
              {{ connectingGmail ? 'מתחבר…' : 'התחבר ל‑Gmail' }}
            </button>
            <p v-if="connectingGmail" class="text-center text-xs text-slate-500">
              חלון הדפדפן ייפתח לאישור הגישה…
            </p>
            <p
              v-if="gmailError"
              class="border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-300"
            >
              {{ gmailError }}
            </p>
          </div>

          <div class="mt-8 flex gap-3">
            <button
              class="flex-1 border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              @click="back"
            >
              חזרה
            </button>
            <button
              class="flex-1 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              @click="next"
            >
              {{ authStatus.connected ? 'המשך' : 'דלג, אחבר מאוחר יותר' }}
            </button>
          </div>
        </div>
      </template>

      <!-- ── Step 6: Done ── -->
      <template v-if="step === 6">
        <div class="flex max-w-md flex-col items-center text-center">
          <div
            class="mb-6 flex h-16 w-16 items-center justify-center bg-emerald-500/10 text-emerald-400"
          >
            <svg
              class="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h2 class="text-2xl font-bold text-slate-50">הכל מוכן!</h2>
          <p class="mt-3 text-sm text-slate-400">
            ברוך הבא,
            <span class="font-semibold text-slate-200">{{ businessNameHe }}</span
            >. רוני מוכן לסרוק ולמיין את החשבוניות שלך.
          </p>

          <div class="mt-6 w-full space-y-2 text-right">
            <div class="flex items-center gap-2 text-xs text-slate-500">
              <div class="h-1 w-1 shrink-0 bg-emerald-500" />
              <span>
                מנוע סריקה:
                <span class="text-slate-300">
                  {{ defaultEngine === 'ai' ? 'סריקה חכמה (AI)' : 'סריקה רגילה' }}
                </span>
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-500">
              <div class="h-1 w-1 shrink-0 bg-emerald-500" />
              <span>
                Gmail:
                <span :class="authStatus.connected ? 'text-emerald-400' : 'text-slate-400'">
                  {{ authStatus.connected ? authStatus.email : 'לא מחובר (ניתן לחבר בהגדרות)' }}
                </span>
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-500">
              <div class="h-1 w-1 shrink-0 bg-emerald-500" />
              <span>
                ספירת התקנות:
                <span :class="installConsent ? 'text-emerald-400' : 'text-slate-500'">
                  {{ installConsent ? 'מופעל' : 'כבוי' }}
                </span>
              </span>
            </div>
          </div>

          <button
            class="mt-10 w-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="saving"
            @click="finish"
          >
            {{ saving ? 'שומר…' : 'כניסה ללוח הבקרה' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
