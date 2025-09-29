const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

const DEFAULT_NOTE_TITLE = '新規メモ';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9-_]/gi, '_');
}

class DataStore {
  constructor(basePath) {
    this.basePath = basePath;
    this.notesPath = path.join(this.basePath, 'notes');
    this.historyPath = path.join(this.basePath, 'history');
    this.indexFile = path.join(this.basePath, 'index.json');
    ensureDir(this.basePath);
    ensureDir(this.notesPath);
    ensureDir(this.historyPath);
    this.index = this.loadIndex();
  }

  loadIndex() {
    try {
      const raw = fs.readFileSync(this.indexFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        notes: parsed.notes || {}
      };
    } catch (error) {
      return { notes: {} };
    }
  }

  persistIndex() {
    fs.writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2), 'utf-8');
  }

  listNotes({ includeDeleted = false } = {}) {
    return Object.values(this.index.notes)
      .filter((meta) => includeDeleted || !meta.deletedAt)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  getNote(noteId) {
    const filePath = this.getNotePath(noteId);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  readNoteContent(noteId) {
    const note = this.getNote(noteId);
    return note ? note.content || '' : '';
  }

  getNotePath(noteId) {
    const safeId = sanitizeFilename(noteId);
    return path.join(this.notesPath, `${safeId}.json`);
  }

  getHistoryPath(noteId) {
    const safeId = sanitizeFilename(noteId);
    return path.join(this.historyPath, `${safeId}.jsonl`);
  }

  createNote({ title } = {}) {
    const now = new Date().toISOString();
    const id = nanoid();
    const note = {
      id,
      title: title && title.trim() ? title.trim() : DEFAULT_NOTE_TITLE,
      content: '',
      createdAt: now,
      updatedAt: now
    };
    this.writeNote(note);
    this.index.notes[id] = {
      id,
      title: note.title,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.persistIndex();
    this.appendHistoryEntry(id, {
      type: 'create',
      title: note.title,
      content: note.content,
      timestamp: now
    });
    return note;
  }

  saveNote(noteId, { title, content }) {
    const existing = this.getNote(noteId);
    if (!existing) {
      throw new Error('Note not found');
    }
    const now = new Date().toISOString();
    const updatedNote = {
      ...existing,
      title: title && title.trim() ? title.trim() : DEFAULT_NOTE_TITLE,
      content: content != null ? content : existing.content,
      updatedAt: now
    };
    this.writeNote(updatedNote);
    const meta = this.index.notes[noteId];
    if (meta) {
      meta.title = updatedNote.title;
      meta.updatedAt = now;
    }
    this.persistIndex();
    this.appendHistoryEntry(noteId, {
      type: 'update',
      title: updatedNote.title,
      content: updatedNote.content,
      timestamp: now
    });
    return updatedNote;
  }

  deleteNote(noteId) {
    const meta = this.index.notes[noteId];
    if (!meta) {
      throw new Error('Note not found');
    }
    if (!meta.deletedAt) {
      meta.deletedAt = new Date().toISOString();
      this.persistIndex();
      this.appendHistoryEntry(noteId, {
        type: 'delete',
        title: meta.title,
        content: this.readNoteContent(noteId),
        timestamp: meta.deletedAt
      });
    }
    return meta;
  }

  restoreNote(noteId) {
    const meta = this.index.notes[noteId];
    if (!meta) {
      throw new Error('Note not found');
    }
    meta.deletedAt = null;
    meta.updatedAt = new Date().toISOString();
    this.persistIndex();
    this.appendHistoryEntry(noteId, {
      type: 'restore',
      title: meta.title,
      content: this.readNoteContent(noteId),
      timestamp: meta.updatedAt
    });
    return this.getNote(noteId);
  }

  getHistory(noteId) {
    const filePath = this.getHistoryPath(noteId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .map((entry) => ({
        ...entry,
        versionId: entry.versionId
      }));

    return entries
      .map((entry, index) => ({
        ...entry,
        versionId: entry.versionId || `${noteId}-${index}-${entry.timestamp}`
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  restoreVersion(noteId, versionId) {
    const history = this.getHistory(noteId);
    const target = history.find((entry) => entry.versionId === versionId);
    if (!target) {
      throw new Error('Version not found');
    }
    const now = new Date().toISOString();
    const restored = {
      id: noteId,
      title: target.title,
      content: target.content,
      createdAt: this.index.notes[noteId]?.createdAt || now,
      updatedAt: now
    };
    this.writeNote(restored);
    if (this.index.notes[noteId]) {
      this.index.notes[noteId].title = restored.title;
      this.index.notes[noteId].updatedAt = now;
      this.index.notes[noteId].deletedAt = null;
    }
    this.persistIndex();
    this.appendHistoryEntry(noteId, {
      type: 'restore-version',
      title: restored.title,
      content: restored.content,
      timestamp: now
    });
    return restored;
  }

  appendHistoryEntry(noteId, entry) {
    const filePath = this.getHistoryPath(noteId);
    const versionEntry = {
      ...entry,
      versionId: entry.versionId || nanoid()
    };
    fs.appendFileSync(filePath, `${JSON.stringify(versionEntry)}\n`, 'utf-8');
    return versionEntry;
  }

  writeNote(note) {
    const filePath = this.getNotePath(note.id);
    fs.writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf-8');
  }
}

module.exports = DataStore;
