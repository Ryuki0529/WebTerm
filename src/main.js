const fs = require('fs');
const pty = require('node-pty');
const os = require('os');
const { Client: SshClient, Server: SshServer } = require('ssh2');
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const Store = require('electron-store');
const ffi = require('ffi-napi');
const ref_wchar = require('ref-wchar-napi');
const iconv = require("iconv-lite");
//const sqlLite = require('sqlite3');

const APP_NAME = "WebTerm";
const HOME_PATH = process.env[process.platform === "win32" ? "USERPROFILE" : "HOME"];
const USERDATA_PATH = app.getPath('userData');

class AppControl {

  Windows = new Map();
  Terminals = new Map();
  CONFIG = new Store({ encryptionKey: 'ymzkrk33' });
  SSH_CONFIG = new Store({ name: 'ssh.config' });
  PCTalker = ffi.Library('PCTKUSR.dll', {
    SoundMessage: ['BOOL', ['STRING', 'INT']],
    SoundPause: ['BOOL', ['BOOL']]
  });
  NVDA = ffi.Library('nvdaControl.dll', {
    nvdaController_speakText: ['int', [ref_wchar.string]],
    nvdaController_cancelSpeech: ['int', []]
  });

  constructor() {

    //this.CONFIG.clear();
    // 初期設定情報の登録
    //console.log(app.getPath('userData'));
    if ( this.CONFIG.size === 0 ) {
      this.CONFIG.store = {
        xterm: {
          rendererType: "canvas",
          cursorBlink: false,
          fontSize: 22, //fontFamily: 'Ricty Diminished, Noto Sans JP, Meiryo',
          screenReaderMode: true,
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
          accessibility: {
            screenReaderMode: 0,
            lsCommandView: false
          },
          startUpTerminalMode: "shell"
        }
      }
    }

    /*let db = new sqlLite.Database('db.sql');
    db.serialize(() => {
      db.run(`create table if not exists test (
        account text primary key,
        name text,
        email text
      )`)
    })*/

    /*if ( this.SSH_CONFIG.size === 0 ) {
      this.SSH_CONFIG.store = {
        "ubuntu": {
          host: "192.168.137.98", port: 22,
          user: "ryuki", password: "ymzkrk33"
        },
        "webdev": {
          host: "160.251.14.97", port: 10529,
          user: "ryuki", identityFile: "C:\\Users\\yamaz\\.ssh\\conoha-vps.pem"
        }
      }
    }*/

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
      this.createWindow( this.CONFIG.store.app.startUpTerminalMode );
    });

    /*##############################################*/
    /*                 IPCの設定                    */
    /*##############################################*/
    ipcMain.on('new-app', (event, arg) => { this.createWindow(arg) });

    ipcMain.on('text-to-speech', (event, arg) => { this.speekToText( arg ) });

    ipcMain.on('speach-stop', () => { this.speechStop() });

    ipcMain.on("get-file-path", (event, windowID) => {
      event.returnValue = dialog.showOpenDialogSync(
        this.Windows.get( Number( windowID ) ),
        {
          title: 'キーファイルの選択',
          properties: ['openFile', 'showHiddenFiles', '']
        }
      );
    });

    ipcMain.on('save-file', ( event, arg ) => {
      let savePath = dialog.showSaveDialogSync(
        this.Windows.get( Number( arg.windowID ) ),
        {
          title: 'ファイル保存ダイアログ',
          properties: ['openFile', 'createDirectory'],
          filters: [
              { name: 'テキストファイル', extensions: ['txt'] },
              { name: 'すべてのファイル', extensions: ['*'] }
          ]
        }
      );
      if ( savePath !== undefined ) {
        fs.writeFileSync( savePath, arg.saveText );
      }
    });

    ipcMain.on("reed-file", (event, arg) => {
      event.returnValue = (reedFileSync(arg)).toString('utf-8');
    });

    ipcMain.on('masagebox', ( event, arg ) => {
      event.returnValue = dialog.showMessageBoxSync(
        this.Windows.get( Number( arg.windowID ) ), arg.values
      );
    });

    ipcMain.on('get-userdata-path', ( event, windowID ) => {
      dialog.showMessageBoxSync(
        this.Windows.get( Number( windowID ) ),
        { title: 'USER DATA', message: app.getPath('userData') }
      );
    });

    ipcMain.on("screen-keystroke", (event, data) => {
      if (data.mode === 'shell') {
        ((this.Terminals.get(Number(data.window))).get(data.screenID)).pty.write(data.buffer);
      } else if (data.mode === 'ssh') {
        try {
          ((this.Terminals.get(Number(data.window))).get(data.screenID)).stream.write(data.buffer);
        } catch ( e ) { /*console.log(e)*/ }
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
        try {
          ((this.Terminals.get(Number(arg.window))).get(arg.screenID)).stream.setWindow(Number(arg.rows), Number(arg.cols));
        } catch ( e ) { /*console.log(e)*/ }
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
        try {
          ((this.Terminals.get(Number(arg.window))).get(Number(arg.screenID))).connection.destroy();
          (this.Terminals.get(Number(arg.window))).delete(Number(arg.screenID));
        } catch ( e ) { /*console.log(e)*/ }
      }
    });

    ipcMain.on('clipboard-copy', (event, arg) => {
      clipboard.writeText(arg);
    });

    ipcMain.on('clipboard-read', (event, arg) => {
      event.returnValue = clipboard.read();
    });

    ipcMain.on('get-app-config', (event, arg) => {
      event.returnValue = {
        appConfig: this.CONFIG.store,
        sshConfig: this.SSH_CONFIG.store
      }
    });

    ipcMain.on('app-config-updated', (event, arg) => {
      this.CONFIG.store = arg.config.appConfig;
      this.SSH_CONFIG.store = arg.config.sshConfig;
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
      //(this.Windows.get(Number(arg))).destroy();
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

    //let child = new BrowserWindow({ parent: win, modal: true, show: true, width: 300, height: 150 });

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
        cwd: HOME_PATH, // process.env.HOME
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
        sshConfig.privateKey = fs.readFileSync(sshConfig.privateKey);
      }

      let conn = new SshClient();
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
            //fs.writeFile('log.txt', iconv.encode(data, 'utf8'), { flag: 'a' }, () => {});
          }).on('close', () => {
            conn.destroy();
            (this.Windows.get(windowID)).webContents.send(
              "screenprocess-finished", screenID
            );
            (this.Terminals.get(windowID)).delete(screenID);
          });

          stream.setWindow(rows, cols);

          (this.Windows.get(windowID)).webContents.send('ssh-connected');
          (this.Terminals.get(windowID)).set(screenID,
            { type: "ssh", connection: conn, stream }
          );

          this.speekToText( '接続成功' );
          resolve();
        });
      }).on( 'error', ( err ) => {
        (this.Windows.get(windowID)).webContents.send(
          "shellprocess-incomingData",
          { buffer: new TextEncoder().encode(err), screenID }
        ); conn = null; this.speekToText( err ); resolve();
      }).connect( sshConfig );
    });
  }

  speekToText( text ) {
    //console.log( text );
    if ((this.CONFIG.store).app.accessibility.screenReaderMode === 1) {
      this.PCTalker.SoundMessage(iconv.encode(text, 'CP932'), 0);
      //console.log('PC-Talker');
    } else if ((this.CONFIG.store).app.accessibility.screenReaderMode === 2) {
      //setTimeout(() => { this.NVDA.nvdaController_speakText(iconv.encode(text, 'utf16')) }, 50);
      this.NVDA.nvdaController_speakText(iconv.encode(text, 'utf16'));
      //console.log('NVDA');
    }
  }

  speechStop() {
    if ((this.CONFIG.store).app.accessibility.screenReaderMode === 1) {
      this.PCTalker.SoundPause(true);
    } else if ((this.CONFIG.store).app.accessibility.screenReaderMode === 2) {
      //setTimeout(() => { this.NVDA.nvdaController_cancelSpeech() }, 40);
      //this.NVDA.nvdaController_cancelSpeech();
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