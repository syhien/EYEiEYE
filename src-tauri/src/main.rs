#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  collections::HashMap,
  path::PathBuf,
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
  },
  time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
  CustomMenuItem,
  Manager,
  SystemTray,
  SystemTrayEvent,
  SystemTrayMenu,
  SystemTrayMenuItem,
  WindowEvent,
  WindowUrl,
};
use tokio::sync::watch;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub small_interval_minutes: i64,
  pub small_duration_seconds: i64,
  pub big_interval_minutes: i64,
  pub big_duration_minutes: i64,
  pub open_at_login: bool,
  pub process_blocklist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
  pub paused: bool,
}

impl Default for Settings {
  fn default() -> Self {
    Self {
      small_interval_minutes: 5,
      small_duration_seconds: 3,
      big_interval_minutes: 60,
      big_duration_minutes: 3,
      open_at_login: false,
      process_blocklist: vec![],
    }
  }
}

fn clamp_i64(value: i64, min: i64, max: i64, fallback: i64) -> i64 {
  if value < min || value > max {
    return fallback;
  }
  value
}

fn normalize_settings(input: Settings) -> Settings {
  Settings {
    small_interval_minutes: clamp_i64(input.small_interval_minutes, 1, 240, Settings::default().small_interval_minutes),
    small_duration_seconds: clamp_i64(input.small_duration_seconds, 1, 30, Settings::default().small_duration_seconds),
    big_interval_minutes: clamp_i64(input.big_interval_minutes, 5, 480, Settings::default().big_interval_minutes),
    big_duration_minutes: clamp_i64(input.big_duration_minutes, 1, 30, Settings::default().big_duration_minutes),
    open_at_login: input.open_at_login,
    process_blocklist: input.process_blocklist,
  }
}

