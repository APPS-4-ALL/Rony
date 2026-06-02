import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/ipc'
import type { RoniApi } from '../shared/types'

// Custom, typed API exposed to the renderer. Each method forwards to a
// main-process `ipcMain.handle` channel via `ipcRenderer.invoke`, so the
// renderer never touches Node/Electron internals directly.
const api: RoniApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  invoices: {
    list: () => ipcRenderer.invoke(IpcChannels.invoicesList),
    count: () => ipcRenderer.invoke(IpcChannels.invoicesCount),
    addSample: () => ipcRenderer.invoke(IpcChannels.invoicesAddSample),
    openFile: (path) => ipcRenderer.invoke(IpcChannels.invoicesOpenFile, path)
  },
  auth: {
    status: () => ipcRenderer.invoke(IpcChannels.authStatus),
    login: () => ipcRenderer.invoke(IpcChannels.authLogin),
    logout: () => ipcRenderer.invoke(IpcChannels.authLogout)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (patch) => ipcRenderer.invoke(IpcChannels.settingsSet, patch)
  },
  scan: {
    run: () => ipcRenderer.invoke(IpcChannels.scanRun)
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
