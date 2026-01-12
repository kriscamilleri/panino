// Test user fixtures
import bcrypt from 'bcryptjs';

export const testUsers = {
    alice: {
        id: 'user-alice-test-001',
        name: 'Alice',
        email: 'alice@test.com',
        password: 'password123',
        // Pre-computed bcrypt hash for 'password123' with salt rounds 10
        passwordHash: bcrypt.hashSync('password123', 10)
    },
    bob: {
        id: 'user-bob-test-002',
        name: 'Bob',
        email: 'bob@test.com',
        password: 'password456',
        passwordHash: bcrypt.hashSync('password456', 10)
    }
};

export function createTestUser(db, user) {
    db.prepare(`
        INSERT INTO users (id, name, email, password_hash, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
    `).run(user.id, user.name, user.email, user.passwordHash);
}
