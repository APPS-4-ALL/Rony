import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/ipc'
import type { RoniApi, ScanProgress } from '../shared/types'

// Custom, typed API exposed to the renderer. Each method forwards to a
// main-process `ipcMain.handle` channel via `ipcRenderer.invoke`, so the
// renderer never touches Node/Electron internals directly.
const api: RoniApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  invoices: {
    list: () => ipcRenderer.invoke(IpcChannels.invoicesList),
    count: () => ipcRenderer.invoke(IpcChannels.invoicesCount),
    addSample: () => ipcRenderer.invoke(IpcChannels.invoicesAddSample),
    openFile: (invoiceId) => ipcRenderer.invoke(IpcChannels.invoicesOpenFile, invoiceId)
  },
  auth: {
    status: () => ipcRenderer.invoke(IpcChannels.authStatus),
    login: () => ipcRenderer.invoke(IpcChannels.authLogin),
    logout: () => ipcRenderer.invoke(IpcChannels.authLogout)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (patch) => ipcRenderer.invoke(IpcChannels.settingsSet, patch),
    setApiKey: (provider, key) => ipcRenderer.invoke(IpcChannels.settingsSetApiKey, provider, key),
    hasApiKey: (provider) => ipcRenderer.invoke(IpcChannels.settingsHasApiKey, provider),
    clearApiKey: (provider) => ipcRenderer.invoke(IpcChannels.settingsClearApiKey, provider)
  },
  scan: {
    run: (opts) => ipcRenderer.invoke(IpcChannels.scanRun, opts),
    onProgress: (callback) => {
      const listener = (_e: IpcRendererEvent, progress: ScanProgress): void => callback(progress)
      ipcRenderer.on(IpcChannels.scanProgress, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.scanProgress, listener)
      }
    }
  },
  dialog: {
    saveFile: (req) => ipcRenderer.invoke(IpcChannels.dialogSaveFile, req)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
