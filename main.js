const { app, BrowserWindow, dialog, Menu, Notification, Tray, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;
let tray = null;
let quitting = false;
let trayStatus = '自动签到：未开启';
let trayHintShown = false;

const isDev = process.env.NODE_ENV === 'development';
/** Started by Windows at login: stay in the tray without opening the window. */
const startHidden = process.argv.includes('--hidden');
const iconPath = path.join(__dirname, 'icon.ico');

const userDataPath = (...parts) => path.join(app.getPath('userData'), ...parts);
const loginFile = () => userDataPath('login.dat');

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

// ---------- Saved login (encrypted with the Windows account via safeStorage / DPAPI) ----------

function saveLogin(login) {
    if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[login-data] Encryption unavailable; login not saved');
        return;
    }
    const encrypted = safeStorage.encryptString(JSON.stringify({
        studentId: login.studentId,
        password: login.password,
        networkMode: login.networkMode
    }));
    fs.mkdirSync(path.dirname(loginFile()), { recursive: true });
    fs.writeFileSync(loginFile(), encrypted);
}

function loadLogin() {
    try {
        if (!fs.existsSync(loginFile()) || !safeStorage.isEncryptionAvailable()) {
            return null;
        }
        return JSON.parse(safeStorage.decryptString(fs.readFileSync(loginFile())));
    } catch (error) {
        console.warn('[login-data] Failed to read saved login:', error);
        return null;
    }
}

function forgetLogin() {
    fs.rmSync(loginFile(), { force: true });
}

// ---------- Launch at Windows login ----------

/** The portable build unpacks to a temp folder; register the .exe the user actually runs. */
const launchTarget = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

function getAutoStart() {
    return app.getLoginItemSettings({ path: launchTarget(), args: ['--hidden'] }).openAtLogin;
}

function setAutoStart(enabled) {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: launchTarget(), args: ['--hidden'] });
    refreshTrayMenu();
    return getAutoStart();
}

// ---------- Backend process ----------

function startServer() {
    if (isDev) {
        return true;
    }
    const serverPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'dist', 'main.js')
        : path.join(__dirname, 'server', 'dist', 'main.js');

    if (!fs.existsSync(serverPath)) {
        dialog.showErrorBox('文件缺失', '找不到核心后台服务，请尝试重新下载本程序。');
        return false;
    }

    serverProcess = fork(serverPath, [], {
        env: Object.assign({}, process.env, {
            NODE_ENV: 'production',
            API_PORT: '3000',
            AUTO_SIGN_DIR: app.getPath('userData')
        }),
        stdio: 'pipe'
    });

    // 仅保留关键错误打印，避免正常的日志也弹窗干扰用户
    serverProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data}`));
    serverProcess.on('message', handleServerMessage);

    const saved = loadLogin();
    serverProcess.send(saved ? { type: 'credentials', ...saved } : { type: 'credentials-none' });
    return true;
}

function handleServerMessage(message) {
    switch (message && message.type) {
        case 'save-credentials':
            saveLogin(message);
            break;
        case 'forget-credentials':
            forgetLogin();
            break;
        case 'notify':
            if (Notification.isSupported()) {
                new Notification({ title: message.title, body: message.body, icon: iconPath }).show();
            }
            break;
        case 'status':
            trayStatus = String(message.text || trayStatus);
            refreshTrayMenu();
            break;
        default:
            break;
    }
}

// ---------- Window and tray ----------

function showWindow() {
    if (!mainWindow) {
        createWindow(true);
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

function createWindow(show) {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        icon: iconPath,
        show,
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

    // Closing the window keeps the app (and auto-sign) running in the tray.
    mainWindow.on('close', (event) => {
        if (quitting) {
            return;
        }
        if (!tray) {
            // No tray icon to come back from: closing quits as before.
            quitting = true;
            return;
        }
        event.preventDefault();
        mainWindow.hide();
        if (!trayHintShown && tray) {
            trayHintShown = true;
            tray.displayBalloon({
                iconType: 'info',
                title: 'iClass 签到仍在后台运行',
                content: '自动签到会继续工作。右键托盘图标可以退出。'
            });
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function refreshTrayMenu() {
    if (!tray) {
        return;
    }
    tray.setToolTip(`iClass 签到\n${trayStatus}`);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开 iClass 签到', click: showWindow },
        { label: trayStatus, enabled: false },
        { type: 'separator' },
        {
            label: '开机自动启动',
            type: 'checkbox',
            checked: getAutoStart(),
            click: (item) => setAutoStart(item.checked)
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                quitting = true;
                app.quit();
            }
        }
    ]));
}

function createTray() {
    try {
        tray = new Tray(iconPath);
    } catch (error) {
        // Without a tray the window must still open (and closing it then quits).
        console.error('[tray] Failed to create tray icon:', error);
        tray = null;
        return;
    }
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    refreshTrayMenu();
}

// ---------- App lifecycle ----------

if (!app.requestSingleInstanceLock()) {
    // Already running (maybe hidden in the tray): that instance shows its window.
    app.quit();
} else {
    app.on('second-instance', showWindow);

    ipcMain.handle('autostart:get', () => getAutoStart());
    ipcMain.handle('autostart:set', (_event, enabled) => setAutoStart(enabled));

    app.whenReady().then(() => {
        app.setAppUserModelId('com.buaa.iclass');
        removeLegacyLoginData();
        if (!startServer()) {
            app.quit();
            return;
        }
        createTray();
        createWindow(!startHidden);
    });

    app.on('before-quit', () => {
        quitting = true;
        if (serverProcess) {
            serverProcess.kill();
        }
    });

    // Windows closing to the tray must not end the app.
    app.on('window-all-closed', () => {
        if (quitting) {
            app.quit();
        }
    });
}
