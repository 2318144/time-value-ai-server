const express = require("express");
const cors = require("cors");
const multer = require("multer");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

dotenv.config();

// =====================================
// 基本設定
// =====================================

const app = express();

const SERVER_VERSION = "context-time-location-v7";

const PORT = process.env.PORT || 3000;

const MAX_PHOTO_COUNT = 10;
const MAX_AI_PHOTO_COUNT = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: MAX_PHOTO_COUNT,
    fileSize: MAX_FILE_SIZE
  }
});

// =====================================
// Gemini初期化
// =====================================

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "注意：GEMINI_API_KEYが環境変数に設定されていません。"
  );
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// =====================================
// Geminiの出力形式
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
        "家族、友人、仲間など、人との関わりを0から5までの整数で評価する"
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
        "写真だけから確認できる人物、物、場所、行動、表情、雰囲気を説明する。メモ、日時、位置情報、カレンダー予定は使わない"
    },

    contextMeaning: {
      type: "string",
      description:
        "カテゴリ、本人のメモ、撮影日時、位置情報、カレンダー予定から分かる撮影時の背景や状況を説明する。撮影日時がある場合は日付または時間帯に触れ、位置情報がある場合はその存在に触れ、予定がある場合は写真との関係に触れる"
    },

    valueReason: {
      type: "string",
      description:
        "この時間が本人にとって、なぜ将来残す価値のある時間なのかを説明する"
    },

    reason: {
      type: "string",
      description:
        "emotion、experience、people、learning、specialの5項目について、それぞれ何点にしたかと具体的な採点根拠を説明する"
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
              text:
                'JSONで {"status":"ok"} のみ返してください。'
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

    const result = JSON.parse(
      cleanJsonText(responseText)
    );

    return res.json({
      status: "ok",
      serverVersion: SERVER_VERSION,
      geminiResponse: result
    });

  } catch (error) {
    console.error(
      "Gemini接続確認エラー:",
      error
    );

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
      const memo = String(
        req.body.memo || ""
      ).trim();

      const category = String(
        req.body.category || ""
      ).trim();

      const files = req.files || [];

      const photoContexts =
        parsePhotoContexts(
          req.body.photoContexts
        );

      logRequestInformation({
        category,
        memo,
        files,
        photoContexts
      });

      if (files.length === 0) {
        return res.status(400).json({
          status: "error",
          serverVersion: SERVER_VERSION,
          error: "写真がありません"
        });
      }

      // Geminiへ送信する写真は最大3枚
      const imageParts = files
        .slice(0, MAX_AI_PHOTO_COUNT)
        .map(createImagePart);

      // AIが理解しやすい文章形式へ変換
      const formattedPhotoContexts =
        formatPhotoContexts(
          photoContexts
        );

      const prompt =
        createAnalysisPrompt({
          category,
          memo,
          fileCount: files.length,
          formattedPhotoContexts
        });

      console.log(
        "Geminiへ送信中..."
      );

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

      const result =
        parseGeminiResponse(
          responseText
        );

      const scores =
        normalizeScores(result);

      let descriptions =
        normalizeDescriptions(result);

      // 同じ文章が含まれていた場合は再生成
      const duplicateFields =
        findDuplicateFields(
          descriptions
        );

      if (duplicateFields.length > 0) {
        console.warn(
          "文章の重複を検出しました:",
          duplicateFields
        );

        descriptions =
          await regenerateDescriptions({
            category,
            memo,
            formattedPhotoContexts,
            descriptions,
            scores
          });
      }

      const onePhotoScore =
        calculateScore(scores);

      /*
        現在は写真全体を1回で評価しているため、
        写真枚数は掛けません。
      */
      const totalScore =
        onePhotoScore;

      const responseData = {
        status: "ok",

        serverVersion:
          SERVER_VERSION,

        emotion:
          scores.emotion,

        experience:
          scores.experience,

        people:
          scores.people,

        learning:
          scores.learning,

        special:
          scores.special,

        summary:
          descriptions.summary,

        contextMeaning:
          descriptions.contextMeaning,

        valueReason:
          descriptions.valueReason,

        reason:
          descriptions.reason,

        onePhotoScore,
        totalScore,

        photoCount:
          files.length
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

      return res.json(
        responseData
      );

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
// 写真情報の解析
// =====================================

function parsePhotoContexts(
  photoContextsText
) {
  try {
    const parsed = JSON.parse(
      photoContextsText || "[]"
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;

  } catch (error) {
    console.error(
      "photoContexts解析エラー:",
      error
    );

    return [];
  }
}

// =====================================
// Gemini用画像データ作成
// =====================================

function createImagePart(file) {
  return {
    inlineData: {
      mimeType:
        file.mimetype ||
        "image/jpeg",

      data:
        file.buffer.toString(
          "base64"
        )
    }
  };
}

// =====================================
// 写真情報を読みやすい文章へ変換
// =====================================

function formatPhotoContexts(
  photoContexts
) {
  if (
    !Array.isArray(photoContexts) ||
    photoContexts.length === 0
  ) {
    return "写真の付随情報はありません。";
  }

  return photoContexts
    .map((photo, index) => {
      const takenDate =
        formatDateValue(
          photo.takenDate
        );

      const latitude =
        normalizeNullableValue(
          photo.latitude
        );

      const longitude =
        normalizeNullableValue(
          photo.longitude
        );

      const locationText =
        createLocationText(
          latitude,
          longitude
        );

      const eventText =
        createCalendarEventText(
          photo.relatedEvent
        );

      const fileName =
        normalizeNullableValue(
          photo.fileName
        );

      const dateSource =
        normalizeNullableValue(
          photo.dateSource
        );

      const gpsSource =
        normalizeNullableValue(
          photo.gpsSource
        );

      return `
【写真${index + 1}】

ファイル名：
${fileName}

撮影日時：
${takenDate}

撮影日時の取得元：
${dateSource}

位置情報：
${locationText}

位置情報の取得元：
${gpsSource}

関連するカレンダー予定：
${eventText}
`.trim();
    })
    .join("\n\n");
}

// =====================================
// 撮影日時を整形
// =====================================

function formatDateValue(value) {
  if (!value) {
    return "取得できません";
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  const hours =
    String(
      date.getHours()
    ).padStart(2, "0");

  const minutes =
    String(
      date.getMinutes()
    ).padStart(2, "0");

  const seconds =
    String(
      date.getSeconds()
    ).padStart(2, "0");

  return (
    `${year}年${month}月${day}日 ` +
    `${hours}時${minutes}分${seconds}秒`
  );
}

// =====================================
// 位置情報を文章化
// =====================================

function createLocationText(
  latitude,
  longitude
) {
  const hasLatitude =
    latitude !== "取得できません";

  const hasLongitude =
    longitude !== "取得できません";

  if (
    !hasLatitude ||
    !hasLongitude
  ) {
    return "位置情報を取得できません";
  }

  return (
    `緯度 ${latitude}、` +
    `経度 ${longitude} が記録されています。` +
    "地名は断定せず、位置情報が存在することだけを利用してください。"
  );
}

// =====================================
// カレンダー予定を文章化
// =====================================

function createCalendarEventText(
  relatedEvent
) {
  if (
    !relatedEvent ||
    typeof relatedEvent !== "object"
  ) {
    return "関連する予定はありません";
  }

  const title =
    relatedEvent.summary ||
    "タイトルなし";

  const start =
    relatedEvent.start?.dateTime ||
    relatedEvent.start?.date ||
    null;

  const end =
    relatedEvent.end?.dateTime ||
    relatedEvent.end?.date ||
    null;

  const startText =
    start
      ? formatDateValue(start)
      : "開始時刻不明";

  const endText =
    end
      ? formatDateValue(end)
      : "終了時刻不明";

  return (
    `予定名：${title}\n` +
    `開始：${startText}\n` +
    `終了：${endText}`
  );
}

// =====================================
// プロンプト生成
// =====================================

function createAnalysisPrompt({
  category,
  memo,
  fileCount,
  formattedPhotoContexts
}) {
  return `
あなたは「時間の価値の可視化」アプリで使用する分析AIです。

写真と付随情報を分析し、以下の4種類の文章を、それぞれ異なる観点から作成してください。

=====================================
【1：summary】
=====================================

写真に直接写っている内容だけを説明してください。

対象：
・人物
・物
・場所
・行動
・表情
・雰囲気

使用してはいけない情報：
・本人のメモ
・撮影日時
・位置情報
・カレンダー予定

注意：
・写真に写っていない出来事を断定しないでください。
・summaryは写真の視覚的な内容だけを書いてください。

=====================================
【2：contextMeaning】
=====================================

写真の付随情報から、撮影時の背景や状況を説明してください。

使用する情報：
・カテゴリ
・本人のメモ
・撮影日時
・位置情報
・カレンダー予定

必ず行うこと：
・撮影日時が存在する場合は、日付または時間帯に必ず触れてください。
・位置情報が存在する場合は、位置情報が記録されていることに必ず触れてください。
・カレンダー予定が存在する場合は、その予定と写真の関係を説明してください。
・本人のメモが存在する場合は、その出来事が本人にとってどのような状況だったか説明してください。
・利用できる付随情報を無視せず、文章へ反映してください。

禁止：
・summaryと同じ写真説明を繰り返すこと
・緯度や経度だけから地名や施設名を断定すること
・存在しない予定や位置情報を作ること
・日時や位置情報があるのに、それらへ一切触れないこと

contextMeaningは、
日時・場所・予定・メモから分かる撮影時の背景です。

=====================================
【3：valueReason】
=====================================

この時間が本人にとって、
なぜ将来残す価値のある時間なのかを説明してください。

考慮する観点：
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

valueReasonは、
この思い出を将来残す価値の説明です。

=====================================
【4：reason】
=====================================

以下の5項目について、
何点にしたかと具体的な採点根拠を説明してください。

・emotion
・experience
・people
・learning
・special

禁止：
・写真の説明だけを書くこと
・思い出を残す価値だけを書くこと
・summary、contextMeaning、valueReasonをまとめ直すこと

reasonは、
5項目の点数評価の理由です。

=====================================
【入力情報】
=====================================

カテゴリ：
${category || "未設定"}

本人のメモ：
${memo || "メモなし"}

選択された写真枚数：
${fileCount}枚

写真の付随情報：

${formattedPhotoContexts}

=====================================
【評価基準】
=====================================

emotion：
本人の感情や印象の強さ

experience：
経験の新しさ、挑戦、非日常性

people：
家族、友人、仲間など、人との関わり

learning：
学び、気付き、成長

special：
記念性、希少性、特別性

各項目を0から5までの整数で評価してください。

=====================================
【重要な制約】
=====================================

・summary、contextMeaning、valueReason、reasonは必ず異なる文章にしてください。
・同じ文章を複数項目へ書かないでください。
・単なる言い換えも避けてください。
・各文章は1文から3文で書いてください。
・不明な情報を事実として断定しないでください。
・撮影日時がある場合は、contextMeaningで必ず触れてください。
・位置情報がある場合は、contextMeaningで必ず触れてください。
・カレンダー予定がある場合は、contextMeaningで必ず写真との関係に触れてください。
・位置情報がない場合は、場所を推測しないでください。
・予定がない場合は、予定を作らないでください。
・空文字は禁止です。
・JSON以外は出力しないでください。
`;
}

// =====================================
// Gemini応答解析
// =====================================

function parseGeminiResponse(
  responseText
) {
  try {
    return JSON.parse(
      cleanJsonText(
        responseText
      )
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
}

// =====================================
// 点数補正
// =====================================

function normalizeScores(result) {
  return {
    emotion:
      normalizeScore(
        result.emotion
      ),

    experience:
      normalizeScore(
        result.experience
      ),

    people:
      normalizeScore(
        result.people
      ),

    learning:
      normalizeScore(
        result.learning
      ),

    special:
      normalizeScore(
        result.special
      )
  };
}

// =====================================
// 文章補正
// =====================================

function normalizeDescriptions(
  result
) {
  return {
    summary:
      normalizeText(
        result.summary,
        "写真そのものの意味を取得できませんでした。"
      ),

    contextMeaning:
      normalizeText(
        result.contextMeaning,
        "日時やメモなどから文脈的な意味を取得できませんでした。"
      ),

    valueReason:
      normalizeText(
        result.valueReason,
        "この時間が持つ価値の理由を取得できませんでした。"
      ),

    reason:
      normalizeText(
        result.reason,
        "各項目の点数評価理由を取得できませんでした。"
      )
  };
}

// =====================================
// 合計点計算
// =====================================

function calculateScore(scores) {
  return (
    scores.emotion +
    scores.experience +
    scores.people +
    scores.learning +
    scores.special
  );
}

// =====================================
// 重複時の再生成
// =====================================

async function regenerateDescriptions({
  category,
  memo,
  formattedPhotoContexts,
  descriptions,
  scores
}) {
  const prompt = `
以下の4文章には、内容の重複または役割の混在があります。

それぞれ異なる役割の文章として書き直してください。

summary：
写真に視覚的に写っている内容だけを書く。

contextMeaning：
カテゴリ、メモ、撮影日時、位置情報、予定から分かる背景だけを書く。
日時がある場合は日付または時間帯に触れてください。
位置情報がある場合は位置情報が記録されていることに触れてください。
予定がある場合は写真との関係に触れてください。

valueReason：
この時間を将来残す価値だけを書く。

reason：
5項目の点数と採点根拠だけを書く。

【現在の文章】

summary：
${descriptions.summary}

contextMeaning：
${descriptions.contextMeaning}

valueReason：
${descriptions.valueReason}

reason：
${descriptions.reason}

【入力情報】

カテゴリ：
${category || "未設定"}

メモ：
${memo || "メモなし"}

写真情報：
${formattedPhotoContexts}

点数：
${JSON.stringify(scores, null, 2)}

4文章は同じ内容にせず、
それぞれ1文から3文で書いてください。

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
                "日時、位置情報、予定、メモから分かる背景を書く"
            },

            valueReason: {
              type: "string",
              description:
                "この時間を残す価値を書く"
            },

            reason: {
              type: "string",
              description:
                "5項目の点数と採点根拠を書く"
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

  const responseText =
    response.text || "{}";

  const regenerated =
    JSON.parse(
      cleanJsonText(
        responseText
      )
    );

  return {
    summary:
      normalizeText(
        regenerated.summary,
        descriptions.summary
      ),

    contextMeaning:
      normalizeText(
        regenerated.contextMeaning,
        descriptions.contextMeaning
      ),

    valueReason:
      normalizeText(
        regenerated.valueReason,
        descriptions.valueReason
      ),

    reason:
      normalizeText(
        regenerated.reason,
        descriptions.reason
      )
  };
}

// =====================================
// 重複確認
// =====================================

function findDuplicateFields(
  descriptions
) {
  const entries = [
    [
      "summary",
      descriptions.summary
    ],

    [
      "contextMeaning",
      descriptions.contextMeaning
    ],

    [
      "valueReason",
      descriptions.valueReason
    ],

    [
      "reason",
      descriptions.reason
    ]
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
      const [
        nameA,
        textA
      ] = entries[i];

      const [
        nameB,
        textB
      ] = entries[j];

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
// 文章類似判定
// =====================================

function areTextsSimilar(
  textA,
  textB
) {
  const a =
    normalizeForComparison(
      textA
    );

  const b =
    normalizeForComparison(
      textB
    );

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

  let matchedCount = 0;

  for (
    const character
    of shorter
  ) {
    if (
      longer.includes(
        character
      )
    ) {
      matchedCount++;
    }
  }

  const similarity =
    matchedCount /
    shorter.length;

  return similarity >= 0.9;
}

// =====================================
// 比較用文字列整形
// =====================================

function normalizeForComparison(
  text
) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(
      /[。、,.!?！？「」『』（）()]/g,
      ""
    )
    .toLowerCase();
}

// =====================================
// JSON文字列整形
// =====================================

function cleanJsonText(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

// =====================================
// 点数を0～5へ補正
// =====================================

function normalizeScore(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
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

// =====================================
// 文章の空欄補正
// =====================================

function normalizeText(
  value,
  fallback
) {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  const text =
    value.trim();

  if (!text) {
    return fallback;
  }

  return text;
}

// =====================================
// nullや空欄の補正
// =====================================

function normalizeNullableValue(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "取得できません";
  }

  return String(value);
}

// =====================================
// リクエストログ
// =====================================

function logRequestInformation({
  category,
  memo,
  files,
  photoContexts
}) {
  console.log(
    "===================================="
  );

  console.log(
    "AIリクエストを受信しました"
  );

  console.log(
    "サーバーバージョン:",
    SERVER_VERSION
  );

  console.log(
    "カテゴリ:",
    category
  );

  console.log(
    "メモ:",
    memo
  );

  console.log(
    "写真枚数:",
    files.length
  );

  console.log(
    "写真情報:",
    JSON.stringify(
      photoContexts,
      null,
      2
    )
  );

  console.log(
    "===================================="
  );
}

// =====================================
// サーバー起動
// =====================================

app.listen(PORT, () => {
  console.log(
    "================================"
  );

  console.log(
    "Server running!"
  );

  console.log(
    "Version:",
    SERVER_VERSION
  );

  console.log(
    "Port:",
    PORT
  );

  console.log(
    "================================"
  );
});
