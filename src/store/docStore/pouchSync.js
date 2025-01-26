import PouchDB from 'pouchdb-browser'

// We use a single localDB variable so it persists across calls.
// This gets initialized once in initPouchDB.
let localDB = null

/**
 * Initialize the local PouchDB instance.
 */
export function initPouchDB() {
  if (!localDB) {
    localDB = new PouchDB('pn-markdown-notes')
  }
}

/**
 * Loads the data from PouchDB into our store’s `data` ref.
 * @param {Ref} dataRef - the `data` ref from our store
 */
export async function loadFromPouchDB(dataRef) {
  if (!localDB) return
  try {
    const doc = await localDB.get('docStoreData')
    if (doc && doc.data) {
      dataRef.value = doc.data
    }
  } catch (err) {
    if (err.status === 404) {
      // docStoreData doesn't exist yet
      console.info('[PouchDB] No existing docStoreData found.')
    } else {
      console.error('Error loading from PouchDB:', err)
    }
  }
}

/**
 * Saves the given data to PouchDB (upserts the docStoreData document).
 * @param {object} storeData
 */
export async function saveToPouchDB(storeData) {
  if (!localDB) return
  try {
    const existing = await localDB.get('docStoreData')
    await localDB.put({
      ...existing,
      data: storeData
    })
  } catch (err) {
    if (err.status === 404) {
      // Create a new doc
      await localDB.put({
        _id: 'docStoreData',
        data: storeData
      })
    } else {
      console.error('Error saving to PouchDB:', err)
    }
  }
}

/**
 * Sets up live syncing to a remote CouchDB instance.
 */
export function initSync() {
  if (!localDB) return

  const remoteCouch = 'http://admin:password@127.0.0.1:5984/pn-markdown-notes'
  const remoteDB = new PouchDB(remoteCouch)

  localDB.sync(remoteDB, { live: true, retry: true })
    .on('change', info => {
      console.log('Sync change:', info)
    })
    .on('paused', err => {
      if (err) {
        console.error('Sync paused by error:', err)
      }
    })
    .on('active', () => {
      console.log('Sync resumed')
    })
    .on('denied', err => {
      console.error('Sync denied:', err)
    })
    .on('error', err => {
      console.error('Sync error:', err)
    })
}
