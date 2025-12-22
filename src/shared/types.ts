export type ViewMode = 'settings' | 'blink' | 'rest'

export interface Settings {
  smallIntervalMinutes: number
  smallDurationSeconds: number
  bigIntervalMinutes: number
  bigDurationMinutes: number
  openAtLogin: boolean
}

export interface AppStatus {
  paused: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  smallIntervalMinutes: 5,
  smallDurationSeconds: 3,
  bigIntervalMinutes: 60,
  bigDurationMinutes: 3,
  openAtLogin: false,
}
