// api.js - Інтеграція з OpenAI та Anthropic API

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"; // Примітка: може вимагати CORS проксі у браузері

export const TYPE_LABEL = {
  alko: 'алкогольна залежність',
  opio: 'опіоїдна залежність',
  stim: 'залежність від стимуляторів',
  sed: 'залежність від седативних засобів',
  poly: 'полінаркоманія',
  gambl: 'гемблінг (ігрова залежність)',
  'dual-dep': 'подвійний діагноз: залежність + депресія',
  'dual-gtr': 'подвійний діагноз: залежність + Генералізований тривожний розлад (ГТР)',
  'dual-ptsr': 'подвійний діагноз: залежність + ПТСР',
  'dual-panic': 'подвійний діагноз: залежність + панічний розлад',
  'pure-dep': 'чиста депресія (без залежності)',
  'pure-ocd': 'чистий ОКР (обсесивно-компульсивний розлад)',
  'pure-phobia': 'фобічний розлад'
};

// Системний промпт для віртуального пацієнта
function getSystemPrompt(customPrompt, hiddenState, patientCard) {
  let basePrompt = customPrompt && customPrompt.trim() ? customPrompt : `Ти — рушій симуляції для тренування психолога-початківця в КПТ (Когнітивно-поведінкова терапія). Користувач ВИВЧАЄ терапію, він не є експертом. Контекст: наркологічне відділення обласної психіатричної лікарні.

Ти граєш ПАЦІЄНТА і одночасно даєш ПІДКАЗКУ терапевту. Відповідай ЗАВЖДИ строго у форматі JSON, без жодного тексту поза JSON.

Обов'язковий формат відповіді JSON:
{
  "patient": "репліка пацієнта від першої особи, жива розмовна мова українською, 1-3 фрази",
  "hint": {
    "now": "що зараз відбувається з психологічного погляду — назви механізм (опір, мінімізація, амбівалентність, автоматична думка, когнітивне викривлення тощо). 1-2 речення",
    "avoid": "чого терапевту НЕ слід робити зараз — типова помилка психолога-початківця в цій точці",
    "do": "що потрібно зробити — конкретна техніка КПТ або Мотиваційного інтерв'ювання (MI) українською (наприклад: сократичний діалог, рефлексивне слухання, зважування за і проти, аналіз когнітивного спотворення, поведінковий експеримент тощо) та куди спрямувати бесіду",
    "example": "орієнтовний приклад фрази/питання для терапевта — одна фраза, яку він може використати для орієнтиру"
  }
}

Як грати пацієнта:
- Будь психологічно реалістичним: показуй спротив, заперечення хвороби, мінімізацію вживання, раціоналізацію, амбівалентність (хочу кинути, але це єдине задоволення), почуття сорому чи вини.
- НЕ погоджуйся і НЕ здавайся занадто швидко. Якщо терапевт задає хороше, відкрите чи сократичне питання — відкривайся поступово. Якщо він тисне, моралізує, дає передчасні поради чи сперечається — дратуйся, закривайся, захищай своє вживання, відповідай коротко або йди у повний опір.
- Май прихований внутрішній стан або страх, який розкривається ТІЛЬКИ у разі застосування терапевтом правильних технік (наприклад, сократичний діалог, скероване відкриття).
- Відповідай на сократичні запитання сумнівом у своїй позиції. Якщо з тобою сперечаються — захищай вживання сильніше.
- Користувач може використовувати диктування голосом, через що слова можуть бути трохи спотворені — розумій за контекстом і не виправляй помилки користувача.
- Зберігай стабільність характеру, пацієнт не може вилікуватись за 5 реплік.`;

  if (patientCard) {
    basePrompt += `\n\n[МЕДИЧНА КАРТКА ПАЦІЄНТА]\n${patientCard}`;
  }

  if (hiddenState) {
    basePrompt += `\n\n[ПРИХОВАНИЙ КОГНІТИВНИЙ СТАН ПАЦІЄНТА]\n` +
      `- Ситуація високого ризику / Тригер: ${hiddenState.trigger}\n` +
      `- Глибинне переконання: ${hiddenState.coreBelief}\n` +
      `- Рівень опору (0-5): ${hiddenState.resistanceLevel}\n` +
      `- Механізм опору: ${hiddenState.resistanceMechanism}\n` +
      `- Прихований страх (розкривай ТІЛЬКИ на правильні сократичні чи емпатичні питання): ${hiddenState.hiddenFear}\n` +
      `- Рівень небезпеки (ризик суїциду/відміни 0-3): ${hiddenState.riskFlag}\n\n` +
      `Керуйся цим прихованим станом. Відігруй призначений механізм опору:\n` +
      `- intellectualisation (інтелектуалізація): розмовляй про проблему теоретично, використовуй розумні слова, але уникай емоційного контакту та визнання власної проблеми.\n` +
      `- charm-as-avoidance (шарм як уникнення): намагайся сподобатися терапевту, роби компліменти, жартуй, щоб перевести тему з болючих питань.\n` +
      `- aggression (агресія): захищайся через роздратування, звинувачуй терапевта у некомпетентності чи безкорисності терапії.\n` +
      `- hollow-agreement (пуста згода): формально погоджуйся з усім («так, ви праві»), але насправді не змінюй переконань та уникай внутрішньої роботи.\n` +
      `- tears (сльози/розрядка): починай плакати, жалітися на життя, використовуючи емоційний вилив, щоб терапевт пожалів тебе та припинив розпитувати про відповідальність.\n` +
      `- deflective-humour (відволікаючий гумор): постійно віджартовуйся, знецінюй серйозність проблеми через гумор.`;
  }

  return basePrompt;
}

