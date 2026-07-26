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

const SERVER_VERSION = "memory-value-25-history-learning-v17-complete";
const PORT = process.env.PORT || 3000;

const APP_TIME_ZONE = "Asia/Tokyo";

const MAX_PHOTO_COUNT = 10;
const MAX_AI_PHOTO_COUNT = 3;
const MAX_HISTORY_COUNT = 20;
const MAX_HISTORY_PROMPT_COUNT = 20;
const MAX_HISTORY_TEXT_LENGTH = 600;
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

    emotion: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "この思い出に伴う感情や印象の強さ"
    },

    meaning: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "この思い出が持つ意味、学び、気付き、成長"
    },

    relationship: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "家族、友人、仲間などとのつながり"
    },

    future: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "この思い出が将来の行動、考え方、成長、人間関係へ与える影響"
    },

    rarity: {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        "記念性、希少性、特別性、記憶として残る濃さ"
    },

    reason: {
      type: "string",
      description:
        "emotion、meaning、relationship、future、rarityの各点数と採点根拠"
    },

    usedUserProfile: {
      type: "boolean",
      description:
        "本人情報を今回の評価判断に実際に利用した場合はtrue、利用しなかった場合はfalse"
    },

    usedProfileItems: {
      type: "string",
      description:
        "評価に利用した本人情報の項目。例：年齢、職業。利用していない場合は「なし」"
    },

    userProfileReason: {
      type: "string",
      description:
        "本人情報をどのように評価へ反映したか。利用していない場合は、その理由を説明する"
    },

    usedMemoryHistory: {
      type: "boolean",
      description:
        "過去の思い出から算出した価値傾向を今回の評価へ実際に利用した場合はtrue"
    },

    historyReferenceReason: {
      type: "string",
      description:
        "過去の思い出の傾向を今回の評価へどう反映したか。利用していない場合はその理由"
    }
  },

  required: [
    "memoryTitle",
    "memorySummary",
    "contextMeaning",
    "valueReason",
    "emotion",
    "meaning",
    "relationship",
    "future",
    "rarity",
    "reason",
    "usedUserProfile",
    "usedProfileItems",
    "userProfileReason",
    "usedMemoryHistory",
    "historyReferenceReason"
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

      const userProfile =
        parseUserProfile(
          req.body.userProfile
        );

      const memoryHistory =
        parseMemoryHistory(
          req.body.memoryHistory
        );

      const learnedValueProfile =
        createLearnedValueProfile(
          memoryHistory
        );

      const files =
        req.files || [];

      const photoContexts =
        parsePhotoContexts(
          req.body.photoContexts
        );

      logRequestInformation({
        category,
        memo,
        userProfile,
        memoryHistory,
        learnedValueProfile,
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
          formattedPhotoContexts,
          userProfile,
          memoryHistory,
          learnedValueProfile
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

      const profileUsage =
        normalizeProfileUsage(result);

      const historyUsage =
        normalizeHistoryUsage(
          result,
          learnedValueProfile
        );

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

        emotion:
          scores.emotion,

        meaning:
          scores.meaning,

        relationship:
          scores.relationship,

        future:
          scores.future,

        rarity:
          scores.rarity,

        totalScore,

        reason:
          descriptions.reason,

        usedUserProfile:
          profileUsage.usedUserProfile,

        usedProfileItems:
          profileUsage.usedProfileItems,

        userProfileReason:
          profileUsage.userProfileReason,

        usedMemoryHistory:
          historyUsage.usedMemoryHistory,

        historyReferenceReason:
          historyUsage.historyReferenceReason,

        learnedValueProfile,

        historyCountUsed:
          learnedValueProfile.historyCount,

        receivedUserProfile: {
          birthday:
            userProfile.birthday,

          age:
            userProfile.age,

          gender:
            userProfile.gender,

          job:
            userProfile.job
        },

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
// 本人情報JSONの解析
// =====================================

function parseUserProfile(
  userProfileText
) {
  try {
    const parsed =
      JSON.parse(
        userProfileText || "{}"
      );

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {
        birthday: "",
        age: "",
        gender: "",
        job: ""
      };
    }

    return {
      birthday:
        normalizeProfileValue(
          parsed.birthday
        ),

      age:
        normalizeProfileValue(
          parsed.age
        ),

      gender:
        normalizeProfileValue(
          parsed.gender
        ),

      job:
        normalizeProfileValue(
          parsed.job
        )
    };

  } catch (error) {
    console.error(
      "userProfile解析エラー:",
      error
    );

    return {
      birthday: "",
      age: "",
      gender: "",
      job: ""
    };
  }
}

// =====================================
// 過去の思い出JSONの解析
// =====================================

function parseMemoryHistory(
  memoryHistoryText
) {
  try {
    const parsed =
      JSON.parse(
        memoryHistoryText || "[]"
      );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .slice(0, MAX_HISTORY_COUNT)
      .map((memory) => {
        const hasUserScores =
          hasAnyDefinedScore([
            memory.userEmotion,
            memory.userMeaning,
            memory.userRelationship,
            memory.userFuture,
            memory.userRarity,
            memory.userScore?.emotion,
            memory.userScore?.meaning,
            memory.userScore?.relationship,
            memory.userScore?.future,
            memory.userScore?.rarity
          ]);

        const scores = {
          emotion:
            normalizeScore(
              firstDefinedValue(
                memory.userEmotion,
                memory.userScore?.emotion,
                memory.emotion,
                memory.aiScore?.emotion
              )
            ),

          meaning:
            normalizeScore(
              firstDefinedValue(
                memory.userMeaning,
                memory.userScore?.meaning,
                memory.meaning,
                memory.learning,
                memory.experience,
                memory.aiScore?.meaning
              )
            ),

          relationship:
            normalizeScore(
              firstDefinedValue(
                memory.userRelationship,
                memory.userScore?.relationship,
                memory.relationship,
                memory.people,
                memory.aiScore?.relationship
              )
            ),

          future:
            normalizeScore(
              firstDefinedValue(
                memory.userFuture,
                memory.userScore?.future,
                memory.future,
                memory.futureImpact,
                memory.growth,
                memory.aiScore?.future
              )
            ),

          rarity:
            normalizeScore(
              firstDefinedValue(
                memory.userRarity,
                memory.userScore?.rarity,
                memory.rarity,
                memory.special,
                memory.aiScore?.rarity
              )
            )
        };

        const calculatedTotal =
          calculateScore(scores);

        return {
          category:
            normalizeHistoryText(
              memory.category
            ),

          memo:
            normalizeHistoryText(
              memory.memo
            ),

          memoryTitle:
            normalizeHistoryText(
              firstDefinedValue(
                memory.memoryTitle,
                memory.title
              )
            ),

          memorySummary:
            normalizeHistoryText(
              firstDefinedValue(
                memory.memorySummary,
                memory.summary
              )
            ),

          contextMeaning:
            normalizeHistoryText(
              memory.contextMeaning
            ),

          valueReason:
            normalizeHistoryText(
              memory.valueReason
            ),

          primaryCriterion:
            normalizeHistoryText(
              memory.primaryCriterion
            ),

          userPriority:
            normalizeHistoryText(
              memory.userPriority
            ),

          correctionReason:
            normalizeHistoryText(
              firstDefinedValue(
                memory.correctionReason,
                memory.userCorrectionReason
              )
            ),

          scoreSource:
            hasUserScores
              ? "user-corrected"
              : normalizeHistoryText(
                  memory.scoreSource
                ) || "ai",

          emotion:
            scores.emotion,

          meaning:
            scores.meaning,

          relationship:
            scores.relationship,

          future:
            scores.future,

          rarity:
            scores.rarity,

          totalScore:
            normalizeHistoryTotalScore(
              firstDefinedValue(
                memory.userTotalScore,
                memory.totalScore
              ),
              calculatedTotal
            ),

          createdAt:
            normalizeHistoryText(
              firstDefinedValue(
                memory.createdAt,
                memory.date
              )
            )
        };
      });

  } catch (error) {
    console.error(
      "memoryHistory解析エラー:",
      error
    );

    return [];
  }
}

// =====================================
// 過去の思い出から利用者の価値傾向を作成
// =====================================

function createLearnedValueProfile(
  memoryHistory
) {
  if (
    !Array.isArray(memoryHistory) ||
    memoryHistory.length === 0
  ) {
    return {
      historyCount: 0,

      averages: {
        emotion: 0,
        meaning: 0,
        relationship: 0,
        future: 0,
        rarity: 0,
        totalScore: 0
      },

      strongestCriteria: [],
      frequentCategories: [],
      representativeMemories: [],

      summary:
        "過去の思い出がないため、価値傾向はまだ形成されていません。"
    };
  }

  const scoreKeys = [
    "emotion",
    "meaning",
    "relationship",
    "future",
    "rarity"
  ];

  const criterionLabels = {
    emotion: "感情",
    meaning: "意味・学び",
    relationship: "人間関係",
    future: "将来への影響",
    rarity: "希少性"
  };

  const sums = {
    emotion: 0,
    meaning: 0,
    relationship: 0,
    future: 0,
    rarity: 0,
    totalScore: 0
  };

  const categoryCounts =
    new Map();

  memoryHistory.forEach(
    (memory) => {
      scoreKeys.forEach(
        (key) => {
          sums[key] +=
            normalizeScore(
              memory[key]
            );
        }
      );

      sums.totalScore +=
        normalizeHistoryTotalScore(
          memory.totalScore,
          calculateScore(memory)
        );

      const category =
        normalizeHistoryText(
          memory.category
        );

      if (category) {
        categoryCounts.set(
          category,
          (categoryCounts.get(category) || 0) + 1
        );
      }
    }
  );

  const averages = {
    emotion:
      roundToOneDecimal(
        sums.emotion /
        memoryHistory.length
      ),

    meaning:
      roundToOneDecimal(
        sums.meaning /
        memoryHistory.length
      ),

    relationship:
      roundToOneDecimal(
        sums.relationship /
        memoryHistory.length
      ),

    future:
      roundToOneDecimal(
        sums.future /
        memoryHistory.length
      ),

    rarity:
      roundToOneDecimal(
        sums.rarity /
        memoryHistory.length
      ),

    totalScore:
      roundToOneDecimal(
        sums.totalScore /
        memoryHistory.length
      )
  };

  const strongestCriteria =
    scoreKeys
      .map((key) => ({
        key,
        label:
          criterionLabels[key],
        average:
          averages[key]
      }))
      .sort(
        (a, b) =>
          b.average -
          a.average
      )
      .slice(0, 3);

  const frequentCategories =
    Array.from(
      categoryCounts.entries()
    )
      .map(
        ([category, count]) => ({
          category,
          count
        })
      )
      .sort(
        (a, b) =>
          b.count -
          a.count
      )
      .slice(0, 5);

  const representativeMemories =
    [...memoryHistory]
      .sort(
        (a, b) =>
          b.totalScore -
          a.totalScore
      )
      .slice(0, 3)
      .map((memory) => ({
        memoryTitle:
          memory.memoryTitle ||
          "タイトルなし",

        category:
          memory.category ||
          "未設定",

        totalScore:
          memory.totalScore,

        valueReason:
          memory.valueReason ||
          memory.contextMeaning ||
          memory.memorySummary ||
          "説明なし"
      }));

  const strongestText =
    strongestCriteria
      .map(
        (item) =>
          `${item.label}（平均${item.average}点）`
      )
      .join("、");

  const categoryText =
    frequentCategories.length > 0
      ? frequentCategories
          .map(
            (item) =>
              `${item.category}（${item.count}件）`
          )
          .join("、")
      : "分類できるカテゴリなし";

  return {
    historyCount:
      memoryHistory.length,

    averages,

    strongestCriteria,

    frequentCategories,

    representativeMemories,

    summary:
      `過去${memoryHistory.length}件では、${strongestText}が比較的高く、頻出カテゴリは${categoryText}です。`
  };
}

// =====================================
// 学習した価値傾向をプロンプト用文章へ変換
// =====================================

function formatLearnedValueProfile(
  learnedValueProfile
) {
  if (
    !learnedValueProfile ||
    learnedValueProfile.historyCount === 0
  ) {
    return `
過去の思い出：
登録なし

今回の評価では、
過去履歴による個人化を行わないでください。
`.trim();
  }

  const strongestText =
    learnedValueProfile
      .strongestCriteria
      .map(
        (item) =>
          `・${item.label}：平均${item.average}点`
      )
      .join("\n");

  const categoriesText =
    learnedValueProfile
      .frequentCategories
      .length > 0
      ? learnedValueProfile
          .frequentCategories
          .map(
            (item) =>
              `・${item.category}：${item.count}件`
          )
          .join("\n")
      : "・該当なし";

  const memoriesText =
    learnedValueProfile
      .representativeMemories
      .length > 0
      ? learnedValueProfile
          .representativeMemories
          .map(
            (memory, index) =>
              `${index + 1}. ${memory.memoryTitle}／${memory.category}／${memory.totalScore}点\n   ${memory.valueReason}`
          )
          .join("\n")
      : "該当なし";

  return `
履歴件数：
${learnedValueProfile.historyCount}件

5項目の平均：
・感情：${learnedValueProfile.averages.emotion}
・意味・学び：${learnedValueProfile.averages.meaning}
・人間関係：${learnedValueProfile.averages.relationship}
・将来への影響：${learnedValueProfile.averages.future}
・希少性：${learnedValueProfile.averages.rarity}
・合計：${learnedValueProfile.averages.totalScore}／25

比較的高い観点：
${strongestText}

頻出カテゴリ：
${categoriesText}

代表的な高価値の思い出：
${memoriesText}

傾向の要約：
${learnedValueProfile.summary}
`.trim();
}


// =====================================
// 過去の思い出をプロンプト用文章へ変換
// =====================================

function formatMemoryHistoryForPrompt(
  memoryHistory
) {
  if (
    !Array.isArray(memoryHistory) ||
    memoryHistory.length === 0
  ) {
    return `
過去の思い出：
登録なし
`.trim();
  }

  return memoryHistory
    .slice(0, MAX_HISTORY_PROMPT_COUNT)
    .map((memory, index) => {
      const title =
        trimPromptText(
          memory.memoryTitle ||
          "タイトルなし"
        );

      const category =
        trimPromptText(
          memory.category ||
          "未設定"
        );

      const memo =
        trimPromptText(
          memory.memo ||
          "メモなし"
        );

      const summary =
        trimPromptText(
          memory.memorySummary ||
          "概要なし"
        );

      const contextMeaning =
        trimPromptText(
          memory.contextMeaning ||
          "背景情報なし"
        );

      const valueReason =
        trimPromptText(
          memory.valueReason ||
          "価値理由なし"
        );

      const primaryCriterion =
        trimPromptText(
          memory.primaryCriterion ||
          "未設定"
        );

      const userPriority =
        trimPromptText(
          memory.userPriority ||
          "未設定"
        );

      const correctionReason =
        trimPromptText(
          memory.correctionReason ||
          "修正理由なし"
        );

      const scoreSource =
        memory.scoreSource === "user-corrected"
          ? "本人が修正した点数"
          : "AIが付けた点数";

      const createdAt =
        trimPromptText(
          memory.createdAt ||
          "日時不明"
        );

      return `
【過去の思い出${index + 1}】

タイトル：
${title}

カテゴリ：
${category}

本人のメモ：
${memo}

概要：
${summary}

背景・意味：
${contextMeaning}

価値の理由：
${valueReason}

本人が特に重視した観点：
${primaryCriterion}

本人の優先事項：
${userPriority}

点数の情報源：
${scoreSource}

本人による修正理由：
${correctionReason}

点数：
・感情：${memory.emotion}点
・意味・学び：${memory.meaning}点
・人間関係：${memory.relationship}点
・将来への影響：${memory.future}点
・希少性：${memory.rarity}点
・合計：${memory.totalScore}／25点

登録日時：
${createdAt}
`.trim();
    })
    .join("\n\n");
}

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
  formattedPhotoContexts,
  userProfile,
  memoryHistory,
  learnedValueProfile
}) {
  const formattedMemoryHistory =
    formatMemoryHistoryForPrompt(
      memoryHistory
    );

  const formattedLearnedProfile =
    formatLearnedValueProfile(
      learnedValueProfile
    );

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

・感情
・意味や学び
・人とのつながり
・将来への影響
・希少性
・記憶として残る濃さ

写真の見た目を説明するだけにしないでください。

日時、場所、予定を並べるだけにしないでください。

=====================================
【5：reason】
=====================================

次の5項目について、
何点にしたかと具体的な採点根拠を説明してください。

・emotion
・meaning
・relationship
・future
・rarity

各項目について、
「〇点。理由は～」のように説明してください。

=====================================
【6：本人情報の利用確認】
=====================================

本人情報は、
写真だけでは分からない本人の生活段階や背景を理解するための
補助情報として使用してください。

ただし、次のルールを守ってください。

・本人情報だけを根拠に点数を上げたり下げたりしない
・年齢、性別、職業から固定的な人物像を決めつけない
・写真、メモ、日時、場所、予定との関係がある場合だけ評価に反映する
・本人情報を利用した場合は、利用項目と反映理由を具体的に説明する
・本人情報が今回の思い出と関係しない場合は、無理に利用しない
・利用しなかった場合は、usedUserProfileをfalseにする
・利用しなかった場合は、usedProfileItemsを「なし」にする

=====================================
【本人情報】
=====================================

誕生日：
${userProfile.birthday || "未設定"}

現在の年齢：
${userProfile.age || "未設定"}

性別：
${userProfile.gender || "未設定"}

職業：
${userProfile.job || "未設定"}

=====================================
【7：過去の経験・価値観】
=====================================

次の情報は、
この利用者が過去に登録した思い出です。

これらは単なる平均値ではなく、
この利用者がどのような時間に価値を感じやすいかを理解するための
個人適応用の参考情報です。

-------------------------------------
【過去の思い出一覧】
-------------------------------------

${formattedMemoryHistory}

-------------------------------------
【過去の思い出から算出した価値傾向】
-------------------------------------

${formattedLearnedProfile}

過去の思い出は、
今回の思い出と関連がある場合だけ参考にしてください。

今回との関連として確認する観点：

・同じ人物または人間関係
・同じ場所
・同じカテゴリ
・似た出来事
・似た感情
・似た意味や学び
・似た将来への影響
・本人が重視した観点

次のルールを守ってください。

・今回の写真と本人のメモを最優先にする
・過去の平均点を今回の点数へそのままコピーしない
・過去に高かった観点という理由だけで点数を上げない
・関連する具体的な過去の思い出がある場合だけ利用する
・本人が修正した点数は、AIだけで付けた点数より重要な証拠として扱う
・本人の修正理由がある場合は、その価値判断を優先して参考にする
・履歴が少ない場合は、強い価値傾向として断定しない
・今回と関係しない過去の思い出は利用しない

過去履歴を利用した場合：

・usedMemoryHistoryをtrueにする
・historyReferenceReasonに、参考にした過去の思い出のタイトルを書く
・今回との共通点を書く
・点数または説明へどのように反映したかを書く

過去履歴を利用しなかった場合：

・usedMemoryHistoryをfalseにする
・historyReferenceReasonに
「今回の思い出と関連する過去の経験が無かったため利用しませんでした。」
と記述する

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
【評価根拠の優先順位】
=====================================

次の順番で評価根拠を重視してください。

1. 今回の写真に写っている内容
2. 今回の本人のメモ
3. 撮影日時
4. 撮影場所
5. カレンダー予定
6. 関連する過去の思い出
7. 本人情報

過去の思い出や本人情報を、
今回の写真やメモより優先してはいけません。

=====================================
【時間の価値という観点】
=====================================

この研究で扱う時間の価値は、
単なる楽しさやイベントの規模だけではありません。

次の観点を総合的に判断してください。

・本人の人生の中で意味がある時間だったか
・将来振り返ったときにも価値が残るか
・人との関係を築いた、または深めた時間か
・学び、気付き、成長につながった時間か
・将来の考え方や行動へ影響する時間か
・その人らしさを表す経験か
・同じ形では繰り返せない特別な時間か

見た目が派手な出来事を自動的に高く評価せず、
本人にとってどれだけ意味のある時間だったかを重視してください。

=====================================
【25点満点の評価基準】
=====================================

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

meaning：
意味、学び、気付き、成長

0点：
意味や学びを判断できない

1点：
意味や学びが小さい

2点：
多少の意味や学びがある

3点：
明確な意味や学びがある

4点：
大きな成長や気付きにつながる

5点：
人生観や価値観に関わる大きな意味がある

-------------------------------------

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

=====================================
【合計点】
=====================================

emotion：
0～5点

meaning：
0～5点

relationship：
0～5点

future：
0～5点

rarity：
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
・usedUserProfileは本人情報を実際に評価へ使ったかを示してください。
・usedProfileItemsは利用した本人情報の項目名を示してください。
・userProfileReasonは本人情報をどのように評価へ反映したかを説明してください。
・本人情報を利用していない場合も、userProfileReasonを空文字にしないでください。
・usedMemoryHistoryは過去履歴を実際に評価へ使ったかを示してください。
・historyReferenceReasonは過去履歴の利用方法または利用しなかった理由を説明してください。
・過去履歴の平均点を機械的に今回の点数へ適用しないでください。
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
    emotion:
      normalizeScore(
        result.emotion
      ),

    meaning:
      normalizeScore(
        result.meaning
      ),

    relationship:
      normalizeScore(
        result.relationship
      ),

    future:
      normalizeScore(
        result.future
      ),

    rarity:
      normalizeScore(
        result.rarity
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
// 本人情報利用結果の補正
// =====================================

function normalizeProfileUsage(
  result
) {
  const usedUserProfile =
    result.usedUserProfile === true;

  const usedProfileItems =
    normalizeText(
      result.usedProfileItems,
      usedUserProfile
        ? "利用項目を取得できませんでした"
        : "なし"
    );

  const userProfileReason =
    normalizeText(
      result.userProfileReason,
      usedUserProfile
        ? "本人情報の反映理由を取得できませんでした。"
        : "今回の思い出との明確な関係を確認できなかったため、本人情報は評価に利用していません。"
    );

  return {
    usedUserProfile,
    usedProfileItems:
      usedUserProfile
        ? usedProfileItems
        : "なし",
    userProfileReason
  };
}

// =====================================
// 過去履歴利用結果の補正
// =====================================

function normalizeHistoryUsage(
  result,
  learnedValueProfile
) {
  const hasHistory =
    learnedValueProfile &&
    learnedValueProfile.historyCount > 0;

  const usedMemoryHistory =
    hasHistory &&
    result.usedMemoryHistory === true;

  const historyReferenceReason =
    normalizeText(
      result.historyReferenceReason,

      hasHistory
        ? (
            usedMemoryHistory
              ? "過去の思い出の価値傾向を今回の評価へ反映しました。"
              : "今回の思い出との明確な関連が確認できなかったため、過去履歴は点数評価に利用していません。"
          )
        : "過去の思い出が登録されていないため、履歴による個人化は行っていません。"
    );

  return {
    usedMemoryHistory,
    historyReferenceReason
  };
}

// =====================================
// 25点満点の合計点計算
// =====================================

function calculateScore(
  scores
) {
  return (
    scores.emotion +
    scores.meaning +
    scores.relationship +
    scores.future +
    scores.rarity
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
// 最初に定義されている値を取得
// =====================================

function firstDefinedValue(
  ...values
) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return undefined;
}

// =====================================
// 利用者修正点数が存在するか確認
// =====================================

function hasAnyDefinedScore(
  values
) {
  return values.some(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      Number.isFinite(
        Number(value)
      )
  );
}

// =====================================
// プロンプトへ渡す文章の長さを制限
// =====================================

function trimPromptText(
  value,
  maxLength = MAX_HISTORY_TEXT_LENGTH
) {
  const text =
    String(value || "")
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return (
    text.slice(
      0,
      maxLength
    ) + "…"
  );
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
// 本人情報の値を文字列へ補正
// =====================================

function normalizeProfileValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

// =====================================
// 過去履歴用の文字列補正
// =====================================

function normalizeHistoryText(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

// =====================================
// 過去履歴の合計点補正
// =====================================

function normalizeHistoryTotalScore(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  if (
    Number.isFinite(number)
  ) {
    return Math.max(
      0,
      Math.min(
        25,
        Math.round(number)
      )
    );
  }

  return Math.max(
    0,
    Math.min(
      25,
      Math.round(
        Number(fallback) || 0
      )
    )
  );
}

// =====================================
// 小数第1位へ丸める
// =====================================

function roundToOneDecimal(
  value
) {
  return Math.round(
    Number(value) * 10
  ) / 10;
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
  userProfile,
  memoryHistory,
  learnedValueProfile,
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
    "本人情報:",
    JSON.stringify(
      userProfile,
      null,
      2
    )
  );

  console.log(
    "過去の思い出件数:",
    memoryHistory.length
  );

  console.log(
    "学習した価値傾向:",
    JSON.stringify(
      learnedValueProfile,
      null,
      2
    )
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
      "最大点:",
      "25点"
    );

    console.log(
      "個人化:",
      "本人情報＋過去の思い出詳細＋利用者修正点数＋価値傾向"
    );

    console.log(
      "最大履歴件数:",
      MAX_HISTORY_COUNT
    );

    console.log(
      "================================"
    );
  }
);
