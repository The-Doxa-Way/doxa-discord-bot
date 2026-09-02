import {
  SlashCommandBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DoxaClient, DoxaWayMovementId } from '@thedoxaway/mcp-client';

import { doxaAppRow } from '../components.js';

const MOVEMENT_CHOICES: { name: string; value: DoxaWayMovementId }[] = [
  { name: 'Hear (receive what God is saying)', value: 'hear' },
  { name: 'Discern (wisdom about its source)', value: 'discern' },
  { name: 'Test (measure against Scripture)', value: 'test' },
  { name: 'Record (capture before it fades)', value: 'record' },
  { name: 'Remember (return to what was said)', value: 'remember' },
  { name: 'Engage (act on it)', value: 'engage' },
  { name: 'Trust (lean on it)', value: 'trust' },
  { name: 'Fight (contend for what was promised)', value: 'fight' },
  { name: 'Endure (keep walking when it costs)', value: 'endure' },
];

export const encourageCommand = new SlashCommandBuilder()
  .setName('encourage')
  .setDescription('Doxa-voice encouragement for a situation')
  .addStringOption((opt) =>
    opt
      .setName('situation')
      .setDescription('Describe what you are facing in 1-3 sentences')
      .setRequired(true)
      .setMaxLength(2000),
  )
  .addStringOption((opt) =>
    opt
      .setName('movement')
      .setDescription('Optional: which movement of The Doxa Way fits')
      .setRequired(false)
      .addChoices(...MOVEMENT_CHOICES),
  );

/**
 * Build the Doxa-voice encouragement reply payload (content + components).
 *
 * Shared by the `/encourage` slash command and the @mention handler so the voice
 * and formatting are identical across both surfaces. The reply shape (plain
 * markdown `content` with masked scripture links + a single Doxa app button row)
 * works the same on `interaction.editReply` and `message.reply`.
 *
 * @param callerId   Per-user caller id (`discord:<userId>`) for fair daily quota.
 * @param utmMedium  UTM medium tag so installs are attributable to the surface.
 */
export async function buildEncourageReply(
  doxa: DoxaClient,
  callerId: string,
  situation: string,
  movement: DoxaWayMovementId | undefined,
  utmMedium: string,
): Promise<{ content: string; components: ActionRowBuilder<ButtonBuilder>[] }> {
  const result = await doxa.withCaller(callerId).encourage(situation, movement);

  const scriptureLines = result.scriptures.length
    ? '\n\n' +
      result.scriptures
        .map((s) => `📖 [${s.ref}](${s.link})`)
        .join('  ·  ')
    : '';

  const movementBadge = result.movement ? `_${result.movement}_\n\n` : '';

  return {
    content: `${movementBadge}${result.text}${scriptureLines}`,
    components: [doxaAppRow(utmMedium)],
  };
}

export async function handleEncourage(
  interaction: ChatInputCommandInteraction,
  doxa: DoxaClient,
): Promise<void> {
  await interaction.deferReply();

  const situation = interaction.options.getString('situation', true);
  const movement = (interaction.options.getString('movement') ?? undefined) as DoxaWayMovementId | undefined;

  const reply = await buildEncourageReply(
    doxa,
    `discord:${interaction.user.id}`,
    situation,
    movement,
    'encourage',
  );

  await interaction.editReply(reply);
}
