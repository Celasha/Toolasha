#!/usr/bin/env node

/**
 * Warms jsDelivr's cache for the library files a userscript @requires.
 *
 * jsDelivr fetches a never-before-seen GitHub commit from GitHub on the first request, and the
 * ~2 MB libraries can take longer than Tampermonkey waits. Running this right after a release
 * means users who update straight away hit a warm cache.
 *
 * Usage: node warm-jsdelivr-cache.js <path-to-userscript>
 * Best effort: exits 0 even if some files never warm (the caller treats that as a warning).
 */

import { readFileSync, realpathSync } from 'fs';
import { pathToFileURL } from 'url';

const ATTEMPTS = 12;
const RETRY_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * @param {string} userscriptText - Contents of the userscript with its metadata block
 * @returns {string[]} jsDelivr GitHub-hosted @require URLs, in order, without duplicates
 */
export function extractJsDelivrGithubUrls(userscriptText) {
    const urls = [];
    for (const line of userscriptText.split('\n')) {
        const match = line.match(/^\/\/\s*@require\s+(https:\/\/cdn\.jsdelivr\.net\/gh\/\S+)\s*$/);
        if (match && !urls.includes(match[1])) urls.push(match[1]);
    }
    return urls;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Request one URL until it answers 200 with a body, or attempts run out.
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, attempts?: number, delayMs?: number, log?: (message: string) => void}} [options]
 * @returns {Promise<boolean>} True once the URL was served
 */
export async function warmUrl(
    url,
    { fetchImpl = fetch, attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS, log = console.log } = {}
) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            if (response.ok) {
                const body = await response.text();
                if (body.length > 0) {
                    log(`warm (attempt ${attempt}): ${url}`);
                    return true;
                }
            }
            log(`not ready (attempt ${attempt}, status ${response.status}): ${url}`);
        } catch (error) {
            log(`not ready (attempt ${attempt}, ${error.name}): ${url}`);
        }
        if (attempt < attempts) await sleep(delayMs);
    }
    return false;
}

async function main() {
    const userscriptPath = process.argv[2];
    if (!userscriptPath) throw new Error('Usage: warm-jsdelivr-cache.js <path-to-userscript>');

    const urls = extractJsDelivrGithubUrls(readFileSync(userscriptPath, 'utf8'));
    if (urls.length === 0) throw new Error(`No jsDelivr @require URLs found in ${userscriptPath}`);

    const results = await Promise.all(urls.map((url) => warmUrl(url)));
    const failed = urls.filter((_, index) => !results[index]);
    if (failed.length > 0) {
        console.error(
            `[warm-jsdelivr-cache] ${failed.length} of ${urls.length} files never warmed:\n${failed.join('\n')}`
        );
        process.exitCode = 1;
        return;
    }
    console.log(`All ${urls.length} library files are cached on jsDelivr.`);
}

// realpath: import.meta.url is symlink-resolved, argv[1] is not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((error) => {
        console.error(`[warm-jsdelivr-cache] ${error.message}`);
        process.exitCode = 1;
    });
}
