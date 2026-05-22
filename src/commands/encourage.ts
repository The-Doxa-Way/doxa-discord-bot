import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DoxaClient, DoxaWayMovementId } from '@thedoxaway/mcp-client';

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

export async function handleEncourage(
  interaction: ChatInputCommandInteraction,
  doxa: DoxaClient,
): Promise<void> {
  await interaction.deferReply();

  const situation = interaction.options.getString('situation', true);
  const movement = (interaction.options.getString('movement') ?? undefined) as DoxaWayMovementId | undefined;

  const result = await doxa.withCaller(`discord:${interaction.user.id}`).encourage(situation, movement);

  const scriptureLines = result.scriptures.length
    ? '\n\n' +
      result.scriptures
        .map((s) => `📖 [${s.ref}](${s.link})`)
        .join('  ·  ')
    : '';

  const movementBadge = result.movement ? `_${result.movement}_\n\n` : '';

  await interaction.editReply({
    content: `${movementBadge}${result.text}${scriptureLines}`,
  });
}
