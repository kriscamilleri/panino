import fetch from 'node-fetch';

const COUCHDB_HOST = process.env.COUCHDB_HOST || '127.0.0.1';
const COUCHDB_PORT = process.env.COUCHDB_PORT || '5984';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
// const NODENAME = process.env.NODENAME || 'couchdb@localhost';

async function putConfig(path, value) {
    const url = `http://${COUCHDB_HOST}:${COUCHDB_PORT}/_node/_local/_config/${path}`;
    const authHeader = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64');

    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
        },
        body: JSON.stringify(value)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to PUT ${path}: ${res.status} - ${text}`);
    }
}

async function createDatabase(dbName) {
    const url = `http://${COUCHDB_HOST}:${COUCHDB_PORT}/${dbName}`;
    const authHeader = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64');

    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': authHeader,
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create database ${dbName}: ${res.status} - ${text}`);
    }
}

async function main() {
    console.log('Enabling CORS on CouchDB...');
    await putConfig('httpd/enable_cors', 'true');
    await putConfig('cors/origins', '*');
    await putConfig('cors/credentials', 'true');
    await putConfig('cors/methods', 'GET, PUT, POST, HEAD, DELETE');
    await putConfig('cors/headers', 'accept, authorization, content-type, origin, referer, x-csrf-token');
    console.log('CORS setup complete.');

    try{
        console.log('Creating _users database...');
        await createDatabase('_users');
        console.log('_users database created.');
    }
    catch(err){
        console.log('_users database already exists.');
    }

    // REMOVED: PerUser auto-creation lines to avoid conflicts with the signup service:
    // console.log('Configuring Couch PerUser...');
    // await putConfig('chttpd/require_valid_user', 'true');
    // await putConfig('couch_peruser/enable', 'true');
    // await putConfig('couch_peruser/delayed_commits', 'false');
    // console.log('Couch PerUser setup complete.');

    console.log('Configuring CouchDB session timeout...');
    await putConfig('couch_httpd_auth/timeout', '1209600');
    await putConfig('couch_httpd_auth/allow_persistent_cookies', 'true');
    console.log('Session timeout set to 2 weeks.');
    console.log('Done!');
}

main().catch(err => {
    console.error('Error during CouchDB setup:', err);
    process.exit(1);
});
