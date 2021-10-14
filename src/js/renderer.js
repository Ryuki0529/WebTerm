const IpcRenderer = require('electron').ipcRenderer;
const { Terminal } = require('xterm');
const TerminalFitAddon = require('xterm-addon-fit').FitAddon;
const TerminalWebLinksAddon = require('xterm-addon-web-links').WebLinksAddon;
const stripAnsi = require('ansi-colors');

const LINE_BG_GREEN = "\033[42m\033[37m\033[1m  L  \033[0m ";
const LINE_BG_ORANGE = "\033[43m\033[37m\033[1m  F  \033[0m ";
const LINE_BG_BLUE = "\033[44m\033[37m\033[1m  D  \033[0m ";

const FIRST_GET = (new URL(window.location.href)).searchParams;

class RendererMain {

  #ipcRenderer = IpcRenderer;

  #screenSelections = document.getElementById('screen-tabs');
  #addShellTabBtn = document.getElementById('add-shell-tab');
  #addShellSelectionBtn = document.getElementById('add-shell-selection');
  #addShellSelectionContent = document.getElementById('add-shell-selection-content');
  #addTabSshSession = document.querySelectorAll('#add-tab-ssh-session button');
  #commandResult = document.getElementById('terminal-screens');
  #settingModalElem = document.getElementById('app-setting-modal');
  #sshConnectionModal = document.getElementById('ssh-conection-modal');
  #sshProfileModal = document.getElementById('ssh-profile-modal');
  #modalElem = document.getElementById('connection-msg-modal');
  #modalCloseTriggers = document.getElementsByClassName('modal-close');
  #windowID = Number(FIRST_GET.get('w_id'));

  #CONFIG;
  #terminals = new Map();
  #jumpPoints = {}
  #currentJumpingIndex = 0;
  #fitAdons = new Map();
  #webLinksAddon = new Map();
  #terminalsConfFlag = {};
  #tabNumber = 0;
  #currentScreenID = 0;
  #currentScreenType = '';
  #isSpeech = true;
  #currentCursorPosition = { x: 0, y: 0 };
  #currentInputString = { text: '', pos: 0 };
  #virtualCursorMode = { bagFlag: true, status: true };

