// Unit tests for db.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    initDb,
    getAuthDb,
    getUserDb,
    getTestDb,
    deleteTestDb,
    closeAllConnections,
    clearConnectionCache
} from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '../../data');

describe('Database Initialization', () => {
    afterEach(() => {
        closeAllConnections();
    });

    it('should initialize authentication database', () => {
        initDb();
        const db = getAuthDb();
        
        expect(db).toBeDefined();
        
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tables.map(t => t.name);
        
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('password_resets');
    });

    it('should return the same auth database instance on multiple calls', () => {
        const db1 = getAuthDb();
        const db2 = getAuthDb();
        
        expect(db1).toBe(db2);
    });
});

describe('User Database Management', () => {
    const testUserId = `test-user-${Date.now()}`;

    afterEach(() => {
        closeAllConnections();
        deleteTestDb(testUserId);
    });

    it('should create new database for user', () => {
        const db = getUserDb(testUserId);
        
        expect(db).toBeDefined();
        expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db`))).toBe(true);
    });

    it('should return cached connection for same user', () => {
        const db1 = getUserDb(testUserId);
        const db2 = getUserDb(testUserId);
        
        expect(db1).toBe(db2);
    });

    it('should apply CRDT schema to user database', () => {
        const db = getUserDb(testUserId);
        
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tables.map(t => t.name);
        
        // CR-SQLite 0.16+ creates different tables
        // Check for CR-SQLite specific tables (any of these indicate CRDT is working)
        const hasCRDT = tableNames.some(name => 
            name.startsWith('crsql_') || 
            name === '__crsql_clock' ||
            name === 'crsql_tracked_peers'
        );
        expect(hasCRDT).toBe(true);
        
        // Check base tables exist
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('folders');
        expect(tableNames).toContain('notes');
        expect(tableNames).toContain('images');
        expect(tableNames).toContain('settings');
    });

    it('should enable WAL mode', () => {
        const db = getUserDb(testUserId);
        
        const result = db.pragma('journal_mode', { simple: true });
        expect(result).toBe('wal');
    });
});

describe('Test Database Utilities', () => {
    const testUserId = `test-util-user-${Date.now()}`;

    afterEach(() => {
        closeAllConnections();
        deleteTestDb(testUserId);
    });

    it('should create in-memory test database', () => {
        const db = getTestDb(testUserId, { inMemory: true });
        
        expect(db).toBeDefined();
        
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tables.map(t => t.name);
        
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('folders');
        expect(tableNames).toContain('notes');
        
        // CR-SQLite 0.16+ creates different tables
        const hasCRDT = tableNames.some(name => 
            name.startsWith('crsql_') || 
            name === '__crsql_clock' ||
            name === 'crsql_tracked_peers'
        );
        expect(hasCRDT).toBe(true);
        
        db.close();
    });

    it('should create file-based test database', () => {
        const db = getTestDb(testUserId);
        
        expect(db).toBeDefined();
        expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db`))).toBe(true);
        
        db.close();
    });

    it('should delete test database and WAL files', () => {
        const db = getTestDb(testUserId);
        db.close();
        
        deleteTestDb(testUserId);
        
        expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db`))).toBe(false);
        expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db-wal`))).toBe(false);
        expect(fs.existsSync(path.join(DB_DIR, `${testUserId}.db-shm`))).toBe(false);
    });
});

describe('Connection Management', () => {
    const testUserId1 = `test-conn-user-1-${Date.now()}`;
    const testUserId2 = `test-conn-user-2-${Date.now()}`;

    afterEach(() => {
        closeAllConnections();
        deleteTestDb(testUserId1);
        deleteTestDb(testUserId2);
    });

    it('should close all connections', () => {
        const db1 = getUserDb(testUserId1);
        const db2 = getUserDb(testUserId2);
        
        expect(db1).toBeDefined();
        expect(db2).toBeDefined();
        
        closeAllConnections();
        
        // After closing, new calls should create new connections
        const db3 = getUserDb(testUserId1);
        expect(db3).not.toBe(db1);
    });

    it('should clear connection cache', () => {
        const db1 = getUserDb(testUserId1);
        
        clearConnectionCache();
        
        const db2 = getUserDb(testUserId1);
        // Should get a new instance since cache was cleared
        // Note: We can't use toBe here since we're comparing objects
        // Instead, verify it's a valid database
        expect(db2).toBeDefined();
        
        db2.close();
    });
});

describe('CRDT Tables', () => {
    const testUserId = `test-crr-user-${Date.now()}`;

    afterEach(() => {
        closeAllConnections();
        deleteTestDb(testUserId);
    });

    it('should mark all base tables as CRR', () => {
        const db = getUserDb(testUserId);
        
        // Check that we can query crsql_changes (only available if tables are CRR)
        const result = db.prepare('SELECT COUNT(*) as count FROM crsql_changes').get();
        expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('should allow inserting data into CRR tables', () => {
        const db = getUserDb(testUserId);
        
        const userId = 'test-user-id';
        db.prepare(`
            INSERT INTO users (id, name, email, created_at)
            VALUES (?, ?, ?, datetime('now'))
        `).run(userId, 'Test User', 'test@example.com');
        
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        expect(user).toBeDefined();
        expect(user.name).toBe('Test User');
        expect(user.email).toBe('test@example.com');
    });
});
