// ai-service.js — тонкая обёртка над DeepSeek API (AiService из ТЗ).
//
// ВАЖНО про реальные возможности: обычный DeepSeek chat-completions API
// НЕ умеет сам ходить в интернет — это подтверждено их же документацией
// (tool calling есть, но саму функцию обязано выполнять приложение).
// Поэтому AiService используется здесь для того, что LLM реально умеет
// без браузинга: анализ уже известных данных, генерация поисковых
// запросов, сравнение и объяснение совпадений, тексты досье, этимология
// фамилий по обучающим данным модели, исторический контекст по эпохе.
// AI НИКОГДА не меняет дерево напрямую — только предлагает,
// пользователь подтверждает через обычные API дерева.

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// deepseek-chat/deepseek-reasoner официально отключены с 24 июля 2026 —
// используем актуальные идентификаторы модели напрямую.
const MODEL = "deepseek-v4-flash";

function isConfigured() {
  return !!DEEPSEEK_API_KEY;
}

// messages: [{role, content}], jsonMode: bool — просим строго JSON-ответ
async function callDeepSeek(messages, { jsonMode = false, temperature = 0.4 } = {}) {
  if (!isConfigured()) {
    const err = new Error("DeepSeek API не настроен: не задана переменная окружения DEEPSEEK_API_KEY");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  const body = {
    model: MODEL,
    messages,
    temperature,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`DeepSeek API вернул ошибку ${res.status}: ${text.slice(0, 300)}`);
    err.code = "AI_REQUEST_FAILED";
    throw err;
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error("DeepSeek вернул пустой ответ");
    err.code = "AI_EMPTY_RESPONSE";
    throw err;
  }
  if (jsonMode) {
    try { return JSON.parse(content); }
    catch { const err = new Error("DeepSeek вернул невалидный JSON"); err.code = "AI_BAD_JSON"; throw err; }
  }
  return content;
}

module.exports = { callDeepSeek, isConfigured };
