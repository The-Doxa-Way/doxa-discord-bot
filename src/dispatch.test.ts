/**
 * GDPR Art. 9 consent gate. Fake interactions and messages, a fake Doxa MCP
 * client that records every call, and an in-memory consent store.
 *
 *   - no consent: /encourage, /weigh, /promise, /scripture and @mentions send
 *     nothing to the MCP; the user gets the notice with an "I agree" button
 *   - pressing "I agree" stores consent
 *   - with consent, the text is forwarded (the gate opens)
 *   - /privacy withdraws: consent is cleared
 *   - a store read error counts as no consent
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DoxaClient } from '@thedoxaway/mcp-client';
import type { Interaction, Message } from 'discord.js';

import { handleInteraction, mentionConsentGate } from './dispatch.js';
import {
  CONSENT_BUTTON_ID,
  CONSENT_NOTICE,
  CONSENT_THANKS,
  CONSENT_VERSION,
  PRIVACY_URL,
  SAVE_FAILED_TEXT,
  WITHDRAWN_TEXT,
  type ConsentStore,
} from './consent.js';

const USER = '123456789012345678';

function memoryStore(initial: string[] = []) {
  const consented = new Set(initial);
  const log: string[] = [];
  const store: ConsentStore = {
    async has(id) { log.push(`has:${id}`); return consented.has(id); },
    async grant(id) { log.push(`grant:${id}:${CONSENT_VERSION}`); consented.add(id); },
    async withdraw(id) { log.push(`withdraw:${id}`); consented.delete(id); return 2; },
  };
  return { store, consented, log };
}

function fakeDoxa() {
  const calls: string[] = [];
  const reply = { text: 'Psalm 34:18', scriptures: [], movement: undefined };
  const api = {
    encourage: async (situation: string) => { calls.push(`encourage:${situation}`); return reply; },
    scripture: async (ref: string) => { calls.push(`scripture:${ref}`); return { reference: ref, link: 'https://doxa.app', translation: 'BSB', text: 'x' }; },
    wayMovement: async () => { calls.push('wayMovement'); return { movements: [], northStar: '', fiveVerbDailyPractice: [], doxaWayCanonicalUrl: '' }; },
  };
  const doxa = { withCaller: () => api } as unknown as DoxaClient;
  return { doxa, calls };
}

type Sent = { content?: string; components?: { toJSON(): unknown }[]; flags?: unknown };

function fakeCommand(commandName: string, options: Record<string, string>) {
  const sent: Sent[] = [];
  const i = {
    commandName,
    user: { id: USER },
    replied: false,
    deferred: false,
    options: { getString: (k: string) => options[k] ?? null },
    isAutocomplete: () => false,
    isButton: () => false,
    isChatInputCommand: () => true,
    async reply(p: Sent) { sent.push(p); i.replied = true; },
    async deferReply() { i.deferred = true; },
    async editReply(p: Sent | string) { sent.push(typeof p === 'string' ? { content: p } : p); },
    async followUp(p: Sent) { sent.push(p); },
  };
  return { interaction: i as unknown as Interaction, sent };
}

function fakeButton(customId: string) {
  const sent: Sent[] = [];
  const i = {
    customId,
    user: { id: USER },
    isAutocomplete: () => false,
    isButton: () => true,
    isChatInputCommand: () => false,
    async deferReply() {},
    async editReply(p: string) { sent.push({ content: p }); },
  };
  return { interaction: i as unknown as Interaction, sent };
}

function buttonOf(p: Sent) {
  const row = p.components?.[0]?.toJSON() as { components: { custom_id: string; label: string }[] };
  const button = row.components[0];
  assert.ok(button, 'no button');
  return button;
}

const FREE_TEXT: [string, Record<string, string>][] = [
  ['encourage', { situation: 'I feel far from God since my church split' }],
  ['weigh', { word: 'I sensed God say to move city' }],
  ['promise', { area: 'grief' }],
  ['scripture', { reference: 'John 14:6' }],
];

for (const [name, options] of FREE_TEXT) {
  test(`no consent: /${name} sends nothing to the MCP and shows the notice with "I agree"`, async () => {
    const { store } = memoryStore();
    const { doxa, calls } = fakeDoxa();
    const { interaction, sent } = fakeCommand(name, options);
    await handleInteraction(interaction, { doxa, consent: store });
    assert.deepEqual(calls, []);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.content!, /religious beliefs/);
    assert.match(sent[0]!.content!, /\/privacy/);
    assert.ok(sent[0]!.content!.includes(PRIVACY_URL));
    assert.deepEqual(
      { id: buttonOf(sent[0]!).custom_id, label: buttonOf(sent[0]!).label },
      { id: CONSENT_BUTTON_ID, label: 'I agree' },
    );
  });
}

test('with consent: /encourage forwards the text (the gate opens)', async () => {
  const { store } = memoryStore([USER]);
  const { doxa, calls } = fakeDoxa();
  const { interaction } = fakeCommand('encourage', { situation: 'I feel far from God' });
  await handleInteraction(interaction, { doxa, consent: store });
  assert.deepEqual(calls, ['encourage:I feel far from God']);
});

test('"I agree" stores consent for the presser, then their next message is answered', async () => {
  const { store, log, consented } = memoryStore();
  const { doxa, calls } = fakeDoxa();
  const { interaction, sent } = fakeButton(CONSENT_BUTTON_ID);
  await handleInteraction(interaction, { doxa, consent: store });
  assert.ok(log.includes(`grant:${USER}:v1.0`));
  assert.ok(consented.has(USER));
  assert.match(sent[0]!.content!, /send your message again/);
  assert.deepEqual(calls, [], 'the earlier message is not replayed');

  const next = fakeCommand('encourage', { situation: 'again' });
  await handleInteraction(next.interaction, { doxa, consent: store });
  assert.deepEqual(calls, ['encourage:again']);
});

test('/privacy withdraws: consent cleared, next message gated again', async () => {
  const { store, log, consented } = memoryStore([USER]);
  const { doxa, calls } = fakeDoxa();
  const { interaction, sent } = fakeCommand('privacy', {});
  await handleInteraction(interaction, { doxa, consent: store });
  assert.ok(log.includes(`withdraw:${USER}`));
  assert.equal(consented.has(USER), false);
  assert.match(sent[0]!.content!, /deleted/);

  const next = fakeCommand('encourage', { situation: 'still there?' });
  await handleInteraction(next.interaction, { doxa, consent: store });
  assert.deepEqual(calls, []);
});

test('a consent store error counts as no consent (fail closed)', async () => {
  const store: ConsentStore = {
    has: async () => { throw new Error('db down'); },
    grant: async () => {},
    withdraw: async () => 0,
  };
  const { doxa, calls } = fakeDoxa();
  const { interaction, sent } = fakeCommand('encourage', { situation: 'hello' });
  await handleInteraction(interaction, { doxa, consent: store });
  assert.deepEqual(calls, []);
  assert.match(sent[0]!.content!, /religious beliefs/);
});

test('a slow consent store times out as no consent, inside Discord\'s 3 s window', async () => {
  const store: ConsentStore = {
    has: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5_000).unref()),
    grant: async () => {},
    withdraw: async () => 0,
  };
  const { doxa, calls } = fakeDoxa();
  const { interaction, sent } = fakeCommand('weigh', { word: 'a word' });
  const started = Date.now();
  await handleInteraction(interaction, { doxa, consent: store });
  assert.ok(Date.now() - started < 2_500, `took ${Date.now() - started} ms`);
  assert.deepEqual(calls, []);
  assert.match(sent[0]!.content!, /religious beliefs/);
});

test('/doxaway (no free text) is not gated', async () => {
  const { store } = memoryStore();
  const { doxa, calls } = fakeDoxa();
  const { interaction } = fakeCommand('doxaway', {});
  await handleInteraction(interaction, { doxa, consent: store });
  assert.deepEqual(calls, ['wayMovement']);
});

test('@mention without consent: notice sent, gate closed; with consent: gate open', async () => {
  const replies: Sent[] = [];
  const message = { author: { id: USER }, reply: async (p: Sent) => { replies.push(p); } } as unknown as Message;
  assert.equal(await mentionConsentGate(message, memoryStore().store), false);
  assert.match(replies[0]!.content!, /religious beliefs/);
  assert.equal(buttonOf(replies[0]!).custom_id, CONSENT_BUTTON_ID);

  assert.equal(await mentionConsentGate(message, memoryStore([USER]).store), true);
  assert.equal(replies.length, 1);
});

test('index.ts wiring: the mention gate runs before any MCP call, and interactions go through dispatch', () => {
  // Compiled tests run from .test-dist/, so read the source from src/.
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const gate = src.indexOf('await mentionConsentGate(message, consent)');
  const call = src.indexOf('await buildEncourageReply(');
  assert.ok(gate > 0 && call > gate, 'mentionConsentGate must come before buildEncourageReply');
  assert.match(src, /handleInteraction\(interaction, \{ doxa, consent \}\)/);
  assert.match(src, /privacyCommand,\n\];/);
});

// DoxaIsNotAPerson (Garth 2026-09-02): the bot never speaks in the first
// person. Only the user's own words ("I agree") may use "I".
test('consent copy has no first-person voice for Doxa', () => {
  for (const text of [CONSENT_NOTICE, CONSENT_THANKS, WITHDRAWN_TEXT, SAVE_FAILED_TEXT]) {
    const body = text.replace(/"I agree"/g, '');
    assert.doesNotMatch(body, /\b(I|me|my|mine|we|us|our)\b/i, text);
  }
});
