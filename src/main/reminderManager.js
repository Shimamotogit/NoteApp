const fs = require('fs');
const path = require('path');
const { BrowserWindow, Notification } = require('electron');
const { nanoid } = require('nanoid');
const loudness = require('loudness');

const MAX_TIMEOUT = 2147483647; // ~24 days

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

class ReminderManager {
  constructor(basePath, getMainWindow) {
    this.basePath = basePath;
    this.reminderFile = path.join(this.basePath, 'reminders.json');
    ensureDir(this.basePath);
    this.getMainWindow = getMainWindow;
    this.reminders = this.loadReminders();
    this.timers = new Map();
    this.activeAlarms = new Map();
    this.bootstrap();
  }

  loadReminders() {
    try {
      const raw = fs.readFileSync(this.reminderFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed.reminders || [];
    } catch (error) {
      return [];
    }
  }

  persistReminders() {
    const payload = { reminders: this.reminders };
    fs.writeFileSync(this.reminderFile, JSON.stringify(payload, null, 2), 'utf-8');
  }

  bootstrap() {
    for (const reminder of this.reminders) {
      if (reminder.status === 'scheduled') {
        this.scheduleReminder(reminder);
      }
    }
  }

  listReminders() {
    return this.reminders
      .slice()
      .sort((a, b) => new Date(a.triggerAt) - new Date(b.triggerAt));
  }

  createReminder({ title, message, triggerAt, type = 'notification', noteId = null }) {
    const now = new Date().toISOString();
    const reminder = {
      id: nanoid(),
      title: title || 'リマインダー',
      message: message || '',
      triggerAt,
      type,
      noteId,
      createdAt: now,
      status: 'scheduled'
    };
    this.reminders.push(reminder);
    this.persistReminders();
    this.scheduleReminder(reminder);
    return reminder;
  }

  updateReminder(reminderId, updates) {
    const reminder = this.reminders.find((item) => item.id === reminderId);
    if (!reminder) {
      throw new Error('Reminder not found');
    }
    Object.assign(reminder, updates);
    this.persistReminders();
    if (reminder.status === 'scheduled') {
      this.scheduleReminder(reminder);
    }
    return reminder;
  }

  deleteReminder(reminderId) {
    const index = this.reminders.findIndex((item) => item.id === reminderId);
    if (index === -1) {
      return null;
    }
    const [removed] = this.reminders.splice(index, 1);
    this.persistReminders();
    this.clearTimer(reminderId);
    this.stopAlarm(reminderId);
    return removed;
  }

  markCompleted(reminderId) {
    const reminder = this.reminders.find((item) => item.id === reminderId);
    if (!reminder) {
      return null;
    }
    reminder.status = 'completed';
    reminder.completedAt = new Date().toISOString();
    this.persistReminders();
    this.clearTimer(reminderId);
    this.stopAlarm(reminderId);
    return reminder;
  }

  scheduleReminder(reminder) {
    this.clearTimer(reminder.id);
    const plan = () => {
      const due = new Date(reminder.triggerAt).getTime();
      const now = Date.now();
      const delay = due - now;
      if (delay <= 0) {
        setTimeout(() => this.executeReminder(reminder.id), 100);
        return;
      }
      if (delay > MAX_TIMEOUT) {
        const timer = setTimeout(() => plan(), MAX_TIMEOUT);
        this.timers.set(reminder.id, timer);
      } else {
        const timer = setTimeout(() => this.executeReminder(reminder.id), delay);
        this.timers.set(reminder.id, timer);
      }
    };
    plan();
  }

  executeReminder(reminderId) {
    const reminder = this.reminders.find((item) => item.id === reminderId);
    if (!reminder || reminder.status !== 'scheduled') {
      return;
    }
    reminder.status = 'triggered';
    reminder.triggeredAt = new Date().toISOString();
    this.persistReminders();
    this.clearTimer(reminderId);

    if (reminder.type === 'alarm') {
      this.launchAlarm(reminder);
    } else {
      this.showNotification(reminder);
    }

    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('reminders:fired', reminder);
    }
  }

  showNotification(reminder) {
    const notification = new Notification({
      title: reminder.title || 'リマインダー',
      body: reminder.message || '',
      silent: false
    });
    notification.show();
  }

  async launchAlarm(reminder) {
    try {
      const previousState = {
        volume: await loudness.getVolume(),
        muted: await loudness.getMuted()
      };
      await loudness.setMuted(false);
      let currentVolume = Math.max(10, previousState.volume);
      await loudness.setVolume(currentVolume);
      const targetVolume = Math.max(80, previousState.volume);

      const alarmWindow = new BrowserWindow({
        width: 420,
        height: 260,
        alwaysOnTop: true,
        resizable: false,
        frame: false,
        movable: true,
        transparent: false,
        title: 'アラーム',
        webPreferences: {
          preload: path.join(__dirname, 'alarmPreload.js'),
          contextIsolation: true
        }
      });

      alarmWindow.on('closed', () => {
        this.stopAlarm(reminder.id);
      });

      const increaseInterval = setInterval(async () => {
        if (currentVolume >= targetVolume) {
          clearInterval(increaseInterval);
          return;
        }
        currentVolume = Math.min(targetVolume, currentVolume + 5);
        try {
          await loudness.setVolume(currentVolume);
        } catch (error) {
          clearInterval(increaseInterval);
        }
      }, 7000);

      this.activeAlarms.set(reminder.id, {
        window: alarmWindow,
        volumeTimer: increaseInterval,
        previousState
      });

      alarmWindow.loadFile(path.join(__dirname, 'alarmWindow.html'));
      alarmWindow.once('ready-to-show', () => {
        alarmWindow.show();
      });
      alarmWindow.webContents.on('did-finish-load', () => {
        alarmWindow.webContents.send('alarm:data', {
          id: reminder.id,
          title: reminder.title,
          message: reminder.message,
          triggerAt: reminder.triggerAt
        });
      });
    } catch (error) {
      console.error('Failed to launch alarm', error);
      this.showNotification(reminder);
    }
  }

  async stopAlarm(reminderId) {
    const active = this.activeAlarms.get(reminderId);
    if (!active) {
      return;
    }
    const { window, volumeTimer, previousState } = active;
    if (volumeTimer) {
      clearInterval(volumeTimer);
    }
    if (window && !window.isDestroyed()) {
      window.close();
    }
    try {
      if (previousState) {
        await loudness.setVolume(previousState.volume);
        await loudness.setMuted(previousState.muted);
      }
    } catch (error) {
      // ignore volume restore failures
    }
    this.activeAlarms.delete(reminderId);
  }

  clearTimer(reminderId) {
    const existing = this.timers.get(reminderId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(reminderId);
    }
  }
}

module.exports = ReminderManager;
