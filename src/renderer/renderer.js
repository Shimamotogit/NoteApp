const state = {
  notes: [],
  showArchived: false,
  selectedNoteId: null,
  currentNote: null,
  noteCache: new Map(),
  autoSaveTimer: null,
  history: [],
  reminders: [],
  searchQuery: ''
};

const elements = {
  noteList: document.getElementById('note-list'),
  noteTitle: document.getElementById('note-title'),
  noteContent: document.getElementById('note-content'),
  deleteButton: document.getElementById('delete-note'),
  restoreButton: document.getElementById('restore-note'),
  newNoteButton: document.getElementById('new-note'),
  openHistoryButton: document.getElementById('open-history'),
  historyDrawer: document.getElementById('history-drawer'),
  historyList: document.getElementById('history-list'),
  closeHistoryButton: document.getElementById('close-history'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  toggleArchived: document.getElementById('toggle-archived'),
  reminderList: document.getElementById('reminder-list'),
  reminderDialog: document.getElementById('reminder-dialog'),
  reminderForm: document.getElementById('reminder-form'),
  reminderCancel: document.getElementById('cancel-reminder'),
  reminderNoteSelect: document.getElementById('reminder-note-select'),
  openReminderFormButton: document.getElementById('open-reminder-form'),
  toastContainer: document.getElementById('toast-container')
};

const api = window.noteAPI;

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}

function highlightQuery(text, query) {
  if (!query) return text;
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    return text.replace(regex, (match) => `<mark>${match}</mark>`);
  } catch (error) {
    return text;
  }
}

function showToast(title, message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${title}</strong>${message ? `<span>${message}</span>` : ''}`;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade');
    toast.remove();
  }, 5000);
}

async function refreshNotes() {
  const notes = await api.listNotes({ includeDeleted: true });
  state.notes = notes;
  renderNotes();
  updateReminderNoteSelect();
}

function renderNotes() {
  const list = elements.noteList;
  list.innerHTML = '';
  const filtered = state.notes.filter((note) =>
    state.showArchived ? Boolean(note.deletedAt) : !note.deletedAt
  );

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'note-item';
    empty.innerHTML = '<div class="title">まだメモがありません</div><div class="preview">Ctrl+Nで作成しましょう。</div>';
    empty.style.opacity = '0.6';
    list.appendChild(empty);
    return;
  }

  for (const note of filtered) {
    const item = document.createElement('div');
    item.className = 'note-item';
    if (note.id === state.selectedNoteId) {
      item.classList.add('active');
    }
    const cached = state.noteCache.get(note.id);
    const preview = cached ? cached.content.slice(0, 120) : '';
    item.innerHTML = `
      <div class="meta">
        <span>${formatDateTime(note.updatedAt)}</span>
        ${note.deletedAt ? '<span>アーカイブ済み</span>' : ''}
      </div>
      <div class="title">${note.title || '無題のメモ'}</div>
      <div class="preview">${preview ? preview.replace(/\n/g, ' ') : '...'}</div>
    `;
    item.addEventListener('click', () => loadNote(note.id));
    list.appendChild(item);
  }

  elements.toggleArchived.textContent = state.showArchived ? '通常表示' : 'アーカイブ表示';
}

async function loadNote(noteId) {
  try {
    const note = await api.getNote(noteId);
    if (!note) {
      return;
    }
    state.selectedNoteId = noteId;
    state.currentNote = { ...note, deletedAt: state.notes.find((n) => n.id === noteId)?.deletedAt };
    state.noteCache.set(noteId, note);
    elements.noteTitle.value = note.title || '';
    elements.noteContent.value = note.content || '';
    const isArchived = Boolean(state.currentNote.deletedAt);
    elements.noteTitle.disabled = isArchived;
    elements.noteContent.disabled = isArchived;
    elements.deleteButton.disabled = isArchived;
    elements.deleteButton.textContent = 'アーカイブ';
    elements.restoreButton.style.display = isArchived ? 'inline-flex' : 'none';
    renderNotes();
    closeHistory();
  } catch (error) {
    console.error(error);
  }
}

function scheduleAutoSave() {
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(() => saveCurrentNote(), 600);
}

async function saveCurrentNote(force = false) {
  if (!state.currentNote) return;
  const title = elements.noteTitle.value;
  const content = elements.noteContent.value;
  if (!force && state.currentNote.title === title && state.currentNote.content === content) {
    return;
  }
  try {
    const saved = await api.saveNote({ id: state.currentNote.id, title, content });
    state.currentNote = { ...saved, deletedAt: state.currentNote.deletedAt };
    state.noteCache.set(saved.id, saved);
    await refreshNotes();
  } catch (error) {
    console.error(error);
    showToast('保存エラー', 'メモの保存に失敗しました');
  }
}

async function createNote() {
  try {
    const note = await api.createNote();
    await refreshNotes();
    await loadNote(note.id);
    showToast('新しいメモ', '空のメモを作成しました');
  } catch (error) {
    showToast('エラー', '新規メモの作成に失敗しました');
  }
}

async function deleteOrArchiveNote() {
  if (!state.currentNote) return;
  if (state.currentNote.deletedAt) {
    showToast('情報', '復元すると再度編集できます');
    return;
  }
  try {
    await api.deleteNote(state.currentNote.id);
    showToast('メモをアーカイブ', '一覧からは非表示になりました');
    await refreshNotes();
    await loadNote(state.currentNote.id);
  } catch (error) {
    showToast('エラー', 'アーカイブに失敗しました');
  }
}

async function restoreNote() {
  if (!state.currentNote) return;
  try {
    const restored = await api.restoreNote(state.currentNote.id);
    state.currentNote = restored;
    showToast('復元しました', 'メモを元に戻しました');
    await refreshNotes();
    await loadNote(restored.id);
  } catch (error) {
    showToast('エラー', '復元に失敗しました');
  }
}

async function openHistory() {
  if (!state.currentNote) return;
  try {
    const history = await api.getHistory(state.currentNote.id);
    state.history = history;
    renderHistory();
    elements.historyDrawer.classList.remove('hidden');
  } catch (error) {
    showToast('エラー', '履歴の取得に失敗しました');
  }
}

function closeHistory() {
  elements.historyDrawer.classList.add('hidden');
}

async function restoreVersion(versionId) {
  if (!state.currentNote) return;
  try {
    await api.restoreVersion({ id: state.currentNote.id, versionId });
    showToast('バージョンを復元', '選択した履歴に戻しました');
    await loadNote(state.currentNote.id);
    await refreshNotes();
    await openHistory();
  } catch (error) {
    showToast('エラー', '復元に失敗しました');
  }
}

function renderHistory() {
  elements.historyList.innerHTML = '';
  if (!state.history.length) {
    elements.historyList.innerHTML = '<p class="meta">履歴がまだありません。</p>';
    return;
  }
  for (const entry of state.history) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <header>
        <strong>${entry.title || '無題のメモ'}</strong>
        <button class="ghost" data-version="${entry.versionId}">復元</button>
      </header>
      <span class="meta">${formatDateTime(entry.timestamp)} ／ ${entry.type}</span>
      <pre>${entry.content ? entry.content.slice(0, 500) : ''}</pre>
    `;
    const restoreBtn = item.querySelector('button[data-version]');
    restoreBtn.addEventListener('click', () => restoreVersion(entry.versionId));
    elements.historyList.appendChild(item);
  }
}