fn settings_path(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
  let base = app
    .path_resolver()
    .app_config_dir()
    .ok_or_else(|| anyhow::anyhow!("failed to resolve app_config_dir"))?;
  Ok(base.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Settings {
  let p = match settings_path(app) {
    Ok(p) => p,
    Err(_) => return Settings::default(),
  };

  match std::fs::read_to_string(p) {
    Ok(raw) => serde_json::from_str::<Settings>(&raw).map(normalize_settings).unwrap_or_default(),
    Err(_) => Settings::default(),
  }
}

fn write_settings(app: &tauri::AppHandle, settings: &Settings) -> anyhow::Result<()> {
  let p = settings_path(app)?;
  if let Some(parent) = p.parent() {
    std::fs::create_dir_all(parent)?;
  }
  std::fs::write(p, serde_json::to_string_pretty(settings)?)?;
  Ok(())
}

#[cfg(windows)]
fn apply_autostart(open_at_login: bool) -> anyhow::Result<()> {
  use winreg::{enums::HKEY_CURRENT_USER, RegKey};

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let (key, _) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")?;

  let exe = std::env::current_exe()?;
  let exe_str = format!("\"{}\"", exe.to_string_lossy());

  if open_at_login {
    key.set_value("EYEiEYE", &exe_str)?;
  } else {
    let _ = key.delete_value("EYEiEYE");
  }

  Ok(())
}

#[cfg(not(windows))]
fn apply_autostart(_open_at_login: bool) -> anyhow::Result<()> {
  Ok(())
}

#[derive(Clone)]
struct RuntimeState {
  paused: Arc<AtomicBool>,
  rest_allow_close: Arc<AtomicBool>,
  scheduler_tx: watch::Sender<u64>,
}

impl RuntimeState {
  fn is_paused(&self) -> bool {
    self.paused.load(Ordering::SeqCst)
  }

  fn set_paused(&self, paused: bool) {
    self.paused.store(paused, Ordering::SeqCst);
  }

  fn reset_scheduler(&self) {
    let next = *self.scheduler_tx.borrow() + 1;
    let _ = self.scheduler_tx.send(next);
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunningApp {
  name: String,
  title: String,
  pid: u32,
}

#[cfg(windows)]
mod win {
  use super::*;
  use std::{
    ffi::OsString,
    os::windows::ffi::OsStringExt,
  };

  use windows::Win32::{
    Foundation::{BOOL, HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    System::{
      ProcessStatus::K32GetModuleFileNameExW,
      Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ},
    },
    UI::WindowsAndMessaging::{
      EnumWindows, GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
      GetWindowThreadProcessId, IsWindowVisible,
    },
  };

  fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    OsString::from_wide(&buf[..end]).to_string_lossy().to_string()
  }

  fn window_title(hwnd: HWND) -> Option<String> {
    unsafe {
      let len = GetWindowTextLengthW(hwnd);
      if len == 0 {
        return None;
      }
      let mut buf = vec![0u16; (len + 1) as usize];
      let read = GetWindowTextW(hwnd, &mut buf);
      if read == 0 {
        return None;
      }
      let s = wide_to_string(&buf);
      let s = s.trim().to_string();
      if s.is_empty() { None } else { Some(s) }
    }
  }

  fn process_exe_name(pid: u32) -> Option<String> {
    unsafe {
      let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, pid).ok()?;
      let mut buf = vec![0u16; 32768];
      let len = K32GetModuleFileNameExW(h, None, &mut buf);
      if len == 0 {
        return None;
      }
      let full = wide_to_string(&buf);
      let name = std::path::Path::new(&full)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
      if name.is_empty() { None } else { Some(name) }
    }
  }

  pub fn list_running_window_apps() -> Vec<RunningApp> {
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
      let apps = &mut *(lparam.0 as *mut Vec<RunningApp>);

      if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
      }

      let title = match window_title(hwnd) {
        Some(t) => t,
        None => return BOOL(1),
      };

      let mut pid: u32 = 0;
      let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
      if pid == 0 {
        return BOOL(1);
      }

      let name = process_exe_name(pid).unwrap_or_else(|| format!("{pid}"));

      apps.push(RunningApp { name, title, pid });
      BOOL(1)
    }

    let mut raw: Vec<RunningApp> = vec![];
    unsafe {
      let _ = EnumWindows(Some(enum_proc), LPARAM(&mut raw as *mut _ as isize));
    }

    // Dedupe by exe name (match Electron behavior)
    let mut map: HashMap<String, RunningApp> = HashMap::new();
    for app in raw {
      map.entry(app.name.clone()).or_insert(app);
    }

    map.into_values().collect()
  }

  pub fn foreground_exe_and_rect() -> Option<(String, RECT)> {
    unsafe {
      let hwnd = GetForegroundWindow();
      if hwnd.0.is_null() {
        return None;
      }

      let mut pid: u32 = 0;
      let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
      if pid == 0 {
        return None;
      }

      let mut rect = RECT::default();
      GetWindowRect(hwnd, &mut rect).ok()?;

      let exe = process_exe_name(pid)?;
      Some((exe, rect))
    }
  }

  pub fn is_foreground_external_fullscreen(app_name_hint: &str) -> bool {
    let (exe, rect) = match foreground_exe_and_rect() {
      Some(v) => v,
      None => return true, // fail-safe: don't pop
    };

    let exe_l = exe.to_lowercase();
    if exe_l.contains(&app_name_hint.to_lowercase()) {
      return false;
    }

    // Use nearest monitor for the foreground window
    unsafe {
      let hwnd = GetForegroundWindow();
      if hwnd.0.is_null() {
        return true;
      }

      let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
      let mut mi = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
      };
      if !GetMonitorInfoW(monitor, &mut mi as *mut _ as *mut _).as_bool() {
        return true;
      }

      let d = mi.rcMonitor;
      let w = mi.rcWork;

      let b_w = (rect.right - rect.left) as i32;
      let b_h = (rect.bottom - rect.top) as i32;
      let b_x = rect.left as i32;
      let b_y = rect.top as i32;

      let d_w = (d.right - d.left) as i32;
      let d_h = (d.bottom - d.top) as i32;
      let d_x = d.left as i32;
      let d_y = d.top as i32;

      let w_x = w.left as i32;
      let w_y = w.top as i32;
      let w_w = (w.right - w.left) as i32;
      let w_h = (w.bottom - w.top) as i32;

      // Same idea as Electron version: avoid treating maximized windows as fullscreen
      if (d_w != w_w || d_h != w_h)
        && b_x >= w_x - 2
        && b_y >= w_y - 2
        && b_w <= w_w + 4
        && b_h <= w_h + 4
      {
        return false;
      }

      let eps = 5;
      let is_fullscreen_size = (b_w - d_w).abs() <= eps
        && (b_h - d_h).abs() <= eps
        && (b_x - d_x).abs() <= eps
        && (b_y - d_y).abs() <= eps;

      let window_area = (b_w as i64) * (b_h as i64);
      let display_area = (d_w as i64) * (d_h as i64);
      let covers_most = window_area >= (display_area * 98 / 100);

      is_fullscreen_size || covers_most
    }
  }

  pub fn cursor_monitor_workarea_center() -> Option<(i32, i32, i32, i32)> {
    unsafe {
      let mut p = POINT::default();
      GetCursorPos(&mut p).ok()?;
      let monitor = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
      let mut mi = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
      };
      if !GetMonitorInfoW(monitor, &mut mi as *mut _ as *mut _).as_bool() {
        return None;
      }
      let w = mi.rcWork;
      let w_x = w.left as i32;
      let w_y = w.top as i32;
      let w_w = (w.right - w.left) as i32;
      let w_h = (w.bottom - w.top) as i32;
      Some((w_x, w_y, w_w, w_h))
    }
  }

  pub fn toast_30s_before_rest() {
    use winrt_notification::{Duration as ToastDuration, Toast};
    let _ = Toast::new(Toast::POWERSHELL_APP_ID)
      .title("EYEiEYE")
      .text1("30 秒后进入休息时间")
      .duration(ToastDuration::Short)
      .show();
  }
}

