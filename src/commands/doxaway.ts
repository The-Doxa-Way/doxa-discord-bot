import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DoxaClient, DoxaWayMovementId } from '@thedoxaway/mcp-client';

const MOVEMENT_CHOICES: { name: string; value: DoxaWayMovementId }[] = [
  { name: 'Hear / Recognise', value: 'hear' },
  { name: 'Discern', value: 'discern' },
  { name: 'Test / Weigh', value: 'test' },
  { name: 'Record', value: 'record' },
  { name: 'Remember', value: 'remember' },
  { name: 'Engage', value: 'engage' },
  { name: 'Trust', value: 'trust' },
  { name: 'Fight the good fight', value: 'fight' },
  { name: 'Endure / Persevere', value: 'endure' },
];

export const doxawayCommand = new SlashCommandBuilder()
  .setName('doxaway')
  .setDescription('The Doxa Way — the 9-movement framework')
  .addStringOption((opt) =>
    opt
      .setName('movement')
      .setDescription('Optional: get a single movement by name')
      .setRequired(false)
      .addChoices(...MOVEMENT_CHOICES),
  );

export async function handleDoxaway(
  interaction: ChatInputCommandInteraction,
  doxa: DoxaClient,
): Promise<void> {
  await interaction.deferReply();

  const movementArg = (interaction.options.getString('movement') ?? undefined) as DoxaWayMovementId | undefined;

  const userDoxa = doxa.withCaller(`discord:${interaction.user.id}`);

  if (movementArg) {
    const result = await userDoxa.wayMovement(movementArg);
    const m = result.movement;
    await interaction.editReply({
      content:
        `**${m.name}**\n` +
        `*${m.short}*\n\n` +
        `When it fits: ${m.prompt_for}\n\n` +
        `_North Star: ${result.northStar}_`,
    });
    return;
  }

  const result = await userDoxa.wayMovement();
  const lines = result.movements
    .map((m, i) => `**${i + 1}. ${m.name}** — ${m.short}`)
    .join('\n');

  await interaction.editReply({
    content:
      `**The Doxa Way**\n\n${lines}\n\n` +
      `_North Star: ${result.northStar}_\n\n` +
      `Daily practice (5 verbs): ${result.fiveVerbDailyPractice.join(' · ')}\n\n` +
      `Read more: ${result.doxaWayCanonicalUrl}`,
  });
}
