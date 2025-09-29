const escapeStringRegexp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class SearchService {
  constructor(dataStore) {
    this.dataStore = dataStore;
  }

  search(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return [];
    }
    const safeQuery = escapeStringRegexp(trimmed);
    const regex = new RegExp(safeQuery, 'gi');
    const notes = this.dataStore.listNotes({ includeDeleted: true });
    const results = [];

    for (const meta of notes) {
      const content = this.dataStore.readNoteContent(meta.id);
      const haystack = `${meta.title}\n${content}`;
      regex.lastIndex = 0;
      const contexts = [];
      let match;
      while ((match = regex.exec(haystack)) !== null) {
        const start = Math.max(0, match.index - 60);
        const end = Math.min(haystack.length, match.index + trimmed.length + 60);
        const snippet = haystack
          .slice(start, end)
          .replace(/\s+/g, ' ')
          .trim();
        contexts.push(snippet);
        if (contexts.length >= 5) {
          break;
        }
      }
      if (contexts.length) {
        results.push({
          id: meta.id,
          title: meta.title,
          updatedAt: meta.updatedAt,
          deletedAt: meta.deletedAt || null,
          contexts
        });
      }
    }

    return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
}

module.exports = SearchService;
