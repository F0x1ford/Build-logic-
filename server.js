
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");
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

// -----------------------------
// ENCODAGE INTENSBLAPLITE
// -----------------------------

function cleanSid(value) {
  return String(value || "").trim().slice(0, 10);
}

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

  if (
    Object.prototype.hasOwnProperty.call(
      symbolCodes,
      character
    )
  ) {
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

// -----------------------------
// AUTHENTIFICATION API
// -----------------------------

function authorized(key) {
  if (!API_KEY || !key) return false;

  const a = Buffer.from(String(key));
  const b = Buffer.from(API_KEY);

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

function requireApiKey(req, res, next) {
  if (!authorized(req.params.apiKey)) {
    console.log("[API] Accès refusé");

    return res.status(403).json({
      value: "UNAUTHORIZED",
      error: "Invalid API key"
    });
  }

  next();
}

// -----------------------------
// BOT DISCORD
// -----------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(
    `[DISCORD] Connecté : ${readyClient.user.tag}`,
    true
  );
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (
    DISCORD_CHANNEL_ID &&
    message.channelId !== DISCORD_CHANNEL_ID
  ) {
    return;
  }

  if (message.content === "!logichelp") {
    await message.reply(
      "Commandes disponibles :\n" +
      "`!logic <message>` : envoyer vers Build Logic\n" +
      "`!logichelp` : afficher cette aide"
    );

    return;
  }

  if (!message.content.startsWith("!logic ")) {
    return;
  }

  const text = message.content.slice(7).trim();

  if (!text) {
    await message.reply(
      "Écris un message après `!logic`."
    );
    return;
  }

  if (!BUILD_LOGIC_SID) {
    await message.reply(
      "Erreur : SID Build Logic non configuré."
    );
    console.error("[ERREUR] BUILD_LOGIC_SID manquant");
    return;
  }

  const limitedText = [...text].slice(0, 512).join("");

  // Enregistrement de la session
  sessions.set(BUILD_LOGIC_SID, {
    text: limitedText,
    index: 0
  });

  console.log("[DEBUG SAVE]", {
    sid: BUILD_LOGIC_SID,
    text: limitedText,
    sessionExists: sessions.has(BUILD_LOGIC_SID)
  });

  console.log(
    `[DISCORD -> BUILD LOGIC] ${[...limitedText].length} caractères enregistrés`
  );

  await message.reply(
    "Message enregistré pour Build Logic !"
  );
});

// -----------------------------
// PAGE D'ACCUEIL
// -----------------------------

app.get("/", (_req, res) => {
  res.type("html").send(`
    <h1>Build Logic Discord Bridge</h1>
    <p>Serveur opérationnel.</p>
    <p>Lecture : /typewriter/read</p>
    <p>Santé : /health</p>
  `);
});

// -----------------------------
// TEST SANTE
// -----------------------------

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Build Logic Discord Bridge"
  });
});

// -----------------------------
// DISCORD -> BUILD LOGIC
// -----------------------------

app.get("/typewriter/read", (req, res) => {
  const sid = cleanSid(req.get("sid"));

  if (!sid) {
    console.log("[READ ERROR] SID manquant");

    return res.status(400).json({
      error: "Missing sid header"
    });
  }

  const session = sessions.get(sid);

  console.log("[DEBUG READ]", {
    sid: sid,
    sessionExists: !!session,
    index: session ? session.index : null,
    text: session ? session.text : null
  });

  // Valeur témoin temporaire quand aucune session n'existe
  if (!session) {
    console.log("[READ TEST] Session inexistante : 00000001");

    return res.json({
      value: "00000001"
    });
  }

  const characters = [...session.text];

  // Fin du message
  if (session.index >= characters.length) {
    console.log("[READ TEST] Fin du message : 00000001");

    return res.json({
      value: "00000001"
    });
  }

  // Encodage du caractère suivant
  const character = characters[session.index];
  const value = encodeCharacter(character);

  session.index += 1;

  console.log("[READ]", {
    sid: sid,
    character: character,
    value: value,
    nextIndex: session.index
  });

  return res.json({
    value: value
  });
});

// -----------------------------
// BUILD LOGIC -> DISCORD
// -----------------------------

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

      console.log(
        `[BUILD LOGIC -> DISCORD] ${value}`
      );

      return res.json({
        value: "OK"
      });

    } catch (error) {
      console.error(
        "[ERREUR ENVOI DISCORD]",
        error
      );

      return res.status(500).json({
        value: "ERROR",
        error: "Discord send failed"
      });
    }
  }
);

// -----------------------------
// DEMARRAGE SERVEUR
// -----------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[SERVER] Serveur lancé sur le port ${PORT}`
  );
});

// -----------------------------
// CONNEXION DISCORD
// -----------------------------

if (!DISCORD_TOKEN) {
  console.error(
    "[ERREUR] DISCORD_TOKEN manquant"
  );
} else {
  client.login(DISCORD_TOKEN).catch((error) => {
    console.error(
      "[ERREUR CONNEXION DISCORD]",
      error
    );
  });
}
