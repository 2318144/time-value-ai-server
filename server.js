修正版全文です。元の`server(7).js`内に残っていた`meaning`を、評価基準に合わせてすべて`learning`へ変更しています。

````javascript
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

const SERVER_VERSION = "memory-value-25-learning-v11";
const PORT = process.env.PORT || 3000;

const APP_TIME_ZONE = "Asia/Tokyo";

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
    memoryTitle: {
      type: "string",
      description:
        "複数の写真と付随情報から判断した、1つの思い出を表す短いタイトル"
    },

    memorySummary: {
      type: "string",
      description:
        "選択された写真全体が表す1つの思い出の概要。写真に写っている内容を中心に説明する"
    },

    contextMeaning: {
      type: "string",
      description:
        "カテゴリ、メモ、撮影日時、撮影場所、カレンダー予定から分かる思い出の背景や意味"
    },

    valueReason: {
      type: "string",
      description:
        "この思い出が本人にとって、なぜ将来残す価値があるのかを説明する"
    },

    relationship: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "家族、友人、仲間などとのつながり"
    },

    emotion: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "この思い出に伴う感情や印象の強さ"
    },

    rarity: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "記念性、希少性、特別性、記憶として残る濃さ"
    },

    learning: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "この思い出から得られる学び、気付き、成長"
    },

    future: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "この思い出が将来の行動、考え方、成長、人間関係へ与える影響"
    },

    reason: {
      type: "string",
      description:
        "relationship、emotion、rarity、learning、futureの各点数と採点根拠"
    }
  },

  required: [
    "memoryTitle",
    "memorySummary",
    "contextMeaning",
    "valueReason",
    "relationship",
    "emotion",
    "rarity",
    "learning",
    "future",
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

          required: [
            "status"
          ]
        }
      }
    });

    const responseText =
      response.text || "{}";

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
// 思い出AI評価
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

      const files =
        req.files || [];

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

      /*
        Geminiへ送る画像は最大3枚。
        ただし評価対象は写真1枚ずつではなく、
        写真全体から判断される1つの思い出。
      */
      const imageParts = files
        .slice(0, MAX_AI_PHOTO_COUNT)
        .map(createImagePart);

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
        "===================================="
      );

      console.log(
        "Geminiへ送る写真文脈:"
      );

      console.log(
        formattedPhotoContexts
      );

      console.log(
        "===================================="
      );

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

      console.log(
        responseText
      );

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

      /*
        各説明文が同じ文章になった場合は、
        文章部分だけ再生成する。
      */
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

      /*
        5項目を各5点満点で評価。
        合計は最大25点。

        写真枚数は掛けない。
        何枚選択しても1つの思い出として1回だけ評価する。
      */
      const totalScore =
        calculateScore(scores);

      const responseData = {
        status: "ok",

        serverVersion:
          SERVER_VERSION,

        memoryTitle:
          descriptions.memoryTitle,

        memorySummary:
          descriptions.memorySummary,

        contextMeaning:
          descriptions.contextMeaning,

        valueReason:
          descriptions.valueReason,

        relationship:
          scores.relationship,

        emotion:
          scores.emotion,

        rarity:
          scores.rarity,

        learning:
          scores.learning,

        future:
          scores.future,

        totalScore,

        reason:
          descriptions.reason,

        photoCount:
          files.length,

        evaluationUnit:
          "memory",

        maxScore:
          25
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

      console.error(
        error
      );

      console.error(
        "==========================="
      );

      return res.status(500).json({
        status: "error",
        serverVersion: SERVER_VERSION,
        error: "思い出のAI評価に失敗しました",
        detail: error.message
      });
    }
  }
);

// =====================================
// 写真情報JSONの解析
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
// 写真情報を文章へ変換
// =====================================

