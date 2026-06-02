<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AuthStatus, EngineType, Settings } from '@shared/types'
import { connectionDisplay, ENGINE_OPTIONS } from '../lib/settingsView'

const status = ref<AuthStatus>({ connected: false, email: null })
const settings = ref<Settings>({ defaultEngine: 'deterministic' })
const busy = ref(false)
const error = ref('')

const conn = computed(() => connectionDisplay(status.value))

async function load(): Promise<void> {
  status.value = await window.api.auth.status()
  settings.value = await window.api.settings.get()
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
  })

onMounted(() => guarded(load))
</script>

<template>
  <div class="space-y-6">
    <!-- Gmail connection -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">Gmail connection</h2>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="inline-block h-2.5 w-2.5 rounded-full" :class="conn.badgeColor" />
          <div>
            <p class="font-medium" :class="conn.textColor">
              {{ conn.label }}
            </p>
            <p class="text-sm text-slate-400">{{ conn.detail }}</p>
          </div>
        </div>

        <button
          v-if="conn.connected"
          class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-red-500 hover:text-red-300 disabled:opacity-50"
          :disabled="busy"
          @click="onLogout"
        >
          Disconnect
        </button>
        <button
          v-else
          class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          :disabled="busy"
          @click="onLogin"
        >
          {{ busy ? 'Connecting…' : 'Connect Gmail' }}
        </button>
      </div>

      <p v-if="!conn.connected && busy" class="mt-3 text-sm text-slate-400">
        A browser window opened — approve access there to finish connecting.
      </p>
    </section>

    <!-- Default scan engine -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 class="text-lg font-semibold">Default scan engine</h2>
      <p class="mt-1 text-sm text-slate-400">
        Which engine runs by default when you scan. You can change this anytime.
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          v-for="opt in ENGINE_OPTIONS"
          :key="opt.value"
          class="rounded-lg border p-4 text-left transition disabled:opacity-50"
          :class="
            settings.defaultEngine === opt.value
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-700 bg-slate-950 hover:border-slate-500'
          "
          :disabled="busy"
          @click="selectEngine(opt.value)"
        >
          <div class="flex items-center justify-between">
            <span class="font-medium text-slate-100">{{ opt.label }}</span>
            <span
              v-if="settings.defaultEngine === opt.value"
              class="text-xs font-semibold text-emerald-400"
              >Selected</span
            >
          </div>
          <p class="mt-1 text-sm text-slate-400">{{ opt.description }}</p>
        </button>
      </div>
    </section>

    <p v-if="error" class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {{ error }}
    </p>
  </div>
</template>