async function refreshReminders() {
  try {
    const reminders = await api.reminders.list();
    state.reminders = reminders;
    renderReminders();
  } catch (error) {
    console.error(error);
  }
}

function renderReminders() {
  elements.reminderList.innerHTML = '';
  if (!state.reminders.length) {
    elements.reminderList.innerHTML = '<p class="meta">予定されているリマインダーはありません。</p>';
    return;
  }
  for (const reminder of state.reminders) {
    const item = document.createElement('div');
    item.className = 'reminder-item';
    item.innerHTML = `
      <header>
        <div>
          <strong>${reminder.title || 'リマインダー'}</strong>
          <div class="meta">${reminder.type === 'alarm' ? 'アラーム' : '通知'} ／ ${formatDateTime(reminder.triggerAt)}</div>
        </div>
        <div class="actions"></div>
      </header>
      ${reminder.message ? `<div class="meta">${reminder.message}</div>` : ''}
      <div class="meta">状態：${reminder.status}</div>
    `;
    const actions = item.querySelector('.actions');
    if (reminder.status === 'scheduled') {
      const completeBtn = document.createElement('button');
      completeBtn.className = 'ghost';
      completeBtn.textContent = '完了';
      completeBtn.addEventListener('click', () => completeReminder(reminder.id));
      actions.appendChild(completeBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'ghost';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', () => deleteReminder(reminder.id));
      actions.appendChild(deleteBtn);
    } else if (reminder.status === 'triggered' && reminder.type === 'alarm') {
      const stopBtn = document.createElement('button');
      stopBtn.className = 'ghost';
      stopBtn.textContent = '停止';
      stopBtn.addEventListener('click', () => api.reminders.stopAlarm(reminder.id));
      actions.appendChild(stopBtn);
    }
    elements.reminderList.appendChild(item);
  }
}

async function completeReminder(id) {
  try {
    await api.reminders.complete(id);
    await refreshReminders();
  } catch (error) {
    showToast('エラー', 'リマインダーを完了できませんでした');
  }
}

async function deleteReminder(id) {
  try {
    await api.reminders.delete(id);
    await refreshReminders();
  } catch (error) {
    showToast('エラー', 'リマインダーを削除できませんでした');
  }
}

function openReminderDialog() {
  populateReminderSelect();
  elements.reminderDialog.classList.remove('hidden');
}

function closeReminderDialog() {
  elements.reminderDialog.classList.add('hidden');
  elements.reminderForm.reset();
}

function populateReminderSelect() {
  elements.reminderNoteSelect.innerHTML = '<option value="">未選択</option>';
  for (const note of state.notes.filter((n) => !n.deletedAt)) {
    const option = document.createElement('option');
    option.value = note.id;
    option.textContent = note.title || '無題のメモ';
    if (note.id === state.selectedNoteId) {
      option.selected = true;
    }
    elements.reminderNoteSelect.appendChild(option);
  }
}

function updateReminderNoteSelect() {
  if (!elements.reminderDialog.classList.contains('hidden')) {
    populateReminderSelect();
  }
}

async function handleReminderSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.reminderForm);
  const triggerAt = formData.get('triggerAt');
  if (!triggerAt) {
    showToast('エラー', '日時を入力してください');
    return;
  }
  const reminder = {
    title: formData.get('title') || undefined,
    message: formData.get('message') || undefined,
    triggerAt: new Date(triggerAt).toISOString(),
    type: formData.get('type') || 'notification',
    noteId: formData.get('noteId') || null
  };
  try {
    await api.reminders.create(reminder);
    closeReminderDialog();
    showToast('リマインダーを登録', '指定した時刻に通知します');
    await refreshReminders();
  } catch (error) {
    showToast('エラー', 'リマインダーの登録に失敗しました');
  }
}

