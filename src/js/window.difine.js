const Convert = require('ansi-to-html');
window.convert = new Convert({
  fg: '#FFF',
  bg: '#000',
  newline: true,
  escapeXML: true,
  stream: false
});

const Client = require('ssh2');
window.conn = new Client();

const { contextBridge, ipcRenderer } = require("electron");
window.ipcRenderer = ipcRenderer;
window.MyIPCSend = (msg) => {
  return ipcRenderer.send("exec_shell_process", msg);
}
window.appClose = () => { ipcRenderer.send('app:quit') }

/*
const conn = new Client();
conn.on('ready', () => {
  console.log('Client :: ready');
  conn.shell((err, stream) => {
    if (err) throw err;
    stream.on('close', () => {
      console.log('Stream :: close');
      conn.end();
    }).on('data', (data) => {
      console.log('OUTPUT: ' + data);
    });
    stream.write('mysql -u ryuki -p\n');
    //stream.write('ymzkrk33\n');
    //stream.write('exit\n');

    setTimeout(() => {
      stream.write('ymzkrk33\n');
      stream.write('exit\nexit\n');
    }, 1000);

  });
}).connect({
  host: '147.157.57.167',
  port: 22,
  username: 'ryuki',
  password: 'ymzkrk33'
});*/