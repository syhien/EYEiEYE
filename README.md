# EYEiEYE

一个 Windows 托盘常驻的眨眼 / 休息提醒软件。

## 技术栈

- Tauri (Rust) + Vite + React + TypeScript
- Tailwind CSS
- shadcn/ui（以源码组件方式集成在 `src/components/ui/*`）

## 功能说明

- 启动后隐藏在系统托盘（不会自动弹出主窗口）
- 小间隔：到点后在屏幕正中弹出“眨眼一下”提示，持续 N 秒后自动关闭
- 大间隔：开始前 30 秒通过系统原生通知提示；到点后弹出全屏半透明休息覆盖页，持续 M 分钟后自动关闭
- 当检测到你正在使用“外部全屏应用”（全屏游戏、全屏视频等）时，不会弹出任何提醒（包含眨眼/休息/提前通知）

> 设置窗口可在托盘菜单中打开。

## 开发

```bash
npm install
npm run dev
```

## 构建（Windows）

```bash
npm run build
```

构建产物默认输出到 `src-tauri/target/release/bundle/`（如 `msi/`、`nsis/`）。

## 代码入口

- Rust 主程序：`src-tauri/src/main.rs`
- 渲染进程（设置/眨眼/休息三种视图用 query 参数区分）：`src/App.tsx`
