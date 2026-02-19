require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");
const axios = require("axios");

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SECURITY_LOG_CHANNEL_ID = process.env.SECURITY_LOG_CHANNEL_ID;

const ALLOWED_ROLE_IDS = [
  "1472483097722359829",
  "1471412345858162688"
];

const BGC_CHANNEL_ID = "1473052939290415204";
const COMMUNITY_GROUP_ID = 934910352;

const BLACKLIST_CSV =
  "https://docs.google.com/spreadsheets/d/1sGsiydgKaJPxQy7BRJSBdygle6I1iGtYR6rlJz-eY54/export?format=csv&gid=0";

const LOW_ROBLOX_AGE_THRESHOLD = 30;
const LOW_DISCORD_AGE_THRESHOLD = 14;

/* ================= CLIENT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= SLASH COMMAND ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("bgc")
    .setDescription("Run AETD background check")
    .addStringOption(option =>
      option
        .setName("username")
        .setDescription("Roblox username")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands
  });
  console.log("✅ Slash command registered");
})();

/* ================= READY ================= */

client.once("ready", () => {
  console.log(`🛡️ AETD BGC Bot Online as ${client.user.tag}`);
});

/* ================= HELPER: CHECK BLACKLIST ================= */

async function checkBlacklist(robloxName, discordId) {
  try {
    // Cache bypass added
    const res = await axios.get(`${BLACKLIST_CSV}&t=${Date.now()}`);
    const rows = res.data.split("\n").slice(1); // skip header row

    for (const row of rows) {
      const cols = row.split(",");

      // Your sheet structure:
      // Column C = Name (index 2)
      // Column D = Discord ID (index 3)

      const sheetName = cols[2]?.trim().toLowerCase();
      const sheetDiscord = cols[3]?.trim();

      if (
        sheetName === robloxName.toLowerCase() ||
        sheetDiscord === discordId
      ) {
        return { blacklisted: true };
      }
    }

    return { blacklisted: false };
  } catch (err) {
    console.error("Blacklist fetch error:", err);
    return { blacklisted: false };
  }
}

/* ================= COMMAND HANDLER ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "bgc") return;

  if (interaction.channelId !== BGC_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ Use this command in the BGC channel only.",
      ephemeral: true
    });
  }

  const hasPermission = ALLOWED_ROLE_IDS.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!hasPermission) {
    return interaction.reply({
      content: "❌ You are not authorized.",
      ephemeral: true
    });
  }

  const username = interaction.options.getString("username");
  await interaction.deferReply();

  try {
    /* ===== DISCORD AGE ===== */

    const discordCreated = interaction.user.createdAt;
    const discordAgeDays = Math.floor(
      (Date.now() - discordCreated.getTime()) / (1000 * 60 * 60 * 24)
    );

    /* ===== ROBLOX USER FETCH ===== */

    const userRes = await axios.post(
      "https://users.roblox.com/v1/usernames/users",
      {
        usernames: [username],
        excludeBannedUsers: false
      }
    );

    if (!userRes.data.data.length) {
      return interaction.editReply("❌ Roblox user not found.");
    }

    const user = userRes.data.data[0];
    const userId = user.id;

    const infoRes = await axios.get(
      `https://users.roblox.com/v1/users/${userId}`
    );

    const createdDate = new Date(infoRes.data.created);
    const robloxAgeDays = Math.floor(
      (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    /* ===== GROUP CHECK ===== */

    const groupsRes = await axios.get(
      `https://groups.roblox.com/v1/users/${userId}/groups/roles`
    );

    const match = groupsRes.data.data.find(
      g => g.group?.id === COMMUNITY_GROUP_ID
    );

    const rankName = match?.role?.name ?? "Not in group";
    const rankNumber = match?.role?.rank ?? "N/A";

    /* ===== BLACKLIST CHECK ===== */

    const blacklist = await checkBlacklist(username, interaction.user.id);

    /* ===== EMBED COLOR LOGIC ===== */

    let embedColor = 0x2ecc71;

    if (
      robloxAgeDays < LOW_ROBLOX_AGE_THRESHOLD ||
      discordAgeDays < LOW_DISCORD_AGE_THRESHOLD
    ) {
      embedColor = 0xf1c40f;
    }

    if (blacklist.blacklisted) {
      embedColor = 0xff0000;
    }

    /* ===== BUILD EMBED ===== */

    const embed = new EmbedBuilder()
      .setTitle("AETD Background Check Report")
      .setColor(embedColor)
      .addFields(
        { name: "Roblox Username", value: user.name },
        { name: "Roblox ID", value: String(userId) },
        { name: "Roblox Account Age", value: `${robloxAgeDays} days` },
        { name: "Discord Account Age", value: `${discordAgeDays} days` },
        { name: "Group Rank", value: `${rankName} (Rank ${rankNumber})` },
        {
          name: "Profile Link",
          value: `https://www.roblox.com/users/${userId}/profile`
        }
      )
      .setFooter({ text: `Checked by ${interaction.user.tag}` })
      .setTimestamp();

    if (blacklist.blacklisted) {
      embed.addFields({
        name: "🚫 BLACKLIST STATUS",
        value: `User is BLACKLISTED`
      });
    }

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] } // prevents accidental pings
    });

    /* ===== SECURITY LOGGING ===== */

    if (blacklist.blacklisted) {
      const logChannel = await client.channels.fetch(
        SECURITY_LOG_CHANNEL_ID
      );

      if (logChannel) {
        logChannel.send(
          `🚨 BLACKLIST ALERT\nUser: ${username}\nChecked by: ${interaction.user.tag}`
        );
      }
    }

  } catch (err) {
    console.error(err);
    interaction.editReply("❌ Error running background check.");
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);
    
