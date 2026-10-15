import { describe, test, expect } from 'vitest';
import { getGameOrigin } from './game-origin.js';

const loc = (hostname) => ({ hostname, origin: `https://${hostname}` });

describe('getGameOrigin', () => {
    test.each(['www.milkywayidle.com', 'milkywayidle.com', 'test.milkywayidle.com'])(
        'uses the main domain on %s',
        (hostname) => {
            expect(getGameOrigin(loc(hostname))).toBe('https://www.milkywayidle.com');
        }
    );

    test.each(['www.milkywayidlecn.com', 'milkywayidlecn.com'])(
        'uses the page origin on the CN mirror %s',
        (hostname) => {
            expect(getGameOrigin(loc(hostname))).toBe(`https://${hostname}`);
        }
    );

    test('does not treat look-alike hosts as the CN mirror', () => {
        expect(getGameOrigin(loc('milkywayidlecn.com.evil.example'))).toBe('https://www.milkywayidle.com');
        expect(getGameOrigin(loc('notmilkywayidlecn.com'))).toBe('https://www.milkywayidle.com');
    });

    test('falls back to the main domain without a location', () => {
        expect(getGameOrigin(null)).toBe('https://www.milkywayidle.com');
    });
});
