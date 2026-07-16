const { contextBridge, ipcRenderer } = require('electron');

const workerCount = ipcRenderer.sendSync('pool:workerCount');

contextBridge.exposeInMainWorld('engineAPI', {
  workerCount,
  send:              (cmd, param) => ipcRenderer.invoke('engine:cmd', cmd, param),
  cancel:            ()           => ipcRenderer.invoke('engine:cancel'),
  poolGetLevelPoints:(param)      => ipcRenderer.invoke('pool:getLevelPoints', param),
  poolCancel:        ()           => ipcRenderer.invoke('pool:cancel'),
  poolSetRules:      (rules)      => ipcRenderer.invoke('pool:setRules', rules),
});
