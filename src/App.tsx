import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Settings, ViewMode } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'

function getQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

function getViewMode(): ViewMode {
  const view = (getQueryParam('view') ?? 'settings') as ViewMode
  return view === 'blink' || view === 'rest' || view === 'settings' ? view : 'settings'
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function SettingsView() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [paused, setPaused] = useState(false)
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS)
  
  const [showProcessModal, setShowProcessModal] = useState(false)
  const [runningApps, setRunningApps] = useState<{ name: string; title: string; pid: number }[]>([])
  const [loadingApps, setLoadingApps] = useState(false)

  async function openProcessModal() {
    setShowProcessModal(true)
    setLoadingApps(true)
    try {
      const apps = await window.eyeieye.getRunningApps()
      setRunningApps(apps)
    } finally {
      setLoadingApps(false)
    }
  }

  function addProcess(name: string) {
    setForm(s => {
      if (s.processBlocklist?.includes(name)) return s
      return { ...s, processBlocklist: [...(s.processBlocklist || []), name] }
    })
    setShowProcessModal(false)
  }

  function removeProcess(name: string) {
    setForm(s => ({
      ...s,
      processBlocklist: s.processBlocklist?.filter(p => p !== name) || []
    }))
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [settings, status] = await Promise.all([
          window.eyeieye.getSettings(),
          window.eyeieye.getStatus(),
        ])
        if (!mounted) return
        setForm(settings)
        setPaused(status.paused)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function onSave() {
    setSaving(true)
    try {
      const normalized: Settings = {
        smallIntervalMinutes: clampInt(form.smallIntervalMinutes, 1, 240),
        smallDurationSeconds: clampInt(form.smallDurationSeconds, 1, 30),
        bigIntervalMinutes: clampInt(form.bigIntervalMinutes, 5, 480),
        bigDurationMinutes: clampInt(form.bigDurationMinutes, 1, 30),
        openAtLogin: Boolean(form.openAtLogin),
        processBlocklist: form.processBlocklist || [],
      }
      await window.eyeieye.setSettings(normalized)
      setForm(normalized)
    } finally {
      setSaving(false)
    }
  }

  async function togglePaused() {
    const next = !paused
    setPaused(next)
    await window.eyeieye.setPaused(next)
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">加载中…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-transparent text-foreground flex items-center justify-center p-6">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/20 backdrop-blur-md" />
      <Card className="relative w-full max-w-xl bg-background/80 backdrop-blur-2xl border-primary/10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.15)] overflow-hidden animate-fade-in-up">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
        <CardHeader className="pb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              <div className="p-3 bg-primary/10 rounded-2xl shadow-inner group">
                <img src="眼睛-睁眼.svg" alt="" className="h-9 w-9 group-hover:scale-110 transition-transform duration-500" />
              </div>
              <div>
                <CardTitle className="text-3xl font-black tracking-tighter">EYEiEYE</CardTitle>
                <CardDescription className="text-sm font-medium text-muted-foreground/80">守护你的用眼健康</CardDescription>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-background/50 border border-primary/5 shadow-sm">
                <div className={`h-2 w-2 rounded-full ${paused ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`} />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{paused ? 'Paused' : 'Active'}</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8 pt-2">
          {/* 眨眼提醒部分 */}
          <div className="space-y-5 p-6 rounded-[32px] bg-primary/[0.03] border border-primary/5 hover:border-primary/10 transition-colors duration-500 group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-primary">
                <div className="h-4 w-1 bg-primary rounded-full" />
                眨眼提醒 (20-20-20)
              </div>
              <div className="text-[10px] font-bold text-primary/40 uppercase tracking-tighter">Blink Reminder</div>
            </div>
            <div className="grid gap-8">
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label htmlFor="smallInterval" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">提醒间隔</Label>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black font-mono text-primary">{form.smallIntervalMinutes}</span>
                    <span className="text-xs font-bold text-muted-foreground">min</span>
                  </div>
                </div>
                <input
                  type="range"
                  id="smallInterval"
                  min="1"
                  max="60"
                  value={form.smallIntervalMinutes}
                  onChange={(e) => setForm((s) => ({ ...s, smallIntervalMinutes: Number(e.target.value) }))}
                  className="w-full h-2 bg-primary/10 rounded-full appearance-none cursor-pointer accent-primary hover:accent-primary/80 transition-all"
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label htmlFor="smallDuration" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">持续时长</Label>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black font-mono text-primary">{form.smallDurationSeconds}</span>
                    <span className="text-xs font-bold text-muted-foreground">sec</span>
                  </div>
                </div>
                <input
                  type="range"
                  id="smallDuration"
                  min="1"
                  max="20"
                  value={form.smallDurationSeconds}
                  onChange={(e) => setForm((s) => ({ ...s, smallDurationSeconds: Number(e.target.value) }))}
                  className="w-full h-2 bg-primary/10 rounded-full appearance-none cursor-pointer accent-primary hover:accent-primary/80 transition-all"
                />
              </div>
            </div>
          </div>

          {/* 休息提醒部分 */}
          <div className="space-y-5 p-6 rounded-[32px] bg-secondary/30 border border-secondary hover:border-secondary-foreground/10 transition-colors duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground/80">
                <div className="h-4 w-1 bg-foreground/30 rounded-full" />
                深度休息
              </div>
              <div className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-tighter">Deep Rest</div>
            </div>
            <div className="grid gap-8">
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label htmlFor="bigInterval" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">提醒间隔</Label>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black font-mono text-foreground/80">{form.bigIntervalMinutes}</span>
                    <span className="text-xs font-bold text-muted-foreground">min</span>
                  </div>
                </div>
                <input
                  type="range"
                  id="bigInterval"
                  min="10"
                  max="120"
                  step="5"
                  value={form.bigIntervalMinutes}
                  onChange={(e) => setForm((s) => ({ ...s, bigIntervalMinutes: Number(e.target.value) }))}
                  className="w-full h-2 bg-foreground/10 rounded-full appearance-none cursor-pointer accent-foreground/60 hover:accent-foreground transition-all"
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label htmlFor="bigDuration" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">休息时长</Label>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black font-mono text-foreground/80">{form.bigDurationMinutes}</span>
                    <span className="text-xs font-bold text-muted-foreground">min</span>
                  </div>
                </div>
                <input
                  type="range"
                  id="bigDuration"
                  min="1"
                  max="30"
                  value={form.bigDurationMinutes}
                  onChange={(e) => setForm((s) => ({ ...s, bigDurationMinutes: Number(e.target.value) }))}
                  className="w-full h-2 bg-foreground/10 rounded-full appearance-none cursor-pointer accent-foreground/60 hover:accent-foreground transition-all"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-2">
            <div className="space-y-1">
              <div className="text-sm font-bold tracking-tight">开机自启动</div>
              <div className="text-[11px] font-medium text-muted-foreground/60">Windows 登录后自动在后台运行</div>
            </div>
            <Switch
              checked={Boolean(form.openAtLogin)}
              onCheckedChange={(checked) => setForm((s) => ({ ...s, openAtLogin: checked }))}
              className="data-[state=checked]:bg-primary"
            />
          </div>

          {/* 进程屏蔽部分 */}
          <div className="space-y-5 p-6 rounded-[32px] bg-muted/30 border border-muted-foreground/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground/80">
                <div className="h-4 w-1 bg-foreground/30 rounded-full" />
                免打扰模式
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={openProcessModal}
                className="h-7 text-xs rounded-full px-3"
              >
                + 添加进程
              </Button>
            </div>
            
            <div className="space-y-2">
              {(!form.processBlocklist || form.processBlocklist.length === 0) && (
                <div className="text-xs text-muted-foreground/60 text-center py-2">
                  暂无屏蔽进程，点击上方按钮添加
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {form.processBlocklist?.map(proc => (
                  <div key={proc} className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-background border text-xs font-medium shadow-sm group">
                    {proc}
                    <button 
                      onClick={() => removeProcess(proc)}
                      className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-4 bg-muted/20 p-8">
          <Button 
            variant="ghost" 
            onClick={togglePaused}
            className={`flex-1 h-12 font-bold rounded-2xl transition-all ${paused ? 'text-green-600 hover:text-green-700 hover:bg-green-50' : 'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50'}`}
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </Button>
          <Button onClick={onSave} disabled={saving} className="flex-1 h-12 font-bold rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
            {saving ? 'SAVING...' : 'APPLY SETTINGS'}
          </Button>
        </CardFooter>
      </Card>

      {/* 进程选择弹窗 */}
      {showProcessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
            <CardHeader className="pb-4 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">选择要屏蔽的进程</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowProcessModal(false)}>关闭</Button>
              </div>
              <CardDescription>当这些程序在前台运行时，将暂停提醒</CardDescription>
            </CardHeader>
            <div className="flex-1 overflow-y-auto p-2">
              {loadingApps ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <span className="animate-pulse">正在扫描运行中的程序...</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {runningApps.map((app) => (
                    <button
                      key={`${app.name}-${app.pid}`}
                      onClick={() => addProcess(app.name)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 text-left transition-colors group"
                    >
                      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {app.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-sm">{app.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{app.name}</div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 text-xs font-bold text-primary px-2 py-1 rounded-full bg-primary/10">
                        添加
                      </div>
                    </button>
                  ))}
                  {runningApps.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      未找到有窗口的程序
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function BlinkView() {
  const durationSeconds = useMemo(() => clampInt(Number(getQueryParam('duration') ?? '3'), 1, 30), [])
  const [left, setLeft] = useState(durationSeconds)

  const blinkCycleSeconds = useMemo(() => {
    return Math.min(4, Math.max(1.6, durationSeconds / 3))
  }, [durationSeconds])

  const lookCycleSeconds = useMemo(() => {
    return Math.min(12, Math.max(6, durationSeconds * 2))
  }, [durationSeconds])

  useEffect(() => {
    const prevBodyBg = document.body.style.background
    const prevHtmlBg = document.documentElement.style.background
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    setLeft(durationSeconds)
    const id = window.setInterval(() => {
      setLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => {
      window.clearInterval(id)
      document.body.style.background = prevBodyBg
      document.documentElement.style.background = prevHtmlBg
    }
  }, [durationSeconds])

  const animationVars = useMemo(
    () =>
      ({
        '--eyes-blink-duration': `${blinkCycleSeconds}s`,
        '--eyes-look-duration': `${lookCycleSeconds}s`,
      }) as CSSProperties,
    [blinkCycleSeconds, lookCycleSeconds]
  )

  return (
    <div className="h-screen w-screen bg-transparent p-4 flex items-center justify-center overflow-hidden">
      <div className="relative w-full max-w-[480px] aspect-[16/9] rounded-[40px] bg-background/80 backdrop-blur-2xl border-2 border-primary/10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] flex flex-col items-center justify-center overflow-hidden animate-bounce-in group">
        {/* Border Pulse Effect */}
        <div className="absolute inset-0 rounded-[40px] border-2 border-primary/20 animate-border-pulse pointer-events-none" />
        
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        
        <div
          className="relative z-10 flex items-center justify-center gap-12 mb-6"
          style={animationVars}
        >
          {/* Left eye */}
          <div className="relative h-24 w-24 rounded-full bg-white border-4 border-primary/5 shadow-inner overflow-hidden group-hover:scale-105 transition-transform duration-500">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-foreground animate-eyes-look shadow-lg">
              <div className="absolute top-1.5 left-1.5 h-3 w-3 rounded-full bg-white/40" />
            </div>
            <div className="absolute inset-0 -top-full bg-primary/10 backdrop-blur-[2px] border-b border-primary/20 animate-eyes-blink z-20" />
          </div>
          
          {/* Right eye */}
          <div className="relative h-24 w-24 rounded-full bg-white border-4 border-primary/5 shadow-inner overflow-hidden group-hover:scale-105 transition-transform duration-500">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-foreground animate-eyes-look shadow-lg">
              <div className="absolute top-1.5 left-1.5 h-3 w-3 rounded-full bg-white/40" />
            </div>
            <div className="absolute inset-0 -top-full bg-primary/10 backdrop-blur-[2px] border-b border-primary/20 animate-eyes-blink z-20" />
          </div>
        </div>

        <div className="relative z-10 space-y-1 text-center">
          <div className="text-4xl font-black tracking-tight text-foreground/90 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
            记得眨眨眼
          </div>
          <div className="text-lg font-bold text-primary/60 flex items-center justify-center gap-3">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span>放松一下</span>
            <span className="px-3 py-0.5 rounded-full bg-primary/10 text-sm font-mono border border-primary/10">
              {left}s
            </span>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-3xl animate-float" />
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '-3s' }} />
      </div>
    </div>
  )
}

function RestView() {
  const durationSeconds = useMemo(
    () => clampInt(Number(getQueryParam('duration') ?? String(3 * 60)), 10, 60 * 60),
    []
  )
  const [left, setLeft] = useState(durationSeconds)

  const breathCycleSeconds = 8
  const [breathPhase, setBreathPhase] = useState<'inhale' | 'exhale'>('inhale')
  const tip = useMemo(() => {
    const TIPS = [
      "眺望 6 米外的远方，让睫状肌彻底放松",
      "多眨眨眼，给眼球涂上一层“润滑油”",
      "起个身，活动一下僵硬的肩颈",
      "深呼吸，感受空气进入肺部的节奏",
      "闭上眼，享受片刻的宁静",
    ]
    return TIPS[Math.floor(Math.random() * TIPS.length)]
  }, [])

  useEffect(() => {
    setLeft(durationSeconds)
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      const next = Math.max(0, durationSeconds - elapsed)
      setLeft(next)
    }, 250)
    return () => window.clearInterval(id)
  }, [durationSeconds])

  useEffect(() => {
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt
      const t = (elapsedMs / 1000) % breathCycleSeconds
      setBreathPhase(t < breathCycleSeconds / 2 ? 'inhale' : 'exhale')
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')

  const ringR = 90
  const ringC = 2 * Math.PI * ringR
  const progress = durationSeconds > 0 ? 1 - left / durationSeconds : 1
  const dashOffset = ringC * progress

  return (
    <div className="h-screen w-screen bg-background flex items-center justify-center overflow-hidden relative animate-in fade-in duration-1000">
      {/* Vignette Effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)] z-20 pointer-events-none" />
      
      {/* Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-secondary/20 animate-pulse" />
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[120px] animate-float" style={{ animationDuration: '15s' }} />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-secondary/10 rounded-full blur-[120px] animate-float" style={{ animationDuration: '20s', animationDelay: '-5s' }} />

      <div className="relative z-30 w-[640px] max-w-[92vw] rounded-[60px] border border-white/20 bg-background/40 backdrop-blur-3xl p-12 text-center shadow-[0_0_100px_-20px_rgba(0,0,0,0.3)] animate-fade-in-up">
        <div className="space-y-3">
          <div className="inline-block px-4 py-1 rounded-full bg-primary/10 text-primary text-sm font-bold tracking-widest uppercase mb-2">
            Deep Rest
          </div>
          <div className="text-5xl font-black tracking-tighter text-foreground drop-shadow-sm">
            休息时间
          </div>
          <div className="text-xl text-muted-foreground font-medium max-w-md mx-auto leading-relaxed">
            {tip}
          </div>
        </div>

        <div className="relative mx-auto mt-12 h-[320px] w-[320px] flex items-center justify-center">
          {/* Progress ring */}
          <svg className="absolute inset-0 -rotate-90 drop-shadow-2xl" width="320" height="320" viewBox="0 0 200 200">
            <circle
              className="text-primary/10"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              r={ringR}
              cx="100"
              cy="100"
            />
            <circle
              className="text-primary transition-all duration-700 ease-out"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              r={ringR}
              cx="100"
              cy="100"
              strokeLinecap="round"
              style={{
                strokeDasharray: `${ringC} ${ringC}`,
                strokeDashoffset: dashOffset,
                filter: 'drop-shadow(0 0 12px hsl(var(--primary) / 0.5))',
              }}
            />
          </svg>

          {/* Breathing core */}
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="relative">
              <div className="h-28 w-28 rounded-full bg-primary/30 animate-rest-breathe" />
              <div className="absolute inset-0 h-28 w-28 rounded-full bg-primary/50 blur-2xl animate-rest-breathe" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-4 w-4 rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl font-black text-primary tracking-tight">
                {breathPhase === 'inhale' ? '吸气…' : '呼气…'}
              </div>
              <div className="text-5xl font-mono font-black tracking-tighter text-foreground/90">
                {mm}<span className="animate-pulse">:</span>{ss}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center gap-8">
          <div className="text-sm text-muted-foreground/80 font-bold tracking-wide flex items-center gap-2">
            <span className="w-12 h-[1px] bg-muted-foreground/20" />
            坚持就是胜利，眼睛会感谢你的
            <span className="w-12 h-[1px] bg-muted-foreground/20" />
          </div>
          <Button
            variant="ghost"
            className="text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-full px-10 py-6 text-base font-bold transition-all hover:scale-105 active:scale-95"
            onClick={() => {
              void window.eyeieye.exitRest()
            }}
          >
            我有急事，跳过休息
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const view = useMemo(() => getViewMode(), [])

  if (view === 'blink') return <BlinkView />
  if (view === 'rest') return <RestView />
  return <SettingsView />
}