function formatPhotoContexts(
  photoContexts
) {
  if (
    !Array.isArray(photoContexts) ||
    photoContexts.length === 0
  ) {
    return "写真情報はありません。";
  }

  return photoContexts
    .map((photo, index) => {
      const fileName =
        normalizeNullableValue(
          photo.fileName
        );

      /*
        Monaca側で作成した日本時間表記を優先する。
      */
      const takenDate =
        hasText(photo.takenDateJST)
          ? String(
              photo.takenDateJST
            ).trim()
          : formatDateValueJST(
              photo.takenDate
            );

      /*
        位置名が取得できている場合は位置名を使用する。
      */
      const location =
        hasText(photo.locationName)
          ? String(
              photo.locationName
            ).trim()
          : createLocationText(
              photo.latitude,
              photo.longitude
            );

      const calendar =
        createCalendarEventText(
          photo.relatedEvent
        );

      return `
【写真${index + 1}】

ファイル名：
${fileName}

撮影日時：
${takenDate}

撮影場所：
${location}

関連予定：
${calendar}
`.trim();
    })
    .join("\n\n");
}

// =====================================
// 撮影日時を日本時間へ変換
// =====================================

function formatDateValueJST(value) {
  if (!value) {
    return "取得できません";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  const dateText =
    new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone:
          APP_TIME_ZONE,

        year:
          "numeric",

        month:
          "long",

        day:
          "numeric",

        weekday:
          "short",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hour12:
          false
      }
    ).format(date);

  const timePeriod =
    getJapaneseTimePeriod(
      date
    );

  return (
    `${dateText}（日本時間・${timePeriod}）`
  );
}

// =====================================
// 時間帯を判定
// =====================================

function getJapaneseTimePeriod(
  dateValue
) {
  const date =
    new Date(dateValue);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "時間帯不明";
  }

  const hourText =
    new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone:
          APP_TIME_ZONE,

        hour:
          "2-digit",

        hour12:
          false
      }
    ).format(date);

  const hour = Number(
    hourText.replace(
      /\D/g,
      ""
    )
  );

  if (
    hour >= 5 &&
    hour < 10
  ) {
    return "朝";
  }

  if (
    hour >= 10 &&
    hour < 15
  ) {
    return "昼";
  }

  if (
    hour >= 15 &&
    hour < 18
  ) {
    return "午後";
  }

  if (
    hour >= 18 &&
    hour < 21
  ) {
    return "夕方";
  }

  return "夜";
}

// =====================================
// 位置情報を文章化
// =====================================

function createLocationText(
  latitude,
  longitude
) {
  const hasLatitude =
    latitude !== null &&
    latitude !== undefined &&
    latitude !== "";

  const hasLongitude =
    longitude !== null &&
    longitude !== undefined &&
    longitude !== "";

  if (
    !hasLatitude ||
    !hasLongitude
  ) {
    return "取得できません";
  }

  return (
    "位置情報が記録されています。"
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
    return "関連予定なし";
  }

  const title =
    hasText(
      relatedEvent.summary
    )
      ? String(
          relatedEvent.summary
        ).trim()
      : "タイトルなし";

  const start =
    relatedEvent.start?.dateTime ||
    relatedEvent.start?.date ||
    null;

  const end =
    relatedEvent.end?.dateTime ||
    relatedEvent.end?.date ||
    null;

  if (
    relatedEvent.start?.date &&
    relatedEvent.end?.date
  ) {
    return (
      `${title}（終日予定）`
    );
  }

  if (
    start &&
    end
  ) {
    const startText =
      formatTimeJST(start);

    const endText =
      formatTimeJST(end);

    return (
      `${title}（${startText}～${endText}・日本時間）`
    );
  }

  return title;
}

// =====================================
// カレンダー時刻を日本時間へ変換
// =====================================

function formatTimeJST(value) {
  if (!value) {
    return "時刻不明";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      timeZone:
        APP_TIME_ZONE,

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false
    }
  ).format(date);
}

// =====================================
// AIプロンプト生成
// =====================================

