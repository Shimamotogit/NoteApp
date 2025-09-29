const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteAPI', {
  listNotes: (options) => ipcRenderer.invoke('notes:list', options),
  createNote: () => ipcRenderer.invoke('notes:create'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  saveNote: (payload) => ipcRenderer.invoke('notes:save', payload),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  restoreNote: (id) => ipcRenderer.invoke('notes:restore', id),
  getHistory: (id) => ipcRenderer.invoke('notes:history', id),
  restoreVersion: (payload) => ipcRenderer.invoke('notes:restore-version', payload),
  search: (query) => ipcRenderer.invoke('search:run', query),
  reminders: {
    list: () => ipcRenderer.invoke('reminders:list'),
    create: (payload) => ipcRenderer.invoke('reminders:create', payload),
    delete: (id) => ipcRenderer.invoke('reminders:delete', id),
    complete: (id) => ipcRenderer.invoke('reminders:complete', id),
    stopAlarm: (id) => ipcRenderer.invoke('reminders:stop-alarm', id)
  },
  onReminderFired: (callback) => ipcRenderer.on('reminders:fired', (_, payload) => callback(payload))
});
