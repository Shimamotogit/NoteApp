const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alarmAPI', {
  onData(callback) {
    ipcRenderer.on('alarm:data', (_, payload) => callback(payload));
  },
  stop(reminderId) {
    return ipcRenderer.invoke('reminders:stop-alarm', reminderId);
  }
});