function createAnalysisPrompt({
  category,
  memo,
  fileCount,
  formattedPhotoContexts
}) {
  return `
あなたは「時間の価値の可視化」アプリで使用する分析AIです。

選択された写真は、写真1枚ごとに採点するためのものではありません。

選択された写真全体と付随情報から、
写真が表している「1つの思い出」を推定してください。

その1つの思い出を、
5項目・合計25点満点で1回だけ評価してください。

写真枚数を点数に掛けてはいけません。

=====================================
【1：memoryTitle】
=====================================

写真全体と付随情報から推定される1つの思い出に、
短く分かりやすいタイトルを付けてください。

例：
・友人との京都旅行
・家族で過ごした誕生日
・大学生活最後の文化祭
・アルバイト仲間との食事

分からない情報を事実として断定しないでください。

=====================================
【2：memorySummary】
=====================================

選択された写真全体が表している、
1つの思い出の概要を説明してください。

写真に写っている次の内容を中心にしてください。

・人物
・物
・場所
・行動
・表情
・雰囲気

写真ごとの説明を別々に並べるのではなく、
全体を1つの出来事としてまとめてください。

メモ、日時、場所、予定だけを根拠に、
写真に写っていない内容を断定しないでください。

=====================================
【3：contextMeaning】
=====================================

写真の付随情報を使って、
この思い出の背景や本人にとっての意味を説明してください。

使用する情報：

・カテゴリ
・本人のメモ
・撮影日時
・撮影場所
・カレンダー予定

撮影日時がある場合は、
日付または時間帯に触れてください。

撮影場所がある場合は、
場所と出来事の関係に触れてください。

関連予定がある場合は、
予定と写真の関係に触れてください。

本人のメモは、
思い出の背景として重視してください。

存在しない予定や場所を作ってはいけません。

日本時間をUTCとして読み直してはいけません。

=====================================
【4：valueReason】
=====================================

この思い出が本人にとって、
なぜ将来残す価値のある時間なのかを説明してください。

次の観点を考慮してください。

・人とのつながり
・感情
・希少性
・学び
・将来への影響

写真の見た目を説明するだけにしないでください。

日時、場所、予定を並べるだけにしないでください。

=====================================
【5：reason】
=====================================

次の5項目について、
何点にしたかと具体的な採点根拠を説明してください。

・relationship
・emotion
・rarity
・learning
・future

各項目について、
「〇点。理由は～」のように説明してください。

=====================================
【入力情報】
=====================================

カテゴリ：
${category || "未設定"}

本人のメモ：
${memo || "メモなし"}

思い出の判断に使用する写真枚数：
${fileCount}枚

写真の付随情報：

${formattedPhotoContexts}

=====================================
【日時についての重要事項】
=====================================

・撮影日時と予定日時は、すべて日本時間です。
・UTCへ変換し直さないでください。
・表示されている日時をそのまま解釈してください。
・15時台は午後です。
・18時台は夕方です。
・21時以降は夜です。
・日本時間と書かれた日時を最優先してください。

=====================================
【25点満点の評価基準】
=====================================

relationship：
家族、友人、仲間などとのつながり

0点：
人との関係を判断できない

1点：
人との関わりが弱い

2点：
一定の関わりがある

3点：
交流や共有体験がある

4点：
関係を深める重要な体験である

5点：
非常に強い絆や重要な関係性を表す

-------------------------------------

emotion：
この思い出に伴う感情や印象の強さ

0点：
感情を判断できない

1点：
弱い感情である

2点：
多少の感情がある

3点：
明確な感情がある

4点：
強い感情を伴う

5点：
非常に強く記憶に残る感情を伴う

-------------------------------------

rarity：
記念性、希少性、特別性、記憶として残る濃さ

0点：
特別性を判断できない

1点：
日常的で記憶性が低い

2点：
やや印象に残る

3点：
特別な要素がある

4点：
記念性や希少性が高い

5点：
二度と同じ形では経験できない、
非常に特別な思い出である

-------------------------------------

learning：
学び、気付き、成長

0点：
学びや成長を判断できない

1点：
学びや成長が小さい

2点：
多少の学びや成長がある

3点：
明確な学びや成長がある

4点：
大きな成長や気付きにつながる

5点：
人生観や価値観に関わる大きな学びがある

-------------------------------------

future：
将来の考え方、行動、成長、人間関係への影響

0点：
将来への影響を判断できない

1点：
将来への影響が小さい

2点：
多少の影響がある

3点：
今後につながる経験である

4点：
将来の選択や成長に大きく影響する

5点：
人生の方向性を変えるほどの影響がある

=====================================
【合計点】
=====================================

relationship：
0～5点

emotion：
0～5点

rarity：
0～5点

learning：
0～5点

future：
0～5点

5項目の合計を、
1つの思い出の価値とします。

合計は0点から25点です。

=====================================
【重要な制約】
=====================================

・評価対象は写真ではなく、写真から推定した1つの思い出です。
・写真1枚ごとに点数を付けてはいけません。
・写真枚数を点数に掛けてはいけません。
・複数の写真でも合計は最大25点です。
・memoryTitleは思い出の短い名前にしてください。
・memorySummaryは写真全体から分かる思い出の概要にしてください。
・contextMeaningは付随情報から分かる背景や意味にしてください。
・valueReasonは将来残す価値を説明してください。
・reasonは点数と採点根拠を説明してください。
・各文章を同じ内容にしないでください。
・同じ文章を複数項目に書かないでください。
・不明な情報を事実として断定しないでください。
・各文章は1文から3文程度にしてください。
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

function normalizeScores(
  result
) {
  return {
    relationship:
      normalizeScore(
        result.relationship
      ),

    emotion:
      normalizeScore(
        result.emotion
      ),

    rarity:
      normalizeScore(
        result.rarity
      ),

    learning:
      normalizeScore(
        result.learning
      ),

    future:
      normalizeScore(
        result.future
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
    memoryTitle:
      normalizeText(
        result.memoryTitle,
        "名称を付けられない思い出"
      ),

    memorySummary:
      normalizeText(
        result.memorySummary,
        "写真全体から思い出の概要を取得できませんでした。"
      ),

    contextMeaning:
      normalizeText(
        result.contextMeaning,
        "日時やメモなどから思い出の背景を取得できませんでした。"
      ),

    valueReason:
      normalizeText(
        result.valueReason,
        "この思い出が持つ時間価値の理由を取得できませんでした。"
      ),

    reason:
      normalizeText(
        result.reason,
        "各項目の点数評価理由を取得できませんでした。"
      )
  };
}

// =====================================
// 25点満点の合計点計算
// =====================================

function calculateScore(
  scores
) {
  return (
    scores.relationship +
    scores.emotion +
    scores.rarity +
    scores.learning +
    scores.future
  );
}

// =====================================
// 説明文が重複した場合の再生成
// =====================================

async function regenerateDescriptions({
  category,
  memo,
  formattedPhotoContexts,
  descriptions,
  scores
}) {
  const prompt = `
以下の5文章には、
内容の重複または役割の混在があります。

評価対象は写真そのものではなく、
写真全体から推定された1つの思い出です。

それぞれ異なる役割の文章として書き直してください。

memoryTitle：
1つの思い出を表す短いタイトルを書く。

memorySummary：
写真全体から分かる1つの思い出の概要を書く。

contextMeaning：
カテゴリ、メモ、日本時間の撮影日時、
撮影場所、関連予定から分かる背景や意味を書く。

valueReason：
この思い出を将来残す価値を書く。

reason：
5項目の点数と採点根拠だけを書く。

=====================================
【現在の文章】
=====================================

memoryTitle：
${descriptions.memoryTitle}

memorySummary：
${descriptions.memorySummary}

contextMeaning：
${descriptions.contextMeaning}

valueReason：
${descriptions.valueReason}

reason：
${descriptions.reason}

=====================================
【入力情報】
=====================================

カテゴリ：
${category || "未設定"}

メモ：
${memo || "メモなし"}

写真情報：
${formattedPhotoContexts}

日時はすべて日本時間です。
UTCへ変換し直さないでください。

点数：
${JSON.stringify(scores, null, 2)}

評価項目は次の5項目です。

・人間関係
・感情
・希少性
・学び
・将来への影響

5文章は同じ内容にしないでください。

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
            memoryTitle: {
              type: "string",
              description:
                "1つの思い出を表す短いタイトル"
            },

            memorySummary: {
              type: "string",
              description:
                "写真全体から分かる1つの思い出の概要"
            },

            contextMeaning: {
              type: "string",
              description:
                "日時、場所、予定、メモから分かる背景や意味"
            },

            valueReason: {
              type: "string",
              description:
                "この思い出を将来残す価値"
            },

            reason: {
              type: "string",
              description:
                "5項目の点数と採点根拠"
            }
          },

          required: [
            "memoryTitle",
            "memorySummary",
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
    memoryTitle:
      normalizeText(
        regenerated.memoryTitle,
        descriptions.memoryTitle
      ),

    memorySummary:
      normalizeText(
        regenerated.memorySummary,
        descriptions.memorySummary
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
// 説明文の重複確認
// =====================================

function findDuplicateFields(
  descriptions
) {
  const entries = [
    [
      "memoryTitle",
      descriptions.memoryTitle
    ],

    [
      "memorySummary",
      descriptions.memorySummary
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
    const character of shorter
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
  return String(
    text || ""
  )
    .replace(
      /\s+/g,
      ""
    )
    .replace(
      /[。、,.!?！？「」『』（）()]/g,
      ""
    )
    .toLowerCase();
}

// =====================================
// JSON文字列整形
// =====================================

function cleanJsonText(
  text
) {
  return String(
    text || ""
  )
    .replace(
      /```json/gi,
      ""
    )
    .replace(
      /```/g,
      ""
    )
    .trim();
}

// =====================================
// 点数を0～5へ補正
// =====================================

function normalizeScore(
  value
) {
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
// 文字列が存在するか確認
// =====================================

function hasText(
  value
) {
  return (
    typeof value === "string" &&
    value.trim() !== ""
  );
}

// =====================================
// リクエスト情報ログ
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
    "思い出AI評価リクエストを受信しました"
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
// Multerエラー処理
// =====================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error instanceof multer.MulterError
    ) {
      console.error(
        "Multerエラー:",
        error
      );

      if (
        error.code === "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          status: "error",
          serverVersion: SERVER_VERSION,
          error:
            "画像のファイルサイズが大きすぎます。1枚10MB以下にしてください。"
        });
      }

      if (
        error.code === "LIMIT_FILE_COUNT"
      ) {
        return res.status(400).json({
          status: "error",
          serverVersion: SERVER_VERSION,
          error:
            "選択できる写真は最大10枚です。"
        });
      }

      return res.status(400).json({
        status: "error",
        serverVersion: SERVER_VERSION,
        error: error.message
      });
    }

    if (error) {
      console.error(
        "サーバーエラー:",
        error
      );

      return res.status(500).json({
        status: "error",
        serverVersion: SERVER_VERSION,
        error: "サーバー内部でエラーが発生しました。",
        detail: error.message
      });
    }

    next();
  }
);

// =====================================
// サーバー起動
// =====================================

app.listen(
  PORT,
  () => {
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
      "評価単位:",
      "1つの思い出"
    );

    console.log(
      "評価項目:",
      "人間関係・感情・希少性・学び・将来への影響"
    );

    console.log(
      "最大点:",
      "25点"
    );

    console.log(
      "================================"
    );
  }
);
````
