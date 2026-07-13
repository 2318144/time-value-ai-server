const express = require("express");
const cors = require("cors");
const multer = require("multer");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

dotenv.config();

const app = express();

const SERVER_VERSION = "separated-result-v4";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json());

// =====================================
// Gemini初期化
// =====================================

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "注意：GEMINI_API_KEY が環境変数に設定されていません"
  );
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// =====================================
// JSON Schema
// =====================================

const analysisSchema = {
  type: "object",

  properties: {
    emotion: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "本人の感情や印象の強さを0から5までの整数で評価する"
    },

    experience: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "経験の新しさ、挑戦、非日常性を0から5までの整数で評価する"
    },

    people: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "家族、友人、仲間など人との関わりを0から5までの整数で評価する"
    },

    learning: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "学び、気付き、成長につながる度合いを0から5までの整数で評価する"
    },

    special: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "本人にとっての記念性、希少性、特別性を0から5までの整数で評価する"
    },

    summary: {
      type: "string",
      description:
        "写真に直接写っている人物、物、場所、行動、雰囲気だけを説明する。メモ、日時、位置情報、予定は使わない"
    },

    contextMeaning: {
      type: "string",
      description:
        "カテゴリ、本人のメモ、撮影日時、位置情報、カレンダー予定から分かる撮影時の背景や状況を説明する。写真の視覚的説明を繰り返さない"
    },

    valueReason: {
      type: "string",
      description:
        "この時間が本人にとって、なぜ将来残す価値のある時間なのかを説明する。写真の見た目や撮影状況の説明だけにしない"
    },

    reason: {
      type: "string",
      description:
        "emotion、experience、people、learning、specialの5項目について、それぞれ何点にしたかと具体的な採点根拠だけを説明する"
    }
  },

  required: [
    "emotion",
    "experience",
    "people",
    "learning",
    "special",
    "summary",
    "contextMeaning",
    "valueReason",
    "reason"
  ]
};

// =====================================
// 基本ルート
// =====================================

app.get("/", (req, res) => {
  res.send(
    `Time Value AI Server is running. Version: ${SERVER_VERSION}`
  );
});

app.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "server is working",
    serverVersion: SERVER_VERSION
  });
});

// =====================================
// Gemini接続確認
// =====================================

app.get("/analyze-test", async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",

      contents: [
        {
          role: "user",
          parts: [
            {
              text: 'JSONで {"status":"ok"} のみ返してください。'
            }
          ]
        }
      ],

      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",

          properties: {
            status: {
              type: "string"
            }
          },

          required: ["status"]
        }
      }
    });

    const responseText = response.text || "{}";
    const result = JSON.parse(cleanJsonText(responseText));

    return res.json({
      status: "ok",
      serverVersion: SERVER_VERSION,
      geminiResponse: result
    });

  } catch (error) {
    console.error("Gemini接続確認エラー:", error);

    return res.status(500).json({
      status: "error",
      serverVersion: SERVER_VERSION,
      message: error.message
    });
  }
});

// =====================================
// AI評価
// =====================================

