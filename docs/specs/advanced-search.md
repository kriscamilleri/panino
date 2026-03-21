# Advanced Search — Spec

> Full-text search across note content, titles, front-matter variables, and tags.
> Status: Draft — 2026-03-21

---

## 1) Summary

Add a comprehensive search system that lets users find notes by content, title, front-matter variables, or tags. Results are ranked by relevance and displayed in a dedicated search panel with highlighted matches.

---

## 2) Goals

1. Search across note **body content** (full-text).
2. Search by note **title**.
3. Search by **front-matter variable** keys and values.
4. Search by **tags** (depends on tag system spec).
5. Support combined/filtered queries (e.g. content search scoped to a tag).
6. Provide fast, responsive results with match highlighting.

## Non-Goals

- No fuzzy/typo-tolerant search in v1 (exact substring/token matching).
- No search within revision history.
- No saved searches or search bookmarks.
- No server-side search — all search runs client-side against the local SQLite DB.

---

## 3) Query Syntax

### Simple Search

Plain text input matches against title and content simultaneously.

```
meeting notes
```

### Field-Scoped Search

Prefix modifiers to target specific fields:

| Prefix | Searches | Example |
|--------|----------|---------|
| `title:` | Note title only | `title:kickoff` |
| `content:` | Note body only | `content:action items` |
| `tag:` | Tag names | `tag:urgent` |
| `var:` | Front-matter variable values | `var:author:Jane` |
| `in:` | Folder path | `in:Projects/2026` |

### Combining Filters

Multiple terms are AND-ed:

```
tag:work title:meeting content:budget
```

### Quoted Phrases

Exact phrase matching:

```
"quarterly review"
```

---

## 4) UX & UI

### Search Entry Point

- Keyboard shortcut: `Ctrl+Shift+F` / `Cmd+Shift+F`.
- Search icon button in the sidebar header.
- Opens a search panel that replaces or overlays the sidebar file list.

### Search Panel

- **Search input** at the top with a clear button.
- **Filter chips** below the input for quick scoping: All, Title, Content, Tags, Variables.
- **Results list**: Each result shows:
  - Note title (clickable — opens the note).
  - Folder path (muted).
  - Matched snippet with search term highlighted (max 150 chars of context).
  - Matching tags displayed as colored chips (if tag filter active).
- **Result count** displayed below the input.
- Results update as the user types (debounced, ~300ms).

### Empty / No Results State

- Before any query: show recent searches (last 5, stored in `localStorage`).
- No results: "No notes match your search" with suggestion to broaden query.

---

## 5) Implementation

### Client-Side SQLite Search

Use SQLite's built-in capabilities on the local WASM database:

```sql
-- Content/title search using LIKE (v1)
SELECT id, title, content, folder_id
FROM notes
WHERE title LIKE '%' || ? || '%'
   OR content LIKE '%' || ? || '%'
ORDER BY updated_at DESC
LIMIT 50;
```

### Future: FTS5

For better performance and ranking, migrate to SQLite FTS5:

```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, content=notes, content_rowid=rowid);
```

This is deferred to a follow-up iteration due to CRR compatibility considerations.

### Front-Matter Parsing

- Parse `---` block from each note's content using existing YAML parser.
- Extract variables and tags for field-scoped queries.
- Consider caching parsed front-matter in a separate indexed column or table for performance.

### Search Result Ranking (v1, simple)

1. Exact title match → highest.
2. Title contains term → high.
3. Content contains term → normal.
4. Sort ties by `updated_at` descending.

---

## 6) Performance Considerations

- Debounce input to avoid excessive queries.
- Limit results to 50 per query; paginate or "show more" for overflow.
- For workspaces with 1000+ notes, FTS5 migration becomes necessary.
- Cache parsed front-matter to avoid re-parsing YAML on every search.

---

## 7) Security Considerations

- Search input sanitized before use in SQL (parameterized queries only).
- No search data sent to the server — entirely client-side.