// Промпт супервізії за шкалою CTS-R
function getEvalPrompt() {
  return `Тепер ВИЙДИ З РОЛІ. Дай супервізію за шкалою CTS-R (Cognitive Therapy Scale - Revised). Відповідай ЗВИЧАЙНИМ ТЕКСТОМ українською мовою з використанням красивого Markdown форматування.

Оціни сесію за наступними 12 пунктами, виставляючи за кожен пункт бал від 0 до 6 (0 - некомпетентно, 3-4 - адекватно, 5-6 - експертний рівень):
1. Порядок денний (Agenda)
2. Зворотний зв'язок (Feedback)
3. Співпраця (Collaboration)
4. Темп та керування часом (Pacing)
5. Міжособистісна ефективність (Interpersonal Effectiveness)
6. Скероване відкриття / Сократичний діалог (Guided Discovery)
7. Концептуалізація (Conceptualization)
8. Ключові когніції / Виявлення думок (Key Cognitions)
9. Робота з емоціями (Focus on Emotion)
10. Робота з поведінкою / Дії (Focus on Behavior)
11. Техніки змін (Cognitive/Behavioral Techniques)
12. Домашнє завдання (Homework)

Для кожного пункту напиши виставлений бал і коротке клінічне обґрунтування (чому саме такий бал).
Вкажи загальну суму балів: СУМА / 72 (мінімальний поріг компетентності ≥ 36).

МОТИВАЦІЙНЕ ІНТЕРВ'ЮВАННЯ (MI) ТА МІТИ (MITI):
Оціни глобальні параметри за шкалою 1-5 (де 1 - найнижчий, 5 - найвищий):
- Плекання мови змін (Cultivating Change Talk)
- Пом'якшення мови статус-кво (Softening Sustain Talk)
- Партнерство (Partnership)
- Емпатія (Empathy)
Дай оціночне співвідношення рефлексій до запитань (Reflection-to-Question ratio) та відсоток складних рефлексій, використаних терапевтом.

Після цього виділи:
- **3 сильні ходи:** конкретні репліки терапевта, які були найбільш вдалими.
- **3 головні помилки/зони росту:** що було невдалим (наприклад, повчання, суперечки, пропущені теми) з цитатами та пропозицією, як краще було б сформулювати репліку.

НАРКОЛОГІЧНА СПЕЦИФІКА: Оціни, чи врахував терапевт роботу з опором, потягом (крейвінгом), тригерами, профілактикою рецидиву, або подвійним діагнозом.
ЧЕРВОНІ ПРАПОРЦІ БЕЗПЕКИ: Чи помітив терапевт сигнали небезпеки (ризик відміни, суїцидальні думки, сильна нестабільність) — або вкажи "Немає".

Будь чесним і професійним супервізором, не завищуй бали з ввічливості.`;
}