  constructor() {

    this.#CONFIG = this.#ipcRenderer.sendSync('get-app-config');
    this.#ipcRenderer.on('new-app-config-stream', (e, config) => {
      this.#CONFIG = config; this.#refreshTermScreen();
    });

    this.#addShellSelectionContent
      .querySelector(`input[type="radio"][value="${this.#CONFIG.appConfig.app.pushCurrentShellType}"]`).click();

    this.#createTabSelection(FIRST_GET.get('d_mode'));

    [...this.#addTabSshSession].forEach((elem) => {
      elem.addEventListener('click', (e) => {
        this.#createTabSelection( e.target.dataset.type );
        this.#screenSelections.scrollLeft = this.#screenSelections.clientWidth;
      });
    });

    this.#addShellTabBtn.addEventListener('click', event => {
      this.#createTabSelection(
        this.#addShellSelectionContent
          .querySelector('input[type="radio"]:checked').value
      );
      this.#screenSelections.scrollLeft = this.#screenSelections.clientWidth;
    });

    [...this.#addShellSelectionContent.querySelectorAll('input[type="radio"]')].forEach((elem) => {
      elem.addEventListener('click', ( e ) => {
        if ( e.detail > 0 ) {
          this.#addShellSelectionContent.classList.remove('show');
          this.#addShellTabBtn.click();
          this.#CONFIG.appConfig.app.pushCurrentShellType = this.#addShellSelectionContent
            .querySelector('#add-shell-selection-content input[type="radio"]:checked').value
          this.#configUpdate();
        }
      });
      elem.addEventListener('keypress', ( e ) => {
        if ( e.code === 'Enter' ) {
          this.#addShellSelectionContent.classList.remove('show');
          this.#addShellTabBtn.click();
        } else {
          this.#CONFIG.appConfig.app.pushCurrentShellType = this.#addShellSelectionContent
            .querySelector('#add-shell-selection-content input[type="radio"]:checked').value
          this.#configUpdate();
        }
      });
    });

    this.#addShellSelectionContent.addEventListener('keydown', ( e ) => {
      if ( e.code === 'Escape' ) {
        this.#addShellSelectionContent.classList.remove('show');
      }
    });

    this.#addShellSelectionBtn.addEventListener('click', ( e ) => {
      if ( this.#addShellSelectionContent.classList.contains('show') ) {
        this.#addShellSelectionContent.classList.remove('show');
      } else {
        this.#addShellSelectionContent.classList.toggle('show');
        setTimeout(() => {
          this.#addShellSelectionContent
            .querySelector('input[type="radio"]:checked').focus();
        }, 400);
      }
    });

    this.#commandResult.addEventListener('click', ( e ) => {
      this.#addShellSelectionContent.classList.contains('show')
        ? this.#addShellSelectionContent.classList.remove('show') : null;
    });

    this.#ipcRenderer.on("shellprocess-incomingData", (event, arg) => {
      (this.#terminals.get(Number(arg.screenID))).write(this.#editBufferStream(arg.buffer));
      if (this.#isSpeech && this.#terminalsConfFlag[arg.screenID].isSpeech && this.#CONFIG.appConfig.app.accessibility.screenReaderMode > 0) {
        let buffer = this.#currentScreenType === 'ssh' ? (new TextDecoder).decode(arg.buffer) : arg.buffer;
        this.speakToText(stripAnsi.unstyle(buffer));
      }
    });

    this.#screenSelections.addEventListener('wheel', event => {
      let amount = 30;
      let elementWidth = this.#screenSelections.clientWidth;
      let currentX = this.#screenSelections.scrollLeft;
      if (event.deltaY >= 0) {
        this.#screenSelections.scrollLeft = (currentX + amount) > elementWidth ? elementWidth : (currentX + amount);
      } else this.#screenSelections.scrollLeft = (currentX - amount) < 0 ? 0 : (currentX - amount);
    });

    this.#ipcRenderer.on('screenprocess-finished', (event, delScreenID) => {
      this.#terminals.delete(delScreenID);
      this.#fitAdons.delete(delScreenID);
      this.#webLinksAddon.delete(delScreenID);
      this.#screenSelections.querySelector(`.tab input[value="${delScreenID}"]`).parentElement.remove();
      let screensElem = this.#commandResult.getElementsByClassName('screen');
      if (screensElem.length > 1) {
        [...screensElem].forEach(elem => {
          if (elem.getAttribute('data-number') == delScreenID) {
            elem.remove();
          } else {
            document.getElementById('screen-label-' + elem.getAttribute('data-number')).click();
            this.currentScreenFocus();
          }
        });
      } else this.windowClose();
    });

    document.getElementById('new-ssh-window')
      .addEventListener('click', event => {
        this.#ipcRenderer.send('new-app', 'ssh');
      });

    document.getElementById('new-shell-window')
      .addEventListener('click', event => {
        this.#ipcRenderer.send('new-app', this.#CONFIG.appConfig.app.startUpTerminalMode);
      });

    document.getElementById('window-maximize')
      .addEventListener('click', event => {
        this.#ipcRenderer.send('window-maximize', this.#windowID);
      });

    document.getElementById('window-minimize')
      .addEventListener('click', event => {
        this.#ipcRenderer.send('window-minimize', this.#windowID);
      });

    document.getElementById('window-close')
      .addEventListener('click', event => this.windowClose());

    document.getElementById('app-setting').addEventListener('click', () => {
      this.#settingModalElem.querySelector('#set-term-fontsize').value = this.#CONFIG.appConfig.xterm.fontSize;
      this.#settingModalElem
        .querySelector(`#set-term-fontcolor option[value="${this.#CONFIG.appConfig.xterm.theme.foreground}"]`)
        .setAttribute('selected', 'true');
      this.#settingModalElem
        .querySelector(`#set-term-bg-color option[value="${this.#CONFIG.appConfig.xterm.theme.background}"]`)
        .setAttribute('selected', 'true');
      switch (this.#CONFIG.appConfig.app.accessibility.screenReaderMode) {
        case 1:
          this.#settingModalElem.querySelector('#set-srm-pctalker').click(); break;
        case 2:
          this.#settingModalElem.querySelector('#set-srm-nvda').click(); break;
        default:
          this.#settingModalElem.querySelector('#set-srm-none').click(); break;
      }
      switch (this.#CONFIG.appConfig.app.startUpTerminalMode) {
        case 'PowerShell':
          this.#settingModalElem.querySelector('#set-stm-shell').click(); break;
        case 'PowerShell-dev':
          this.#settingModalElem.querySelector('#set-stm-shell-dev').click(); break;
        case 'cmd':
          this.#settingModalElem.querySelector('#set-stm-cmd').click(); break;
        case 'cmd-dev':
          this.#settingModalElem.querySelector('#set-stm-cmd-dev').click(); break;
        case 'wsl':
          this.#settingModalElem.querySelector('#set-stm-wsl').click(); break;
        case 'ssh':
          this.#settingModalElem.querySelector('#set-stm-ssh').click(); break;
        default:
          this.#settingModalElem.querySelector('#set-stm-shell').click(); break;
      }
      if (this.#CONFIG.appConfig.app.accessibility.screenCursorMode) {
        this.#settingModalElem.querySelector('#set-screen-cursor-mode').setAttribute('checked', '');
      }
      if (this.#CONFIG.appConfig.app.accessibility.lsCommandView) {
        this.#settingModalElem.querySelector('#set-ls-comand-effect').setAttribute('checked', '');
      }
      this.#settingModalElem.showModal();
    });

    this.#settingModalElem.querySelector('#app-setting-activate')
      .addEventListener('click', e => {
        this.#CONFIG.appConfig.xterm.fontSize = this.#settingModalElem.querySelector('#set-term-fontsize').value;
        this.#CONFIG.appConfig.xterm.theme.foreground = this.#settingModalElem.querySelector('#set-term-fontcolor').value;
        this.#CONFIG.appConfig.xterm.theme.background = this.#settingModalElem.querySelector('#set-term-bg-color').value;
        this.#CONFIG.appConfig.xterm.screenReaderMode = this.#settingModalElem.querySelector('#set-screen-cursor-mode').checked;
        this.#CONFIG.appConfig.app.accessibility.screenReaderMode = Number(this.#settingModalElem.querySelector('#set-screen-reader-mode input[type="radio"]:checked').value);
        this.#CONFIG.appConfig.app.startUpTerminalMode = this.#settingModalElem.querySelector('#set-startup-terminal-mode input[type="radio"]:checked').value;
        this.#CONFIG.appConfig.app.accessibility.screenCursorMode = this.#settingModalElem.querySelector('#set-screen-cursor-mode').checked;
        this.#CONFIG.appConfig.app.accessibility.lsCommandView = this.#settingModalElem.querySelector('#set-ls-comand-effect').checked;

        this.#settingModalElem.querySelector('.modal-close').click();
        this.#refreshTermScreen();
        this.#configUpdate();
      });

    [...this.#modalCloseTriggers].forEach(trigger => {
      trigger.addEventListener('click', e => {
        let modalElem = document.getElementById(e.target.dataset.target);
        this.dialogClose(modalElem);
      });
    });

    [...document.querySelectorAll('dialog')].forEach(elem => {
      elem.addEventListener('cancel', e => {
        e.preventDefault();
        elem.querySelector('.modal-close').click();
      })
    });

    this.#sshConnectionModal.querySelector('#public-key-auth-change')
      .addEventListener('click', event => {
        if (event.target.checked) {
          document.getElementById('input-password').setAttribute('disabled', '');
          document.getElementById('input-privateKey').removeAttribute('disabled');
          document.getElementById('input-passphrase').removeAttribute('disabled');
          document.getElementById('privateKey-choice').removeAttribute('disabled');
        } else {
          document.getElementById('input-privateKey').setAttribute('disabled', '');
          document.getElementById('privateKey-choice').setAttribute('disabled', '');
          document.getElementById('input-passphrase').setAttribute('disabled', '');
          document.getElementById('input-password').removeAttribute('disabled');
        }
      });

    this.#sshConnectionModal.querySelector('#privateKey-choice')
      .addEventListener('click', event => {
        document.getElementById('input-privateKey')
          .value = (this.#ipcRenderer.sendSync('get-file-path', this.#windowID))[0];
      });

    this.#sshConnectionModal.querySelector('#ssh-profile-select')
      .addEventListener('change', (event) => {
        if (event.target.value != 'none') {
          this.#sshConnectionModal.querySelector('#input-hostname').value = this.#CONFIG.sshConfig[event.target.value].host;
          this.#sshConnectionModal.querySelector('#input-portnumber').value = this.#CONFIG.sshConfig[event.target.value].port;
          this.#sshConnectionModal.querySelector('#input-username').value = this.#CONFIG.sshConfig[event.target.value].user;
          if (this.#CONFIG.sshConfig[event.target.value].identityFile !== undefined) {
            if (!this.#sshConnectionModal.querySelector('#public-key-auth-change').checked) {
              this.#sshConnectionModal.querySelector('#public-key-auth-change').click();
            }
            this.#sshConnectionModal.querySelector('#input-password').value = '';
            this.#sshConnectionModal.querySelector('#input-privateKey').value = this.#CONFIG.sshConfig[event.target.value].identityFile;
            if (this.#CONFIG.sshConfig[event.target.value].passphrase !== undefined) {
              this.#sshConnectionModal.querySelector('#input-passphrase').value = this.#CONFIG.sshConfig[event.target.value].passphrase;
            }
          } else {
            this.#sshConnectionModal.querySelector('#input-password').value = this.#CONFIG.sshConfig[event.target.value].password;
            this.#sshConnectionModal.querySelector('#input-privateKey').value = '';
            this.#sshConnectionModal.querySelector('#input-passphrase').value = '';
            this.#sshConnectionModal.querySelector('#public-key-auth-change').checked
              ? this.#sshConnectionModal.querySelector('#public-key-auth-change').click() : null;
          }
        } else {
          this.#sshConnectionModal.querySelector('#public-key-auth-change').checked
            ? this.#sshConnectionModal.querySelector('#public-key-auth-change').click() : null;
          this.#sshConnectionModal.querySelector('#input-hostname').value = '';
          this.#sshConnectionModal.querySelector('#input-portnumber').value = '';
          this.#sshConnectionModal.querySelector('#input-username').value = '';
          this.#sshConnectionModal.querySelector('#input-password').value = '';
          this.#sshConnectionModal.querySelector('#input-privateKey').value = '';
          this.#sshConnectionModal.querySelector('#input-passphrase').value = '';
        }
      });

    this.#sshConnectionModal.querySelector('#save-ssh-conn-profile')
      .addEventListener('click', (event) => {
        if (this.showConfirmMsgBox('入力した接続情報を保存しますか？')) {
          const profileName = this.#sshConnectionModal.querySelector('#ssh-conn-profile-name').value;
          if (
            profileName.length !== 0 && profileName.length <= 20 &&
            profileName.match(/^[A-Za-z0-9_-]+$/)
          ) {
            if (this.#CONFIG.sshConfig[profileName] === undefined) {
              this.#CONFIG.sshConfig[profileName] = {}
              this.#CONFIG.sshConfig[profileName].host = this.#sshConnectionModal.querySelector('#input-hostname').value;
              this.#CONFIG.sshConfig[profileName].port = this.#sshConnectionModal.querySelector('#input-portnumber').value;
              this.#CONFIG.sshConfig[profileName].user = this.#sshConnectionModal.querySelector('#input-username').value;
              if (this.#sshConnectionModal.querySelector('#public-key-auth-change').checked) {
                this.#CONFIG.sshConfig[profileName].identityFile = this.#sshConnectionModal.querySelector('#input-privateKey').value;
                if (this.#sshConnectionModal.querySelector('#input-passphrase').value.length !== 0) {
                  this.#CONFIG.sshConfig[profileName].passphrase = this.#sshConnectionModal.querySelector('#input-passphrase').value;
                }
              } else this.#CONFIG.sshConfig[profileName].password = this.#sshConnectionModal.querySelector('#input-password').value;
              this.#sshConnectionModal.querySelector('#ssh-conn-profile-name').value = '';
              this.#configUpdate();
              this.showNormalMsgBox(`プロファイル名「${profileName}」で接続情報を保存しました。`);
            } else this.showErrorMsgBox('同名のプロファイルが既に存在します。');
          } else this.showErrorMsgBox('プロファイル名の形式が正しくありません。');
        }
      });

    this.#sshConnectionModal.querySelector('#ssh-profile-input-value-clear')
      .addEventListener('click', (e) => {
        this.#sshConnectionModal.querySelector('#public-key-auth-change').checked
          ? this.#sshConnectionModal.querySelector('#public-key-auth-change').click() : null;
        this.#sshConnectionModal.querySelector('#input-hostname').value = '';
        this.#sshConnectionModal.querySelector('#input-portnumber').value = '';
        this.#sshConnectionModal.querySelector('#input-username').value = '';
        this.#sshConnectionModal.querySelector('#input-password').value = '';
        this.#sshConnectionModal.querySelector('#input-privateKey').value = '';
        this.#sshConnectionModal.querySelector('#input-passphrase').value = '';
      });

    this.#modalElem.querySelector('#msg-modal-close')
      .addEventListener('click', event => {
        this.#modalElem.close();
        //this.#sshClient.end();
        //this.#sshClient = new (require('ssh2').Client);
        document.getElementById('try-connect-btn').removeAttribute('disabled');
      });

    document.body.addEventListener('keypress', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyU') {
        this.#ipcRenderer.send('get-userdata-path', this.#windowID);
      }
    });
  }

  #editBufferStream(buffer) {
    if (this.#CONFIG.appConfig.app.accessibility.lsCommandView) {
      let re = buffer.match(/[dl-]([r-][w-][xtsS-]){3}(.|\s+)[0-9]+\s+\w+\s+\w+\s+[0-9]+\s+[^\n]+\n/g);
      if (re) {
        re.forEach(result => {
          if (result.match(/^d/)) {
            buffer = buffer.replace(result, LINE_BG_BLUE + result);
          } else if (result.match(/^l/)) {
            buffer = buffer.replace(result, LINE_BG_GREEN + result);
          } else if (result.match(/^-/)) {
            buffer = buffer.replace(result, LINE_BG_ORANGE + result);
          }
        });
      }
    }
    return buffer;
  }

  #getSshConnectionInfo() {
    return new Promise((resolve, reject) => {
      let sshConfig = {};
      const profileSelect = this.#sshConnectionModal.querySelector('#ssh-profile-select');

      profileSelect.innerHTML = `<option value="none">保存済み接続情報を使用</option>`;
      for (let [key, value] of Object.entries(this.#CONFIG.sshConfig)) {
        profileSelect.innerHTML += `<option value="${key}">${key}</option>`;
      }

      this.#sshConnectionModal.querySelector('#try-connect-btn').removeAttribute('disabled');
      this.#sshConnectionModal.showModal();
      this.#sshConnectionModal.querySelector('#try-connect-btn')
        .addEventListener('click', (e) => {
          e.target.setAttribute('disabled', '');
          this.dialogClose(this.#sshConnectionModal);
          sshConfig.host = this.#sshConnectionModal.querySelector('#input-hostname').value;
          sshConfig.port = Number(this.#sshConnectionModal.querySelector('#input-portnumber').value);
          sshConfig.user = this.#sshConnectionModal.querySelector('#input-username').value;
          if (this.#sshConnectionModal.querySelector('#public-key-auth-change').checked) {
            sshConfig.privateKey = this.#sshConnectionModal.querySelector('#input-privateKey').value;
            sshConfig.passphrase = this.#sshConnectionModal.querySelector('#input-passphrase').value;
          } else sshConfig.password = this.#sshConnectionModal.querySelector('#input-password').value;
          sshConfig.keepaliveInterval = 20000;
          sshConfig.readyTimeout = 10000;
          resolve({ sshConfig, profile: profileSelect.value !== 'none' ? profileSelect.value : false });
        });
      this.#sshConnectionModal.querySelector('.modal-close')
        .addEventListener('click', (e) => {
          resolve({ sshConfig: undefined, profile: false });
        });
    });
  }

  #sshProfileManage() {
    this.#sshProfileModal.querySelector('.profile-list').innerHTML = '';
    const presetElem = this.#sshProfileModal.querySelector('.preset-element');
    for (let [key, value] of Object.entries(this.#CONFIG.sshConfig)) {
      const addEmen = document.createElement('li');
      addEmen.appendChild(presetElem.cloneNode(true));

      addEmen.querySelector('.profile-name').textContent = key;

      addEmen.querySelector('input.host-address').value = value.host;
      addEmen.querySelector('input.host-address').setAttribute('id', `ssh-profile-value-host-${key}`);
      addEmen.querySelector('label.host-address').setAttribute('for', `ssh-profile-value-host-${key}`);

      addEmen.querySelector('input.port-number').value = value.port;
      addEmen.querySelector('input.port-number').setAttribute('id', `ssh-profile-value-port-${key}`);
      addEmen.querySelector('label.port-number').setAttribute('for', `ssh-profile-value-port-${key}`);

      addEmen.querySelector('input.user-name').value = value.user;
      addEmen.querySelector('input.user-name').setAttribute('id', `ssh-profile-value-user-${key}`);
      addEmen.querySelector('label.user-name').setAttribute('for', `ssh-profile-value-user-${key}`);

      if (value.identityFile !== undefined) {
        addEmen.querySelector('input.keyfile').value = value.identityFile;
        addEmen.querySelector('input.keyfile').setAttribute('id', `ssh-profile-value-keyfile-${key}`);
        addEmen.querySelector('label.keyfile').setAttribute('for', `ssh-profile-value-keyfile-${key}`);
        addEmen.querySelector('input.keyfile').parentElement.removeAttribute('hidden');
        addEmen.querySelector('input.password').parentElement.setAttribute('hidden', '');
        if (value.passphrase !== undefined) {
          addEmen.querySelector('input.passphrase').value = value.passphrase;
          addEmen.querySelector('input.passphrase').setAttribute('id', `ssh-profile-value-passphrase-${key}`);
          addEmen.querySelector('label.passphrase').setAttribute('for', `ssh-profile-value-passphrase-${key}`);
          addEmen.querySelector('input.passphrase').parentElement.removeAttribute('hidden');
        }
      } else {
        addEmen.querySelector('input.password').value = value.password;
        addEmen.querySelector('input.password').setAttribute('id', `ssh-profile-value-password-${key}`);
        addEmen.querySelector('label.password').setAttribute('for', `ssh-profile-value-password-${key}`);
      }
      addEmen.querySelector('.profile-delete').dataset.key = key;
      addEmen.querySelector('.profile-delete')
        .addEventListener('click', (e) => {
          if (this.showConfirmMsgBox(`プロファイル「${key}」を削除しますか？`)) {
            delete this.#CONFIG.sshConfig[key];
            e.target.parentElement.parentElement.remove();
            this.#configUpdate();
          }
        });
      this.#sshProfileModal.querySelector('.profile-list').appendChild(addEmen);
    }
    if (Object.keys(this.#CONFIG.sshConfig).length === 0) {
      const addEmen = document.createElement('li');
      addEmen.innerHTML = `<span style="display:block;text-align:center;width: 100%;">現在プロファイルは登録されていません。</span>`;
      this.#sshProfileModal.querySelector('.profile-list').appendChild(addEmen);
    }
    this.#sshProfileModal.showModal();
  }

  async #createTabSelection(mode = 'PowerShell') {

    let sshConfigResult = {}
    if (mode === 'ssh') {
      sshConfigResult = await this.#getSshConnectionInfo();
      if (sshConfigResult.sshConfig === undefined) {
        if (this.#tabNumber === 0) this.windowClose();
        return;
      }
    } else if (mode === 'ssh-profile') {
      this.#sshProfileManage();
      return;
    }

    this.#tabNumber += 1;
    let tabElem = document.createElement('div');
    tabElem.setAttribute('class', 'tab');
    tabElem.dataset.screen = this.#tabNumber;
    tabElem.dataset.mode = mode;
    let inputRadio = document.createElement('input');
    inputRadio.setAttribute('type', 'radio');
    inputRadio.setAttribute('name', 'screen-name');
    inputRadio.setAttribute('id', "screen-label-" + this.#tabNumber);
    inputRadio.setAttribute('value', this.#tabNumber);
    inputRadio.dataset.mode = mode;
    inputRadio.addEventListener('click', event => {
      let selectScreen = event.target.value;
      this.#currentScreenID = Number(event.target.value);
      this.#currentScreenType = event.target.dataset.mode;
      let targetScreens = this.#commandResult.children;
      Array.prototype.forEach.call(targetScreens, (targetScreen) => {
        if (targetScreen.getAttribute('data-number') != selectScreen) {
          targetScreen.setAttribute('hidden', '');
        } else targetScreen.removeAttribute('hidden');
      });
      this.#refreshTermScreen();

      /*let tabSelectionWidth = Number( document.defaultView
            .getComputedStyle(this.#screenSelections, null).width
            .replace('px', ''));*/
      //(this.#terminals.get(Number(selectScreen))).focus();
    });
    inputRadio.addEventListener('keypress', ( e ) => {
      if ( e.key === 'Enter' ) {
        (this.#terminals.get(Number(e.target.value))).focus();
      }
    });
    inputRadio.checked = true;
    let tabLavel = document.createElement('label');
    tabLavel.setAttribute('for', "screen-label-" + this.#tabNumber);
    let closeBtn = document.createElement('button');
    closeBtn.setAttribute('class', 'screen-close');
    closeBtn.textContent = 'X';
    if (mode === 'PowerShell' || mode === 'PowerShell-dev' || mode === 'cmd' || mode === 'cmd-dev' || mode === 'wsl') {
      switch ( mode ) {
        case 'PowerShell':
          closeBtn.setAttribute('aria-label', `PowerShell ${this.#tabNumber}のタブを閉じる`);
          tabLavel.textContent = 'PowerShell #' + this.#tabNumber; break;
        case 'PowerShell-dev':
          closeBtn.setAttribute('aria-label', `Developer-PS ${this.#tabNumber}のタブを閉じる`);
          tabLavel.textContent = 'Developer-PS #' + this.#tabNumber; break;
        case 'cmd':
          closeBtn.setAttribute('aria-label', `Command Prompt ${this.#tabNumber}のタブを閉じる`);
          tabLavel.textContent = 'Command Prompt #' + this.#tabNumber; break;
        case 'cmd-dev':
          closeBtn.setAttribute('aria-label', `Developer-CP ${this.#tabNumber}のタブを閉じる`);
          tabLavel.textContent = 'Developer-CP #' + this.#tabNumber; break;
        case 'wsl':
          closeBtn.setAttribute('aria-label', `WSL ${this.#tabNumber}のタブを閉じる`);
          tabLavel.textContent = 'WSL #' + this.#tabNumber; break;
      }
    } else if (mode === 'ssh') {
      if (sshConfigResult.profile === false) {
        tabLavel.innerHTML = '<span class="ssh">SSH</span> ' + sshConfigResult.sshConfig.host;
        closeBtn.setAttribute('area-label', `SSH ${sshConfigResult.sshConfig.host}のタブを閉じる`);
      } else {
        tabLavel.innerHTML = '<span class="ssh">SSH</span> ' + sshConfigResult.profile
        closeBtn.setAttribute('area-label', `SSH ${sshConfigResult.profile}のタブを閉じる`);
      }
    }
    closeBtn.addEventListener('click', event => {
      let tabElem = event.target.parentElement;
      let delScreenID = Number(tabElem.querySelector('input').value);

      this.#terminals.delete(delScreenID);
      this.#fitAdons.delete(delScreenID);
      this.#webLinksAddon.delete(delScreenID);
      delete this.#terminalsConfFlag[ delScreenID ];
      delete this.#jumpPoints[ delScreenID ];
      this.#currentJumpingIndex = 0;

      this.#ipcRenderer.send('screenprocess-exit', {
        window: this.#windowID, screenID: delScreenID, mode: this.#currentScreenType
      });

      tabElem.remove();
      let visibleFlag = true;
      let targetScreens = this.#commandResult.querySelectorAll('.screen');
      if (targetScreens.length > 1) {
        for (let i = 0; i < targetScreens.length; i++) {
          if (targetScreens[i].getAttribute('data-number') == delScreenID) {
            targetScreens[i].remove();
          } else if (visibleFlag === true) {
            document.getElementById('screen-label-' + targetScreens[i].getAttribute('data-number')).click();
            visibleFlag = false;
          }
        }
      } else this.windowClose();
      /*Array.prototype.forEach.call(targetScreens, (targetScreen) => {
        console.log('count');
        if ( targetScreen.getAttribute('data-number') == delScreenID) {
          targetScreen.remove(); console.log('del');
        }else if ( visibleFlag === true ) {
          document.getElementById('screen-label-' + targetScreen.getAttribute('data-number')).click();
          visibleFlag = false; console.log('show');
        }
      });*/
    });
    tabElem.appendChild(inputRadio);
    tabElem.appendChild(tabLavel);
    tabElem.appendChild(closeBtn);
    this.#screenSelections.appendChild(tabElem);

    let screen = document.createElement('div');
    screen.setAttribute('class', 'screen');
    screen.setAttribute('data-number', this.#tabNumber);
    this.#commandResult.appendChild(screen);

    this.#createTermInstance(this.#tabNumber, mode, sshConfigResult.sshConfig, inputRadio);

    this.#currentScreenID = this.#tabNumber;
    this.#currentScreenType = mode;
  }

  #createTermInstance(screenID, mode, sshConfig, targetTab) {

    const helperElemString = `.screen[data-number="${screenID}"] .xterm-helper-textarea`;
    const accessibilityElemString = `.screen[data-number="${screenID}"] .xterm-accessibility`;
    const ariaLiveElemString = `.screen[data-number="${screenID}"] .live-region`;

    this.#terminalsConfFlag[screenID] = { isSpeech: true, bugflag: true };

    this.#terminals.set(screenID, new Terminal(this.#CONFIG.appConfig.xterm));
    this.#fitAdons.set(screenID, new TerminalFitAddon());
    this.#webLinksAddon.set(screenID,
      new TerminalWebLinksAddon((event, url) => {
        event.preventDefault(); window.open(url);
      })
    );
    (this.#terminals.get(screenID)).setOption('convertEol', true);

    this.#jumpPoints[ screenID ] = { lineNumbers: [], hist: {} };

    (this.#terminals.get(screenID)).loadAddon(this.#fitAdons.get(screenID));
    (this.#terminals.get(screenID)).loadAddon(this.#webLinksAddon.get(screenID));
    (this.#terminals.get(screenID)).open(this.#commandResult.lastElementChild);
    (this.#fitAdons.get(screenID)).fit();
    (this.#terminals.get(screenID)).focus();

    /*(this.#terminals.get(screenID)).onSelectionChange(() => {});*/

    let ipcChannelText = '';
    if (
        mode === 'PowerShell' || mode === 'PowerShell-dev'
        || mode === 'cmd' || mode === 'cmd-dev' || mode === 'wsl'
      ){
      ipcChannelText = 'shellprocess-create';
    }else ipcChannelText = 'sshprocess-create';

    this.#ipcRenderer.sendSync( ipcChannelText, {
      window: this.#windowID, screenID: screenID,
      cols: (this.#terminals.get(screenID)).cols, mode,
      rows: (this.#terminals.get(screenID)).rows, sshConfig
    });

    targetTab.click();

    window.addEventListener('resize', () => { this.#screenTermResize() });

    let editorMode = { bugfleg: false, status: false };
    (this.#terminals.get(screenID)).attachCustomKeyEventHandler(e => {
      if (e.ctrlKey && e.key === 'c') {
        if ((this.#terminals.get(screenID)).hasSelection()) {
          this.clipboardCopy((this.#terminals.get(screenID)).getSelection());
          return false;
        }
      } else if (e.ctrlKey && e.key === 'v') {
        //let clip = this.#ipcRenderer.sendSync('clipboard-read');
        //this.#screenKeyStrokeSend(clip);
        setTimeout(() => {
          (this.#terminals.get(screenID)).blur();
          (this.#terminals.get(screenID)).focus();
        }, 60);
        return false;
      } else if (e.ctrlKey && e.key === 'b') {
        if (this.#CONFIG.appConfig.app.accessibility.screenCursorMode && this.#virtualCursorMode.bagFlag) {
          this.#terminals.forEach((value, key) => {
            value.setOption('screenReaderMode', false);
          }); this.#CONFIG.appConfig.app.accessibility.screenCursorMode = false;
          this.#CONFIG.appConfig.xterm.screenReaderMode = false;
          this.speakToText('スクリーンカーソルモードOFF'); this.#configUpdate();
        } else if (!this.#CONFIG.appConfig.app.accessibility.screenCursorMode && !this.#virtualCursorMode.bagFlag) {
          this.#terminals.forEach((value, key) => {
            value.setOption('screenReaderMode', true);
          }); this.#CONFIG.appConfig.app.accessibility.screenCursorMode = true;
          this.#CONFIG.appConfig.xterm.screenReaderMode = true;
          (document.querySelectorAll('.live-region')).forEach(( elem ) => {
            elem.setAttribute('style', 'display:none;');
          });
          this.#xtermAccessibilityElemEdit( screenID, accessibilityElemString );
          this.speakToText('スクリーンカーソルモードON'); this.#configUpdate();
        } else if (!this.#virtualCursorMode.bagFlag) {
          this.#virtualCursorMode.bagFlag = true;
        } else if (this.#virtualCursorMode.bagFlag) {
          this.#virtualCursorMode.bagFlag = false;
        }
        return false;
      } else if (e.key === 'Insert') {
        (this.#terminals.get(screenID)).blur();
        return false;
      } else if (e.key === 'Enter') {
        if ( this.#currentInputString.text !== '' ) {
          this.#jumpPoints[ screenID ][ 'lineNumbers' ].unshift( this.#currentCursorPosition.y );
          this.#jumpPoints[ screenID ][ 'hist' ][ this.#currentCursorPosition.y ] = this.#currentInputString.text;
          this.#jumpPoints[ screenID ][ 'lineNumbers' ] = Array.from( new Set( this.#jumpPoints[ screenID ][ 'lineNumbers' ] ) );
        }
        //console.log(this.#jumpPoints);
      } else if ( e.key === 'H' && e.ctrlKey && e.shiftKey ) {
        let saveText = this.getBufferText(
          this.#jumpPoints[ screenID ][ 'lineNumbers' ][0],
          this.#currentCursorPosition.y
        );
        this.#ipcRenderer.send( 'save-file', { windowID: this.#windowID, saveText } );
      } else if (e.key === 'N' && e.ctrlKey && e.shiftKey) {
        this.#CONFIG.appConfig.app.accessibility.screenReaderMode = 2;
        this.#configUpdate(); this.speakToText('スクリーンリーダーモードON NVDA');
        return false;
      } else if (e.key === 'P' && e.ctrlKey && e.shiftKey) {
        this.#CONFIG.appConfig.app.accessibility.screenReaderMode = 1;
        this.#configUpdate(); this.speakToText('スクリーンリーダーモードON PC-Talker');
        return false;
      } else if ( e.key === 'O' && e.ctrlKey && e.shiftKey ) {
        if ( this.#terminalsConfFlag[screenID].isSpeech === true && this.#terminalsConfFlag[screenID].bugflag === true ) {
          this.#terminalsConfFlag[screenID].isSpeech = false; this.speakToText('カレントスクリーンスピーチOFF');
        } else if ( this.#terminalsConfFlag[screenID].isSpeech === false && this.#terminalsConfFlag[screenID].bugflag === false ) {
          this.#terminalsConfFlag[screenID].isSpeech = true; this.speakToText('カレントスクリーンスピーチON');
          console.log(this.#terminalsConfFlag);
        } else if ( this.#terminalsConfFlag[screenID].bugflag === true ) {
          this.#terminalsConfFlag[screenID].bugflag = false;
        } else if ( this.#terminalsConfFlag[screenID].bugflag === false ) {
          this.#terminalsConfFlag[screenID].bugflag = true;
        }
      } else if ( e.key === 'E' && e.ctrlKey && e.shiftKey ) {
        if ( editorMode.status && editorMode.bugflag ) {
          this.speakToText('screen editor mode stop.');
          editorMode.status = false;
        } else if ( !editorMode.status && !editorMode.bugflag ) {
          this.speakToText('screen editor mode start.');
          editorMode.status = true;
        } else if ( !editorMode.bugflag ) {
          editorMode.bugflag = true;
        } else if ( editorMode.bugflag ) {
          editorMode.bugflag = false;
          document.querySelector(helperElemString).value = '';
        }
      }
    });

    (this.#terminals.get(screenID)).onData(event => {
      this.#screenKeyStrokeSend(event);
      //console.log(event.charCodeAt(0).toString(16));
    });

    (this.#terminals.get(screenID)).textarea.addEventListener('keydown', (e) => {
      setTimeout(() => {
        this.#currentInputString.text = this.getCurrentCommandInput();
        this.#currentInputString.pos = (this.#terminals.get(screenID)).buffer.active.cursorX - this.#currentCursorPosition.x;
        //e.target.selectionEnd;
      }, 60);
    });

    (this.#terminals.get(screenID)).textarea.addEventListener('focus', (e) => {
      e.target.value = this.#currentInputString.text;
      e.target.selectionStart = this.#currentInputString.pos;
      e.target.selectionEnd = this.#currentInputString.pos;
      this.#currentJumpingIndex = 0;
    });

    (this.#terminals.get(screenID)).textarea.addEventListener('blur', (e) => {
      let tabIndex = (this.#terminals.get(screenID)).buffer.active.cursorY;
      tabIndex += (this.#terminals.get(screenID)).buffer.active.baseY + 1;
      document.querySelector(`.screen[data-number="${screenID}"] div[role="listitem"][aria-posinset="${tabIndex}"]`).focus();
    });

    (this.#terminals.get(screenID)).onLineFeed(() => {
      setTimeout(() => {
        let cursorY = (this.#terminals.get(screenID)).buffer.active.baseY;
        cursorY += (this.#terminals.get(screenID)).buffer.active.cursorY;
        let cursorX = (this.#terminals.get(screenID)).buffer.active.cursorX;
        this.#currentCursorPosition.x = cursorX;
        this.#currentCursorPosition.y = cursorY;
        //(this.#terminals.get(screenID)).write('\r\n');
      }, 300);
      this.#isSpeech = true;
    });

    //(this.#terminals.get(screenID)).onRender((e) => {  });

    (this.#terminals.get(screenID)).onKey((e) => {
      if (
        e.domEvent.code === 'ArrowUp' || e.domEvent.code === 'ArrowDown'
        || e.domEvent.code === 'Tab'
      ) {
        //(this.#terminals.get(screenID)).blur();
        //(this.#terminals.get(screenID)).focus();
        //setTimeout(() => { this.#isSpeech = false }, 200);
        setTimeout(() => {
          this.#currentInputString.text = this.getCurrentCommandInput();
          if ( !editorMode.status ) {
            let command = this.getCurrentCommandInput();
            let helper = document.querySelector(helperElemString);
            helper.value = command;
            helper.setSelectionRange(command.length, command.length);
            //this.speakToText(command);
            //console.log(document.querySelector(helperElemString).value);
          } else {
            let text = (this.getCurrentBufferText()).replace(/\s{8}/, '\t');
            let tabCount = ( text.match( /\t/ ) || [] ).length;
            let cursorX = (this.#terminals.get(screenID)).buffer.active.cursorX;
            let helperElem = document.querySelector(helperElemString);
            helperElem.value = text;
            if ( tabCount > 0 ) {
              //console.log('count.');
              for ( let i=0;i<tabCount;i++ ) {
                cursorX -= 7;
              }
            }
            helperElem.selectionStart = cursorX;
            helperElem.selectionEnd = cursorX;
            this.speakToText( text );
            //console.log( helperElem.value );
          }
        }, 150);
      } else if ( e.domEvent.code === 'Enter' ) {
        /*setTimeout(() => {
          this.#screenKeyStrokeSend('test');
        }, 500);*/
        this.#isSpeech = true;
      } else {
        //this.#isSpeech = false;
      }
    });

    document.querySelector( ariaLiveElemString ).setAttribute('style', 'display:none;');

    this.#xtermAccessibilityElemEdit( screenID, accessibilityElemString );
  }

  #xtermAccessibilityElemEdit( screenID, elem ) {
    document.querySelector( elem ).addEventListener('keyup', ( e ) => {
      if ( e.key === '9' && this.#jumpPoints[ screenID ].lineNumbers.length !== 0 ) {
        //console.log( this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex ] );
        this.scrollBufferLine( this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex ] );
        this.#ipcRenderer.send('speach-stop');
        this.speakToText( 'jump ' + this.#jumpPoints[ screenID ].hist[ this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex ] ] );
        if ( this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex + 1 ] !== undefined ) this.#currentJumpingIndex += 1;
      } else if ( e.key === '0' && this.#jumpPoints[ screenID ].lineNumbers.length !== 0 ) {
        //console.log( this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex ] );
        this.scrollBufferLine( this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex ] );
        this.#ipcRenderer.send('speach-stop');
        this.speakToText( 'jump ' + this.#jumpPoints[ screenID ].hist[ this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex ] ] );
        if ( this.#jumpPoints[ screenID ].lineNumbers[ this.#currentJumpingIndex - 1 ] !== undefined ) this.#currentJumpingIndex -= 1;
      }
    });
  }

  showMsgModal(title, masage) {
    this.#modalElem.querySelector('.title').textContent = title;
    this.#modalElem.querySelector('.msg').textContent = masage;
    this.#modalElem.showModal();
  }

  clipboardCopy(data) {
    if (data != "") this.#ipcRenderer.send('clipboard-copy', data);
  }

  #screenKeyStrokeSend(keystroke, screenID=this.#currentScreenID) {
    this.#ipcRenderer.send('screen-keystroke', {
      window: this.#windowID, screenID,
      buffer: keystroke, mode: this.#currentScreenType
    });
  }

  #refreshTermScreen(screenID = this.#currentScreenID) {
    const ITheme = {
      background: this.#CONFIG.appConfig.xterm.theme.background,
      foreground: this.#CONFIG.appConfig.xterm.theme.foreground,
    };

    (this.#terminals.get(screenID)).setOption('fontSize', this.#CONFIG.appConfig.xterm.fontSize);
    (this.#terminals.get(screenID)).setOption('theme', ITheme);

    this.#terminals.forEach((value, key) => {
      value.setOption('screenReaderMode', this.#CONFIG.appConfig.xterm.screenReaderMode);
    });

    this.#screenTermResize();
    this.#setWindowTitle();
  }

  #setWindowTitle() {
    let currentTab = this.#screenSelections.querySelector(`.tab[data-screen="${this.#currentScreenID}"]`);
    let tabName = currentTab.querySelector('label').textContent;
    this.#ipcRenderer.send('set-window-title', { windowID: this.#windowID, title: tabName });
  }

  #screenTermResize(targetScreen = null) {
    const screenID = targetScreen == null ? this.#currentScreenID : targetScreen;
    (this.#fitAdons.get(screenID)).fit();
    this.#ipcRenderer.send('screenprocess-resize', {
      window: this.#windowID, screenID, mode: this.#currentScreenType,
      cols: (this.#terminals.get(screenID)).cols,
      rows: (this.#terminals.get(screenID)).rows
    });
  }

  currentScreenFocus() {
    (this.#terminals.get(this.#currentScreenID)).focus();
  }

  getCurrentCommandInput() {
    let command = (this.#terminals.get(this.#currentScreenID)).buffer.active
      .getLine(this.#currentCursorPosition.y).translateToString(true,
        this.#currentCursorPosition.x
      );

    if ( ((this.#terminals.get(this.#currentScreenID)).rows - 1) !== this.#currentCursorPosition.y ) {
      for ( let i=(this.#currentCursorPosition.y + 1); i< (this.#terminals.get(this.#currentScreenID)).rows; i++) {
        let tmp = (this.#terminals.get(this.#currentScreenID)).buffer.active
        .getLine(i).translateToString(true,);
        if ( tmp !== '' ) {
          command += tmp;
        } else break;
      }
    }

    return command;
  }

  getBufferText( startY, endY, screenID = this.#currentScreenID ) {
    let handleText = "";
    for ( let i=startY;i<endY;i++ ) {
      handleText += (this.#terminals.get(screenID)).buffer.active.getLine(i).translateToString(true) + '\n';
    }
    return handleText;
  }

  getCurrentBufferText(screenID = this.#currentScreenID) {
    let cursorY = (this.#terminals.get(screenID)).buffer.active.baseY;
    cursorY += (this.#terminals.get(screenID)).buffer.active.cursorY;
    //let cursorX = (this.#terminals.get(screenID)).buffer.active.cursorX;
    return (this.#terminals.get(screenID)).buffer.active.getLine(cursorY).translateToString(true);
  }

  getTermOption(key) {
    return this.#terminals.get(this.#currentScreenID).getOption(key);
  }

  scrollBufferLine(number, screenID=this.#currentScreenID) {
    (this.#terminals.get(screenID)).scrollToLine(number - 1);
    setTimeout(() => {
      document.querySelector(`.screen[data-number="${screenID}"] div[role="listitem"][aria-posinset="${number + 1}"]`).focus();
    }, 50);
  }

  termPasteText(text, screenID = this.#currentScreenID) {
    (this.#terminals.get(screenID)).paste(text);
  }

  #configUpdate() {
    this.#ipcRenderer.send('app-config-updated', {
      windowID: this.#windowID, config: this.#CONFIG
    });
  }

  showConfirmMsgBox(message) {
    return this.#showNativeMsgBoxSync({
      title: `確認メッセージ`, message,
      type: 'question', buttons: ['OK', 'Cancel']
    }) === 0 ? true : false;
  }

  #sendKeyStroke(text) {
    this.#ipcRenderer.send('send-keystroke', text);
  }

  showErrorMsgBox(message) {
    this.#showNativeMsgBoxSync({
      title: `エラーメッセージ`, message, type: 'error'
    });
  }

  showNormalMsgBox(message) {
    this.#showNativeMsgBoxSync({
      title: `メッセージ`, message, type: 'none'
    });
  }

  #showNativeMsgBoxSync(values) {
    return this.#ipcRenderer.sendSync('masagebox', { windowID: this.#windowID, values });
  }

  speakToText(text) {
    this.#ipcRenderer.send('text-to-speech', text);
  }

  dialogClose(dialog) {
    dialog.setAttribute('class', 'close');
    setTimeout(() => {
      dialog.close();
      setTimeout(() => {
        dialog.removeAttribute('class');
        this.currentScreenFocus();
      }, 1000);
    }, 350);
  }

  windowClose() {
    this.#ipcRenderer.send('app:quit', this.#windowID);
  }
}

function loadElement(url) {
  return new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest(), method = "GET";

    xhr.open(method, url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        //console.log(xhr.responseText);
        resolve(xhr.responseText);
      }
    };
    xhr.send();
  });
}

function strIns(str, idx, val){
  var res = str.slice(0, idx) + val + str.slice(idx);
  return res;
}

function sleep(time) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
}

window.addEventListener('load', e => {
  loadElement('./dom/dialogbox.html').then((dom) => {
    document.body.innerHTML += dom;
    window.braws = new RendererMain();
  });
});