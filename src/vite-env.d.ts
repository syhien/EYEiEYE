/// <reference types="vite/client" />

import type { AppStatus, Settings } from './shared/types'

interface EyeIEyeAPI {
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<Settings>
  getStatus(): Promise<AppStatus>
  setPaused(paused: boolean): Promise<AppStatus>
  getRunningApps(): Promise<{ name: string; title: string; pid: number }[]>
  exitRest(): Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    eyeieye: EyeIEyeAPI
  }
}