export async function callOpenAI(settings, messages, jsonMode = false) {
  const { apiKey, openaiModel } = settings;
  if (!apiKey) {
    throw new Error("API-ключ не вказано. Будь ласка, введіть його в налаштуваннях.");
  }

  const body = {
    model: openaiModel || "gpt-4o-mini",
    messages: messages,
    temperature: 0.7
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Код помилки: ${response.status}`;
    throw new Error(`OpenAI помилка: ${message}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function callAnthropic(settings, system, messages) {
  const { apiKey } = settings;
  if (!apiKey) {
    throw new Error("API-ключ не вказано. Будь ласка, введіть його в налаштуваннях.");
  }

  // Anthropic вимагає CORS або проксі, робимо прямий запит
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" // Для клієнтських застосунків
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
      system: system,
      messages: messages
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Код помилки: ${response.status}`;
    throw new Error(`Anthropic помилка: ${message}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

export const api = {
  // Згенерувати пацієнта
  async generatePatient(settings, config) {
    let briefPrompt = "";
    if (config.mode === 'manual') {
      briefPrompt = `Створи пацієнта строго з параметрами:
- Тип розладу: ${TYPE_LABEL[config.type] || config.type}
- Етап лікування: ${config.stage}
- Рівень опору: ${config.resist}/5 (де 0 - немає опору, 5 - максимальний опір)
- Рівень усвідомлення проблеми (інсайту): ${config.insight}/5
- Емоційна відкритість: ${config.open}/5
- Ризик для безпеки: ${config.risk}/3 (якщо ≥2 — заклади в характер серйозний ризик зриву/відміни або суїцидальних думок, які терапевт мусить помітити)`;
    } else {
      briefPrompt = `Витягни випадковий клінічний випадок з ухилом у наркологію (60% - чиста залежність від речовин, 30% - подвійний діаагноз, 10% - інші розлади на кшталт тривоги чи депресії). Рівні опору, інсайту та відкритості обери випадкові.`;
    }

    const fullPrompt = `${briefPrompt}

Поверни JSON. Цього разу JSON обов'язково повинен містити три поля: "patient", "hiddenState" та "hint".

1. Поле "patient" заповни особливим чином: спочатку сформуй медичну картку пацієнта у такому форматі (використовуючи переноси рядків \\n):
НОВИЙ ПАЦІЄНТ
Ім'я, вік: ...
Привід звернення (як сам формулює): ...
Основний діагноз: ...
Коморбідність (якщо є): ...
Етап лікування: ...
Налаштування на момент входу: ...

Після цього зроби подвійний перенос рядка (\\n\\n) і напиши першу фразу від першої особи — як пацієнт відкриває розмову у кабінеті.

2. Поле "hiddenState" має містити приховану когнітивну модель пацієнта, яка не показується користувачеві безпосередньо. Це об'єкт із такими ключами:
- "trigger": конкретна ситуація високого ризику / тригер (наприклад: "конфлікт з дружиною", "зустріч з друзями, які вживають")
- "coreBelief": глибинне переконання пацієнта стосовно вживання речовини (наприклад: "без алкоголю я не впораюся зі стресом")
- "resistanceLevel": рівень опору як число від 0 до 5 (має відповідати параметру вхідного опору)
- "resistanceMechanism": механізм опору пацієнта, обери один із: "intellectualisation", "charm-as-avoidance", "aggression", "hollow-agreement", "tears", "deflective-humour"
- "hiddenFear": прихований страх, який лежить за опором (наприклад: "страх залишитися наодинці зі своїми думками", "страх втратити друзів")
- "riskFlag": число від 0 до 3 (ризик для безпеки)

3. Поле "hint" має містити першу підказку супервізора терапевту.`;

    const system = getSystemPrompt(settings.customSystemPrompt);
    const messages = [{ role: "user", content: fullPrompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      responseText = await callAnthropic(settings, system, messages);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], true);
    }

    return this.parseResponse(responseText);
  },

  // Надіслати нову репліку у чат
  async sendTurn(settings, history, userText, hiddenState, patientCard) {
    const system = getSystemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    const messages = [...history, { role: "user", content: userText }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      const cleanHistory = history.map(h => ({ role: h.role, content: h.content }));
      cleanHistory.push({ role: "user", content: userText });
      responseText = await callAnthropic(settings, system, cleanHistory);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], true);
    }

    return this.parseResponse(responseText);
  },

  // Отримати оцінку CTS-R
  async evaluateSession(settings, chatHistory, hiddenState, patientCard) {
    const evalTextPrompt = getEvalPrompt();
    const system = getSystemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    
    // Формуємо історію для оцінки: додаємо промпт оцінки в кінець
    const messages = [...chatHistory, { role: "user", content: evalTextPrompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      const cleanHistory = chatHistory.map(h => ({ role: h.role, content: h.content }));
      cleanHistory.push({ role: "user", content: evalTextPrompt });
      responseText = await callAnthropic(settings, system, cleanHistory);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], false);
    }

    return responseText;
  },

  // Згенерувати повторну сесію (повторний прийом)
  async generateRepeatSession(settings, hiddenState, patientCard, sessionNumber, stage, patientName) {
    const system = getSystemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    
    const prompt = `Це повторний прийом (сесія №${sessionNumber}) з пацієнтом ${patientName}.
Пацієнт пам'ятає попередню розмову. Етап лікування: ${stage}.
Напиши першу репліку пацієнта на початку цієї нової сесії (наприклад, як він заходить у кабінет і вітається, розповідає про свій стан з минулого тижня).
Поверни JSON з полями "patient" (тільки вступна репліка пацієнта від першої особи) та "hint" (перша підказка супервізора).`;

    const messages = [{ role: "user", content: prompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      responseText = await callAnthropic(settings, system, messages);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], true);
    }

    return this.parseResponse(responseText);
  },

  // Допоміжний метод парсингу JSON
  parseResponse(text) {
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const startIdx = cleanText.indexOf('{');
    const endIdx = cleanText.lastIndexOf('}');
    
    if (startIdx > -1 && endIdx > -1) {
      cleanText = cleanText.slice(startIdx, endIdx + 1);
    }
    
    try {
      return JSON.parse(cleanText);
    } catch (e) {
      console.error("Помилка парсингу JSON від ШІ:", text);
      throw new Error("Не вдалося розпарсити відповідь ШІ як JSON. Перевірте консоль розробника.");
    }
  }
};
