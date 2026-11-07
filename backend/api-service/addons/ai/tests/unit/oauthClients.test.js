// The real Client ID Metadata Document fetcher (docs/specs/active/ai-integration.md §6.2, §11):
// the client_id URL comes from whoever starts a sign-in, so it must never reach
// a private address. The integration tests replace the fetcher; these do not.
import { describe, expect, it } from 'vitest';
import { fetchClientMetadata } from '../../oauthClients.js';

const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('fetchClientMetadata', () => {
    it.each([
        'https://127.0.0.1/client.json',
        'https://10.0.0.5/client.json',
        'https://192.168.1.10/client.json',
        'https://169.254.169.254/latest/meta-data',
        'https://[::1]/client.json',
        'https://[fd00::1]/client.json',
        'https://0.0.0.0/client.json',
    ])('refuses the private address in %s', async (url) => {
        const result = await fetchClientMetadata(url, { lookup: resolvesTo('93.184.216.34') });
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    });

    it('refuses a public name that resolves to a private address', async () => {
        const result = await fetchClientMetadata('https://client.example/oauth.json', { lookup: resolvesTo('10.1.2.3') });
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    });

    it('refuses a name when any of its addresses is private', async () => {
        const result = await fetchClientMetadata('https://client.example/oauth.json', { lookup: resolvesTo('93.184.216.34', '127.0.0.1') });
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    });

    it('refuses plain http and credentials in the URL', async () => {
        expect(await fetchClientMetadata('http://client.example/oauth.json', { lookup: resolvesTo('93.184.216.34') }))
            .toMatchObject({ ok: false, reason: 'blocked' });
        expect(await fetchClientMetadata('https://user:pw@client.example/oauth.json', { lookup: resolvesTo('93.184.216.34') }))
            .toMatchObject({ ok: false, reason: 'blocked' });
    });
});
