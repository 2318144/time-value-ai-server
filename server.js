const express = require("express");
const cors = require("cors");
const multer = require("multer");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
  console.log("注意：GEMINI_API_KEY が .env に設定されていません");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.get("/", (req, res) => {
  res.send("Time Value AI Server is running.");
});

app.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "server is working"
  });
});

app.get("/analyze-test", async (req, res) => {
  try {
    console.log("Gemini API 接続テスト開始");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "こんにちは。JSONで {\"status\":\"ok\"} だけ返してください。"
    });

    console.log("Gemini API 接続テスト結果:");
    console.log(response.text);

    res.json({
      status: "ok",
      geminiResponse: response.text
    });

  } catch (error) {
    console.log("Gemini API 接続テスト失敗");
    console.log(error);

    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

app.post("/analyze", upload.array("photos"), async (req, res) => {
  console.log("====================================");
  console.log("AIリクエストを受信しました");
  console.log("カテゴリ:", req.body.category);
  console.log("メモ:", req.body.memo);
  console.log("写真枚数:", req.files ? req.files.length : 0);
  console.log("====================================");

  try {
    const memo = req.body.memo || "";
    const category = req.body.category || "";
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ error: "写真がありません" });
    }

    const imageParts = files.slice(0, 3).map((file) => ({
      inlineData: {
        mimeType: file.mimetype,
        data: file.buffer.toString("base64")
      }
    }));

    const prompt = `
あなたは「時間の価値の可視化」アプリの評価AIです。

写真、カテゴリ、メモをもとに、思い出の価値を評価してください。

カテゴリ：${category}
メモ：${memo}
写真枚数：${files.length}枚

以下の5項目を0〜5点で評価してください。

emotion：感情の強さ
experience：経験の新しさ
people：人との関わり
learning：学び・成長
special：特別感・希少性

必ずJSONだけで返してください。

{
  "emotion": 0,
  "experience": 0,
  "people": 0,
  "learning": 0,
  "special": 0,
  "reason": "評価理由"
}
`;

    console.log("Geminiへ送信中...");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...imageParts
          ]
        }
      ]
    });

    console.log("Geminiから返答を受信しました");
    console.log(response.text);

    let text = response.text;
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const result = JSON.parse(text);

    const onePhotoScore =
      Number(result.emotion) +
      Number(result.experience) +
      Number(result.people) +
      Number(result.learning) +
      Number(result.special);

    const totalScore = onePhotoScore * files.length;

    res.json({
      ...result,
      onePhotoScore,
      totalScore,
      photoCount: files.length
    });

  } catch (error) {
    console.log("========== ERROR ==========");
    console.log(error);
    console.log("===========================");

    res.status(500).json({
      error: "AI評価に失敗しました",
      detail: error.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("================================");
  console.log("Server running!");
  console.log("http://localhost:" + port);
  console.log("http://localhost:" + port + "/test");
  console.log("http://localhost:" + port + "/analyze-test");
  console.log("================================");
});