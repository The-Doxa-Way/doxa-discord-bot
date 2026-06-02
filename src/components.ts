import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * A single Link button pointing at the Doxa app. Link-style buttons are handled
 * by Discord client-side, so they need no interaction handler in the bot.
 *
 * Attaching this to a reply registers DoxaBot as using the "Buttons / Message
 * Components" feature (one of Top.gg's listed bot features).
 *
 * @param utmMedium  UTM medium tag so installs from each command are attributable.
 */
export function doxaAppRow(utmMedium: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open the Doxa app')
      .setURL(`https://doxa.app/get?utm_source=discord&utm_medium=${utmMedium}`),
  );
}
