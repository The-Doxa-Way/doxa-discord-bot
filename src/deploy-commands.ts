/**
 * One-time slash command registration.
 *
 * Run this AFTER changing any slash command shape (name, description, options).
 * Discord caches command definitions per-guild (instant) or globally (1-hour TTL).
 *
 * For development, set DISCORD_GUILD_ID to a test guild so changes appear instantly.
 * For production, leave DISCORD_GUILD_ID unset for global commands.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=... DISCORD_CLIENT_ID=... npm run deploy-commands
 *   # Optional:
 *   #   DISCORD_GUILD_ID=...   # register to a specific guild (instant, dev mode)
 */

import { REST, Routes } from 'discord.js';
import { encourageCommand } from './commands/encourage.js';
import { scriptureCommand } from './commands/scripture.js';
import { doxawayCommand } from './commands/doxaway.js';

const DISCORD_BOT_TOKEN = required('DISCORD_BOT_TOKEN');
const DISCORD_CLIENT_ID = required('DISCORD_CLIENT_ID');
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const commands = [encourageCommand, scriptureCommand, doxawayCommand].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

try {
  console.log(`Registering ${commands.length} slash command(s)...`);

  if (DISCORD_GUILD_ID) {
    const data = await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands },
    );
    console.log(`✓ Registered ${(data as unknown[]).length} guild command(s) to guild ${DISCORD_GUILD_ID}`);
  } else {
    const data = await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: commands },
    );
    console.log(`✓ Registered ${(data as unknown[]).length} global command(s). May take up to 1 hour to appear.`);
  }
} catch (err) {
  console.error('Failed to register commands:', err);
  process.exit(1);
}
