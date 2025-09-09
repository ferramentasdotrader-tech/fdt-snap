// topo do arquivo (mantém seus imports atuais)
import fs from "fs/promises";
import path from "path";
import express from "express";
import chromium from "chromium";
import puppeteer from "puppeteer-core";
import { Telegraf } from "telegraf";

// --------- CONFIG ---------
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const CHART_URL = process.env.SNAP_URL || process.env.CHART_URL || "https://br.tradingview.com/chart/veTrTJ7Q/";

const TV_USER = process.env.TV_USER || "";
const TV_PASS = process.env.TV_PASS || "";

const TZ = process.env.TZ || "America/Sao_Paulo";
const SNAP_WAIT_MS = Number(process.env.SNAP_WAIT_MS || 0);

const COOKIE_PATH = "/tmp/tv_cookies.json";

if (!TELEGRAM_BOT_TOKEN || !CHAT_ID) {
  console.error("Faltando TELEGRAM_BOT_TOKEN ou CHAT_ID nas variáveis de ambiente.");
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// --------- HELPERS ---------
function toBrtISOString(ts) {
  const d = ts ? new Date(ts) : new Date();
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: TZ,
  }).format(d);
}

function fmtDetailed(payload) {
  const { product = "-", symbol = "-", price = "-", dir = "-", reason = "-", tf = "-", ts } = payload || {};
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
  const { product = "", symbol = "-", price = "-", dir = "-", tf = "-", reason = "" } = payload || {};
  const header = `${symbol} | ${dir} | ${price} | ${tf} | ${reason}`;
  const title = "📊 *Alerta TradingView – DZAT* 📊";
  return [
    header, "", title, "",
    `📦 *Produto:* ${product}`,
    `📈 *Ativo:* ${symbol}`,
    `⏱️ *Tempo Gráfico:* ${tf}`,
    `💰 *Preço:* ${price}`,
    `🎯 *Direção:* ${dir}`,
    `🧠 *Motivo:* ${reason}`,
    `⏰ *Horário (BRT):* ${toBrtISOString()}`
  ].join("\n");
}

async function sendText(payload) {
  const format = (payload?.fmt || payload?.format || "detailed").toLowerCase(); // "short" | "detailed"
  const message = format === "short" ? fmtShort(payload) : fmtDetailed(payload);
  await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });
}

// --- cookies util ---
async function tryLoadCookies(page) {
  try {
    const buf = await fs.readFile(COOKIE_PATH, "utf8");
    const cookies = JSON.parse(buf);
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      console.log("[TV] Cookies aplicados.");
    }
  } catch (_) {}
}
async function saveCookies(page) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(COOKIE_PATH, JSON.stringify(cookies), "utf8");
    console.log("[TV] Cookies salvos.");
  } catch (err) {
    console.warn("[TV] Falha ao salvar cookies:", err.message);
  }
}

async function pageShowsLogin(page) {
  const html = await page.content();
  // textos comuns quando bloqueia layout sem login
  return html.includes("precisará fazer login") || html.includes("Não podemos abrir este layout gráfico para você");
}

async function performLogin(page) {
  if (!TV_USER || !TV_PASS) return false;

  console.log("[TV] Tentando login…");
  await page.goto("https://www.tradingview.com/accounts/signin/", { waitUntil: "networkidle2", timeout: 120000 });

  // preenche e envia
  await page.waitForSelector('input[name="username"]', { timeout: 30000 });
  await page.type('input[name="username"]', TV_USER, { delay: 40 });
  await page.type('input[name="password"]', TV_PASS, { delay: 40 });

  // botão submit padrão
  const submitSel = 'button[type="submit"]';
  await page.click(submitSel);

  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 }).catch(() => {});
  console.log("[TV] Login enviado (se 2FA estiver ativo, isso falhará).");

  await saveCookies(page);
  return true;
}

async function takeSnapAndSend(urlOverride) {
  const url = urlOverride || CHART_URL;

  const browser = await puppeteer.launch({
    executablePath: chromium.path,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

    // 1) tenta com cookies
    await tryLoadCookies(page);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

    // 2) se bloqueado e temos credenciais -> login e recarrega
    if (await pageShowsLogin(page)) {
      console.log("[TV] Página exige login. Vou autenticar e recarregar o layout.");
      if (await performLogin(page)) {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
      }
    }

    if (SNAP_WAIT_MS > 0) await new Promise(r => setTimeout(r, SNAP_WAIT_MS));

    const buffer = await page.screenshot({ type: "png" });
    await bot.telegram.sendPhoto(CHAT_ID, { source: buffer });
  } finally {
    await browser.close();
  }
}

// --------- ROTAS ---------
app.get("/", (req, res) => {
  res.send("DZAT Snap is running 🚀");
});

app.post("/alert", async (req, res) => {
  try {
    const payload = req.body || {};
    const mode = (payload.mode || "").toLowerCase(); // "snap" | ""

    await sendText(payload);

    if (mode === "snap") {
      await takeSnapAndSend(payload.chart_url || CHART_URL);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro em /alert:", err);
    res.status(500).json({ ok: false, error: "Erro ao processar alerta" });
  }
});

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