fn is_process_blocked(_app: &tauri::AppHandle, settings: &Settings) -> bool {
  if settings.process_blocklist.is_empty() {
    return false;
  }

  #[cfg(windows)]
  {
    if let Some((exe, _)) = win::foreground_exe_and_rect() {
      let current = exe.to_lowercase();
      return settings
        .process_blocklist
        .iter()
        .any(|b| b.to_lowercase() == current);
    }
    return false;
  }

  #[cfg(not(windows))]
  {
    let _ = (app, settings);
    false
  }
}

fn is_external_fullscreen() -> bool {
  #[cfg(windows)]
  {
    // match Electron's fail-safe: if unsure, don't show reminders.
    win::is_foreground_external_fullscreen("eyeieye")
  }
  #[cfg(not(windows))]
  {
    false
  }
}

fn show_settings_window(app: &tauri::AppHandle) {
  if let Some(w) = app.get_window("main") {
    let _ = w.show();
    let _ = w.set_focus();
  }
}

fn centered_position(width: f64, height: f64) -> Option<(f64, f64)> {
  #[cfg(windows)]
  {
    let (x, y, w, h) = win::cursor_monitor_workarea_center()?;
    let cx = x as f64 + (w as f64 - width) / 2.0;
    let cy = y as f64 + (h as f64 - height) / 2.0;
    Some((cx.round(), cy.round()))
  }
  #[cfg(not(windows))]
  {
    let _ = (width, height);
    None
  }
}

async fn maybe_notify_before_rest(app: tauri::AppHandle, state: RuntimeState) {
  if state.is_paused() {
    return;
  }

  let settings = read_settings(&app);
  if is_external_fullscreen() || is_process_blocked(&app, &settings) {
    return;
  }

  #[cfg(windows)]
  {
    win::toast_30s_before_rest();
  }
}

async fn show_blink_window(app: tauri::AppHandle, state: RuntimeState, settings: Settings) {
  if state.is_paused() {
    return;
  }
  if is_external_fullscreen() || is_process_blocked(&app, &settings) {
    return;
  }

  let duration = settings.small_duration_seconds.max(1).min(30) as u64;

  let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
  let label = format!("blink-{ts}");
  let url = WindowUrl::App(format!("index.html?view=blink&duration={}", duration).into());

  let mut builder = tauri::WindowBuilder::new(&app, label, url)
    .title("EYEiEYE")
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false);

  // Size & center
  let w = 640.0;
  let h = 360.0;
  builder = builder.inner_size(w, h);
  if let Some((x, y)) = centered_position(w, h) {
    builder = builder.position(x, y);
  }

  let win = match builder.build() {
    Ok(w) => w,
    Err(_) => return,
  };

  let _ = win.show();

  tauri::async_runtime::spawn(async move {
    tokio::time::sleep(Duration::from_secs(duration)).await;
    let _ = win.close();
  });
}

