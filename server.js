
const express = require("express");
const { Client, GatewayIntentBits, Events } = require("discord.js");
const crypto = require("crypto");

const app = express();

app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 10000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const API_KEY = process.env.API_KEY;
const BUILD_LOGIC_SID = String(
  process.env.BUILD_LOGIC_SID || ""
).trim().slice(0, 10);

const sessions = new Map();

function cleanSid(value) {
  return String(value || "").trim().slice(0, 10);
}

// Encodage original IntensBLAPlite : conservé.
function encodeCharacter(character) {
  const symbolCodes = {
    ".": "100111",
    '"': "110111",
    ";": "101001",
    ",": "101000",
    "-": "100101",
    "[": "110101",
    "]": "110110",
    "/": "101010"
  };

  if (Object.prototype.hasOwnProperty.call(symbolCodes, character)) {
    return "10" + symbolCodes[character];
  }

  if (character === " ") {
    return "10000000";
  }

  const upper = character.toUpperCase();

  if (!/^[A-Z]$/.test(upper)) {
    return "10000000";
  }

  const letterNumber = upper.charCodeAt(0) - 64;
  const sixBits = letterNumber.toString(2).padStart(6, "0");
  const shiftBit = character === upper ? "1" : "0";

  return "1" + shiftBit + sixBits;
}

function authorized(key) {
  if (!API_KEY || !key) return false;

  const a = Buffer.from(String(key));
  const b = Buffer.from(API_KEY);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function requireApiKey(req, res, next) {
  if (!authorized(req.params.apiKey)) {
    return res.status(403).json({
      value: "UNAUTHORIZED",
      error: "Invalid API key"
    });
  }

  next();
}

// Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[DISCORD] Connecté : ${readyClient.user.tag}`);
});

// Commandes Discord
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (
    DISCORD_CHANNEL_ID &&
    message.channelId !== DISCORD_CHANNEL_ID
  ) return;

  if (message.content === "!logichelp") {
    await message.reply(
      "Commandes disponibles :\n" +
      "`!logic <message>` : envoyer un texte vers Build Logic\n" +
      "`!logichelp` : afficher cette aide"
    );
    return;
  }

  if (!message.content.startsWith("!logic ")) return;

  const text = message.content.slice(7).trim();

  if (!text) {
    await message.reply("Écris un message après `!logic`.");
    return;
  }

  if (!BUILD_LOGIC_SID) {
    await message.reply("Erreur : le SID Build Logic n'est pas configuré.");
    return;
  }

  const limitedText = [...text].slice(0, 512).join("");

  sessions.set(BUILD_LOGIC_SID, {
    text: limitedText,
    index: 0
  });

  console.log(
    `[DISCORD -> BUILD LOGIC] ${limitedText.length} caractères enregistrés`
  );

  await message.reply("Message enregistré pour Build Logic !");
});

// Page d'accueil
app.get("/", (_req, res) => {
  res.type("html").send(`
    <h1>Build Logic Discord Bridge</h1>
    <p>Serveur opérationnel.</p>
    <p>Lecture : /typewriter/read (header sid requis)</p>
    <p>Santé : /health</p>
  `);
});

// Santé du serveur
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Lecture IntensBLAPlite
app.get("/typewriter/read", (req, res) => {
  const sid = cleanSid(req.get("sid"));

  if (!sid) {
    return res.status(400).json({
      error: "Missing sid header"
    });
  }

  const session = sessions.get(sid);

  if (!session || session.index >= [...session.text].length) {
    return res.json({ value: "00000001" });
  }

  const characters = [...session.text];
  const value = encodeCharacter(characters[session.index]);

  session.index += 1;

  console.log(`[READ] SID=${sid} VALUE=${value}`);

  return res.json({ value });
});

// Build Logic -> Discord
app.post(
  "/api/:apiKey/game/send",
  requireApiKey,
  async (req, res) => {
    const value = String(
      req.body.value || ""
    ).slice(0, 1500);

    if (!value.trim()) {
      return res.status(400).json({
        value: "ERROR",
        error: "Missing value"
      });
    }

    try {
      const channel = await client.channels.fetch(
        DISCORD_CHANNEL_ID
      );

      if (!channel || !channel.isTextBased()) {
        throw new Error("Salon Discord introuvable");
      }

      await channel.send(value);

      console.log(`[BUILD LOGIC -> DISCORD] ${value}`);

      return res.json({ value: "OK" });

    } catch (error) {
      console.error("[ERREUR DISCORD]", error);

      return res.status(500).json({
        value: "ERROR",
        error: "Discord send failed"
      });
    }
  }
);

// Démarrage
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[SERVER] Serveur lancé sur le port ${PORT}`);
});

if (!DISCORD_TOKEN) {
  console.error("[ERREUR] DISCORD_TOKEN manquant");
} else {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error("[ERREUR CONNEXION DISCORD]", error);
  });
}
