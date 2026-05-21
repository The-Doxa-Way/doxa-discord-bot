/**
 * DoxaBot for Discord.
 *
 * Slash commands:
 *   /encourage  situation:<text> [movement:<doxa-way-movement>]
 *   /scripture  reference:<text>
 *   /doxaway    [movement:<doxa-way-movement>]
 *
 * Backed by Doxa MCP at doxa.app/mcp/v1. Uses BYOL (server-side Anthropic key)
 * if ANTHROPIC_API_KEY is set, otherwise the free anon tier (50 calls/day per IP).
 */

import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { DoxaClient, DoxaRateLimitError, DoxaError } from '@thedoxaway/mcp-client';

import { encourageCommand, handleEncourage } from './commands/encourage.js';
import { scriptureCommand, handleScripture } from './commands/scripture.js';
import { doxawayCommand, handleDoxaway } from './commands/doxaway.js';

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
  userAgent: 'doxa-discord-bot/0.1.0',
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  const tier = ANTHROPIC_API_KEY ? 'BYOL' : 'free anon';
  console.log(`✓ DoxaBot online as ${c.user.tag} — ${tier} tier`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
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
      default:
        await replyEphemeral(interaction, `Unknown command: \`${interaction.commandName}\``);
    }
  } catch (err) {
    if (err instanceof DoxaRateLimitError) {
      await replyEphemeral(
        interaction,
        `Doxa MCP free-tier rate limit reached (${err.quota.used}/${err.quota.limit} in the last 24h).\nUpgrade to BYOL for unlimited: <${err.byolUrl}>`,
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
export const COMMANDS = [encourageCommand, scriptureCommand, doxawayCommand];

client.login(DISCORD_BOT_TOKEN);
