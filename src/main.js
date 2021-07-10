const { readFileSync, writeFileSync } = require('fs');
const pty = require('node-pty');
const os = require('os');
const { Client: SshClient, Server: SshServer } = require('ssh2');
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const Store = require('electron-store');
const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ref_wchar = require('ref-wchar-napi');
const iconv = require("iconv-lite");

const APP_NAME = "WebTerm";

class AppControl {

  Windows = new Map();
  Terminals = new Map();
  ElectronStore = new Store({ encryptionKey: 'ymzkrk33' });
  PCTalker = ffi.Library('PCTKUSR.dll', {
    SoundMessage: ['BOOL', ['STRING', 'INT']],
    SoundPause: ['BOOL', ['BOOL']]
  });
  NVDA = ffi.Library('nvdaControl.dll', {
    nvdaController_speakText: ['int', [ref_wchar.string]],
    nvdaController_cancelSpeech: ['int', []]
  });

  constructor() {

    //this.ElectronStore.clear();
    // 初期設定情報の登録
    //console.log(app.getPath('userData'));
    if (!this.ElectronStore.has('xterm')) {
      this.ElectronStore.store = {
        xterm: {
          rendererType: "canvas",
          cursorBlink: true,
          fontSize: 22, //fontFamily: 'Ricty Diminished, Noto Sans JP, Meiryo',
          screenReaderMode: false,
          rightClickSelectsWord: true,
          drawBoldTextInBrightColors: true,
          macOptionClickForcesSelection: true,
          macOptionIsMeta: true, windowsMode: true,
          minimumContrastRatio: 7,
          theme: {
            background: "black", foreground: "white"
          }
        },
        app: {
          screenReaderMode: 0,
          startUpTerminalMode: "shell"
        }
      }
    }

    /*##############################################*/
    /*                 APPの設定                    */
    /*##############################################*/
    // 全てのウィンドウが閉じたときの処理
    app.on('window-all-closed', () => {
      // macOSのとき以外はアプリケーションを終了させる
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // アプリケーションがアクティブになった時の処理(MacはDockがクリック時）
    app.on('activate', () => {
      // メインウィンドウが消えている場合に再度メインウィンドウを作成
      if (win === null) {
        this.createWindow();
      }
    });

    app.setName(APP_NAME);

    //  初期化完了時
    app.on('ready', () => {
      this.createWindow( this.ElectronStore.store.app.startUpTerminalMode );
    });

    /*##############################################*/
    /*                 IPCの設定                    */
    /*##############################################*/
    ipcMain.on('new-app', (event, arg) => { this.createWindow(arg) });

    ipcMain.on('text-to-speech', (event, arg) => { this.speekToText( arg ) });

    ipcMain.on("get-file-path", (event, arg) => {
      event.returnValue = dialog.showOpenDialogSync({
        title: 'キーファイルの選択',
        properties: ['openFile', 'showHiddenFiles', '']
      });
    });

    ipcMain.on("reed-file", (event, arg) => {
      event.returnValue = (reedFileSync(arg)).toString('utf-8');
    });

    ipcMain.on("screen-keystroke", (event, data) => {
      if (data.mode === 'shell') {
        ((this.Terminals.get(Number(data.window))).get(data.screenID)).pty.write(data.buffer);
      } else if (data.mode === 'ssh') {
        ((this.Terminals.get(Number(data.window))).get(data.screenID)).stream.write(data.buffer);
      }
    });

    ipcMain.on('window-maximize', (event, arg) => {
      if (!this.Windows.get(Number(arg)).isMaximized()) {
        this.Windows.get(Number(arg)).maximize();
      } else this.Windows.get(Number(arg)).unmaximize();
    });

    ipcMain.on('screenprocess-resize', (event, arg) => {
      if (arg.mode === 'shell') {
        ((this.Terminals.get(Number(arg.window))).get(arg.screenID)).pty.resize(Number(arg.cols), Number(arg.rows));
      } else if (arg.mode === 'ssh') {
        ((this.Terminals.get(Number(arg.window))).get(arg.screenID)).stream.setWindow(Number(arg.rows), Number(arg.cols));
      }
    });

    ipcMain.on('shellprocess-create', (event, arg) => {
      this.createShellProcess(
        Number(arg.window), Number(arg.screenID),
        Number(arg.cols), Number(arg.rows)
      );
      event.returnValue = true;
    });

    ipcMain.on('sshprocess-create', (event, arg) => {
      this.createSshProcess(
        Number(arg.window), Number(arg.screenID),
        Number(arg.cols), Number(arg.rows), arg.sshConfig
      ).then(() => event.returnValue = true);
    });

    ipcMain.on('screenprocess-exit', (event, arg) => {
      if (arg.mode === 'shell') {
        (this.Terminals.get(Number(arg.window))).delete(Number(arg.screenID));
      } else if (arg.mode === 'ssh') {
        ((this.Terminals.get(Number(arg.window))).get(Number(arg.screenID))).connection.destroy();
        (this.Terminals.get(Number(arg.window))).delete(Number(arg.screenID));
      }
    });

    ipcMain.on('clipboard-copy', (event, arg) => {
      clipboard.writeText(arg);
    });

    ipcMain.on('clipboard-read', (event, arg) => {
      event.returnValue = clipboard.read();
    });

    ipcMain.on('get-app-config', (event, arg) => {
      event.returnValue = this.ElectronStore.store;
    });

    ipcMain.on('app-config-updated', (event, arg) => {
      this.ElectronStore.store = arg.config;
      this.Windows.forEach((value, key) => {
        if (key != arg.windowID) {
          value.webContents.send('new-app-config-stream', arg.config);
        }
      });
    });

    ipcMain.on('set-window-title', (event, arg) => {
      (this.Windows.get(Number(arg.windowID))).setTitle(`${arg.title} - ${APP_NAME}`);
    });

    ipcMain.on('window-minimize', (event, arg) => {
      this.Windows.get(Number(arg)).minimize();
    });

    ipcMain.on('app:quit', (event, arg) => {
      this.Windows.get(Number(arg)).close();
      (this.Terminals.get(Number(arg))).forEach(( value, key ) => {
        if ( value.type === 'ssh' ) {
          value.connection.destroy();
        }
      });
      this.Terminals.delete(Number(arg));
      this.Windows.delete(Number(arg));
      if (this.Windows.size === 0) app.quit();
    });
  }

  createWindow( mode='shell' ) {
    let win = new BrowserWindow({
      title: APP_NAME, //icon: `${__dirname}/../app-icon.png`,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        //webviewTag: true,
        //preload: __dirname + '/window.difine.js'
      },
      width: 1100, height: 653, frame: false,
      backgroundColor: '#0D1117'
    });
    //win.maximize();

    win.loadURL(`file://${__dirname}/index.html?w_id=${win.id}&d_mode=${mode}`);

    //mainWindow.webContents.openDevTools();

    win.webContents.on('will-navigate', AppControl.handleUrlOpen);
    win.webContents.on('new-window', AppControl.handleUrlOpen);

    win.on('closed', () => {
      win = null;
    });

    mainApp.Windows.set(win.id, win);

    mainApp.Terminals.set(win.id, new Map())
  }

  createShellProcess(windowID, screenID, cols, rows) {
    const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
    (this.Terminals.get(windowID)).set(screenID, {
      type: "shell",
      pty: pty.spawn(shell, [], {
        name: "xterm-color",
        cols: cols, rows: rows,
        cwd: process.env.HOME,
        env: process.env,
        handleFlowControl: true
      })
    });

    ((this.Terminals.get(windowID)).get(screenID)).pty.on('data', (data) => {
      (this.Windows.get(windowID)).webContents.send(
        "shellprocess-incomingData",
        { buffer: data, screenID }
      );
    });

    ((this.Terminals.get(windowID)).get(screenID)).pty.on('exit', () => {
      (this.Windows.get(windowID)).webContents.send(
        "screenprocess-finished", screenID
      );
      (this.Terminals.get(windowID)).delete(screenID);
    });
  }

  createSshProcess(windowID, screenID, cols, rows, sshConfig) {
    return new Promise((resolve, reject) => {

      if ( 'privateKey' in sshConfig ) {
        sshConfig.privateKey = readFileSync(sshConfig.privateKey);
      }

      const conn = new SshClient();
      conn.on('ready', () => {
        conn.shell( { term: 'xterm-256color' }, (err, stream) => {
          if (err) throw err;
          stream.on('exit', () => {
            conn.destroy();
            (this.Windows.get(windowID)).webContents.send(
              "screenprocess-finished", screenID
            );
            (this.Terminals.get(windowID)).delete(screenID);
          }).on('data', (data) => {
            (this.Windows.get(windowID)).webContents.send(
              "shellprocess-incomingData",
              { buffer: data, screenID }
            );
          });

          stream.setWindow(rows, cols);

          (this.Windows.get(windowID)).webContents.send('ssh-connected');
          (this.Terminals.get(windowID)).set(screenID,
            { type: "ssh", connection: conn, stream }
          );

          this.speekToText( '接続成功' );
          resolve();
        });
      }).connect( sshConfig );
    });
  }

  speekToText( text ) {
    if ((this.ElectronStore.store).app.screenReaderMode === 1) {
      this.PCTalker.SoundMessage(iconv.encode(text, 'CP932'), 0);
      //console.log('PC-Talker');
    } else if ((this.ElectronStore.store).app.screenReaderMode === 2) {
      this.NVDA.nvdaController_speakText(iconv.encode(text, 'utf16'));
      //console.log('NVDA');
    }
  }

  static handleUrlOpen(event, url) {
    if (url.match(/^http/)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  }
}

const mainApp = new AppControl();