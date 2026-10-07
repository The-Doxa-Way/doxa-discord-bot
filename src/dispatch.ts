/**
 * Interaction routing, kept out of index.ts (which logs in at import) so it
 * can be tested with fake interactions, a fake Doxa client and a fake
 * consent store.
 *
 * GDPR Art. 9: every command that sends the user's free text to the Doxa MCP
 * (which replies with an AI provider and logs the call) is gated on consent.
 * Without it, the user gets the consent notice and nothing else happens.
 */

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
} from 'discord.js';
import { DoxaRateLimitError, DoxaError, type DoxaClient } from '@thedoxaway/mcp-client';

import { handleEncourage } from './commands/encourage.js';
import { handleScripture } from './commands/scripture.js';
import { handleDoxaway } from './commands/doxaway.js';
import { handleWeigh } from './commands/weigh.js';
import { handlePromise, handlePromiseAutocomplete } from './commands/promise.js';
import { handleConsentButton, handlePrivacy } from './commands/privacy.js';
import { CONSENT_BUTTON_ID, consentPrompt, hasConsent, type ConsentStore } from './consent.js';

export interface Deps {
  doxa: DoxaClient;
  consent: ConsentStore;
}

/** Commands whose free-text option is sent to the Doxa MCP. */
export const CONSENT_GATED_COMMANDS = new Set(['encourage', 'weigh', 'promise', 'scripture']);

export async function handleInteraction(interaction: Interaction, { doxa, consent }: Deps): Promise<void> {
  // Autocomplete (e.g. /promise area:) must answer fast and on its own path.
  // It filters a fixed local list; nothing leaves the bot.
  if (interaction.isAutocomplete()) {
    try {
      if (interaction.commandName === 'promise') {
        await handlePromiseAutocomplete(interaction);
      } else {
        await interaction.respond([]);
      }
    } catch (err) {
      console.error('[autocomplete]', err);
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId !== CONSENT_BUTTON_ID) return;
    try {
      await handleConsentButton(interaction, consent);
    } catch (err) {
      console.error('[consent-button]', err instanceof Error ? err.message : err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (CONSENT_GATED_COMMANDS.has(interaction.commandName) && !(await hasConsent(consent, interaction.user.id))) {
      await interaction.reply({ ...consentPrompt(), flags: MessageFlags.Ephemeral });
      return;
    }

    switch (interaction.commandName) {
      case 'encourage':
        await handleEncourage(interaction, doxa);
        break;
      case 'scripture':
        await handleScripture(interaction, doxa);
        break;
      case 'doxaway':
        await handleDoxaway(interaction, doxa);
        break;
      case 'weigh':
        await handleWeigh(interaction, doxa);
        break;
      case 'promise':
        await handlePromise(interaction, doxa);
        break;
      case 'privacy':
        await handlePrivacy(interaction, consent);
        break;
      default:
        await replyEphemeral(interaction, `Unknown command: \`${interaction.commandName}\``);
    }
  } catch (err) {
    console.error(`[${interaction.commandName}]`, err instanceof Error ? err.message : err);
    try {
      if (err instanceof DoxaRateLimitError) {
        await replyEphemeral(
          interaction,
          `Today's free encouragement is done (${err.quota.used}/${err.quota.limit} in 24h).\n` +
            `For unlimited, install the Doxa app: <https://doxa.app/get?utm_source=discord&utm_medium=rate-limit>\n` +
            `Or drop in your own Anthropic key: <${err.byolUrl}>`,
        );
      } else if (err instanceof DoxaError) {
        await replyEphemeral(interaction, `Doxa MCP returned an error: ${err.message}`);
      } else {
        await replyEphemeral(interaction, 'Something went wrong. Please try again.');
      }
    } catch (replyErr) {
      // Interaction expired or was already acknowledged — log and move on.
      // Do NOT let this crash the process, which would cause a restart loop.
      console.error('[reply-failed]', replyErr instanceof Error ? replyErr.message : replyErr);
    }
  }
}

/**
 * @mention gate. Returns true when the author has consented. Otherwise it
 * replies with the consent notice (their text goes nowhere) and returns false.
 */
export async function mentionConsentGate(message: Message, consent: ConsentStore): Promise<boolean> {
  if (await hasConsent(consent, message.author.id)) return true;
  try {
    await message.reply({ ...consentPrompt(), allowedMentions: { parse: [], repliedUser: false } });
  } catch (err) {
    console.error('[mention][consent-reply-failed]', err instanceof Error ? err.message : err);
  }
  return false;
}

async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
