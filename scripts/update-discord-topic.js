#!/usr/bin/env node

/**
 * Sets the #general channel description (topic) to the latest released version.
 * Runs from the release workflow after the build is published.
 *
 * Env: DISCORD_BOT_TOKEN, DISCORD_GENERAL_CHANNEL_ID, VERSION, GITHUB_REPOSITORY
 * Flags: --dry-run  print the topic without calling Discord
 */

import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_TOPIC_LENGTH = 1024;

/**
 * @param {string} version - Release version, with or without a leading "v"
 * @param {string} repository - "owner/name"
 * @returns {string} Topic text
 */
export function buildTopic(version, repository) {
    const cleanVersion = String(version).trim().replace(/^v/, '');
    if (!cleanVersion) throw new Error('VERSION is empty');
    const topic = `Toolasha v${cleanVersion} — latest release: https://github.com/${repository}/releases/tag/v${cleanVersion}`;
    if (topic.length > MAX_TOPIC_LENGTH) {
        throw new Error(`Topic is ${topic.length} characters; Discord allows ${MAX_TOPIC_LENGTH}`);
    }
    return topic;
}

const FAILURE_HINTS = {
    401: 'the bot token was rejected (reset in the developer portal? update DISCORD_BOT_TOKEN)',
    403: 'the bot lacks Manage Channels for this channel',
    404: 'the channel was not found (check DISCORD_GENERAL_CHANNEL_ID)',
};

/**
 * @param {{token: string, channelId: string, topic: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<void>} Resolves on success, throws with a readable reason otherwise
 */
export async function setChannelTopic({ token, channelId, topic, fetchImpl = fetch }) {
    const response = await fetchImpl(`${DISCORD_API}/channels/${channelId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
    });
    if (!response.ok) {
        const hint = FAILURE_HINTS[response.status] || 'unexpected response';
        throw new Error(`Discord returned ${response.status}: ${hint}`);
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const { DISCORD_BOT_TOKEN, DISCORD_GENERAL_CHANNEL_ID, VERSION, GITHUB_REPOSITORY } = process.env;

    const topic = buildTopic(VERSION, GITHUB_REPOSITORY || 'Celasha/Toolasha');
    if (dryRun) {
        console.log(`[dry run] would set the topic to: ${topic}`);
        return;
    }
    if (!DISCORD_BOT_TOKEN || !DISCORD_GENERAL_CHANNEL_ID) {
        throw new Error('DISCORD_BOT_TOKEN and DISCORD_GENERAL_CHANNEL_ID are required');
    }

    await setChannelTopic({ token: DISCORD_BOT_TOKEN, channelId: DISCORD_GENERAL_CHANNEL_ID, topic });
    console.log(`Set the #general topic to: ${topic}`);
}

// realpath: import.meta.url is already symlink-resolved, argv[1] is not (e.g. macOS /var -> /private/var).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((error) => {
        console.error(`[update-discord-topic] ${error.message}`);
        process.exit(1);
    });
}
