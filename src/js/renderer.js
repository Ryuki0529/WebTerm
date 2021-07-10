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
  #addScreenTrigger = document.getElementsByClassName('add-tab-btn');
  #commandResult = document.getElementById('terminal-screens');
  #settingModalElem = document.getElementById('app-setting-modal');
  #sshConnectionModal = document.getElementById('ssh-conection-modal');
  #modalElem = document.getElementById('connection-msg-modal');
  #modalCloseTriggers = document.getElementsByClassName('modal-close');
  #windowID = Number(FIRST_GET.get('w_id'));

  #CONFIG;
  #terminals = new Map();
  #fitAdons = new Map();
  #webLinksAddon = new Map();
  #tabNumber = 0;
  #currentScreenID = 0;
  #currentScreenType = '';
  #isSpeech = true;
  #virtualCursorMode = { bagFlag: false, status: false }

  constructor() {

    this.#CONFIG = this.#ipcRenderer.sendSync('get-app-config');
    this.#ipcRenderer.on('new-app-config-stream', (e, config) => {
      this.#CONFIG = config; this.#refreshTermScreen();
    });

    this.#createTabSelection( FIRST_GET.get('d_mode') );
    [...this.#addScreenTrigger].forEach(trigger => {
      trigger.addEventListener('click', event => {
        this.#createTabSelection(event.target.dataset.type);
        this.#screenSelections.scrollLeft = this.#screenSelections.clientWidth;
      });
    });

    this.#ipcRenderer.on("shellprocess-incomingData", (event, arg) => {
      arg.buffer = this.#currentScreenType === 'ssh' ? (new TextDecoder).decode(arg.buffer) : arg.buffer;
      if (this.#isSpeech === true) {
        this.#ipcRenderer.send('text-to-speech', stripAnsi.unstyle(arg.buffer));
      }
      let re = arg.buffer.match(/[dl-]([r-][w-][xtsS-]){3}\s+[0-9]+\s+\w+\s+\w+\s+[0-9]+\s+[^\n]+\n/g);
      if (re) {
        re.forEach(result => {
          if (result.match(/^d/)) {
            arg.buffer = arg.buffer.replace(result, LINE_BG_BLUE + result);
          } else if (result.match(/^l/)) {
            arg.buffer = arg.buffer.replace(result, LINE_BG_GREEN + result);
          } else if (result.match(/^-/)) {
            arg.buffer = arg.buffer.replace(result, LINE_BG_ORANGE + result);
          }
        });
      }
      (this.#terminals.get(Number(arg.screenID))).write(arg.buffer);
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
        this.#ipcRenderer.send('new-app', 'shell');
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
      this.#settingModalElem.querySelector('#set-term-fontsize').value = this.#CONFIG.xterm.fontSize;
      this.#settingModalElem
        .querySelector(`#set-term-fontcolor option[value="${this.#CONFIG.xterm.theme.foreground}"]`)
        .setAttribute('selected', 'true');
      this.#settingModalElem
        .querySelector(`#set-term-bg-color option[value="${this.#CONFIG.xterm.theme.background}"]`)
        .setAttribute('selected', 'true');
      switch (this.#CONFIG.app.screenReaderMode) {
        case 1:
          this.#settingModalElem.querySelector('#set-srm-pctalker').click(); break;
        case 2:
          this.#settingModalElem.querySelector('#set-srm-nvda').click(); break;
        default:
          this.#settingModalElem.querySelector('#set-srm-none').click(); break;
      }
      switch (this.#CONFIG.app.startUpTerminalMode) {
        case 'shell':
          this.#settingModalElem.querySelector('#set-stm-shell').click(); break;
        case 'ssh':
          this.#settingModalElem.querySelector('#set-stm-ssh').click(); break;
        default:
          this.#settingModalElem.querySelector('#set-stm-shell').click(); break;
      }
      this.#settingModalElem.showModal();
    });

    this.#settingModalElem.querySelector('#app-setting-activate')
      .addEventListener('click', e => {
        this.#CONFIG.xterm.fontSize = this.#settingModalElem.querySelector('#set-term-fontsize').value;
        this.#CONFIG.xterm.theme.foreground = this.#settingModalElem.querySelector('#set-term-fontcolor').value;
        this.#CONFIG.xterm.theme.background = this.#settingModalElem.querySelector('#set-term-bg-color').value;
        this.#CONFIG.app.screenReaderMode = Number(this.#settingModalElem.querySelector('#set-screen-reader-mode input[type="radio"]:checked').value);
        this.#CONFIG.app.startUpTerminalMode = this.#settingModalElem.querySelector('#set-startup-terminal-mode input[type="radio"]:checked').value;

        this.#settingModalElem.querySelector('.modal-close').click();
        this.#refreshTermScreen();
        this.#ipcRenderer.send('app-config-updated', { windowID: this.#windowID, config: this.#CONFIG });
      });

    [...this.#modalCloseTriggers].forEach(trigger => {
      trigger.addEventListener('click', e => {
        let modalElem = document.getElementById(e.target.dataset.target);
        this.dialogClose( modalElem );
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
          .value = (this.#ipcRenderer.sendSync('get-file-path'))[0];
      });

    this.#modalElem.querySelector('#msg-modal-close')
      .addEventListener('click', event => {
        this.#modalElem.close();
        //this.#sshClient.end();
        //this.#sshClient = new (require('ssh2').Client);
        document.getElementById('try-connect-btn').removeAttribute('disabled');
      });
  }

  #getSshConnectionInfo() {
    return new Promise((resolve, reject) => {
      let sshConfig = {};
      this.#sshConnectionModal.showModal();
      this.#sshConnectionModal.querySelector('#try-connect-btn')
        .addEventListener('click', (e) => {
          this.dialogClose( this.#sshConnectionModal );
          sshConfig.host = this.#sshConnectionModal.querySelector('#input-hostname').value;
          sshConfig.port = Number( this.#sshConnectionModal.querySelector('#input-portnumber').value );
          sshConfig.user = this.#sshConnectionModal.querySelector('#input-username').value;
          if ( this.#sshConnectionModal.querySelector('#public-key-auth-change').checked ) {
            sshConfig.privateKey = this.#sshConnectionModal.querySelector('#input-privateKey').value;
            sshConfig.passphrase = this.#sshConnectionModal.querySelector('#input-passphrase').value;
          } else sshConfig.password = this.#sshConnectionModal.querySelector('#input-password').value;
          resolve(sshConfig);
        });
      this.#sshConnectionModal.querySelector('.modal-close')
        .addEventListener('click', (e) => {
          resolve(undefined);
        });
    });
  }

  async #createTabSelection(mode = 'shell') {

    let sshConfig = null;
    if (mode === 'ssh') {
      sshConfig = await this.#getSshConnectionInfo();
      if ( sshConfig === undefined ) return;
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
    inputRadio.checked = true;
    let tabLavel = document.createElement('label');
    tabLavel.setAttribute('for', "screen-label-" + this.#tabNumber);
    let closeBtn = document.createElement('button');
    closeBtn.setAttribute('class', 'screen-close');
    closeBtn.textContent = 'X';
    if (mode === 'shell') {
      tabLavel.textContent = 'PowerShell #' + this.#tabNumber;
      closeBtn.setAttribute('aria-label', `PowerShell ${this.#tabNumber}のタブを閉じる`);
    } else if (mode === 'ssh') {
      tabLavel.textContent = 'SSH #' + this.#tabNumber;
      closeBtn.setAttribute('area-label', `SSH ${this.#tabNumber}のタブを閉じる`);
    }
    closeBtn.addEventListener('click', event => {
      let tabElem = event.target.parentElement;
      let delScreenID = Number(tabElem.querySelector('input').value);

      this.#terminals.delete(delScreenID);
      this.#fitAdons.delete(delScreenID);
      this.#webLinksAddon.delete(delScreenID);

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

    this.#createTermInstance(this.#tabNumber, mode, sshConfig, inputRadio);

    this.#currentScreenID = this.#tabNumber;
    this.#currentScreenType = mode;
  }

  #createTermInstance(screenID, mode, sshConfig, targetTab) {

    this.#terminals.set(screenID, new Terminal(this.#CONFIG.xterm));
    this.#fitAdons.set(screenID, new TerminalFitAddon());
    this.#webLinksAddon.set(screenID,
      new TerminalWebLinksAddon((event, url) => {
        event.preventDefault(); window.open(url);
      })
    );
    (this.#terminals.get(screenID)).loadAddon(this.#fitAdons.get(screenID));
    (this.#terminals.get(screenID)).loadAddon(this.#webLinksAddon.get(screenID));
    (this.#terminals.get(screenID)).open(this.#commandResult.lastElementChild);
    (this.#fitAdons.get(screenID)).fit();
    (this.#terminals.get(screenID)).focus();

    /*(this.#terminals.get(screenID)).onSelectionChange(() => {});*/

    this.#ipcRenderer.sendSync(`${mode === "shell" ? "shell" : "ssh"}process-create`, {
      window: this.#windowID, screenID: screenID,
      cols: (this.#terminals.get(screenID)).cols,
      rows: (this.#terminals.get(screenID)).rows, sshConfig
    });

    targetTab.click();

    window.addEventListener('resize', () => { this.#screenTermResize() });

    (this.#terminals.get(screenID)).attachCustomKeyEventHandler(e => {
      if (e.ctrlKey && e.key === 'c') {
        if ((this.#terminals.get(screenID)).hasSelection()) {
          this.clipboardCopy((this.#terminals.get(screenID)).getSelection());
          return false;
        }
      } else if (e.ctrlKey && e.key === 'v') {
        this.#screenKeyStrokeSend(this.#ipcRenderer.on('clipboard-read'));
        return false;
      } else if ( e.ctrlKey && e.key === 'b' ) {
        if ( this.#virtualCursorMode.status && this.#virtualCursorMode.bagFlag ) {
          this.#terminals.forEach(( value, key ) => {
            value.setOption('screenReaderMode', false);
          }); this.#virtualCursorMode.status = false;
          this.#ipcRenderer.send('text-to-speech', 'スクリーンカーソルモードOFF');
        } else if ( !this.#virtualCursorMode.status && !this.#virtualCursorMode.bagFlag ) {
          this.#terminals.forEach(( value, key ) => {
            value.setOption('screenReaderMode', true);
          }); this.#virtualCursorMode.status = true;
          this.#ipcRenderer.send('text-to-speech', 'スクリーンカーソルモードON');
        } else if ( !this.#virtualCursorMode.bagFlag ) {
          this.#virtualCursorMode.bagFlag = true;
        } else if ( this.#virtualCursorMode.bagFlag ) {
          this.#virtualCursorMode.bagFlag = false;
        }
        return false;
      } else if ( e.key === 'Insert' ) {
        (this.#terminals.get(screenID)).blur();
        return false;
      }
    });

    (this.#terminals.get(screenID)).onData(event => {
      this.#screenKeyStrokeSend(event);
    });

    /*(this.#terminals.get(screenID)).onLineFeed(() => {});*/

    (this.#terminals.get(screenID)).onKey((e) => {
      if (e.domEvent.code === 'Enter') {
        this.#isSpeech = true;
      } else if ( e.domEvent.code === 'ArrowUp' || e.domEvent.code === 'ArrowDown' ) {
        this.#isSpeech = true;
        this.#ipcRenderer.send('text-to-speech', this.getCurrentBufferText());
      } else if ( e.domEvent.code === 'ArrowRight' ) {
        this.#isSpeech = false;
        this.#ipcRenderer.send('text-to-speech', this.getCurrentBufferText());
      } else if ( e.domEvent.code === 'ArrowLeft' || e.domEvent.code === 'Backspace' ) {
        this.#isSpeech = false;
        this.#ipcRenderer.send('text-to-speech', this.getCurrentBufferText( this.#currentScreenID, true ));
      } else {
        this.#isSpeech = false;
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

  #screenKeyStrokeSend(keystroke) {
    this.#ipcRenderer.send('screen-keystroke', {
      window: this.#windowID, screenID: this.#currentScreenID,
      buffer: keystroke, mode: this.#currentScreenType
    });
  }

  #refreshTermScreen(screenID = this.#currentScreenID) {
    const ITheme = {
      background: this.#CONFIG.xterm.theme.background,
      foreground: this.#CONFIG.xterm.theme.foreground
    };

    (this.#terminals.get(screenID)).setOption('fontSize', this.#CONFIG.xterm.fontSize);
    (this.#terminals.get(screenID)).setOption('theme', ITheme);
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

  getCurrentBufferText(screenID = this.#currentScreenID, shift=false) {
    let cursorY = (this.#terminals.get(screenID)).buffer.active.baseY;
    cursorY += (this.#terminals.get(screenID)).buffer.active.cursorY;
    let cursorX = (this.#terminals.get(screenID)).buffer.active.cursorX;
    return (this.#terminals.get(screenID)).buffer.active
      .getLine(cursorY).translateToString( true,
        shift === true ? cursorX - 1 : cursorX + 1,
        shift === true ? cursorX : cursorX + 2
      );
  }

  getTermOption(key) {
    return this.#terminals.get(this.#currentScreenID).getOption(key);
  }

  scrollPagesTerm(screenID, number) {
    (this.#terminals.get(screenID)).scrollPages(number);
  }

  dialogClose( dialog ) {
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

function sleep(time) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
}

loadElement('./dom/dialogbox.html').then((dom) => {
  document.body.innerHTML += dom;
  window.braws = new RendererMain();
});