function handleSearchInput(event) {
  const query = event.target.value;
  state.searchQuery = query;
  if (!query.trim()) {
    elements.searchResults.classList.add('hidden');
    elements.searchResults.innerHTML = '';
    return;
  }
  performSearch(query);
}

let searchTimer = null;
function performSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try {
      const results = await api.search(query);
      renderSearchResults(results, query);
    } catch (error) {
      console.error(error);
    }
  }, 150);
}


function renderSearchResults(results, query) {
  elements.searchResults.innerHTML = '';
  if (!results.length) {
    elements.searchResults.classList.remove('hidden');
    elements.searchResults.innerHTML = '<div class="meta">該当するメモがありません。</div>';
    return;
  }
  for (const result of results) {
    const item = document.createElement('div');
    item.className = 'search-result';
    item.innerHTML = `
      <h3>${result.title || '無題のメモ'}</h3>
      <div class="contexts">
        ${result.contexts
          .map((ctx) => `<div>${highlightQuery(ctx, query)}</div>`)
          .join('')}
      </div>
      <div class="meta">${result.deletedAt ? 'アーカイブ済み' : ''}</div>
    `;
    item.addEventListener('click', () => {
      elements.searchResults.classList.add('hidden');
      elements.searchInput.value = '';
      loadNote(result.id);
    });
    elements.searchResults.appendChild(item);
  }
  elements.searchResults.classList.remove('hidden');
}

function registerShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      createNote();
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      elements.searchInput.focus();
    }
    if (event.ctrlKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveCurrentNote(true);
      showToast('保存しました', 'メモを手動保存しました');
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      openHistory();
    }
  });
}

function handleReminderFired(reminder) {
  showToast('リマインダー', reminder.title || '予定の時間です');
  refreshReminders();
}

function attachEvents() {
  elements.noteTitle.addEventListener('input', () => {
    if (!state.currentNote || state.currentNote.deletedAt) return;
    state.currentNote.title = elements.noteTitle.value;
    scheduleAutoSave();
  });
  elements.noteContent.addEventListener('input', () => {
    if (!state.currentNote || state.currentNote.deletedAt) return;
    state.currentNote.content = elements.noteContent.value;
    scheduleAutoSave();
  });
  elements.deleteButton.addEventListener('click', deleteOrArchiveNote);
  elements.restoreButton.addEventListener('click', restoreNote);
  elements.newNoteButton.addEventListener('click', createNote);
  elements.openHistoryButton.addEventListener('click', openHistory);
  elements.closeHistoryButton.addEventListener('click', closeHistory);
  elements.searchInput.addEventListener('input', handleSearchInput);
  elements.toggleArchived.addEventListener('click', () => {
    state.showArchived = !state.showArchived;
    renderNotes();
  });
  elements.openReminderFormButton.addEventListener('click', openReminderDialog);
  elements.reminderCancel.addEventListener('click', closeReminderDialog);
  elements.reminderForm.addEventListener('submit', handleReminderSubmit);
}

async function initialize() {
  registerShortcuts();
  attachEvents();
  api.onReminderFired(handleReminderFired);
  await refreshNotes();
  await refreshReminders();
  const firstActive = state.notes.find((note) => !note.deletedAt);
  if (firstActive) {
    await loadNote(firstActive.id);
  } else if (state.notes.length) {
    await loadNote(state.notes[0].id);
  }
}


initialize();