async fn show_rest_window(app: tauri::AppHandle, state: RuntimeState, settings: Settings) {
  if state.is_paused() {
    return;
  }
  if is_external_fullscreen() || is_process_blocked(&app, &settings) {
    return;
  }

  let duration_seconds = (settings.big_duration_minutes.max(1).min(30) * 60) as u64;

  state.rest_allow_close.store(false, Ordering::SeqCst);

  let url = WindowUrl::App(format!("index.html?view=rest&duration={}", duration_seconds).into());

  // Use fixed label so `exitRest` can find it.
  let rest = match tauri::WindowBuilder::new(&app, "rest", url)
    .title("EYEiEYE")
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .fullscreen(true)
    .visible(false)
    .build()
  {
    Ok(w) => w,
    Err(_) => {
      // If already exists, reuse.
      if let Some(w) = app.get_window("rest") {
        let _ = w.eval(&format!(
          "window.location.replace('index.html?view=rest&duration={}')",
          duration_seconds
        ));
        w
      } else {
        return;
      }
    }
  };

  let allow = state.rest_allow_close.clone();
  rest.on_window_event(move |e| {
    if let WindowEvent::CloseRequested { api, .. } = e {
      if !allow.load(Ordering::SeqCst) {
        api.prevent_close();
      }
    }
  });

  let _ = rest.show();
  let _ = rest.set_focus();

  let state2 = state.clone();
  tauri::async_runtime::spawn(async move {
    tokio::time::sleep(Duration::from_secs(duration_seconds)).await;
    state2.rest_allow_close.store(true, Ordering::SeqCst);
    if let Some(w) = app.get_window("rest") {
      let _ = w.close();
    }
  });
}

fn start_scheduler(app: tauri::AppHandle, state: RuntimeState, mut rx: watch::Receiver<u64>) {
  tauri::async_runtime::spawn(async move {
    loop {
      if rx.changed().await.is_err() {
        return;
      }

      let my_gen = *rx.borrow();
      if state.is_paused() {
        continue;
      }

      // Blink loop (cancel when generation changes)
      {
        let app_b = app.clone();
        let state_b = state.clone();
        let mut rx_b = rx.clone();
        tauri::async_runtime::spawn(async move {
          loop {
            let s = read_settings(&app_b);
            let interval = Duration::from_millis((s.small_interval_minutes.max(1) as u64) * 60_000);

            tokio::select! {
              _ = tokio::time::sleep(interval) => {},
              r = rx_b.changed() => {
                if r.is_err() || *rx_b.borrow() != my_gen { return; }
                continue;
              }
            }

            if state_b.is_paused() { return; }
            if *rx_b.borrow() != my_gen { return; }
            show_blink_window(app_b.clone(), state_b.clone(), s).await;
          }
        });
      }

      // Rest loop (notify + rest), cancel when generation changes
      {
        let app_r = app.clone();
        let state_r = state.clone();
        let mut rx_r = rx.clone();
        tauri::async_runtime::spawn(async move {
          loop {
            let s = read_settings(&app_r);
            let interval = Duration::from_millis((s.big_interval_minutes.max(5) as u64) * 60_000);
            let notify_delta = interval.saturating_sub(Duration::from_secs(30));

            tokio::select! {
              _ = tokio::time::sleep(notify_delta) => {},
              r = rx_r.changed() => {
                if r.is_err() || *rx_r.borrow() != my_gen { return; }
                continue;
              }
            }
            if state_r.is_paused() { return; }
            if *rx_r.borrow() != my_gen { return; }
            maybe_notify_before_rest(app_r.clone(), state_r.clone()).await;

            tokio::select! {
              _ = tokio::time::sleep(interval.saturating_sub(notify_delta)) => {},
              r = rx_r.changed() => {
                if r.is_err() || *rx_r.borrow() != my_gen { return; }
                continue;
              }
            }
            if state_r.is_paused() { return; }
            if *rx_r.borrow() != my_gen { return; }
            show_rest_window(app_r.clone(), state_r.clone(), s).await;
          }
        });
      }
    }
  });
}

