const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function removeLegacyLoginData() {
    const userDataDirectory = path.resolve(app.getPath('userData'));
    const legacyLoginDirectory = path.resolve(userDataDirectory, 'cookies');
    if (path.dirname(legacyLoginDirectory) !== userDataDirectory) {
        throw new Error('旧登录数据目录不在 Electron 用户数据目录中');
    }
    try {
        fs.rmSync(legacyLoginDirectory, { recursive: true, force: true });
    } catch (error) {
        console.warn('[login-data] Failed to remove legacy login data:', error);
    }
}

function createWindow() {
    const isDev = process.env.NODE_ENV === 'development';

    // 1. 启动后端进程
    if (!isDev) {
        const serverPath = app.isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'dist', 'main.js')
            : path.join(__dirname, 'server', 'dist', 'main.js');

        if (!fs.existsSync(serverPath)) {
            dialog.showErrorBox("文件缺失", "找不到核心后台服务，请尝试重新下载本程序。");
            app.quit();
            return;
        }
            
        serverProcess = fork(serverPath, [], {
            env: Object.assign({}, process.env, {
                NODE_ENV: 'production',
                API_PORT: '3000'
            }),
            stdio: 'pipe'
        });

        // 仅保留关键错误打印，避免正常的日志也弹窗干扰用户
        serverProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data}`));
    }

    const iconPath = path.join(__dirname, 'icon.ico');

    // 2. 初始化主窗口
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        icon: iconPath,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:4000');
    } else {
        mainWindow.loadFile(path.join(__dirname, 'client', 'dist', 'index.html'));
    }

    mainWindow.on('closed', () => {
        if (serverProcess) serverProcess.kill();
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    removeLegacyLoginData();
    createWindow();
});

// 所有窗口关闭后完全退出程序
app.on('window-all-closed', () => {
    app.quit();
});
