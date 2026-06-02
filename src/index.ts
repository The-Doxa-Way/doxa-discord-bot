/**
 * DoxaBot for Discord.
 *
 * Slash commands:
 *   /encourage  situation:<text> [movement:<doxa-way-movement>]
 *   /scripture  reference:<text>
 *   /doxaway    [movement:<doxa-way-movement>]
 *   /weigh      word:<text>
 *   /promise    area:<text, autocomplete>
 *
 * Backed by Doxa MCP at doxa.app/mcp/v1. Uses BYOL (server-side Anthropic key)
 * if ANTHROPIC_API_KEY is set, otherwise the free anon tier (50 calls/day per IP).
 */

import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { DoxaClient, DoxaRateLimitError, DoxaError } from '@thedoxaway/mcp-client';

import { encourageCommand, handleEncourage } from './commands/encourage.js';
import { scriptureCommand, handleScripture } from './commands/scripture.js';
import { doxawayCommand, handleDoxaway } from './commands/doxaway.js';
import { weighCommand, handleWeigh } from './commands/weigh.js';
import { promiseCommand, handlePromise, handlePromiseAutocomplete } from './commands/promise.js';

const DISCORD_BOT_TOKEN = required('DISCORD_BOT_TOKEN');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const doxa = new DoxaClient({
  anthropicKey: ANTHROPIC_API_KEY,
  userAgent: 'doxa-discord-bot/0.2.0',
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (c) => {
  const tier = ANTHROPIC_API_KEY ? 'BYOL' : 'free anon';
  console.log(`✓ DoxaBot online as ${c.user.tag} — ${tier} tier`);

  // Self-register the global slash commands on boot so a deploy == a command
  // sync. Global PUT is idempotent, so re-running on every restart is safe.
  // (The standalone `npm run deploy-commands` script still works for targeting
  // a single dev guild via DISCORD_GUILD_ID.)
  try {
    await c.application.commands.set(COMMANDS.map((cmd) => cmd.toJSON()));
    console.log(`✓ Synced ${COMMANDS.length} global slash command(s).`);
  } catch (err) {
    console.error('[register] Failed to sync commands on boot:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // Autocomplete (e.g. /promise area:) must answer fast and on its own path.
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

  if (!interaction.isChatInputCommand()) return;

  try {
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
      default:
        await replyEphemeral(interaction, `Unknown command: \`${interaction.commandName}\``);
    }
  } catch (err) {
    if (err instanceof DoxaRateLimitError) {
      await replyEphemeral(
        interaction,
        `Today's free encouragement is done (${err.quota.used}/${err.quota.limit} in 24h).\n` +
          `For unlimited, install the Doxa app: <https://doxa.app/get?utm_source=discord&utm_medium=rate-limit>\n` +
          `Or drop in your own Anthropic key: <${err.byolUrl}>`,
      );
    } else if (err instanceof DoxaError) {
      await replyEphemeral(interaction, `Doxa MCP returned an error: ${err.message}`);
      console.error(`[doxa-error ${err.code}]`, err.message);
    } else {
      await replyEphemeral(interaction, 'Something went wrong. Please try again.');
      console.error('[unexpected]', err);
    }
  }
});

async function replyEphemeral(
  interaction: import('discord.js').ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

// Surface the command definitions for the deploy-commands script.
export const COMMANDS = [
  encourageCommand,
  scriptureCommand,
  doxawayCommand,
  weighCommand,
  promiseCommand,
];

client.login(DISCORD_BOT_TOKEN);
