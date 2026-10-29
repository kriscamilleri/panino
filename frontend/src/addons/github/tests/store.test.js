import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/store/authStore', () => ({
    useAuthStore: () => ({ token: 'test-jwt' }),
}));

import { useGithubBackupStore } from '../store.js';

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('the GitHub add-on store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.restoreAllMocks();
    });

    it('loads backup status and repositories through authenticated requests', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy
            .mockResolvedValueOnce(jsonResponse({
                oauthConfigured: true,
                connected: true,
                username: 'octocat',
                repoFullName: 'octocat/panino-backup',
                isRunning: false,
            }))
            .mockResolvedValueOnce(jsonResponse({
                repos: [{ fullName: 'octocat/panino-backup', name: 'panino-backup' }],
            }));

        const store = useGithubBackupStore();
        await store.fetchStatus();
        await store.fetchRepos();

        expect(fetchSpy).toHaveBeenNthCalledWith(
            1,
            'http://localhost:8000/addons/github/status',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
            })
        );
        expect(fetchSpy).toHaveBeenNthCalledWith(
            2,
            'http://localhost:8000/addons/github/repos',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
            })
        );
        expect(store.status.username).toBe('octocat');
        expect(store.repos).toHaveLength(1);
        expect(store.isConnected).toBe(true);
    });

    it('starts OAuth, saves repo selection, and refreshes status after backup start', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy
            .mockResolvedValueOnce(jsonResponse({ authorizeUrl: 'https://github.com/login/oauth/authorize?state=abc' }))
            .mockResolvedValueOnce(jsonResponse({ repo: { fullName: 'octocat/panino-backup' } }))
            .mockResolvedValueOnce(jsonResponse({
                oauthConfigured: true,
                connected: true,
                repoFullName: 'octocat/panino-backup',
                isRunning: false,
            }))
            .mockResolvedValueOnce(jsonResponse({ started: true }, 202))
            .mockResolvedValueOnce(jsonResponse({
                oauthConfigured: true,
                connected: true,
                repoFullName: 'octocat/panino-backup',
                isRunning: true,
                currentStage: 'queued',
            }));

        const store = useGithubBackupStore();

        await expect(store.startConnect()).resolves.toBe('https://github.com/login/oauth/authorize?state=abc');
        await store.selectRepo('octocat/panino-backup');
        await store.runBackup();

        expect(fetchSpy).toHaveBeenNthCalledWith(
            1,
            'http://localhost:8000/addons/github/connect',
            expect.objectContaining({ method: 'POST' })
        );
        expect(fetchSpy).toHaveBeenNthCalledWith(
            2,
            'http://localhost:8000/addons/github/repo',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ repoFullName: 'octocat/panino-backup' }),
            })
        );
        expect(fetchSpy).toHaveBeenNthCalledWith(
            4,
            'http://localhost:8000/addons/github/run',
            expect.objectContaining({ method: 'POST' })
        );
        expect(store.status.isRunning).toBe(true);
        expect(store.selectedRepoFullName).toBe('octocat/panino-backup');
    });
});