/**
 * Electron 主进程：把打包好的 web 版装进一个原生窗口。
 *
 * 关键点：**不要用 file:// 加载**。
 * Vite 产出的 index.html 里带 `crossorigin`，file:// 下会被 CORS 拦掉，
 * 表现就是黑屏。这里注册一个 app:// 自定义协议，当成本地 http 服务用。
 */
const { app, BrowserWindow, Menu, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

// 常见的几种就够，缺的走 octet-stream
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

// LIARSBAR_FORCE_PROD=1 时强制走打包后的 app:// 分支，方便在未打包状态下验证
const isDev = !app.isPackaged && !process.env.LIARSBAR_FORCE_PROD;
const DIST = path.join(__dirname, '..', 'apps', 'web', 'dist');

// 自动化测试用：LIARSBAR_CDP=9222 时开放调试端口
if (process.env.LIARSBAR_CDP) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.LIARSBAR_CDP);
}

// 必须在 ready 之前声明为特权协议，否则 module/worker 会被当成不安全上下文
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0d0806',
    title: '骗子酒馆',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 打开 devtools 方便排查（环境变量控制）
  if (process.env.LIARSBAR_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  if (isDev) {
    win.loadURL('http://localhost:5183/');
  } else {
    win.loadURL('app://bundle/index.html');
  }
}

app.whenReady().then(() => {
  // app://bundle/xxx → dist/xxx
  // 注意：asar 打包后 file:// 读不了包内文件，必须用 fs（Electron 的 fs 支持 asar）
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.join(DIST, rel);
    if (!target.startsWith(DIST)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fs.readFile(target);
      return new Response(data, {
        status: 200,
        headers: { 'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

Menu.setApplicationMenu(null);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