fn build_tray_menu(paused: bool) -> SystemTrayMenu {
  let open = CustomMenuItem::new("open_settings".to_string(), "打开设置");
  let toggle = CustomMenuItem::new(
    "toggle_paused".to_string(),
    if paused { "继续提醒" } else { "暂停提醒" },
  );
  let quit = CustomMenuItem::new("quit".to_string(), "退出");

  SystemTrayMenu::new()
    .add_item(open)
    .add_item(toggle)
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(quit)
}

#[tauri::command]
fn settings_get(app: tauri::AppHandle) -> Settings {
  read_settings(&app)
}

#[tauri::command]
fn settings_set(app: tauri::AppHandle, state: tauri::State<RuntimeState>, settings: Settings) -> Result<Settings, String> {
  let normalized = normalize_settings(settings);
  write_settings(&app, &normalized).map_err(|e| e.to_string())?;

  if let Err(e) = apply_autostart(normalized.open_at_login) {
    eprintln!("apply_autostart failed: {e}");
  }

  state.reset_scheduler();
  Ok(normalized)
}

#[tauri::command]
fn status_get(state: tauri::State<RuntimeState>) -> AppStatus {
  AppStatus { paused: state.is_paused() }
}

#[tauri::command]
fn status_set_paused(state: tauri::State<RuntimeState>, paused: bool) -> AppStatus {
  state.set_paused(paused);
  state.reset_scheduler();
  AppStatus { paused }
}

#[tauri::command]
fn apps_get_running() -> Vec<RunningApp> {
  #[cfg(windows)]
  {
    win::list_running_window_apps()
  }
  #[cfg(not(windows))]
  {
    vec![]
  }
}

#[tauri::command]
fn rest_exit(app: tauri::AppHandle, state: tauri::State<RuntimeState>) -> serde_json::Value {
  state.rest_allow_close.store(true, Ordering::SeqCst);
  if let Some(w) = app.get_window("rest") {
    let _ = w.close();
    serde_json::json!({"ok": true})
  } else {
    serde_json::json!({"ok": false})
  }
}

fn main() {
  let (tx, rx) = watch::channel(0u64);
  let state = RuntimeState {
    paused: Arc::new(AtomicBool::new(false)),
    rest_allow_close: Arc::new(AtomicBool::new(false)),
    scheduler_tx: tx,
  };

  let tray = SystemTray::new().with_menu(build_tray_menu(false));

  tauri::Builder::default()
    .manage(state.clone())
    .system_tray(tray)
    .on_system_tray_event(move |app, event| {
      if let SystemTrayEvent::MenuItemClick { id, .. } = event {
        match id.as_str() {
          "open_settings" => {
            show_settings_window(app);
          }
          "toggle_paused" => {
            let st = app.state::<RuntimeState>();
            let next = !st.is_paused();
            st.set_paused(next);
            st.reset_scheduler();

            // Update menu label
            let handle = app.tray_handle();
            let _ = handle
              .get_item("toggle_paused")
              .set_title(if next { "继续提醒" } else { "暂停提醒" });
          }
          "quit" => {
            std::process::exit(0);
          }
          _ => {}
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      settings_get,
      settings_set,
      status_get,
      status_set_paused,
      apps_get_running,
      rest_exit
    ])
    .setup(move |app| {
      // Make sure main window never quits the app; hide instead.
      if let Some(w) = app.get_window("main") {
        let _ = w.on_window_event(|event| {
          if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
          }
        });
        let _ = w.hide();
      }

      // Apply autostart once at boot
      let settings = read_settings(&app.handle());
      let _ = apply_autostart(settings.open_at_login);

      // Start scheduler (idle until first reset)
      start_scheduler(app.handle(), state.clone(), rx);
      state.reset_scheduler();

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
