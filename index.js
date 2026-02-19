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

/* ================= ENV VARIABLES ================= */

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // Optional but recommended
const SECURITY_LOG_CHANNEL_ID = process.env.SECURITY_LOG_CHANNEL_ID;

/* ================= CONFIG ================= */

const ALLOWED_ROLE_IDS = [
  "1472483097722359829",
  "1471412345858162688"
];

const BGC_CHANNEL_ID = "1473052939290415204";
const COMMUNITY_GROUP_ID = 934910352;

const BLACKLIST_CSV =
  "https://docs.google.com/spreadsheets/d/1sGsiydgKaJPxQy7BRJSBdygle6I1iGtYR6rlJz-eY54/export?format=csv";

const LOW_ROBLOX_AGE_THRESHOLD = 30;
const LOW_DISCORD_AGE_THRESHOLD = 14;

/* ================= CLIENT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= REGISTER COMMAND ================= */

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
  try {
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log("✅ Guild slash command registered");
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log("✅ Global slash command registered");
    }
  } catch (err) {
    console.error("Slash registration error:", err);
  }
})();

/* ================= READY ================= */

client.once("ready", () => {
  console.log(`🛡️ Bot Online as ${client.user.tag}`);
});

/* ================= BLACKLIST CHECK ================= */

async function checkBlacklist(robloxName, discordId) {
  try {
    const res = await axios.get(`${BLACKLIST_CSV}&t=${Date.now()}`);
    const rows = res.data.split("\n");

    let inSection = false;

    for (const row of rows) {
      const cols = row.split(",").map(c => c.trim().toLowerCase());

      if (cols.some(c => c.includes("aetd blacklist"))) {
        inSection = true;
        continue;
      }

      if (!inSection) continue;

      if (cols.every(c => c === "")) continue;

      const sheetName = cols[1];
      const sheetDiscord = cols[2];

      if (
        sheetName === robloxName.toLowerCase() ||
        sheetDiscord === discordId
      ) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error("Blacklist error:", err);
    return false;
  }
}

/* ================= COMMAND HANDLER ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "bgc") return;

  if (interaction.channelId !== BGC_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ Use this command in the BGC channel.",
      ephemeral: true
    });
  }

  const allowed = ALLOWED_ROLE_IDS.some(role =>
    interaction.member.roles.cache.has(role)
  );

  if (!allowed) {
    return interaction.reply({
      content: "❌ You are not authorized.",
      ephemeral: true
    });
  }

  const username = interaction.options.getString("username");
  await interaction.deferReply();

  try {
    /* ===== DISCORD AGE ===== */

    const discordAge = Math.floor(
      (Date.now() - interaction.user.createdAt) /
      (1000 * 60 * 60 * 24)
    );

    /* ===== ROBLOX USER ===== */

    const userLookup = await axios.post(
      "https://users.roblox.com/v1/usernames/users",
      { usernames: [username] }
    );

    if (!userLookup.data.data.length) {
      return interaction.editReply("❌ Roblox user not found.");
    }

    const robloxUser = userLookup.data.data[0];
    const userId = robloxUser.id;

    const userInfo = await axios.get(
      `https://users.roblox.com/v1/users/${userId}`
    );

    const robloxAge = Math.floor(
      (Date.now() - new Date(userInfo.data.created)) /
      (1000 * 60 * 60 * 24)
    );

    /* ===== GROUP CHECK ===== */

    const groupData = await axios.get(
      `https://groups.roblox.com/v1/users/${userId}/groups/roles`
    );

    const groupMatch = groupData.data.data.find(
      g => g.group?.id === COMMUNITY_GROUP_ID
    );

    const rankName = groupMatch?.role?.name ?? "Not in group";
    const rankNumber = groupMatch?.role?.rank ?? "N/A";

    /* ===== BLACKLIST ===== */

    const blacklisted = await checkBlacklist(
      username,
      interaction.user.id
    );

    /* ===== EMBED COLOR LOGIC ===== */

    let color = 0x2ecc71;

    if (
      robloxAge < LOW_ROBLOX_AGE_THRESHOLD ||
      discordAge < LOW_DISCORD_AGE_THRESHOLD
    ) color = 0xf1c40f;

    if (blacklisted) color = 0xff0000;

    /* ===== EMBED ===== */

    const embed = new EmbedBuilder()
      .setTitle("AETD Background Check")
      .setColor(color)
      .addFields(
        { name: "Roblox Username", value: robloxUser.name },
        { name: "Roblox ID", value: String(userId) },
        { name: "Roblox Age", value: `${robloxAge} days` },
        { name: "Discord Age", value: `${discordAge} days` },
        { name: "Group Rank", value: `${rankName} (${rankNumber})` },
        {
          name: "Profile",
          value: `https://www.roblox.com/users/${userId}/profile`
        }
      )
      .setTimestamp();

    if (blacklisted) {
      embed.addFields({
        name: "🚫 BLACKLIST STATUS",
        value: "USER IS BLACKLISTED"
      });
    }

    await interaction.editReply({ embeds: [embed] });

    if (blacklisted && SECURITY_LOG_CHANNEL_ID) {
      const logChannel = await client.channels.fetch(
        SECURITY_LOG_CHANNEL_ID
      );
      logChannel?.send(
        `🚨 BLACKLIST ALERT\nUser: ${username}\nChecked by: ${interaction.user.tag}`
      );
    }

  } catch (err) {
    console.error(err);
    interaction.editReply("❌ Background check failed.");
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);
