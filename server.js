require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

const https = require("https");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const APPROVER_ROLE_ID = process.env.APPROVER_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  if (!content.startsWith("!buy") && !content.startsWith("!sell")) return;

  const parts = content.split(" ");

  const action = parts[0].replace("!", "").toLowerCase();
  const tier = parts[1];
  const amount = Number(parts[parts.length - 1]);
  const itemName = parts.slice(2, parts.length - 1).join(" ");

  if (!tier || !itemName || !amount) {
    return message.reply(
      "❌ Use it like this: `!sell T5.3 Exceptional Skyflower 100` or `!buy T5.3 Exceptional Skyflower 100`"
    );
  }

  const guild = message.guild;

  const ticketChannel = await guild.channels.create({
    name: `${action}-${tier}-${itemName}`.toLowerCase().replaceAll(" ", "-"),
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: message.author.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: APPROVER_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ]
  });

  const embed = new EmbedBuilder()
    .setTitle("New Albion Order Ticket")
    .setColor(action === "sell" ? "Green" : "Blue")
    .addFields(
      { name: "Action", value: action.toUpperCase(), inline: true },
      { name: "Tier", value: tier, inline: true },
      { name: "Item", value: itemName, inline: true },
      { name: "Amount", value: String(amount), inline: true },
      { name: "User", value: `${message.author}`, inline: true }
    )
    .setFooter({ text: "Approve or decline this order." });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("approve_order")
      .setLabel("APPROVE")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("decline_order")
      .setLabel("DENY")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("CLOSE TICKET")
      .setStyle(ButtonStyle.Secondary)
  );

  const ticketMessage = await ticketChannel.send({
    content: `<@&${APPROVER_ROLE_ID}> New order from ${message.author}`,
    embeds: [embed],
    components: [buttons]
  });

  ticketMessage.orderData = {
    action,
    tier,
    itemName,
    amount,
    user: message.author.username
  };

  global.orderTickets = global.orderTickets || {};
  global.orderTickets[ticketMessage.id] = ticketMessage.orderData;

  await message.reply(`✅ Ticket created: ${ticketChannel}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const member = interaction.member;

  const isApprover = member.roles.cache.has(APPROVER_ROLE_ID);

  if (
    interaction.customId === "approve_order" ||
    interaction.customId === "decline_order"
  ) {
    if (!isApprover) {
      return interaction.reply({
        content: "❌ You do not have permission to approve or deny orders.",
        ephemeral: true
      });
    }
  }

  if (interaction.customId === "close_ticket") {
    await interaction.reply("Closing ticket in 5 seconds...");
    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 5000);
    return;
  }

  const order = global.orderTickets?.[interaction.message.id];

  if (!order) {
    return interaction.reply({
      content: "❌ Order data not found.",
      ephemeral: true
    });
  }

  if (interaction.customId === "decline_order") {
    await interaction.reply("❌ Order declined.");
    return;
  }

  if (interaction.customId === "approve_order") {
    await interaction.reply("⏳ Updating Google Sheet...");

    const result = await updateGoogleSheet({
      action: order.action,
      tier: order.tier,
      item: order.itemName,
      amount: order.amount,
      user: order.user,
      approvedBy: interaction.user.username
    });

    await interaction.channel.send(`✅ ${result}`);
  }
});

function updateGoogleSheet(data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(SCRIPT_URL);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        resolve(body);
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

client.login(TOKEN);