<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AiProvider, AuthStatus, EngineType, Locale, Settings } from '@shared/types'
import { connectionDisplay, ENGINE_OPTIONS, PROVIDER_OPTIONS } from '../lib/settingsView'
import { useI18n } from '../lib/useI18n'
import { LOCALE_OPTIONS } from '../lib/i18n'

const { t, locale, setLocale } = useI18n()

const status = ref<AuthStatus>({ connected: false, email: null })
const settings = ref<Settings>({
  defaultEngine: 'deterministic',
  aiProvider: 'openai',
  locale: 'he'
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

async function refreshKeyStatus(): Promise<void> {
  apiKeySet.value = await window.api.settings.hasApiKey(settings.value.aiProvider)
}

async function load(): Promise<void> {
  status.value = await window.api.auth.status()
  settings.value = await window.api.settings.get()
  setLocale(settings.value.locale)
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

const selectLocale = (next: Locale): Promise<void> =>
  guarded(async () => {
    settings.value = await window.api.settings.set({ locale: next })
    setLocale(next)
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
      <h2 class="text-lg font-semibold">{{ t('settings.gmail.title') }}</h2>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="inline-block h-2.5 w-2.5 rounded-full" :class="conn.badgeColor" />
          <div>
            <p class="font-medium" :class="conn.textColor">
              {{
                conn.connected ? t('settings.gmail.connected') : t('settings.gmail.disconnected')
              }}
            </p>
            <p class="text-sm text-slate-400">
              {{
                conn.connected
                  ? (status.email ?? t('settings.gmail.account'))
                  : t('settings.gmail.notConnected')
              }}
            </p>
          </div>
        </div>

        <button
          v-if="conn.connected"
          class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="onLogout"
        >
          {{ t('settings.gmail.disconnect') }}
        </button>
        <button
          v-else
          class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy"
          @click="onLogin"
        >
          {{ busy ? t('settings.gmail.connecting') : t('settings.gmail.connect') }}
        </button>
      </div>

      <p v-if="!conn.connected && busy" class="mt-3 text-sm text-slate-400">
        {{ t('settings.gmail.browserHint') }}
      </p>
    </section>

    <!-- Language -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">{{ t('settings.lang.title') }}</h2>
      <p class="mt-1 text-sm text-slate-400">{{ t('settings.lang.desc') }}</p>

      <div class="mt-4 flex gap-2">
        <button
          v-for="opt in LOCALE_OPTIONS"
          :key="opt.value"
          class="rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
          :class="
            locale === opt.value
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          "
          :disabled="busy"
          @click="selectLocale(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- Default scan engine -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">{{ t('settings.engine.title') }}</h2>
      <p class="mt-1 text-sm text-slate-400">{{ t('settings.engine.desc') }}</p>

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
            <span class="font-medium text-slate-100">{{
              t(`settings.engine.${opt.value}.label`)
            }}</span>
            <span
              v-if="settings.defaultEngine === opt.value"
              class="text-xs font-semibold text-emerald-400"
              >{{ t('settings.engine.selected') }}</span
            >
          </div>
          <p class="mt-1 text-sm text-slate-400">{{ t(`settings.engine.${opt.value}.desc`) }}</p>
        </button>
      </div>
    </section>

    <!-- AI provider + API key (RONY-16) — only when the AI engine is selected -->
    <section v-if="showAi" class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">{{ t('settings.ai.title') }}</h2>
      <p class="mt-1 text-sm text-slate-400">
        {{ t('settings.ai.desc1')
        }}<span class="text-slate-200">{{ t('settings.ai.descEmph') }}</span
        >{{ t('settings.ai.desc2') }}
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
      <label class="mt-4 block text-sm text-slate-400">{{
        t('settings.ai.keyLabel', { provider: providerLabel })
      }}</label>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <input
          v-model="apiKeyInput"
          type="password"
          autocomplete="off"
          :placeholder="
            apiKeySet ? t('settings.ai.placeholderSet') : t('settings.ai.placeholderEmpty')
          "
          class="w-72 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          class="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy || !apiKeyInput.trim()"
          @click="saveApiKey"
        >
          {{ t('settings.ai.save') }}
        </button>
        <button
          v-if="apiKeySet"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="clearKey"
        >
          {{ t('settings.ai.clear') }}
        </button>
      </div>
      <p class="mt-2 text-sm" :class="apiKeySet ? 'text-emerald-400' : 'text-slate-500'">
        {{
          apiKeySet
            ? t('settings.ai.stored', { provider: providerLabel })
            : t('settings.ai.notStored')
        }}
      </p>
    </section>

    <p v-if="error" class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {{ error }}
    </p>
  </div>
</template>
