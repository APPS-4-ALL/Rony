import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // A sandboxed preload can only `require('electron')` — it cannot pull
    // packages from node_modules at runtime. So we must BUNDLE the one
    // dependency the preload uses (@electron-toolkit/preload) into its output
    // rather than externalize it, or the sandboxed preload fails to load.
    plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue(), tailwindcss()]
  }
})
