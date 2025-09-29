const path = require('path');
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const DataStore = require('./dataStore');
const SearchService = require('./searchService');
const ReminderManager = require('./reminderManager');

let mainWindow;
let dataStore;
let searchService;
let reminderManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f101d' : '#f4f6ff',
    title: 'FlowNote',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function setupIpc() {
  ipcMain.handle('notes:list', (_, options = {}) => {
    return dataStore.listNotes({ includeDeleted: Boolean(options.includeDeleted) });
  });

  ipcMain.handle('notes:create', () => {
    const note = dataStore.createNote();
    return note;
  });

  ipcMain.handle('notes:get', (_, noteId) => {
    return dataStore.getNote(noteId);
  });

  ipcMain.handle('notes:save', (_, payload) => {
    const { id, title, content } = payload;
    return dataStore.saveNote(id, { title, content });
  });

  ipcMain.handle('notes:delete', (_, noteId) => {
    return dataStore.deleteNote(noteId);
  });

  ipcMain.handle('notes:restore', (_, noteId) => {
    return dataStore.restoreNote(noteId);
  });

  ipcMain.handle('notes:history', (_, noteId) => {
    return dataStore.getHistory(noteId);
  });

  ipcMain.handle('notes:restore-version', (_, payload) => {
    const { id, versionId } = payload;
    return dataStore.restoreVersion(id, versionId);
  });

  ipcMain.handle('search:run', (_, query) => {
    return searchService.search(query);
  });

  ipcMain.handle('reminders:list', () => {
    return reminderManager.listReminders();
  });

  ipcMain.handle('reminders:create', (_, payload) => {
    return reminderManager.createReminder(payload);
  });

  ipcMain.handle('reminders:delete', (_, reminderId) => {
    return reminderManager.deleteReminder(reminderId);
  });

  ipcMain.handle('reminders:complete', (_, reminderId) => {
    return reminderManager.markCompleted(reminderId);
  });

  ipcMain.handle('reminders:stop-alarm', (_, reminderId) => {
    return reminderManager.stopAlarm(reminderId);
  });
}

app.whenReady().then(() => {
  const basePath = path.join(app.getPath('userData'), 'FlowNote');
  dataStore = new DataStore(basePath);
  searchService = new SearchService(dataStore);
  reminderManager = new ReminderManager(basePath, () => mainWindow);
  createWindow();
  setupIpc();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
