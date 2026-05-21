import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DoxaClient } from '@thedoxaway/mcp-client';

export const scriptureCommand = new SlashCommandBuilder()
  .setName('scripture')
  .setDescription('Look up a Bible verse')
  .addStringOption((opt) =>
    opt
      .setName('reference')
      .setDescription('Verse reference (e.g. "John 14:6", "Psalm 23:1-3")')
      .setRequired(true)
      .setMaxLength(100),
  );

export async function handleScripture(
  interaction: ChatInputCommandInteraction,
  doxa: DoxaClient,
): Promise<void> {
  await interaction.deferReply();

  const reference = interaction.options.getString('reference', true);
  const result = await doxa.scripture(reference);

  await interaction.editReply({
    content: `**[${result.reference}](${result.link})** *(${result.translation})*\n\n${result.text}`,
  });
}
