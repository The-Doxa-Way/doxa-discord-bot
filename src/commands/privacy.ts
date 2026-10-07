import {
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';

import {
  CONSENT_THANKS,
  SAVE_FAILED_TEXT,
  WITHDRAWN_TEXT,
  type ConsentStore,
} from '../consent.js';

/** /privacy — withdraw Art. 9 consent and delete what Doxa stored from you. */
export const privacyCommand = new SlashCommandBuilder()
  .setName('privacy')
  .setDescription('Withdraw consent and delete the messages Doxa stored from you');

export async function handlePrivacy(
  interaction: ChatInputCommandInteraction,
  consent: ConsentStore,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await consent.withdraw(interaction.user.id);
    await interaction.editReply(WITHDRAWN_TEXT);
  } catch (err) {
    console.error('[privacy] withdraw failed', err instanceof Error ? err.message : err);
    await interaction.editReply(SAVE_FAILED_TEXT);
  }
}

/** The "I agree" button on the consent notice. */
export async function handleConsentButton(
  interaction: ButtonInteraction,
  consent: ConsentStore,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await consent.grant(interaction.user.id);
    await interaction.editReply(CONSENT_THANKS);
  } catch (err) {
    console.error('[consent] grant failed', err instanceof Error ? err.message : err);
    await interaction.editReply(SAVE_FAILED_TEXT);
  }
}