app.post(
  "/analyze",
  upload.array("photos"),
  async (req, res) => {
    try {
      const memo = String(req.body.memo || "").trim();
      const category = String(req.body.category || "").trim();
      const files = req.files || [];

      let photoContexts = [];

      try {
        const parsed = JSON.parse(
          req.body.photoContexts || "[]"
        );

        photoContexts = Array.isArray(parsed)
          ? parsed
          : [];

      } catch (error) {
        console.error(
          "photoContexts解析エラー:",
          error
        );

        photoContexts = [];
      }

      console.log("====================================");
      console.log("AIリクエストを受信しました");
      console.log("サーバーバージョン:", SERVER_VERSION);
      console.log("カテゴリ:", category);
      console.log("メモ:", memo);
      console.log("写真枚数:", files.length);
      console.log(
        "写真情報:",
        JSON.stringify(photoContexts, null, 2)
      );
      console.log("====================================");

      if (files.length === 0) {
        return res.status(400).json({
          status: "error",
          serverVersion: SERVER_VERSION,
          error: "写真がありません"
        });
      }

      // Geminiへ送信する写真は最大3枚
      const imageParts = files
        .slice(0, 3)
        .map((file) => ({
          inlineData: {
            mimeType:
              file.mimetype || "image/jpeg",

            data:
              file.buffer.toString("base64")
          }
        }));

      const prompt = createAnalysisPrompt({
        category,
        memo,
        photoContexts,
        fileCount: files.length
      });

      console.log("Geminiへ送信中...");

      const response =
        await ai.models.generateContent({
          model: "gemini-2.5-flash",

          contents: [
            {
              role: "user",

              parts: [
                {
                  text: prompt
                },

                ...imageParts
              ]
            }
          ],

          config: {
            responseMimeType:
              "application/json",

            responseSchema:
              analysisSchema,

            temperature: 0.5
          }
        });

      const responseText =
        response.text || "";

      console.log(
        "Geminiから返答を受信しました"
      );

      console.log(responseText);

      if (!responseText.trim()) {
        throw new Error(
          "Geminiから空の応答が返されました"
        );
      }

      let result;

      try {
        result = JSON.parse(
          cleanJsonText(responseText)
        );

      } catch (error) {
        console.error(
          "JSON解析対象:",
          responseText
        );

        throw new Error(
          "Geminiの応答をJSONとして解析できませんでした：" +
          error.message
        );
      }

      // =================================
      // 点数を0～5に補正
      // =================================

      const emotion =
        normalizeScore(result.emotion);

      const experience =
        normalizeScore(result.experience);

      const people =
        normalizeScore(result.people);

      const learning =
        normalizeScore(result.learning);

      const special =
        normalizeScore(result.special);

      // =================================
      // 各文章を別々に取得
      // =================================

      let summary = normalizeText(
        result.summary,
        "写真そのものの意味を取得できませんでした。"
      );

      let contextMeaning = normalizeText(
        result.contextMeaning,
        "日時やメモなどから文脈的な意味を取得できませんでした。"
      );

      let valueReason = normalizeText(
        result.valueReason,
        "この時間が持つ価値の理由を取得できませんでした。"
      );

      let reason = normalizeText(
        result.reason,
        "各項目の点数評価理由を取得できませんでした。"
      );

      // =================================
      // 同一文章チェック
      // =================================

      const duplicateFields =
        findDuplicateFields({
          summary,
          contextMeaning,
          valueReason,
          reason
        });

      if (duplicateFields.length > 0) {
        console.warn(
          "文章の重複を検出:",
          duplicateFields
        );

        const regenerated =
          await regenerateDescriptions({
            category,
            memo,
            photoContexts,
            summary,
            contextMeaning,
            valueReason,
            reason,
            scores: {
              emotion,
              experience,
              people,
              learning,
              special
            }
          });

        summary = normalizeText(
          regenerated.summary,
          summary
        );

        contextMeaning = normalizeText(
          regenerated.contextMeaning,
          contextMeaning
        );

        valueReason = normalizeText(
          regenerated.valueReason,
          valueReason
        );

        reason = normalizeText(
          regenerated.reason,
          reason
        );
      }

      const onePhotoScore =
        emotion +
        experience +
        people +
        learning +
        special;

      /*
        現在は写真群全体を1回で評価しているため、
        写真枚数は掛けません。
      */
      const totalScore = onePhotoScore;

      const responseData = {
        status: "ok",
        serverVersion: SERVER_VERSION,

        emotion,
        experience,
        people,
        learning,
        special,

        summary,
        contextMeaning,
        valueReason,
        reason,

        onePhotoScore,
        totalScore,
        photoCount: files.length
      };

      console.log(
        "アプリへ返すデータ:"
      );

      console.log(
        JSON.stringify(
          responseData,
          null,
          2
        )
      );

      return res.json(responseData);

    } catch (error) {
      console.error(
        "========== ERROR =========="
      );

      console.error(error);

      console.error(
        "==========================="
      );

      return res.status(500).json({
        status: "error",
        serverVersion: SERVER_VERSION,
        error: "AI評価に失敗しました",
        detail: error.message
      });
    }
  }
);

// =====================================
// プロンプト生成
// =====================================

function createAnalysisPrompt({
  category,
  memo,
  photoContexts,
  fileCount
}) {
  return `
あなたは「時間の価値の可視化」アプリで使用する分析AIです。

写真と付随情報を分析し、4種類の文章を、それぞれ異なる観点から作成してください。

【1：summary】

写真に直接写っている内容だけを説明してください。

対象：
・人物
・物
・場所
・行動
・表情
・雰囲気

禁止：
・本人のメモを使うこと
・日時を使うこと
・位置情報を使うこと
・カレンダー予定を使うこと
・写真に写っていない出来事を断定すること

summaryは、写真の視覚的説明です。

【2：contextMeaning】

写真の付随情報から、撮影時の背景や状況を説明してください。

使用してよい情報：
・カテゴリ
・本人のメモ
・撮影日時
・位置情報
・カレンダー予定

禁止：
・summaryと同じ写真説明を繰り返すこと
・存在しない位置情報や予定を作ること

contextMeaningは、撮影時の状況や背景です。

【3：valueReason】

この時間が本人にとって、なぜ将来残す価値のある時間なのかを説明してください。

観点：
・感情
・経験
・人との関係
・学び
・特別性
・将来振り返る意味

禁止：
・写真の見た目だけを説明すること
・撮影日時や予定を並べるだけにすること
・点数の説明をすること

valueReasonは、この思い出を残す価値の説明です。

【4：reason】

以下の5項目について、何点にしたかと、その具体的な採点根拠を説明してください。

・emotion
・experience
・people
・learning
・special

禁止：
・写真の説明だけを書くこと
・思い出を残す価値だけを書くこと
・summary、contextMeaning、valueReasonをまとめ直すこと

reasonは、5項目の採点理由です。

【入力情報】

カテゴリ：
${category || "未設定"}

本人のメモ：
${memo || "メモなし"}

写真枚数：
${fileCount}枚

写真の付随情報：
${JSON.stringify(photoContexts, null, 2)}

【評価基準】

emotion：
本人の感情や印象の強さ

experience：
経験の新しさ、挑戦、非日常性

people：
家族、友人、仲間など人との関わり

learning：
学び、気付き、成長

special：
記念性、希少性、特別性

各項目を0から5までの整数で評価してください。

【重要な制約】

・summary、contextMeaning、valueReason、reasonは必ず異なる文章にしてください。
・同じ文章を複数項目へ書かないでください。
・単なる言い換えも避けてください。
・各文章は1～3文で書いてください。
・不明な情報を事実として断定しないでください。
・位置情報がない場合は、場所を推測しないでください。
・予定がない場合は、予定を作らないでください。
・空文字は禁止です。
・JSON以外は出力しないでください。
`;
}

