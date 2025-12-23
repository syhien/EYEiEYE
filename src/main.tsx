import React from 'react'
import ReactDOM from 'react-dom/client'
import { invoke } from '@tauri-apps/api/tauri'
import App from './App.tsx'
import './index.css'

import type { AppStatus, Settings } from './shared/types'

type RunningApp = { name: string; title: string; pid: number }

window.eyeieye = {
  getSettings(): Promise<Settings> {
    return invoke('settings_get')
  },
  setSettings(settings: Settings): Promise<Settings> {
    return invoke('settings_set', { settings })
  },
  getStatus(): Promise<AppStatus> {
    return invoke('status_get')
  },
  setPaused(paused: boolean): Promise<AppStatus> {
    return invoke('status_set_paused', { paused })
  },
  getRunningApps(): Promise<RunningApp[]> {
    return invoke('apps_get_running')
  },
  exitRest(): Promise<{ ok: boolean }> {
    return invoke('rest_exit')
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
