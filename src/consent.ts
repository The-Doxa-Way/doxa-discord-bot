/**
 * GDPR Art. 9 explicit consent.
 *
 * What people send DoxaBot can reveal religious beliefs (special-category
 * data). Before the bot forwards a user's free text to the Doxa MCP (which
 * replies with an AI provider and logs the call), the user must press
 * "I agree" on the notice below. /privacy withdraws.
 *
 * Consent is stored in the Doxa Supabase database (table bot_consents,
 * platform 'discord'). The bot connects as the least-privilege role
 * `discord_bot`, which can ONLY run three functions: status, grant, and
 * withdraw (withdraw also deletes the MCP call rows Doxa stored for this
 * user). It has no table access and no service-role key.
 */

import postgres from 'postgres';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

// Wording-only changes that keep the purpose, processors and withdrawal
// route do not bump the version (no new consent needed).
export const CONSENT_VERSION = 'v1.0';
export const CONSENT_BUTTON_ID = `art9_consent:${CONSENT_VERSION}`;
export const PRIVACY_URL = 'https://doxa.app/privacy#special-category';

// No first person: Doxa is not a person and never speaks as one
// (DoxaIsNotAPerson, Garth 2026-09-02). "I agree" is the USER's voice.
export const CONSENT_NOTICE =
  'Before you start: what you send to DoxaBot can show your religious beliefs. ' +
  'Doxa processes your messages, including with the AI providers named in the Doxa privacy policy, ' +
  'only to reply to you. You can withdraw at any time by using /privacy. ' +
  `Privacy policy: <${PRIVACY_URL}>`;

export const CONSENT_THANKS = 'Thank you. Please send your message again and Doxa will reply.';

export const WITHDRAWN_TEXT =
  'Done. Doxa will not process what you send through this bot, and the messages Doxa stored from you here are deleted. ' +
  'To start again, use a command and press "I agree".\n' +
  `Privacy policy: <${PRIVACY_URL}>`;

export const SAVE_FAILED_TEXT = 'Sorry, saving your choice did not work. Please try again in a moment.';

/** Where consent lives. One method per database function. */
export interface ConsentStore {
  has(userId: string): Promise<boolean>;
  grant(userId: string): Promise<void>;
  /** Clears consent and deletes stored messages; returns rows deleted. */
  withdraw(userId: string): Promise<number>;
}

/** The notice plus its one "I agree" button. */
export function consentPrompt(): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  return {
    content: CONSENT_NOTICE,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(CONSENT_BUTTON_ID)
          .setStyle(ButtonStyle.Primary)
          .setLabel('I agree'),
      ),
    ],
  };
}

/**
 * True only when consent is in force. A read error, or no answer within
 * timeoutMs, counts as NOT consented (fail closed: the cost is one extra
 * consent prompt).
 */
export async function hasConsent(store: ConsentStore, userId: string, timeoutMs?: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = store.has(userId);
    if (timeoutMs === undefined) return await read;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`consent check timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    return await Promise.race([read, timeout]);
  } catch (err) {
    console.error('[consent] read failed', err instanceof Error ? err.message : err);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Postgres-backed store, via the Supabase pooler (transaction mode). */
export function pgConsentStore(databaseUrl: string): ConsentStore {
  const sql = postgres(databaseUrl, { prepare: false, max: 2, connect_timeout: 10 });
  return {
    async has(userId) {
      const [row] = await sql<{ ok: boolean }[]>`select public.discord_bot_consent_status(${userId}) as ok`;
      return row?.ok === true;
    },
    async grant(userId) {
      await sql`select public.discord_bot_consent_grant(${userId}, ${CONSENT_VERSION})`;
    },
    async withdraw(userId) {
      const [row] = await sql<{ deleted: number }[]>`select public.discord_bot_consent_withdraw(${userId}) as deleted`;
      return Number(row?.deleted ?? 0);
    },
  };
}
