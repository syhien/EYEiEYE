/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, exposed in `preload.ts`
interface Window {
  eyeieye: {
    getSettings: () => Promise<import('../src/shared/types').Settings>
    setSettings: (settings: import('../src/shared/types').Settings) => Promise<import('../src/shared/types').Settings>
    getStatus: () => Promise<import('../src/shared/types').AppStatus>
    setPaused: (paused: boolean) => Promise<import('../src/shared/types').AppStatus>
    exitRest: () => Promise<{ ok: boolean }>
  }
}
