We are building a note taking app. We're mid migration to a Sqlite+Powersync+Postgres implementation from a pouchdb+couchdb implementation. We're now reevaluating how to reduce complexity and fix existing issues given we have a proper relational db at our disposal now. 

I am frankly struggling with the added complexity postgres + powersync have introduced. Let's take a hard pivot - and instead synchronize sqlite db per user, using the approach documented below. 

# Prototype Instructions

Here’s a **tiny PoC** (Vue 3 + Node, plain JS) that syncs two SQLite DBs using **cr-sqlite**’s built‑in CRDT layer. Keep it rough & readable; expand later.

---

## 0. What you get

- **Browser:** `@vlcn.io/crsqlite-wasm` (SQLite + cr-sqlite in WASM).  
- **Server:** `better-sqlite3` + loadable `@vlcn.io/crsqlite` extension.  
- **Sync:** one `/sync` endpoint that:  
  - applies client changes (`INSERT INTO crsql_changes ...`)  
  - returns server changes via `SELECT * FROM crsql_changes WHERE db_version > ?`.  
- **Tables:** `notes` marked as a CRR via `SELECT crsql_as_crr('notes');`.

---

## 1. File tree

```
poc/
  package.json
  server.js
  public/
    index.html
```

---

## 2. package.json (minimal deps)

```json
{
  "type": "module",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "express": "^4.19.0",
    "@vlcn.io/crsqlite": "^0.16.0"
  },
  "devDependencies": {}
}
```

---

## 3. server.js (≈45 LOC)

```js
import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(path.join(__dirname, "notes.db"));
db.loadExtension(require.resolve("@vlcn.io/crsqlite/build/Release/crsqlite.node"));

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  SELECT crsql_as_crr('notes');
`);

app.post("/sync", (req, res) => {
  const { since = 0, changes = [] } = req.body || {};
  const tx = db.transaction(() => {
    if (changes.length) {
      const ins = db.prepare(
        \`INSERT INTO crsql_changes(table, pk, cid, val, col_version, db_version, site_id, seq, cl)
         VALUES (?,?,?,?,?,?,?,?,?)\`
      );
      for (const c of changes) ins.run(c.table, c.pk, c.cid, c.val, c.col_version, c.db_version, c.site_id, c.seq, c.cl);
    }
  });
  tx();

  const rows = db.prepare(
    "SELECT * FROM crsql_changes WHERE db_version > ? ORDER BY db_version"
  ).all(since);
  res.json(rows);
});

app.listen(3000, () => console.log("http://localhost:3000"));
```

---

## 4. public/index.html (Vue 3 + WASM, no build step)

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Notes PoC</title>
  <style>body{font-family:sans-serif;max-width:600px;margin:2rem auto}</style>
</head>
<body>
  <div id="app">
    <form @submit.prevent="save">
      <input v-model="draft" placeholder="note..." style="width:100%"/>
    </form>
    <ul>
      <li v-for="n in notes" :key="n.id">{{ n.body }}</li>
    </ul>
    <button @click="sync">sync</button>
  </div>

  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
  <script type="module">
    import initWasm from "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0";
    import wasmUrl from "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0/crsqlite.wasm?url";

    const sqlite = await initWasm(() => wasmUrl);
    const db = await sqlite.open("notes.db"); // persisted in OPFS/IDB
    db.exec(\`
      CREATE TABLE IF NOT EXISTS notes(
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      SELECT crsql_as_crr('notes');
    \`);

    const siteId = crypto.randomUUID();
    const qNotes = db.prepare("SELECT id, body, updated_at FROM notes ORDER BY updated_at DESC");
    const qInsert = db.prepare("INSERT OR REPLACE INTO notes(id, body, updated_at) VALUES (?, ?, ?)");
    const qChangesSince = db.prepare("SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = ?");
    const qAllChangesSince = db.prepare("SELECT * FROM crsql_changes WHERE db_version > ?");

    const app = Vue.createApp({
      setup() {
        const draft = Vue.ref("");
        const notes = Vue.ref([]);
        const clock = Vue.ref(Number(localStorage.clock || 0));

        function refresh(){ notes.value = qNotes.all(); }

        function save(){
          const now = Date.now();
          qInsert.run(crypto.randomUUID(), draft.value.trim(), now);
          draft.value = "";
          refresh();
        }

        async function sync(){
          // push
          const push = qChangesSince.all(clock.value, siteId);
          const res = await fetch("/sync", {
            method:"POST",
            headers:{ "content-type":"application/json" },
            body: JSON.stringify({ since: clock.value, changes: push })
          });
          const pull = await res.json();

          // apply
          const tx = db.transaction(()=>{
            const ins = db.prepare(\`INSERT INTO crsql_changes(table, pk, cid, val, col_version, db_version, site_id, seq, cl)
                                    VALUES (?,?,?,?,?,?,?,?,?)\`);
            for(const c of pull) ins.run(c.table,c.pk,c.cid,c.val,c.col_version,c.db_version,c.site_id,c.seq,c.cl);
          });
          tx();

          clock.value = Math.max(clock.value, ...pull.map(c=>c.db_version||0), ...push.map(c=>c.db_version||0));
          localStorage.clock = clock.value;
          refresh();
        }

        refresh();
        return { draft, notes, save, sync };
      }
    });
    app.mount("#app");
  </script>
</body>
</html>
```

---

## 5. Run it

```bash
npm i
npm start
# open http://localhost:3000 in 2 tabs (or 2 browsers)
# type notes offline, click "sync" when back online
```

---

### Notes / next steps

- This uses **`crsql_changes`** directly for both pull & apply—simple but fine for a PoC.  
- For automatic UI reactivity, look at `@vlcn.io/rx-tbl`, but polling/refresh keeps the code short.  
- Conflict review: cr-sqlite’s LWW is default; store “losers” in a side table via triggers if you need an audit trail.  
- In production: handle auth, chunk large change sets, add compression, and guard `loadExtension` behind config.