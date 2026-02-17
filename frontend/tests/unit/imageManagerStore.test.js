import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../src/store/authStore.js', () => ({
    useAuthStore: () => ({ token: 'test-token' }),
}));

import { useImageManagerStore } from '../../src/store/imageManagerStore.js';

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('imageManagerStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.restoreAllMocks();
    });

    it('fetches images with query params and maps imageUrl/nextCursor', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
            images: [
                {
                    id: 'img-1',
                    filename: 'alpha.png',
                    mimeType: 'image/png',
                    sizeBytes: 12,
                    createdAt: '2026-02-17T12:00:00.000Z',
                    usageCount: 0,
                },
            ],
            nextCursor: 'cursor-2',
        }));

        const store = useImageManagerStore();
        await store.fetchImages({ limit: 10, cursor: 'cursor-1', search: 'alpha', sort: 'size_desc' });

        expect(fetchSpy).toHaveBeenCalledWith(
            'http://localhost:8000/images?limit=10&cursor=cursor-1&search=alpha&sort=size_desc',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            })
        );

        expect(store.images).toHaveLength(1);
        expect(store.images[0].imageUrl).toBe('http://localhost:8000/images/img-1');
        expect(store.nextCursor).toBe('cursor-2');
        expect(store.isLoading).toBe(false);
    });

    it('updates stats from /images/stats', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
            imageCount: 3,
            totalImageBytes: 204,
            quotaBytes: 1024,
        }));

        const store = useImageManagerStore();
        const stats = await store.fetchStats();

        expect(stats).toEqual({ imageCount: 3, totalImageBytes: 204, quotaBytes: 1024 });
        expect(store.stats).toEqual({ imageCount: 3, totalImageBytes: 204, quotaBytes: 1024 });
    });

    it('returns usage payload and defaults when usage missing', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy
            .mockResolvedValueOnce(jsonResponse({ usage: { count: 2, notes: [{ id: 'n1', title: 'N1' }] } }))
            .mockResolvedValueOnce(jsonResponse({}));

        const store = useImageManagerStore();

        await expect(store.fetchImageUsage('img-1')).resolves.toEqual({ count: 2, notes: [{ id: 'n1', title: 'N1' }] });
        await expect(store.fetchImageUsage('img-2')).resolves.toEqual({ count: 0, notes: [] });
    });

    it('sends delete and bulk-delete requests with expected payloads', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy
            .mockResolvedValueOnce(jsonResponse({ deleted: true, id: 'img-1' }))
            .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'img-1', deleted: true }] }));

        const store = useImageManagerStore();

        await store.deleteImage('img-1', true);
        expect(fetchSpy).toHaveBeenNthCalledWith(
            1,
            'http://localhost:8000/images/img-1',
            expect.objectContaining({
                method: 'DELETE',
                headers: expect.objectContaining({
                    Authorization: 'Bearer test-token',
                    'Content-Type': 'application/json',
                }),
                body: JSON.stringify({ force: true }),
            })
        );

        await store.bulkDelete(['img-1'], false);
        expect(fetchSpy).toHaveBeenNthCalledWith(
            2,
            'http://localhost:8000/images/bulk-delete',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer test-token',
                    'Content-Type': 'application/json',
                }),
                body: JSON.stringify({ ids: ['img-1'], force: false }),
            })
        );

        expect(store.isDeleting).toBe(false);
    });

    it('surfaces API errors and stores image fetch error message', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({ error: 'forbidden' }, 403)
        );

        const store = useImageManagerStore();

        await expect(store.fetchImages()).rejects.toThrow('forbidden');
        expect(store.error).toBe('forbidden');
        expect(store.isLoading).toBe(false);
    });
});
