import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DoxaClient } from '@thedoxaway/mcp-client';

import { doxaAppRow } from '../components.js';

/**
 * /weigh — test a word, impression, or piece of advice against Scripture.
 *
 * This is the "test" movement of The Doxa Way made into a command:
 * "Do not treat prophecies with contempt, but test them all; hold on to what
 * is good." (1 Thessalonians 5:20-21). Distinct from /encourage: the intent is
 * discernment of a specific word someone has already received, not general
 * encouragement for a situation.
 */
export const weighCommand = new SlashCommandBuilder()
  .setName('weigh')
  .setDescription('Weigh a word or impression against Scripture')
  .addStringOption((opt) =>
    opt
      .setName('word')
      .setDescription('The word, impression, or advice to weigh (1-3 sentences)')
      .setRequired(true)
      .setMaxLength(2000),
  );

export async function handleWeigh(
  interaction: ChatInputCommandInteraction,
  doxa: DoxaClient,
): Promise<void> {
  await interaction.deferReply();

  const word = interaction.options.getString('word', true);

  const situation =
    `A word or impression I received: "${word}". ` +
    `Help me weigh it against Scripture. Is it consistent with God's character ` +
    `and what He has already said? Name what to hold on to and what to hold loosely.`;

  const result = await doxa.withCaller(`discord:${interaction.user.id}`).encourage(situation, 'test');

  const scriptureLines = result.scriptures.length
    ? '\n\n' + result.scriptures.map((s) => `📖 [${s.ref}](${s.link})`).join('  ·  ')
    : '';

  const movementBadge = result.movement ? `_${result.movement}_\n\n` : '';

  await interaction.editReply({
    content: `${movementBadge}${result.text}${scriptureLines}`,
    components: [doxaAppRow('weigh')],
  });
}
