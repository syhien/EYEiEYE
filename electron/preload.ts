import { contextBridge, ipcRenderer } from 'electron'
import type { AppStatus, Settings } from '../src/shared/types'

contextBridge.exposeInMainWorld('eyeieye', {
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke('settings:get')
  },
  setSettings(settings: Settings): Promise<Settings> {
    return ipcRenderer.invoke('settings:set', settings)
  },
  getStatus(): Promise<AppStatus> {
    return ipcRenderer.invoke('status:get')
  },
  setPaused(paused: boolean): Promise<AppStatus> {
    return ipcRenderer.invoke('status:setPaused', paused)
  },

  exitRest(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('rest:exit')
  },
})
