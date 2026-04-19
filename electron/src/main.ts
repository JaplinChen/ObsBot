import {
  app,
  Tray,
  Menu,
  shell,
  nativeImage,
  Notification,
  ipcMain,
  BrowserWindow,
} from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import AutoLaunch from 'electron-auto-launch';

// ── 常數 ────────────────────────────────────────────────────────────────
const ADMIN_URL = 'http://localhost:3001';
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..', '..');

const ENV_PATH = path.join(APP_ROOT, '.env');
const NODE_BIN = process.execPath; // Electron 打包後內含 Node.js

// ── 狀態 ────────────────────────────────────────────────────────────────
let tray: Tray | null = null;
let botProcess: ChildProcess | null = null;
let isRunning = false;
let setupWindow: Electron.BrowserWindow | null = null;

const autoLauncher = new AutoLaunch({ name: 'KnowPipe', isHidden: true });

// ── 工具函式 ─────────────────────────────────────────────────────────────
function getIconPath(state: 'running' | 'stopped' | 'error'): string {
  const icons: Record<string, string> = {
    running: 'icon-running.png',
    stopped: 'icon-stopped.png',
    error: 'icon-error.png',
  };
  const file = icons[state];
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', 'assets');
  const full = path.join(dir, file);
  // 找不到圖示時使用空白圖
  return fs.existsSync(full) ? full : path.join(dir, 'icon.png');
}

function updateTray() {
  if (!tray) return;
  const icon = nativeImage.createFromPath(
    getIconPath(isRunning ? 'running' : 'stopped')
  );
  tray.setImage(icon);

  const menu = Menu.buildFromTemplate([
    {
      label: isRunning ? '● 運行中' : '○ 已停止',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '開啟管理介面',
      enabled: isRunning,
      click: () => shell.openExternal(ADMIN_URL),
    },
    { type: 'separator' },
    {
      label: isRunning ? '停止 Bot' : '啟動 Bot',
      click: () => (isRunning ? stopBot() : startBot()),
    },
    {
      label: '開機時自動啟動',
      type: 'checkbox',
      checked: false,
      click: async (item) => {
        if (item.checked) {
          await autoLauncher.enable();
        } else {
          await autoLauncher.disable();
        }
      },
    },
    { type: 'separator' },
    { label: '結束 KnowPipe', click: () => quitApp() },
  ]);

  // 非同步更新「開機自動啟動」勾選狀態
  autoLauncher.isEnabled().then((enabled: boolean) => {
    const autoItem = menu.items.find((i) => i.label === '開機時自動啟動');
    if (autoItem) autoItem.checked = enabled;
    tray?.setContextMenu(menu);
  });

  tray.setContextMenu(menu);
  tray.setToolTip(isRunning ? 'KnowPipe — 運行中' : 'KnowPipe — 已停止');
}

// ── Bot 生命週期 ──────────────────────────────────────────────────────────
function startBot() {
  if (isRunning) return;

  const loopScript = path.join(APP_ROOT, 'scripts', 'loop.mjs');
  const nodeModules = path.join(APP_ROOT, 'node_modules');

  // 找系統 node（打包版用 Electron 內建 node，開發版用系統 node）
  const nodeBin = findNodeBin();
  if (!nodeBin) {
    notify('啟動失敗', '找不到 Node.js，請重新安裝 KnowPipe。');
    return;
  }

  botProcess = spawn(nodeBin, [loopScript], {
    cwd: APP_ROOT,
    env: { ...process.env, NODE_PATH: nodeModules },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  botProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('Bot started') || msg.includes('已啟動')) {
      isRunning = true;
      updateTray();
    }
  });

  botProcess.stderr?.on('data', (data) => {
    console.error('[bot]', data.toString().trim());
  });

  botProcess.on('spawn', () => {
    // 3 秒後若進程仍在，視為成功
    setTimeout(() => {
      if (botProcess && !botProcess.killed) {
        isRunning = true;
        updateTray();
        notify('KnowPipe 已啟動', '管理介面：' + ADMIN_URL);
      }
    }, 3000);
  });

  botProcess.on('exit', (code) => {
    isRunning = false;
    botProcess = null;
    updateTray();
    if (code !== 0 && code !== null) {
      notify('KnowPipe 已停止', `退出代碼 ${code}`);
    }
  });
}

function stopBot() {
  if (!botProcess) {
    isRunning = false;
    updateTray();
    return;
  }
  botProcess.kill('SIGTERM');
  setTimeout(() => {
    if (botProcess && !botProcess.killed) botProcess.kill('SIGKILL');
  }, 5000);
  isRunning = false;
  updateTray();
}

function findNodeBin(): string | null {
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Windows：嘗試 PATH
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function quitApp() {
  stopBot();
  app.quit();
}

// ── 設定精靈 ──────────────────────────────────────────────────────────────
function openSetupWizard() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 560,
    height: 620,
    resizable: false,
    title: 'KnowPipe 設定',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  setupWindow = win;

  const wizardPath = path.join(__dirname, '..', 'assets', 'setup.html');
  win.loadFile(wizardPath);
  win.setMenuBarVisibility(false);

  win.on('closed', () => {
    setupWindow = null;
    if (fs.existsSync(ENV_PATH)) startBot();
  });
}

// ── IPC：setup wizard → main ──────────────────────────────────────────────
ipcMain.handle('save-config', async (_event, config: Record<string, string>) => {
  const lines = Object.entries(config)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
  return { ok: true };
});

ipcMain.handle('find-vaults', async () => {
  const { homedir } = require('os');
  const home = homedir();
  const searchPaths = [
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    home,
  ];
  const vaults: string[] = [];
  for (const base of searchPaths) {
    if (!fs.existsSync(base)) continue;
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const vaultPath = path.join(base, entry.name);
        if (fs.existsSync(path.join(vaultPath, '.obsidian'))) {
          vaults.push(vaultPath);
        }
      }
    } catch { /* skip */ }
  }
  return vaults;
});

ipcMain.handle('test-token', async (_event, token: string) => {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { ok: boolean; result?: { username: string } };
    if (data.ok && data.result) return { ok: true, username: data.result.username };
    return { ok: false };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('open-folder-dialog', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '選擇 Obsidian Vault 資料夾',
  });
  return result.filePaths[0] ?? null;
});

// ── App 啟動 ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // macOS：不在 Dock 顯示
  if (process.platform === 'darwin') app.dock?.hide();

  // 建立 tray
  const iconPath = getIconPath('stopped');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('KnowPipe');
  updateTray();

  // 首次執行 → 開啟設定精靈
  if (!fs.existsSync(ENV_PATH)) {
    openSetupWizard();
  } else {
    startBot();
  }
});

app.on('window-all-closed', () => {
  // 保持背景執行，不因視窗關閉而退出
});

app.on('before-quit', () => {
  stopBot();
});
