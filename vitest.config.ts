import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Vitest needs the Vue plugin to compile `.vue` SFCs in component tests, plus
// the same path aliases the renderer build uses. The default test environment
// stays `node` (fast, and what the main/shared tests rely on); component tests
// opt into jsdom per-file with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node'
  }
})
