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

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionsBitField,
  type Interaction,
  type Message,
} from 'discord.js';
import { DoxaClient, DoxaRateLimitError, DoxaError } from '@thedoxaway/mcp-client';

import { encourageCommand, handleEncourage, buildEncourageReply } from './commands/encourage.js';
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
  intents: [
    GatewayIntentBits.Guilds,
    // Needed for the @mention forum-participation handler: GuildMessages fires
    // MessageCreate, and MessageContent (PRIVILEGED — enable "Message Content
    // Intent" in the Discord Developer Portal) populates message.content.
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
});

// Throttles for the @mention handler. In-memory is fine for a single process;
// back these with a shared store if the bot is ever sharded.
//
// The per-user cooldown alone is trivially bypassed with multiple accounts, so
// the cost path (buildEncourageReply → MCP/Anthropic) is additionally guarded by
// a per-channel cooldown, a process-wide token bucket, and a bounded in-flight
// concurrency cap. All of these silently drop when exceeded — never announce a
// throttle (that would itself be channel noise).
const MENTION_COOLDOWN_MS = 10_000;
const CHANNEL_COOLDOWN_MS = 5_000;
const GLOBAL_MAX_PER_MINUTE = 30;
const MAX_IN_FLIGHT = 4;

const mentionCooldowns = new Map<string, number>();
const channelCooldowns = new Map<string, number>();

// Global token bucket: refills GLOBAL_MAX_PER_MINUTE tokens per minute, shared
// across every user/guild/channel, so a coordinated raid can't multiply spend.
let globalTokens = GLOBAL_MAX_PER_MINUTE;
let lastRefill = Date.now();
function takeGlobalToken(): boolean {
  const now = Date.now();
  const refill = Math.floor(((now - lastRefill) / 60_000) * GLOBAL_MAX_PER_MINUTE);
  if (refill >= 1) {
    globalTokens = Math.min(GLOBAL_MAX_PER_MINUTE, globalTokens + refill);
    lastRefill = now;
  }
  if (globalTokens < 1) return false;
  globalTokens -= 1;
  return true;
}

// Bounded max-in-flight cap on concurrent MCP/Anthropic calls — drops bursts
// rather than firing many provider requests at once (avoids 429s).
let inFlight = 0;

// Forum participation: mirror /encourage when the bot is @mentioned in a guild
// channel. Slash commands stay the canonical entry point; this just lets people
// ping DoxaBot conversationally and get the identical Doxa-voice reply.
client.on(Events.MessageCreate, async (message: Message) => {
  // Only handle guild text channels — the bot has no DM behaviour today.
  if (!message.inGuild()) return;
  // Ignore other bots, webhook posts, and our own messages (anti-loop).
  if (message.author.bot) return;
  if (message.webhookId) return;
  if (!client.user || message.author.id === client.user.id) return;
  // Never respond to @everyone / @here — they flip mentions.has(...) true but
  // are not a real ping of the bot.
  if (message.mentions.everyone) return;
  // Require a DIRECT user-mention of the bot. `mentions.users` is the RAW API
  // list, which includes the replied-to author whenever Discord's "ping author"
  // reply toggle is on — it is on by default in every client. Reading it
  // directly meant that replying to one of the bot's own messages with an
  // unrelated follow-up ("which translation is this?") fired a full paid
  // encourage call on that text and spent the user's daily quota. mentions.has
  // with ignoreRepliedUser is the documented way to exclude it; roles and
  // everyone stay excluded too, so this really is a direct ping only.
  if (!message.mentions.has(client.user, { ignoreRepliedUser: true, ignoreRoles: true, ignoreEveryone: true })) return;

  // Strip every form of the bot mention (<@id> and legacy <@!id>) to get the
  // user's situation text.
  const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
  const situation = message.content.replace(mentionRegex, '').trim();

  // Per-user cooldown to stop spam/abuse loops; silently drop if too soon. This
  // runs BEFORE the empty-vs-situation branch so a bare `@DoxaBot` (which strips
  // to empty) is rate-limited too and can't be used to flood the channel with
  // the friendly-prompt reply.
  const now = Date.now();
  const last = mentionCooldowns.get(message.author.id) ?? 0;
  if (now - last < MENTION_COOLDOWN_MS) return;
  mentionCooldowns.set(message.author.id, now);

  // Bail silently if we lack permission to post here (never announce that we
  // can't post — that would itself be noise / require posting).
  const me = message.guild.members.me;
  if (me && !message.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)) {
    return;
  }

  // Per-channel cooldown so a single channel can't be saturated by many users.
  // This gates the FREE friendly-prompt reply below as well: without it, N users
  // each pinging inside their own 10s per-user window could flood a channel with
  // canned replies, which costs no budget but is exactly the spam this bot must
  // never produce. Claiming the 5s slot here can delay a real request by at most
  // that, which is the cheaper mistake.
  const channelLast = channelCooldowns.get(message.channelId) ?? 0;
  if (now - channelLast < CHANNEL_COOLDOWN_MS) return;
  channelCooldowns.set(message.channelId, now);

  // Empty ping → friendly prompt to add what they're facing.
  if (!situation) {
    try {
      await message.reply({
        content:
          'Tell me what you are facing and I will encourage you — for example: ' +
          '`@DoxaBot I am anxious about a decision`',
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      console.error('[mention][reply-failed]', err instanceof Error ? err.message : err);
    }
    return;
  }

  // Process-wide guards on the paid cost path: drop silently when the global
  // rate is exhausted or too many calls are already in flight.
  if (inFlight >= MAX_IN_FLIGHT) return;
  if (!takeGlobalToken()) return;

  inFlight++;
  try {
    const reply = await buildEncourageReply(
      doxa,
      `discord:${message.author.id}`,
      situation,
      undefined,
      'mention',
    );
    // Lock `parse` to [] so AI/user-derived text can never trigger an
    // @everyone/@here/role/user mass-ping (a single one is an instant ban).
    await message.reply({ ...reply, allowedMentions: { parse: [], repliedUser: false } });
  } catch (err) {
    console.error('[mention]', err instanceof Error ? err.message : err);
    try {
      if (err instanceof DoxaRateLimitError) {
        await message.reply({
          content:
            `Today's free encouragement is done (${err.quota.used}/${err.quota.limit} in 24h).\n` +
            `For unlimited, install the Doxa app: <https://doxa.app/get?utm_source=discord&utm_medium=rate-limit>\n` +
            `Or drop in your own Anthropic key: <${err.byolUrl}>`,
          allowedMentions: { parse: [], repliedUser: false },
        });
      } else if (err instanceof DoxaError) {
        await message.reply({
          content: `Doxa MCP returned an error: ${err.message}`,
          allowedMentions: { parse: [], repliedUser: false },
        });
      } else {
        await message.reply({
          content: 'Something went wrong. Please try again.',
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
    } catch (replyErr) {
      // Send failed (e.g. missing perms, code 50013/50001) — log, never throw.
      console.error('[mention][reply-failed]', replyErr instanceof Error ? replyErr.message : replyErr);
    }
  } finally {
    inFlight--;
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
