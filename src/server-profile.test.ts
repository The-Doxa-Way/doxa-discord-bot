/**
 * The Doxa server's public text is code-owned (src/server-profile.ts) and
 * synced idempotently: read each item, write only what differs, report a
 * missing permission instead of writing. The text obeys the brand hard rules
 * (Hard Rule 15: the descriptor leads; no em dashes; Rules 13 and 14).
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GUILD_DESCRIPTION,
  WELCOME_POST_TEMPLATE,
  WELCOME_TOPIC,
  renderWelcomePost,
  syncServerProfile,
  type PinnedPost,
  type ServerPort,
} from './server-profile.js';

const BOT = '1507038958318518352';
const IDS = { encouragement: '11', stories: '12', prayer: '13', 'the-doxa-way': '14' };

function fakePort(over: Partial<ServerPort> = {}, pins: PinnedPost[] = []) {
  const writes: string[] = [];
  const port: ServerPort = {
    botId: BOT,
    guildDescription: GUILD_DESCRIPTION,
    canManageGuild: true,
    setGuildDescription: async (t) => { writes.push(`description:${t}`); },
    welcomeTopic: WELCOME_TOPIC,
    canManageChannel: true,
    setWelcomeTopic: async (t) => { writes.push(`topic:${t}`); },
    canSend: true,
    canPin: true,
    welcomePins: async () => pins,
    editMessage: async (id, c) => { writes.push(`edit:${id}:${c}`); },
    postAndPin: async (c) => { writes.push(`post:${c}`); },
    channelIds: IDS,
    ...over,
  };
  return { port, writes };
}

const current = renderWelcomePost(IDS);

test('everything already matches: no writes', async () => {
  const { port, writes } = fakePort({}, [{ id: 'p1', authorId: BOT, content: current }]);
  assert.deepEqual(await syncServerProfile(port), { description: 'ok', topic: 'ok', pin: 'ok' });
  assert.deepEqual(writes, []);
});

test('stale text is replaced with the code-owned text, and the bot edits its own oldest pin', async () => {
  const pins = [
    { id: 'new', authorId: 'someone', content: 'a member pin' },
    { id: 'old', authorId: BOT, content: 'Know the God who speaks. Hey, glad you are here.' },
  ];
  const { port, writes } = fakePort({ guildDescription: 'old', welcomeTopic: null }, pins);
  assert.deepEqual(await syncServerProfile(port), { description: 'updated', topic: 'updated', pin: 'updated' });
  assert.deepEqual(writes, [`description:${GUILD_DESCRIPTION}`, `topic:${WELCOME_TOPIC}`, `edit:old:${current}`]);
});

test('no bot pin: post and pin a new one', async () => {
  const { port, writes } = fakePort({}, [{ id: 'h', authorId: 'garth', content: 'old welcome' }]);
  assert.equal((await syncServerProfile(port)).pin, 'posted');
  assert.deepEqual(writes, [`post:${current}`]);
});

test('a missing permission is reported and nothing is written', async () => {
  const { port, writes } = fakePort({
    guildDescription: 'old', canManageGuild: false,
    welcomeTopic: 'old', canManageChannel: false,
    canPin: false,
  });
  assert.deepEqual(await syncServerProfile(port), {
    description: 'missing permission: ManageGuild',
    topic: 'missing permission: ManageChannels',
    pin: 'missing permission: PinMessages',
  });
  assert.deepEqual(writes, []);
});

test('an API error on one item is reported and the others still sync', async () => {
  const { port, writes } = fakePort({
    guildDescription: 'old',
    setGuildDescription: async () => { throw new Error('Missing Access'); },
    welcomeTopic: 'old',
  }, [{ id: 'p', authorId: BOT, content: current }]);
  assert.deepEqual(await syncServerProfile(port), { description: 'failed: Missing Access', topic: 'updated', pin: 'ok' });
  assert.deepEqual(writes, [`topic:${WELCOME_TOPIC}`]);
});

test('channel names become links when the channel exists, else plain text', () => {
  assert.match(renderWelcomePost(IDS), /\*\*<#11>\*\* send DoxaBot/);
  assert.match(renderWelcomePost({}), /\*\*#encouragement\*\* send DoxaBot/);
  assert.doesNotMatch(renderWelcomePost(IDS), /\{#/);
});

test('the text obeys the brand hard rules and the Discord limits', () => {
  const DESCRIPTOR = 'Record and hold prophetic encouragement for decades.';
  assert.ok(GUILD_DESCRIPTION.startsWith(DESCRIPTOR));
  assert.ok(WELCOME_TOPIC.startsWith(DESCRIPTOR));
  assert.ok(WELCOME_POST_TEMPLATE.startsWith(`**${DESCRIPTOR}**`));
  assert.ok(GUILD_DESCRIPTION.includes('Doxa: Prophetic Encouragement'));
  assert.ok(WELCOME_TOPIC.length <= 1024);
  assert.ok(renderWelcomePost({}).length <= 2000);
  for (const text of [GUILD_DESCRIPTION, WELCOME_TOPIC, WELCOME_POST_TEMPLATE]) {
    assert.doesNotMatch(text, /[—–]/, 'no em or en dashes');
    assert.doesNotMatch(text, /know the god (who|that) speaks/i, 'Hard Rule 15');
    assert.doesNotMatch(text, /\bwords?\b/i, 'Hard Rule 13');
    assert.doesNotMatch(text, /\bburn/i, 'Hard Rule 14');
  }
});
