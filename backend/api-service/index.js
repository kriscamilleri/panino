// /backend/api-service/index.js
import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';
const PORT = process.env.PORT || 8000;

//<editor-fold desc="Existing Auth Routes">
// Health check
app.get('/', (req, res) => {
    res.send('API service is running');
});

// POST /signup - Create a new user
app.post('/signup', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const password_hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
            [email, password_hash]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // unique_violation
            return res.status(409).json({ error: 'User with this email already exists' });
        }
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /login - Authenticate a user and return a JWT
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const result = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { user_id: user.id },
            JWT_SECRET,
            { expiresIn: '7d', audience: 'powersync' }
        );

        res.json({ token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, { audience: 'powersync' }, (err, user) => {
        if (err) {
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

// GET /me - A protected route to validate a token
app.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.user_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
//</editor-fold>

// --- START: POWER-SYNC WRITE-BACK LOGIC ---

// In-memory store for the last processed oplog ID.
// For production, this should be stored persistently in the database.
let lastOplogId = 0;

/**
 * Builds a dynamic SQL query for INSERT or UPDATE operations.
 * This is a simplified helper; a production app should use a robust query builder.
 * @param {string} table The table name to operate on.
 * @param {object} data The object containing column-value pairs.
 * @param {string} [rowId] If provided, generates an UPDATE statement for this row ID.
 * @returns {{text: string, values: any[]}|null}
 */
function buildUpsertQuery(table, data, rowId) {
    const keys = Object.keys(data);
    if (keys.length === 0) {
        return null;
    }

    if (rowId) {
        // UPDATE
        const setClause = keys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');
        const values = [...Object.values(data), rowId];
        const text = `UPDATE "${table}" SET ${setClause} WHERE id = $${keys.length + 1}`;
        return { text, values };
    } else {
        // INSERT
        const columns = keys.map(k => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const values = Object.values(data);
        const text = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`;
        return { text, values };
    }
}

/**
 * Processes a single entry from the PowerSync oplog.
 * @param {object} entry The oplog entry.
 */
async function applyOplogEntry(entry) {
    const { op, table, row_id, data, changed_data } = entry;
    // We only want to write back to our main application tables.
    const validTables = ['notes', 'folders'];
    if (!validTables.includes(table)) {
        return;
    }

    console.log(`Applying op: ${op}, table: ${table}, row_id: ${row_id}`);

    try {
        switch (op) {
            case 'PUT': { // INSERT
                const fullData = JSON.parse(data);
                const query = buildUpsertQuery(table, fullData);
                if (query) {
                    await pool.query(query.text, query.values);
                }
                break;
            }
            case 'PATCH': { // UPDATE
                const changes = JSON.parse(changed_data);
                const query = buildUpsertQuery(table, changes, row_id);
                if (query) {
                    await pool.query(query.text, query.values);
                }
                break;
            }
            case 'DELETE': { // DELETE
                await pool.query(`DELETE FROM "${table}" WHERE id = $1`, [row_id]);
                break;
            }
        }
    } catch (error) {
        console.error(`Failed to apply oplog entry ${entry.id} for table ${table}:`, error);
    }
}

/**
 * Periodically polls the PowerSync oplog for new entries and processes them.
 */
async function processOplog() {
    try {
        // Query for new entries since the last processed one.
        const result = await pool.query(
            'SELECT * FROM powersync.ps_oplog WHERE id > $1 ORDER BY id ASC LIMIT 100',
            [lastOplogId]
        );

        if (result.rows.length > 0) {
            console.log(`[Write-Back] Processing ${result.rows.length} new oplog entries...`);
            for (const entry of result.rows) {
                await applyOplogEntry(entry);
                lastOplogId = entry.id; // Update checkpoint
            }
            console.log(`[Write-Back] Oplog processing finished. Last ID: ${lastOplogId}`);
        }
    } catch (error) {
        // This specific error code means the `ps_oplog` table doesn't exist yet,
        // which is normal on first startup before PowerSync creates it.
        if (error.code !== '42P01') {
            console.error('[Write-Back] Error polling oplog:', error);
        }
    }
}

// Start the oplog poller
const POLLING_INTERVAL = 2000; // 2 seconds
console.log(`Starting PowerSync oplog poller with ${POLLING_INTERVAL}ms interval...`);
setInterval(processOplog, POLLING_INTERVAL);

// --- END: POWER-SYNC WRITE-BACK LOGIC ---

app.listen(PORT, () => {
    console.log(`API service (auth + write-back) listening on port ${PORT}`);
});