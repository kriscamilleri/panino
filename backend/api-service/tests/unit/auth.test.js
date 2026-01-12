// Unit tests for auth.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../../auth.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

describe('authenticateToken middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            headers: {},
            query: {},
            user: null
        };
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
        next = vi.fn();
    });

    it('should authenticate valid token in Authorization header', () => {
        const token = jwt.sign({ user_id: 'test-user-123' }, JWT_SECRET);
        req.headers.authorization = `Bearer ${token}`;
        
        authenticateToken(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.user_id).toBe('test-user-123');
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should authenticate valid token in query param', () => {
        const token = jwt.sign({ user_id: 'test-user-456' }, JWT_SECRET);
        req.query.token = token;
        
        authenticateToken(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.user_id).toBe('test-user-456');
    });

    it('should reject missing token', () => {
        authenticateToken(req, res, next);
        
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: No token provided' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid token', () => {
        req.headers.authorization = 'Bearer invalid-token-string';
        
        authenticateToken(req, res, next);
        
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Invalid token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired token', () => {
        // Create a token that expired 1 hour ago
        const expiredToken = jwt.sign(
            { user_id: 'test-user-789', exp: Math.floor(Date.now() / 1000) - 3600 },
            JWT_SECRET
        );
        req.headers.authorization = `Bearer ${expiredToken}`;
        
        authenticateToken(req, res, next);
        
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('should prefer Authorization header over query param', () => {
        const headerToken = jwt.sign({ user_id: 'header-user' }, JWT_SECRET);
        const queryToken = jwt.sign({ user_id: 'query-user' }, JWT_SECRET);
        
        req.headers.authorization = `Bearer ${headerToken}`;
        req.query.token = queryToken;
        
        authenticateToken(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(req.user.user_id).toBe('header-user');
    });

    it('should handle malformed Authorization header', () => {
        req.headers.authorization = 'InvalidFormat token';
        
        authenticateToken(req, res, next);
        
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('should handle token without user_id claim', () => {
        const token = jwt.sign({ some_other_field: 'value' }, JWT_SECRET);
        req.headers.authorization = `Bearer ${token}`;
        
        authenticateToken(req, res, next);
        
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        // Should still set the user object even if user_id is missing
    });
});
