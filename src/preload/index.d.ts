import { ElectronAPI } from '@electron-toolkit/preload'
import type { RoniApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: RoniApi
  }
}