// =====================================
// 重複時の再生成
// =====================================

async function regenerateDescriptions({
  category,
  memo,
  photoContexts,
  summary,
  contextMeaning,
  valueReason,
  reason,
  scores
}) {
  const prompt = `
以下の4文章には、内容の重複または役割の混在があります。

4つをそれぞれ異なる役割の文章として書き直してください。

summary：
写真に視覚的に写っている内容だけを書く。

contextMeaning：
カテゴリ、メモ、日時、位置、予定から分かる背景だけを書く。

valueReason：
この時間を将来残す価値だけを書く。

reason：
5項目の点数と採点根拠だけを書く。

【現在の文章】

summary：
${summary}

contextMeaning：
${contextMeaning}

valueReason：
${valueReason}

reason：
${reason}

【入力情報】

カテゴリ：
${category || "未設定"}

メモ：
${memo || "メモなし"}

写真情報：
${JSON.stringify(photoContexts, null, 2)}

点数：
${JSON.stringify(scores, null, 2)}

4文章は同じ内容にせず、それぞれ1～3文で書いてください。
JSON以外は出力しないでください。
`;

  const response =
    await ai.models.generateContent({
      model: "gemini-2.5-flash",

      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],

      config: {
        responseMimeType:
          "application/json",

        responseSchema: {
          type: "object",

          properties: {
            summary: {
              type: "string",
              description:
                "写真の視覚的内容だけを書く"
            },

            contextMeaning: {
              type: "string",
              description:
                "付随情報から分かる背景だけを書く"
            },

            valueReason: {
              type: "string",
              description:
                "この時間を残す価値だけを書く"
            },

            reason: {
              type: "string",
              description:
                "5項目の点数と採点根拠だけを書く"
            }
          },

          required: [
            "summary",
            "contextMeaning",
            "valueReason",
            "reason"
          ]
        },

        temperature: 0.7
      }
    });

  const text = response.text || "{}";

  return JSON.parse(
    cleanJsonText(text)
  );
}

// =====================================
// 補助関数
// =====================================

function cleanJsonText(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function normalizeScore(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      5,
      Math.round(number)
    )
  );
}

function normalizeText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const text = value.trim();

  if (!text) {
    return fallback;
  }

  return text;
}

function normalizeForComparison(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[。、,.!?！？「」『』（）()]/g, "")
    .toLowerCase();
}

function areTextsSimilar(textA, textB) {
  const a =
    normalizeForComparison(textA);

  const b =
    normalizeForComparison(textB);

  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  if (
    a.includes(b) ||
    b.includes(a)
  ) {
    return true;
  }

  const shorter =
    a.length <= b.length
      ? a
      : b;

  const longer =
    a.length > b.length
      ? a
      : b;

  let matchedCharacters = 0;

  for (const character of shorter) {
    if (longer.includes(character)) {
      matchedCharacters++;
    }
  }

  const similarity =
    matchedCharacters /
    shorter.length;

  return similarity >= 0.9;
}

function findDuplicateFields({
  summary,
  contextMeaning,
  valueReason,
  reason
}) {
  const entries = [
    ["summary", summary],
    ["contextMeaning", contextMeaning],
    ["valueReason", valueReason],
    ["reason", reason]
  ];

  const duplicates = [];

  for (
    let i = 0;
    i < entries.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < entries.length;
      j++
    ) {
      const [nameA, textA] =
        entries[i];

      const [nameB, textB] =
        entries[j];

      if (
        areTextsSimilar(
          textA,
          textB
        )
      ) {
        duplicates.push(
          `${nameA}と${nameB}`
        );
      }
    }
  }

  return duplicates;
}

// =====================================
// サーバー起動
// =====================================

const port =
  process.env.PORT || 3000;

app.listen(port, () => {
  console.log("================================");
  console.log("Server running!");
  console.log("Version:", SERVER_VERSION);
  console.log("Port:", port);
  console.log("================================");
});
