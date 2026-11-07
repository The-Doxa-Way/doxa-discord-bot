/**
 * The Doxa Discord server's public text (server description, #welcome topic,
 * #welcome pinned post) is owned by this file, so it cannot drift from the
 * brand (doxa-brand Hard Rule 15, Garth 2026-11-07: the descriptor leads, the
 * name is "Doxa: Prophetic Encouragement", and the brand's point is never a
 * label).
 *
 * The bot runs syncServerProfile once on ready (a deploy or restart). Each
 * item is read first and written only when it differs. When the bot lacks the
 * permission for an item it writes nothing and reports the permission it
 * lacks, so the log says exactly what to grant.
 */
import { PermissionFlagsBits, type Guild, type TextChannel } from 'discord.js';

export const DOXA_GUILD_ID = '1520163816686747648';
export const WELCOME_CHANNEL_ID = '1520163817256910930';

export const GUILD_DESCRIPTION =
  'Record and hold prophetic encouragement for decades. The community of Doxa: Prophetic Encouragement. ' +
  'Share what God has done, pray for each other, and get encouragement from Scripture.';

export const WELCOME_TOPIC =
  'Record and hold prophetic encouragement for decades. Start here: what this place is, where to go, and how DoxaBot works.';

// {#name} becomes a clickable channel link when the channel exists, else plain #name.
export const WELCOME_POST_TEMPLATE = [
  '**Record and hold prophetic encouragement for decades.**',
  '',
  'Welcome to Doxa: Prophetic Encouragement. Glad you are here.',
  '',
  'Doxa, your prophetic encouragement app, keeps what God has said to you and done for you, so you can come back to it for your whole journey. Here we share it with each other. Believers, seekers, everyone in between. No church background needed, come as you are.',
  '',
  'Where to go:',
  '**{#encouragement}** send DoxaBot what you are facing, get encouragement back from Scripture.',
  '**{#stories}** share what God has done, the wins and the stuff still in progress.',
  '**{#prayer}** drop what you are carrying. People here will pray for you.',
  '**{#the-doxa-way}** the rhythm behind Doxa. Start here and feel it out.',
  '',
  'Getting encouragement:',
  '@mention DoxaBot in any channel with what is on your mind, or use a slash command in {#encouragement}. The full guide is pinned there.',
  '',
  'Start remembering: <https://doxa.app>',
].join('\n');

export function renderWelcomePost(channelIds: Record<string, string>): string {
  return WELCOME_POST_TEMPLATE.replace(/\{#([a-z0-9-]+)\}/g, (_m, name: string) =>
    channelIds[name] ? `<#${channelIds[name]}>` : `#${name}`);
}

export interface PinnedPost { id: string; authorId: string; content: string }

/** What the sync needs from Discord. Built from discord.js by discordPort. */
export interface ServerPort {
  botId: string;
  guildDescription: string | null;
  canManageGuild: boolean;
  setGuildDescription(text: string): Promise<void>;
  welcomeTopic: string | null;
  canManageChannel: boolean;
  setWelcomeTopic(text: string): Promise<void>;
  canSend: boolean;
  canPin: boolean;
  welcomePins(): Promise<PinnedPost[]>;
  editMessage(id: string, content: string): Promise<void>;
  postAndPin(content: string): Promise<void>;
  channelIds: Record<string, string>;
}

export type ItemResult = 'ok' | 'updated' | 'posted' | `missing permission: ${string}` | `failed: ${string}`;

export interface SyncResult { description: ItemResult; topic: ItemResult; pin: ItemResult }

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function step(fn: () => Promise<ItemResult>): Promise<ItemResult> {
  try {
    return await fn();
  } catch (err) {
    return `failed: ${errText(err)}`;
  }
}

/** Read each item, write only what differs, never throw. */
export async function syncServerProfile(port: ServerPort): Promise<SyncResult> {
  const description = await step(async () => {
    if (port.guildDescription === GUILD_DESCRIPTION) return 'ok';
    if (!port.canManageGuild) return 'missing permission: ManageGuild';
    await port.setGuildDescription(GUILD_DESCRIPTION);
    return 'updated';
  });

  const topic = await step(async () => {
    if (port.welcomeTopic === WELCOME_TOPIC) return 'ok';
    if (!port.canManageChannel) return 'missing permission: ManageChannels';
    await port.setWelcomeTopic(WELCOME_TOPIC);
    return 'updated';
  });

  const pin = await step(async () => {
    const want = renderWelcomePost(port.channelIds);
    // The bot can edit only its own messages, so it owns the pin it authored.
    const mine = (await port.welcomePins()).filter((p) => p.authorId === port.botId);
    if (mine.some((p) => p.content === want)) return 'ok';
    // Oldest bot pin is the welcome post (pins come newest first).
    const oldest = mine[mine.length - 1];
    if (oldest) {
      await port.editMessage(oldest.id, want);
      return 'updated';
    }
    if (!port.canSend) return 'missing permission: SendMessages';
    if (!port.canPin) return 'missing permission: PinMessages';
    await port.postAndPin(want);
    return 'posted';
  });

  return { description, topic, pin };
}

/** Adapter from discord.js objects to ServerPort. */
export async function discordPort(guild: Guild, botId: string): Promise<ServerPort> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const channel = (await guild.channels.fetch(WELCOME_CHANNEL_ID)) as TextChannel | null;
  if (!channel) throw new Error(`#welcome channel ${WELCOME_CHANNEL_ID} not found`);
  const perms = channel.permissionsFor(me);
  const has = (flag: bigint) => perms?.has(flag) ?? false;
  const channelIds: Record<string, string> = {};
  for (const c of guild.channels.cache.values()) channelIds[c.name] = c.id;

  return {
    botId,
    guildDescription: guild.description,
    canManageGuild: me.permissions.has(PermissionFlagsBits.ManageGuild),
    setGuildDescription: async (text) => { await guild.edit({ description: text }); },
    welcomeTopic: channel.topic,
    canManageChannel: has(PermissionFlagsBits.ManageChannels),
    setWelcomeTopic: async (text) => { await channel.setTopic(text); },
    canSend: has(PermissionFlagsBits.ViewChannel) && has(PermissionFlagsBits.SendMessages),
    canPin: has(PermissionFlagsBits.PinMessages) || has(PermissionFlagsBits.ManageMessages),
    welcomePins: async () => {
      const res = await channel.messages.fetchPins();
      return res.items.map((p) => ({ id: p.message.id, authorId: p.message.author.id, content: p.message.content }));
    },
    editMessage: async (id, content) => {
      const msg = await channel.messages.fetch(id);
      await msg.edit({ content, allowedMentions: { parse: [] } });
    },
    postAndPin: async (content) => {
      const msg = await channel.send({ content, allowedMentions: { parse: [] } });
      await msg.pin();
    },
    channelIds,
  };
}
