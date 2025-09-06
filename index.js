import express from "express";
import puppeteer from "puppeteer";
import { Telegraf } from "telegraf";

const app = express();
const PORT = process.env.PORT || 3000;

// variáveis de ambiente (Render → Settings → Environment)
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const CHART_URL = process.env.CHART_URL || "https://br.tradingview.com/chart/veTrTJ7Q/";

const bot = new Telegraf(BOT_TOKEN);

// rota básica para manter serviço vivo
app.get("/", (req, res) => {
  res.send("DZAT Snap is running 🚀");
});

// rota que tira print e envia pro Telegram
app.get("/snap", async (req, res) => {
  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.goto(CHART_URL, { waitUntil: "networkidle2" });

    const path = "chart.png";
    await page.screenshot({ path });
    await browser.close();

    await bot.telegram.sendPhoto(CHAT_ID, { source: path });

    res.send("✅ Screenshot enviada pro Telegram!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao capturar screenshot");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
