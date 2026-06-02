import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import type { DoxaClient } from '@thedoxaway/mcp-client';

import { doxaAppRow } from '../components.js';

/**
 * /promise — receive a Scripture promise to stand on, for an area of life.
 *
 * Distinct from /encourage and /scripture: the intent is to anchor on one of
 * God's promises for a named area (fear, provision, healing, waiting...), tied
 * to the "trust" movement of The Doxa Way. The `area` option uses autocomplete,
 * which registers DoxaBot as using the "Autocomplete" feature on Top.gg.
 */

/** Suggested areas of life. Autocomplete filters this list as the user types. */
const AREAS = [
  'fear or anxiety',
  'provision',
  'healing',
  'guidance',
  'identity',
  'waiting',
  'grief',
  'temptation',
  'weariness',
  'doubt',
  'relationships',
  'purpose',
  'protection',
  'peace',
  'forgiveness',
  'strength',
];

export const promiseCommand = new SlashCommandBuilder()
  .setName('promise')
  .setDescription('Receive a Scripture promise to stand on')
  .addStringOption((opt) =>
    opt
      .setName('area')
      .setDescription('The area of life to find a promise for (type to search)')
      .setRequired(true)
      .setAutocomplete(true)
      .setMaxLength(100),
  );

/** Autocomplete handler for the `area` option. Must respond within 3 seconds. */
export async function handlePromiseAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase().trim();
  const matches = focused ? AREAS.filter((a) => a.includes(focused)) : AREAS;
  const choices = (matches.length ? matches : AREAS).slice(0, 25);
  await interaction.respond(choices.map((a) => ({ name: a, value: a })));
}

export async function handlePromise(
  interaction: ChatInputCommandInteraction,
  doxa: DoxaClient,
): Promise<void> {
  await interaction.deferReply();

  const area = interaction.options.getString('area', true);

  const situation =
    `Give me one of God's promises from Scripture to stand on about ${area}. ` +
    `Anchor it in a specific verse, and add one sentence on how to hold to it ` +
    `when belief is hard.`;

  const result = await doxa.withCaller(`discord:${interaction.user.id}`).encourage(situation, 'trust');

  const scriptureLines = result.scriptures.length
    ? '\n\n' + result.scriptures.map((s) => `📖 [${s.ref}](${s.link})`).join('  ·  ')
    : '';

  const movementBadge = result.movement ? `_${result.movement}_\n\n` : '';

  await interaction.editReply({
    content: `${movementBadge}${result.text}${scriptureLines}`,
    components: [doxaAppRow('promise')],
  });
}
