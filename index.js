import express from "express";
import puppeteer from "puppeteer";
import { Telegraf } from "telegraf";

// --------- CONFIG ---------
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// VARIÁVEIS (Render -> Environment)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN; // compat
const CHAT_ID = process.env.CHAT_ID;
const CHART_URL = process.env.SNAP_URL || process.env.CHART_URL || "https://br.tradingview.com/chart/veTrTJ7Q/";

// Opcional: defina TZ=America/Sao_Paulo no Render p/ horário BRT automático
const TZ = process.env.TZ || "America/Sao_Paulo";

if (!TELEGRAM_BOT_TOKEN || !CHAT_ID) {
  console.error("Faltando TELEGRAM_BOT_TOKEN ou CHAT_ID nas variáveis de ambiente.");
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// --------- HELPERS ---------
function toBrtISOString(ts) {
  const d = ts ? new Date(ts) : new Date();
  // formata data/hora em pt-BR (BRT)
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: TZ,
  }).format(d);
}

function fmtDetailed(payload) {
  const {
    product = "-",
    symbol = "-",
    price = "-",
    dir = "-",
    reason = "-",
    tf = "-",
    ts,
  } = payload || {};

  const brt = toBrtISOString(ts);

  return [
    "📊 *Alerta TradingView – DZAT* 📊",
    "",
    `📦 *Produto:* ${product}`,
    `📈 *Ativo:* ${symbol}`,
    `⏱️ *Tempo Gráfico:* ${tf}`,
    `💰 *Preço:* ${price}`,
    `🎯 *Direção:* ${dir}`,
    `🧠 *Motivo:* ${reason}`,
    `⏰ *Horário (BRT):* ${brt}`,
  ].join("\n");
}

function fmtShort(payload) {
  const {
    product = "",
    symbol = "-",
    price = "-",
    dir = "-",
    tf = "-",
    reason = "",
  } = payload || {};

  // formato curto no topo (como você pediu)
  // EX: ETHUSDC.P | LONG | 4295.04 | 1 | setup-teste
  const header = `${symbol} | ${dir} | ${price} | ${tf} | ${reason}`;
  const title = "📊 *Alerta TradingView – DZAT* 📊";

  return [header, "", title, "", `📦 *Produto:* ${product}`, `📈 *Ativo:* ${symbol}`, `⏱️ *Tempo Gráfico:* ${tf}`, `💰 *Preço:* ${price}`, `🎯 *Direção:* ${dir}`, `🧠 *Motivo:* ${reason}`, `⏰ *Horário (BRT):* ${toBrtISOString()}`].join("\n");
}

async function sendText(payload) {
  const format = (payload?.fmt || payload?.format || "detailed").toLowerCase(); // "short" | "detailed"
  const message = format === "short" ? fmtShort(payload) : fmtDetailed(payload);
  await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });
}

async function takeSnapAndSend(urlOverride) {
  const url = urlOverride || CHART_URL;

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // viewport maior para imagem mais legível
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

    // carregar TradingView
    await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

    // (Opcional) Aguarda algum seletor estável antes de fotografar.
    // Exemplo: canvas principal do gráfico:
    // await page.waitForSelector('canvas', { timeout: 20000 }).catch(()=>{});

    // tira screenshot em buffer
    const buffer = await page.screenshot({ type: "png" });

    await bot.telegram.sendPhoto(CHAT_ID, { source: buffer });
  } finally {
    await browser.close();
  }
}

// --------- ROTAS ---------

// Healthcheck
app.get("/", (req, res) => {
  res.send("DZAT Snap is running 🚀");
});

// 🔸 /alert → recebe alerta do TradingView e envia TEXTO
// Se o payload tiver "mode":"snap", envia texto e depois a imagem
app.post("/alert", async (req, res) => {
  try {
    const payload = req.body || {};
    const mode = (payload.mode || "").toLowerCase(); // "snap" | ""

    await sendText(payload);

    if (mode === "snap") {
      // manda o gráfico na sequência
      await takeSnapAndSend(payload.chart_url || CHART_URL);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro em /alert:", err);
    return res.status(500).json({ ok: false, error: "Erro ao processar alerta" });
  }
});

// 🔸 /snap → só tira o print e envia (útil p/ teste manual)
app.get("/snap", async (req, res) => {
  try {
    await takeSnapAndSend(req.query.url || CHART_URL);
    res.send("✅ Screenshot enviada ao Telegram!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao capturar screenshot");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
