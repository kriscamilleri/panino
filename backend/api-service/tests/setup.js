// Test setup file - runs before all tests
import { beforeEach, afterEach } from 'vitest';
import { closeAllConnections } from '../db.js';

// Set test environment variables
process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
process.env.NODE_ENV = 'test';

// Clean up database connections after each test
afterEach(() => {
    closeAllConnections();
});
