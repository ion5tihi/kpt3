// app.js - Головний контролер мобільного КПТ-застосунку

import { storage } from './storage.js';
import { api, TYPE_LABEL } from './api.js';
import { SpeechRecognizer } from './speech.js';

// ---- Ініціалізація та глобальні змінні ----
let settings = storage.getSettings();
let patients = storage.getPatients();
let activeTab = 'tab-simulator';
let selectedPatientIndex = 0;
let busy = false;

// Стан симулятора
let simulatorState = storage.getSimulatorState() || {
  patientCard: null,
  activeName: "Немає активного пацієнта",
  hiddenState: null,
  chatHistory: [], // [{role: 'user'|'assistant', content: string}]
  log: [], // [{type: 'card'|'patient'|'you'|'hint'|'eval', text: string, hint?: object}]
  constructorConfig: {
    type: 'alko',
    stage: 'рання реабілітація',
    resist: 3,
    insight: 2,
    open: 2,
    risk: 1,
    mode: 'manual'
  }
};

// Стан форми заміток трекера
let trackerDraft = {
  pacs: Array(5).fill(null),
  gad7: Array(7).fill(null),
  phq9: Array(9).fill(null),
  sober: 0,
  sleep: 5,
  trigger: ''
};

// Ініціалізація розпізнавання мови
const speechRecognizer = new SpeechRecognizer();

// ---- Елементи DOM ----
const $ = id => document.getElementById(id);
const $$ = selector => document.querySelectorAll(selector);

// ---- Шкали опитувальників ----
const PACS = {
  name: 'PACS — крейвінг (алкоголь)',
  max: 30,
  cut: 15,
  color: 'var(--accent)',
  cutLabel: '≥15 ризик зриву',
  items: [
    'Як часто думали про випивку цього тижня?',
    'Наскільки сильним був потяг у момент найсильнішого бажання?',
    'Скільки часу були заклопотані думками про випивку?',
    'Наскільки важко було б утриматись, якби алкоголь був під рукою?',
    'Загальний рівень потягу до алкоголю за тиждень.'
  ],
  opts: 7 // оцінки від 0 до 6
};

const GAD7 = {
  name: 'GAD-7 — тривога',
  max: 21,
  cut: 10,
  color: 'var(--anx)',
  cutLabel: '≥10 помірна+ тривога',
  items: [
    'Нервозність, тривога або відчуття на межі',
    'Не міг(-ла) спинити чи контролювати тривогу',
    'Надмірне хвилювання про різні речі',
    'Труднощі з розслабленням',
    'Неспокій, важко всидіти на місці',
    'Легко дратувався(-лась) або ставав(-ла) запальним(-ою)',
    'Страх, ніби станеться щось жахливе'
  ],
  opts: 4 // оцінки від 0 до 3
};

const PHQ9 = {
  name: 'PHQ-9 — депресія',
  max: 27,
  cut: 10,
  color: 'var(--dep)',
  cutLabel: '≥10 помірна+ депресія',
  items: [
    'Мало інтересу чи задоволення від справ',
    'Пригніченість, смуток, безнадія',
    'Проблеми зі сном (важко заснути, переривчастий або задовгий)',
    'Втома, мало енергії',
    'Поганий апетит або переїдання',
    'Погане ставлення до себе (невдаха, підвів(-ла) сім\'ю)',
    'Важко зосередитись (читання, телебачення)',
    'Загальмованість рухів/мови або навпаки метушливість',
    'Думки, що краще померти або зашкодити собі'
  ],
  opts: 4 // оцінки від 0 до 3
};

const SCALES = [PACS, GAD7, PHQ9];

// ---- Запуск програми ----
window.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupNavigation();
  setupSettingsTab();
  setupSimulatorTab();
  setupTrackerTab();
  
  // Рендер за замовчуванням
  renderSimulator();
  renderTracker();
  
  // Відновити інтерактивність полів введення чату
  setSimulatorBusyState(false);
});

// ---- Керування Темами ----
function setupTheme() {
  if (settings.theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
  
  $('theme-toggle').onclick = () => {
    const isDark = document.body.classList.toggle('dark-theme');
    settings.theme = isDark ? 'dark' : 'light';
    storage.saveSettings(settings);
  };
}

// ---- Навігація між вкладками ----
function setupNavigation() {
  $$('.nav-item').forEach(button => {
    button.onclick = (e) => {
      const tabId = button.getAttribute('data-tab');
      switchTab(tabId);
    };
  });
}

function switchTab(tabId) {
  activeTab = tabId;
  
  // Оновити активні класи на кнопках меню
  $$('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  
  // Оновити активні вкладки вмісту
  $$('.tab-content').forEach(content => {
    content.classList.toggle('active', content.getAttribute('id') === tabId);
  });
  
  // Додаткові дії при переході на вкладку
  if (tabId === 'tab-tracker') {
    renderTracker();
  } else if (tabId === 'tab-simulator') {
    scrollChatToBottom();
  }
}

// ---- Простий Markdown Парсер ----
function parseMarkdown(md) {
  if (!md) return "";
  // Базовий ескейп HTML
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Заголовки
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Жирний шрифт
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Цитати
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
  
  // Списки
  let lines = html.split('\n');
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.startsWith('- ') || line.startsWith('* ')) {
      let content = line.substring(2);
      lines[i] = (inList ? '' : '<ul>') + '<li>' + content + '</li>';
      inList = true;
    } else {
      if (inList) {
        lines[i] = '</ul>' + lines[i];
        inList = false;
      }
    }
  }
  if (inList) {
    lines[lines.length - 1] += '</ul>';
  }
  html = lines.join('\n');
  
  // Абзаци та переноси
  html = html.split(/\n\n+/).map(p => {
    p = p.trim();
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<bl')) {
      return p;
    }
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  
  return html;
}

// ==========================================================================
// TAB 1: КПТ-СИМУЛЯТОР (ЛОГІКА)
// ==========================================================================
function setupSimulatorTab() {
  // Згортання конструктора пацієнта
  $('toggle-constructor-btn').onclick = () => {
    const card = $('toggle-constructor-btn').closest('.constructor-card');
    const isCollapsed = card.classList.toggle('collapsed');
    $('toggle-constructor-btn').textContent = isCollapsed ? 'Розгорнути' : 'Згорнути';
  };

  // Перемикач режимів генератора
  $('mode-manual').onclick = () => {
    $('mode-manual').classList.add('active');
    $('mode-auto').classList.remove('active');
    $('manual-params').style.display = 'block';
    $('auto-params').style.display = 'none';
    simulatorState.constructorConfig.mode = 'manual';
    saveSimulator();
  };

  $('mode-auto').onclick = () => {
    $('mode-auto').classList.add('active');
    $('mode-manual').classList.remove('active');
    $('manual-params').style.display = 'none';
    $('auto-params').style.display = 'block';
    simulatorState.constructorConfig.mode = 'auto';
    saveSimulator();
  };

  // Зв'язування повзунків з числовими індикаторами
  const binds = [
    ['p-resist', 'val-resist'],
    ['p-insight', 'val-insight'],
    ['p-open', 'val-open'],
    ['p-risk', 'val-risk']
  ];
  binds.forEach(([sId, vId]) => {
    $(sId).oninput = () => {
      $(vId).textContent = $(sId).value;
      simulatorState.constructorConfig[sId.replace('p-', '')] = parseInt($(sId).value);
      saveSimulator();
    };
  });

  // Запуск генерації пацієнта
  $('btn-generate-patient').onclick = generateVirtualPatient;

  // Відправка повідомлення
  $('btn-send-message').onclick = sendTherapistMessage;
  $('chat-input').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTherapistMessage();
    }
  };

  // Голосове введення
  if (speechRecognizer.isSupported()) {
    $('btn-voice-input').onclick = toggleVoiceDictation;
  } else {
    $('btn-voice-input').title = "Голосове введення не підтримується у цьому браузері";
    $('btn-voice-input').style.opacity = 0.5;
  }

  // Оцінка CTS-R
  $('btn-show-eval').onclick = requestCTSRSupervision;

  // Скидання сесії
  $('btn-reset-session').onclick = () => {
    if (confirm("Ви дійсно хочете очистити бесіду і почати заново?")) {
      resetSimulatorSession();
    }
  };

  // Відновлення значень повзунків з конфігу
  restoreConstructorUI();
}

function restoreConstructorUI() {
  const config = simulatorState.constructorConfig;
  if (config.mode === 'auto') {
    $('mode-auto').click();
  } else {
    $('mode-manual').click();
  }
  
  if (config.type) $('p-type').value = config.type;
  if (config.stage) $('p-stage').value = config.stage;
  
  const sliders = ['resist', 'insight', 'open', 'risk'];
  sliders.forEach(key => {
    if (config[key] !== undefined) {
      $(`p-${key}`).value = config[key];
      $(`val-${key}`).textContent = config[key];
    }
  });
}

function saveSimulator() {
  storage.saveSimulatorState(simulatorState);
}

function resetSimulatorSession() {
  simulatorState.chatHistory = [];
  simulatorState.log = [];
  simulatorState.patientCard = null;
  simulatorState.activeName = "Немає активного пацієнта";
  simulatorState.hiddenState = null;
  saveSimulator();
  renderSimulator();
  
  // Вимкнути поля введення
  $('chat-input').disabled = true;
  $('chat-input').value = "";
  $('btn-send-message').disabled = true;
  $('btn-voice-input').disabled = true;
}

// Генерація віртуального пацієнта
async function generateVirtualPatient() {
  if (busy) return;
  
  // Перевірка наявності API ключа
  if (!settings.apiKey) {
    alert("Будь ласка, вкажіть ваш API-ключ у вкладці «Налаштування» перед початком симуляції.");
    switchTab('tab-settings');
    return;
  }

  busy = true;
  setSimulatorBusyState(true);
  
  // Оновити конфіг з форми
  const config = simulatorState.constructorConfig;
  config.type = $('p-type').value;
  config.stage = $('p-stage').value;
  config.resist = parseInt($('p-resist').value);
  config.insight = parseInt($('p-insight').value);
  config.open = parseInt($('p-open').value);
  config.risk = parseInt($('p-risk').value);
  
  resetSimulatorSession();
  
  showThinkingIndicator('chat-feed', 'ШІ створює пацієнта...');
  
  try {
    const result = await api.generatePatient(settings, config);
    
    // Розділяємо картку пацієнта та його вступну репліку
    const fullText = result.patient;
    const splitIdx = fullText.indexOf('\n\n');
    let card = fullText;
    let opener = '';
    
    if (splitIdx > -1) {
      card = fullText.slice(0, splitIdx).trim();
      opener = fullText.slice(splitIdx).trim();
    }
    
    // Дістаємо ім'я пацієнта з картки
    let pName = "Пацієнт";
    const nameMatch = card.match(/Ім'я, вік:\s*(.*)/i);
    if (nameMatch && nameMatch[1]) {
      pName = nameMatch[1].trim();
    }
    
    // Оновлюємо стан
    simulatorState.patientCard = card;
    simulatorState.activeName = pName;
    simulatorState.hiddenState = result.hiddenState || null;
    
    simulatorState.log.push({ type: 'card', text: card });
    
    // Додаємо в історію API
    simulatorState.chatHistory = [];
    if (opener) {
      simulatorState.chatHistory.push({ role: 'assistant', content: opener });
    }
    
    if (opener) {
      simulatorState.log.push({ type: 'patient', text: opener });
    }
    
    if (result.hint) {
      simulatorState.log.push({ type: 'hint', text: '', hint: result.hint });
    }
    
    saveSimulator();
    renderSimulator();
    
    // Активуємо поля введення
    $('chat-input').disabled = false;
    $('btn-send-message').disabled = false;
    $('btn-voice-input').disabled = false;
    
    // Мобільне згортання конструктора
    if (window.innerWidth <= 960) {
      $('toggle-constructor-btn').closest('.constructor-card').classList.add('collapsed');
      $('toggle-constructor-btn').textContent = 'Розгорнути';
    }
    
    $('chat-input').focus();
    
  } catch (e) {
    showErrorIndicator('chat-feed', e.message);
  } finally {
    busy = false;
    setSimulatorBusyState(false);
  }
}

// Відправка повідомлення терапевта
async function sendTherapistMessage() {
  if (busy) return;
  
  const text = $('chat-input').value.trim();
  if (!text || !simulatorState.patientCard) return;
  
  // Очищення інпута
  $('chat-input').value = "";
  
  // Додавання нашої репліки в лог
  simulatorState.log.push({ type: 'you', text: text });
  renderSimulator();
  
  busy = true;
  setSimulatorBusyState(true);
  showThinkingIndicator('supervisor-feed', 'Супервізор аналізує...');
  showThinkingIndicator('chat-feed', 'Пацієнт думає...');
  
  try {
    const result = await api.sendTurn(
      settings,
      simulatorState.chatHistory,
      text,
      simulatorState.hiddenState,
      simulatorState.patientCard
    );
    
    // Зберігаємо хід у чаті
    simulatorState.chatHistory.push({ role: 'user', content: text });
    simulatorState.chatHistory.push({ role: 'assistant', content: result.patient });
    
    simulatorState.log.push({ type: 'patient', text: result.patient });
    if (result.hint) {
      simulatorState.log.push({ type: 'hint', text: '', hint: result.hint });
    }
    
    saveSimulator();
    renderSimulator();
    $('chat-input').focus();
    
  } catch (e) {
    showErrorIndicator('chat-feed', e.message);
    // Видаляємо останню репліку користувача, оскільки запит не вдався
    simulatorState.log.pop();
    renderSimulator();
  } finally {
    busy = false;
    setSimulatorBusyState(false);
  }
}

// Запит супервізії CTS-R
async function requestCTSRSupervision() {
  if (busy || !simulatorState.patientCard) {
    alert("Спершу згенеруйте пацієнта та проведіть хоча б частину сесії.");
    return;
  }
  
  busy = true;
  setSimulatorBusyState(true);
  
  showThinkingIndicator('supervisor-feed', 'Готую звіт CTS-R...');
  
  try {
    const evalReport = await api.evaluateSession(
      settings,
      simulatorState.chatHistory,
      simulatorState.hiddenState,
      simulatorState.patientCard
    );
    
    // Зберігаємо сесію до Трекера
    saveSimulatorSessionToTracker(evalReport);
    
    // Показуємо результат у модальному вікні
    const pName = simulatorState.activeName;
    const pCode = 'Т-' + pName.replace(/,\s*\d+\s*(роки|років|рік)/i, '').trim();
    const savedNotice = `
      <div class="read-box success" style="margin-bottom: 20px;">
        💾 <strong>Сесію автоматично збережено до Трекера!</strong><br>
        Цей прийом додано як запис для пацієнта під кодом <strong>${escapeHtml(pCode)}</strong>. 
        Ви можете переглянути хід сесії та оцінку в історії прийомів цього пацієнта на вкладці «Трекер».
      </div>
    `;
    $('eval-modal-body').innerHTML = savedNotice + parseMarkdown(evalReport);
    $('eval-modal').classList.add('active');
    
    // Зберігаємо оцінку в лог, щоб не втратити її
    simulatorState.log.push({ type: 'eval', text: evalReport });
    saveSimulator();
    renderSimulator();
    
  } catch (e) {
    alert(`Помилка підготовки оцінки: ${e.message}`);
  } finally {
    busy = false;
    setSimulatorBusyState(false);
  }
}

// Збереження тренувальної сесії до трекера
function saveSimulatorSessionToTracker(evalReport) {
  if (!simulatorState.patientCard) return;
  
  const pName = simulatorState.activeName;
  const pCode = 'Т-' + pName.replace(/,\s*\d+\s*(роки|років|рік)/i, '').trim();
  
  let patient = patients.find(p => p.code === pCode);
  if (!patient) {
    const config = simulatorState.constructorConfig;
    const typeLabel = TYPE_LABEL[config.type] || config.type;
    patient = {
      code: pCode,
      note: typeLabel + ' (Тренажер)',
      group: false,
      records: []
    };
    patients.push(patient);
  }
  
  const today = new Date().toISOString().slice(0, 10);
  const hidden = simulatorState.hiddenState;
  
  const resistance = (hidden && !isNaN(parseInt(hidden.resistanceLevel))) 
    ? parseInt(hidden.resistanceLevel) 
    : (parseInt(simulatorState.constructorConfig.resist) || 0);
    
  const risk = (hidden && !isNaN(parseInt(hidden.riskFlag))) 
    ? parseInt(hidden.riskFlag) 
    : (parseInt(simulatorState.constructorConfig.risk) || 0);
  
  const pacs = Array(5).fill(resistance);
  const gad7 = Array(7).fill(0);
  const phq9 = Array(9).fill(0);
  phq9[8] = risk;
  
  const record = {
    date: today,
    sober: 0,
    sleep: 5,
    trigger: (hidden && hidden.trigger) ? hidden.trigger : 'Сесія у тренажері',
    pacs: pacs,
    gad7: gad7,
    phq9: phq9,
    isPractice: true,
    dialogue: JSON.parse(JSON.stringify(simulatorState.log)),
    ctsReport: evalReport,
    hiddenState: hidden ? JSON.parse(JSON.stringify(hidden)) : null,
    patientCard: simulatorState.patientCard
  };
  
  patient.records.push(record);
  patient.records.sort((a, b) => a.date.localeCompare(b.date));
  
  storage.savePatients(patients);
}

// Запуск повторної сесії для існуючого пацієнта
async function startRepeatSimulatorSession(patient) {
  if (busy) return;
  
  if (!settings.apiKey) {
    alert("Будь ласка, вкажіть ваш API-ключ у вкладці «Налаштування» перед початком симуляції.");
    switchTab('tab-settings');
    return;
  }

  const practiceRecords = patient.records.filter(r => r.isPractice);
  if (practiceRecords.length === 0) {
    alert("Не знайдено попередніх практичних сесій цього пацієнта.");
    return;
  }
  
  const lastRecord = practiceRecords[practiceRecords.length - 1];
  
  // Видобуваємо картку пацієнта
  const cardItem = lastRecord.dialogue ? lastRecord.dialogue.find(it => it.type === 'card') : null;
  const patientCard = lastRecord.patientCard || (cardItem ? cardItem.text : '');
  
  if (!patientCard) {
    alert("Не вдалося знайти медичну картку пацієнта.");
    return;
  }
  
  // Видобуваємо ім'я пацієнта
  let patientName = "Пацієнт";
  const nameMatch = patientCard.match(/Ім'я, вік:\s*(.*)/i);
  if (nameMatch && nameMatch[1]) {
    patientName = nameMatch[1].trim();
  } else {
    patientName = patient.code.replace(/^Т-/, '');
  }
  
  // Відтворюємо прихований стан (з фолбеком для старих записів)
  const hiddenState = lastRecord.hiddenState || {
    trigger: lastRecord.trigger || 'тригер вживання',
    coreBelief: 'необхідно виявити під час діалогу',
    resistanceLevel: lastRecord.pacs ? lastRecord.pacs[0] : 3,
    resistanceMechanism: 'intellectualisation',
    hiddenFear: 'необхідно виявити під час діалогу',
    riskFlag: lastRecord.phq9 ? lastRecord.phq9[8] : 0
  };
  
  const sessionNumber = practiceRecords.length + 1;
  
  // Визначаємо етап лікування з картки пацієнта
  const stageMatch = patientCard.match(/Етап лікування:\s*(.*)/i);
  const stage = stageMatch ? stageMatch[1].trim() : "рання реабілітація";
  
  // Готуємо тренажер
  resetSimulatorSession();
  
  busy = true;
  setSimulatorBusyState(true);
  switchTab('tab-simulator');
  
  showThinkingIndicator('chat-feed', 'ШІ готує повторний прийом...');
  
  try {
    const result = await api.generateRepeatSession(
      settings,
      hiddenState,
      patientCard,
      sessionNumber,
      stage,
      patientName
    );
    
    // Заповнюємо стан симулятора
    simulatorState.patientCard = patientCard;
    simulatorState.activeName = patientName;
    simulatorState.hiddenState = hiddenState;
    
    simulatorState.log = [];
    simulatorState.chatHistory = [];
    
    // Додаємо картку до логу
    simulatorState.log.push({ type: 'card', text: patientCard });
    
    // Вступна репліка повторного прийому
    if (result.patient) {
      simulatorState.chatHistory.push({ role: 'assistant', content: result.patient });
      simulatorState.log.push({ type: 'patient', text: result.patient });
    }
    
    // Перша підказка супервізора
    if (result.hint) {
      simulatorState.log.push({ type: 'hint', text: '', hint: result.hint });
    }
    
    saveSimulator();
    renderSimulator();
    
    // Активуємо інпути
    $('chat-input').disabled = false;
    $('btn-send-message').disabled = false;
    $('btn-voice-input').disabled = false;
    
    // Мобільне згортання конструктора
    if (window.innerWidth <= 960) {
      $('toggle-constructor-btn').closest('.constructor-card').classList.add('collapsed');
      $('toggle-constructor-btn').textContent = 'Розгорнути';
    }
    
    $('chat-input').focus();
    
  } catch (e) {
    showErrorIndicator('chat-feed', e.message);
  } finally {
    busy = false;
    setSimulatorBusyState(false);
  }
}

// Запуск/зупинка розпізнавання голосу
function toggleVoiceDictation() {
  if (speechRecognizer.isListening) {
    speechRecognizer.stop();
  } else {
    $('btn-voice-input').classList.add('listening');
    let startText = $('chat-input').value;
    
    speechRecognizer.start(
      // onResult
      (transcript, isFinal) => {
        $('chat-input').value = startText + (startText ? " " : "") + transcript;
        adjustTextareaHeight($('chat-input'));
      },
      // onEnd
      () => {
        $('btn-voice-input').classList.remove('listening');
      },
      // onError
      (error) => {
        $('btn-voice-input').classList.remove('listening');
        alert(`Голосове введення призупинено: ${error}`);
      }
    );
  }
}

function adjustTextareaHeight(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight) + 'px';
}

function setSimulatorBusyState(isBusy) {
  $('btn-generate-patient').disabled = isBusy;
  $('btn-send-message').disabled = isBusy || !simulatorState.patientCard;
  $('chat-input').disabled = isBusy || !simulatorState.patientCard;
  $('btn-voice-input').disabled = isBusy || !simulatorState.patientCard || !speechRecognizer.isSupported();
  $('btn-show-eval').disabled = isBusy || !simulatorState.patientCard;
  
  if (!isBusy) {
    removeThinkingIndicators();
  }
}

// Візуалізація стрічки чату та підказок
function renderSimulator() {
  const dFeed = $('chat-feed');
  const hFeed = $('supervisor-feed');
  
  dFeed.innerHTML = "";
  hFeed.innerHTML = "";
  
  $('active-patient-name').textContent = simulatorState.activeName;
  
  if (simulatorState.log.length === 0) {
    dFeed.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🛋️</div>
      <p>Налаштуйте параметри зліва та натисніть «Згенерувати пацієнта», щоб почати терапевтичну бесіду.</p>
    </div>`;
    
    hFeed.innerHTML = `<div class="empty-state">
      <p>Підказки з'являться після першої репліки пацієнта.</p>
    </div>`;
    return;
  }
  
  let lastHint = null;
  
  simulatorState.log.forEach(item => {
    if (item.type === 'card') {
      dFeed.insertAdjacentHTML('beforeend', `
        <div class="chat-bubble card">${escapeHtml(item.text)}</div>
      `);
    } else if (item.type === 'patient') {
      dFeed.insertAdjacentHTML('beforeend', `
        <div class="chat-bubble patient">
          <div class="bubble-meta">Пацієнт</div>
          <div>${escapeHtml(item.text)}</div>
        </div>
      `);
    } else if (item.type === 'you') {
      dFeed.insertAdjacentHTML('beforeend', `
        <div class="chat-bubble you">
          <div class="bubble-meta">Ви (психолог)</div>
          <div>${escapeHtml(item.text)}</div>
        </div>
      `);
    } else if (item.type === 'hint') {
      lastHint = item.hint;
    } else if (item.type === 'eval') {
      dFeed.insertAdjacentHTML('beforeend', `
        <div class="chat-bubble eval-card">
          <div class="bubble-meta" style="color:var(--accent);">📋 Звіт супервізора CTS-R</div>
          <div class="markdown-style">${parseMarkdown(item.text)}</div>
        </div>
      `);
    }
  });
  
  // Візуалізація останньої підказки супервізора в правій панелі
  if (lastHint) {
    hFeed.innerHTML = `
      <div class="hint-box">
        <div class="hint-title">👤 Поточний стан</div>
        <p><b>Що відбувається:</b> ${escapeHtml(lastHint.now)}</p>
        <p style="margin-top:8px;"><b>Уникайте помилки:</b> <span style="color:var(--anx);">${escapeHtml(lastHint.avoid)}</span></p>
        <p class="hint-do"><b>Рекомендація:</b> ${escapeHtml(lastHint.do)}</p>
        <div class="hint-ex"><b>Приклад запитання:</b> «${escapeHtml(lastHint.example)}»</div>
      </div>
    `;
  } else {
    hFeed.innerHTML = `
      <div class="empty-state">
        <p>Пацієнт ще не відповів або очікується хід ШІ.</p>
      </div>
    `;
  }
  
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const dFeed = $('chat-feed');
  dFeed.scrollTop = dFeed.scrollHeight;
}

// Допоміжні функції індикаторів
function showThinkingIndicator(containerId, message) {
  const container = $(containerId);
  container.insertAdjacentHTML('beforeend', `
    <div class="thinking-indicator" id="think-${containerId}">
      <span class="pulse-dot">⏳</span> ${message}
    </div>
  `);
  container.scrollTop = container.scrollHeight;
}

function removeThinkingIndicators() {
  const t1 = $('think-chat-feed');
  const t2 = $('think-supervisor-feed');
  if (t1) t1.remove();
  if (t2) t2.remove();
}

function showErrorIndicator(containerId, errorMsg) {
  removeThinkingIndicators();
  const container = $(containerId);
  container.insertAdjacentHTML('beforeend', `
    <div class="thinking-indicator" style="color:var(--anx);">
      ⚠️ Помилка: ${escapeHtml(errorMsg)}
    </div>
  `);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// CTS-R Звіт Модальне вікно
$('btn-close-eval').onclick = () => $('eval-modal').classList.remove('active');
$('btn-close-eval-foot').onclick = () => $('eval-modal').classList.remove('active');
$('btn-export-eval-log').onclick = () => {
  if (simulatorState.log.length === 0) return;
  
  let html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
  <title>Звіт сесії КПТ</title><style>
  body{font-family:Georgia,serif;max-width:800px;margin:0 auto;padding:40px 24px;color:#1e2530;line-height:1.6;background:#fdfcf9;}
  h1{font-size:24px;border-bottom:2px solid #2e7d6b;padding-bottom:10px;color:#2e7d6b;}
  .bubble{padding:14px;border-radius:10px;margin-bottom:12px;border:1px solid #e2dcd0;}
  .patient{background:#eaf3f0;border-left:4px solid #2e7d6b;}
  .you{background:#ffffff;border-left:4px solid #5e6875;}
  .card{background:#f5f2eb;font-family:monospace;white-space:pre-wrap;font-size:12px;}
  .eval{background:#fdfcf9;border:2px solid #e2dcd0;padding:20px;}
  .meta{font-size:10px;font-weight:bold;text-transform:uppercase;color:#5e6875;margin-bottom:4px;}
  </style></head><body><h1>Лог КПТ-Сесії та Супервізія</h1>`;
  
  simulatorState.log.forEach(it => {
    if (it.type === 'card') html += `<div class="bubble card">${escapeHtml(it.text)}</div>`;
    else if (it.type === 'patient') html += `<div class="bubble patient"><div class="meta">Пацієнт</div>${escapeHtml(it.text)}</div>`;
    else if (it.type === 'you') html += `<div class="bubble you"><div class="meta">Психолог (Ви)</div>${escapeHtml(it.text)}</div>`;
    else if (it.type === 'eval') html += `<div class="bubble eval"><div class="meta">Звіт Супервізора CTS-R</div>${parseMarkdown(it.text)}</div>`;
  });
  
  html += `</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kpt-session-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ==========================================================================
// TAB 2: КЛІНІЧНИЙ ТРЕКЕР (ЛОГІКА)
// ==========================================================================
function setupTrackerTab() {
  $('filter-all').onclick = () => {
    $('filter-all').classList.add('active');
    $('filter-group').classList.remove('active');
    renderTracker();
  };

  $('filter-group').onclick = () => {
    $('filter-group').classList.add('active');
    $('filter-all').classList.remove('active');
    renderTracker();
  };

  $('btn-add-patient').onclick = () => {
    const codeInp = $('new-patient-code');
    const code = codeInp.value.trim().toUpperCase();
    if (!code) return;
    
    // Перевірка дублікату
    const exists = patients.some(p => p.code === code);
    if (exists) {
      alert("Пацієнт з таким кодом вже існує!");
      return;
    }
    
    patients.push({
      code: code,
      note: '',
      group: false,
      records: []
    });
    
    codeInp.value = "";
    selectedPatientIndex = patients.length - 1;
    resetTrackerFormDraft();
    storage.savePatients(patients);
    renderTracker();
  };
}

function resetTrackerFormDraft() {
  trackerDraft = {
    pacs: Array(5).fill(null),
    gad7: Array(7).fill(null),
    phq9: Array(9).fill(null),
    sober: 0,
    sleep: 5,
    trigger: ''
  };
}

function renderTracker() {
  renderPatientsList();
  renderTrackerForm();
  renderTrackerChart();
}

// Список пацієнтів
function renderPatientsList() {
  const container = $('tracker-patients-list');
  container.innerHTML = "";
  
  const showOnlyGroup = $('filter-group').classList.contains('active');
  
  patients.forEach((p, idx) => {
    if (showOnlyGroup && !p.group) return;
    
    const div = document.createElement('div');
    div.className = `patient-list-item ${idx === selectedPatientIndex ? 'active' : ''}`;
    div.onclick = () => {
      selectedPatientIndex = idx;
      resetTrackerFormDraft();
      renderTracker();
    };
    
    div.innerHTML = `
      <div class="item-info">
        <span class="item-code">${escapeHtml(p.code)}</span>
        <span class="item-meta">${escapeHtml(p.note || 'Без діагнозу')} · ${p.records.length} зап.</span>
      </div>
      <span class="star-btn ${p.group ? 'active' : ''}" data-index="${idx}">★</span>
    `;
    
    // Toggle зірочки експ. групи
    div.querySelector('.star-btn').onclick = (e) => {
      e.stopPropagation();
      p.group = !p.group;
      storage.savePatients(patients);
      renderTracker();
    };
    
    container.appendChild(div);
  });
}

// Рендеринг шкал опитувальника
function renderScaleUI(scale, key) {
  const draftVals = trackerDraft[key];
  const sumVal = draftVals.reduce((acc, v) => acc + (v || 0), 0);
  const isThreshold = sumVal >= scale.cut;
  
  const badgeClass = isThreshold ? 'scale-badge warning' : 'scale-badge success';
  const badgeText = isThreshold ? `⚠ ${scale.cutLabel}` : 'Норма';
  
  let itemsHtml = "";
  
  scale.items.forEach((itemText, qIdx) => {
    let buttonsHtml = "";
    for (let optVal = 0; optVal < scale.opts; optVal++) {
      const isSelected = draftVals[qIdx] === optVal;
      buttonsHtml += `
        <button class="score-btn ${isSelected ? 'selected' : ''}" 
                onclick="window.setDraftScaleValue('${key}', ${qIdx}, ${optVal})">
          ${optVal}
        </button>
      `;
    }
    
    itemsHtml += `
      <div class="scale-item-row">
        <div class="scale-q-text">${qIdx + 1}. ${escapeHtml(itemText)}</div>
        <div class="scale-buttons">${buttonsHtml}</div>
      </div>
    `;
  });
  
  return `
    <div class="scale-wrapper">
      <div class="scale-title">
        <span>${escapeHtml(scale.name)}</span>
        <div>
          <span>Сума: <b style="color:${scale.color}; font-size: 15px;">${sumVal}</b>/${scale.max}</span>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
      </div>
      <div class="scale-items">
        ${itemsHtml}
      </div>
    </div>
  `;
}

// Запис оцінки у чорновик (глобальна функція для виклику через inline onclick)
window.setDraftScaleValue = (scaleKey, qIdx, value) => {
  trackerDraft[scaleKey][qIdx] = value;
  renderTrackerForm();
};

// Рендеринг форми
function renderTrackerForm() {
  const container = $('tracker-form-container');
  const p = patients[selectedPatientIndex];
  
  if (!p) {
    container.innerHTML = `<div class="empty-state"><p>Оберіть або додайте пацієнта зліва.</p></div>`;
    return;
  }
  
  const today = new Date().toISOString().slice(0, 10);
  const isTrainerPatient = p.code.startsWith('Т-');
  const repeatBtnHtml = isTrainerPatient 
    ? `<button id="btn-repeat-session" class="ghost-btn" style="font-size: 13px; padding: 6px 12px; border: 1px solid var(--primary); color: var(--primary); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; background: transparent; transition: background 0.2s, color 0.2s;">🛋️ Повторний прийом</button>`
    : '';
  
  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
      <div class="patient-code-title" style="margin-bottom: 0;">${escapeHtml(p.code)}</div>
      ${repeatBtnHtml}
    </div>
    
    <div class="input-group">
      <label for="p-note">Діагноз / Опис випадку</label>
      <input type="text" id="p-note" value="${escapeHtml(p.note)}" placeholder="напр. алко + депресія, рання реаб.">
    </div>

    <div class="form-grid">
      <div class="input-group">
        <label for="f-date">Дата прийому</label>
        <input type="date" id="f-date" value="${today}">
      </div>

      <div class="input-group">
        <label for="f-sober">Днів тверезості</label>
        <input type="number" id="f-sober" min="0" value="${trackerDraft.sober}">
      </div>

      <div class="slider-group full-width">
        <div class="slider-header">
          <label for="f-sleep">Якість сну цього тижня</label>
          <span class="slider-val" id="val-f-sleep">${trackerDraft.sleep}</span>
        </div>
        <input type="range" id="f-sleep" min="0" max="10" value="${trackerDraft.sleep}">
        <div class="slider-labels">
          <span>Безсоння</span>
          <span>Чудовий сон</span>
        </div>
      </div>
    </div>

    <!-- Візуалізація 3 шкал -->
    ${renderScaleUI(PACS, 'pacs')}
    ${renderScaleUI(GAD7, 'gad7')}
    ${renderScaleUI(PHQ9, 'phq9')}

    <div class="input-group full-width" style="margin-top:16px;">
      <label for="f-trigger">Головний тригер тижня</label>
      <input type="text" id="f-trigger" value="${escapeHtml(trackerDraft.trigger)}" placeholder="напр. конфлікт на роботі, зустріч з друзями...">
    </div>

    <div class="save-record-row">
      <button id="btn-save-record" class="primary-btn">Зберегти замітку</button>
      <span id="tracker-saved-success" class="success-note">✓ Збережено в картку!</span>
    </div>
  `;
  
  // Додаткова логіка збереження нотатки
  $('p-note').oninput = (e) => {
    p.note = e.target.value;
    storage.savePatients(patients);
    renderPatientsList();
  };

  $('f-sober').oninput = (e) => {
    trackerDraft.sober = parseInt(e.target.value) || 0;
  };

  $('f-sleep').oninput = (e) => {
    trackerDraft.sleep = parseInt(e.target.value);
    $('val-f-sleep').textContent = e.target.value;
  };

  $('f-trigger').oninput = (e) => {
    trackerDraft.trigger = e.target.value;
  };

  $('btn-save-record').onclick = saveSessionRecord;

  if (isTrainerPatient) {
    const btnRepeat = $('btn-repeat-session');
    if (btnRepeat) {
      btnRepeat.onclick = () => {
        startRepeatSimulatorSession(p);
      };
    }
  }
  
  // Оновлюємо історію
  renderHistoryTable(p);
}

// Збереження нового запису
function saveSessionRecord() {
  const p = patients[selectedPatientIndex];
  if (!p) return;
  
  const dateVal = $('f-date').value;
  if (!dateVal) {
    alert("Будь ласка, вкажіть дату сесії!");
    return;
  }
  
  // Якщо якісь запитання лишилися пустими, заповнюємо їх 0
  const finalPacs = trackerDraft.pacs.map(v => v === null ? 0 : v);
  const finalGad7 = trackerDraft.gad7.map(v => v === null ? 0 : v);
  const finalPhq9 = trackerDraft.phq9.map(v => v === null ? 0 : v);
  
  const record = {
    date: dateVal,
    sober: trackerDraft.sober,
    sleep: trackerDraft.sleep,
    trigger: trackerDraft.trigger.trim(),
    pacs: finalPacs,
    gad7: finalGad7,
    phq9: finalPhq9
  };
  
  // Додаємо запис, сортуємо за датою
  p.records.push(record);
  p.records.sort((a, b) => a.date.localeCompare(b.date));
  
  // Збереження
  storage.savePatients(patients);
  
  // Візуальний зворотний зв'язок
  const successLabel = $('tracker-saved-success');
  successLabel.classList.add('show');
  setTimeout(() => successLabel.classList.remove('show'), 2000);
  
  // Очищення чорновика та оновлення UI
  resetTrackerFormDraft();
  renderTracker();
}

// Рендеринг таблиці історії
function renderHistoryTable(patient) {
  const container = $('history-table-container');
  
  if (patient.records.length === 0) {
    container.innerHTML = `<p class="info-text">Історія порожня. Додайте перший запис вище.</p>`;
    return;
  }
  
  let rowsHtml = "";
  
  // Показуємо в зворотному хронологічному порядку
  [...patient.records].reverse().forEach((r, rIdx) => {
    const pacsSum = r.pacs.reduce((a,b)=>a+b, 0);
    const gad7Sum = r.gad7.reduce((a,b)=>a+b, 0);
    const phq9Sum = r.phq9.reduce((a,b)=>a+b, 0);
    
    // Перевірка суїцидальних думок (п.9 PHQ-9)
    const hasSuicidalIdeation = r.phq9 && r.phq9[8] > 0;
    
    let practiceLink = "";
    if (r.isPractice) {
      practiceLink = `<br><a href="#" class="view-practice-link" data-index="${rIdx}" style="display:inline-block; font-size:11px; margin-top:4px; color:var(--primary); font-weight:600; text-decoration:underline;">👁️ Див. сесію</a>`;
    }
    
    rowsHtml += `
      <tr>
        <td>${r.date}</td>
        <td>${r.sober} дн.</td>
        <td class="${pacsSum >= 15 ? 'alert-text' : ''}">${pacsSum}</td>
        <td class="${gad7Sum >= 10 ? 'alert-text' : ''}">${gad7Sum}</td>
        <td class="${phq9Sum >= 10 || hasSuicidalIdeation ? 'alert-text' : ''}">
          ${phq9Sum}${hasSuicidalIdeation ? ' ⚠' : ''}
        </td>
        <td>${r.sleep}/10</td>
        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(r.trigger) || '—'}
          ${practiceLink}
        </td>
      </tr>
    `;
  });
  
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Дата</th>
          <th>Тверезість</th>
          <th>PACS</th>
          <th>GAD-7</th>
          <th>PHQ-9</th>
          <th>Сон</th>
          <th>Тригер</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <div class="info-text" style="margin-top: 8px;">
      ⚠ біля балу PHQ-9 = виявлено суїцидальні думки (ненульова відповідь на 9-й пункт опитувальника).
    </div>
  `;

  // Навішуємо обробники кліків для перегляду практичних сесій
  container.querySelectorAll('.view-practice-link').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const rIdx = parseInt(link.getAttribute('data-index'));
      const reversedRecords = [...patient.records].reverse();
      const record = reversedRecords[rIdx];
      if (record && record.isPractice) {
        showPracticeSessionDetails(patient, record);
      }
    };
  });
}

// Показує детальний лог практичного заняття в модальному вікні
function showPracticeSessionDetails(patient, record) {
  let contentHtml = `<div class="chat-feed" style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px; max-height:350px; overflow-y:auto; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-card);">`;
  
  // Картка пацієнта
  const cardItem = record.dialogue.find(it => it.type === 'card');
  if (cardItem) {
    contentHtml += `<div class="chat-bubble card" style="align-self:center; max-width:100%; width:100%; margin-bottom:10px;">${escapeHtml(cardItem.text)}</div>`;
  }
  
  // Діалог
  record.dialogue.forEach(it => {
    if (it.type === 'patient') {
      contentHtml += `
        <div class="chat-bubble patient" style="max-width:85%; align-self:flex-start; margin-bottom:6px;">
          <div class="bubble-meta">Пацієнт</div>
          <div>${escapeHtml(it.text)}</div>
        </div>
      `;
    } else if (it.type === 'you') {
      contentHtml += `
        <div class="chat-bubble you" style="max-width:85%; align-self:flex-end; margin-bottom:6px;">
          <div class="bubble-meta">Ви (психолог)</div>
          <div>${escapeHtml(it.text)}</div>
        </div>
      `;
    }
  });
  contentHtml += `</div>`;
  
  contentHtml += `<hr style="margin:20px 0; border:0; border-top:1px solid var(--line);">`;
  contentHtml += `<div class="markdown-style">${parseMarkdown(record.ctsReport)}</div>`;
  
  $('eval-modal-body').innerHTML = contentHtml;
  
  const modalHeader = $('eval-modal').querySelector('.modal-head h2');
  const originalTitle = modalHeader.textContent;
  modalHeader.textContent = `Практика: ${patient.code} (${record.date})`;
  
  $('eval-modal').classList.add('active');
  
  const restoreTitle = () => {
    modalHeader.textContent = originalTitle;
    $('btn-close-eval').removeEventListener('click', restoreTitle);
    $('btn-close-eval-foot').removeEventListener('click', restoreTitle);
  };
  $('btn-close-eval').addEventListener('click', restoreTitle);
  $('btn-close-eval-foot').addEventListener('click', restoreTitle);
}

// Генерація інтерактивного SVG-графіка
function renderTrackerChart() {
  const container = $('chart-container');
  const interpretation = $('chart-interpretation');
  
  container.innerHTML = "";
  interpretation.innerHTML = "";
  
  const p = patients[selectedPatientIndex];
  if (!p || p.records.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>Тут з'явиться графік після збереження хоча б однієї сесії.</p></div>`;
    return;
  }
  
  const recs = p.records;
  const W = 620;
  const H = 280;
  const padL = 40;
  const padR = 40;
  const padT = 20;
  const padB = 40;
  const n = recs.length;
  
  // Координата X для точки
  const getX = i => padL + (n === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1));
  
  // Координата Y для відсотків (шкали від 0 до 100%)
  const getYPercent = (val, max) => padT + (1 - val / max) * (H - padT - padB);
  
  // Координата Y для днів тверезості (права вісь)
  const maxSober = Math.max(20, ...recs.map(r => r.sober));
  const getYSober = v => padT + (1 - v / maxSober) * (H - padT - padB);
  
  // Малювання лінії тренду для шкали
  const makeLinePath = (key, scaleMax, strokeColor) => {
    const points = recs.map((r, i) => {
      const sumVal = r[key].reduce((a,b)=>a+b, 0);
      return `${getX(i)},${getYPercent(sumVal, scaleMax)}`;
    }).join(' ');
    
    const dots = recs.map((r, i) => {
      const sumVal = r[key].reduce((a,b)=>a+b, 0);
      return `<circle cx="${getX(i)}" cy="${getYPercent(sumVal, scaleMax)}" r="4" fill="${strokeColor}" />`;
    }).join('');
    
    return `<polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="3" />${dots}`;
  };

  // Лінія тверезості (пунктирна)
  const soberPoints = recs.map((r, i) => `${getX(i)},${getYSober(r.sober)}`).join(' ');
  const soberDots = recs.map((r, i) => `<circle cx="${getX(i)}" cy="${getYSober(r.sober)}" r="3.5" fill="var(--primary)" />`).join('');
  const soberPath = `<polyline points="${soberPoints}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-dasharray="5 4" />${soberDots}`;
  
  // Сітка відсотків (ліва вісь)
  let gridHtml = "";
  for (let pct = 0; pct <= 100; pct += 25) {
    const yy = padT + (1 - pct / 100) * (H - padT - padB);
    gridHtml += `
      <line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--line-light)" stroke-width="1" />
      <text x="${padL - 8}" y="${yy + 4}" font-size="10" fill="var(--ink-soft)" text-anchor="end">${pct}%</text>
    `;
  }
  
  // Шкала днів тверезості (права вісь)
  let soberLabelsHtml = "";
  const stepSober = Math.ceil(maxSober / 4);
  for (let v = 0; v <= maxSober; v += stepSober) {
    const yy = getYSober(v);
    soberLabelsHtml += `
      <text x="${W - padR + 8}" y="${yy + 4}" font-size="10" fill="var(--primary)" text-anchor="start">${v}д</text>
    `;
  }
  
  // Підписи дат (вісь X)
  const xLabelsHtml = recs.map((r, i) => {
    return `<text x="${getX(i)}" y="${H - padB + 16}" font-size="9" fill="var(--ink-soft)" text-anchor="middle">${r.date.slice(5)}</text>`;
  }).join('');
  
  // Вставляємо все в SVG
  container.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}">
        <!-- Сітка -->
        ${gridHtml}
        
        <!-- Лінії -->
        ${soberPath}
        ${makeLinePath('pacs', PACS.max, 'var(--accent)')}
        ${makeLinePath('gad7', GAD7.max, 'var(--anx)')}
        ${makeLinePath('phq9', PHQ9.max, 'var(--dep)')}
        
        <!-- Осі -->
        ${xLabelsHtml}
        ${soberLabelsHtml}
        
        <!-- Рамка графіка -->
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" stroke="var(--line)" />
        <line x1="${W-padR}" y1="${padT}" x2="${W-padR}" y2="${H-padB}" stroke="var(--line)" />
      </svg>
    </div>
    
    <div class="legend" style="display:flex; justify-content:space-around; flex-wrap:wrap; font-size:11px; margin-top:8px; gap:8px;">
      <span style="display:inline-flex; align-items:center; gap:4px;"><i style="width:12px; height:3px; background:var(--accent); display:inline-block;"></i>PACS (потяг)</span>
      <span style="display:inline-flex; align-items:center; gap:4px;"><i style="width:12px; height:3px; background:var(--anx); display:inline-block;"></i>GAD-7 (тривога)</span>
      <span style="display:inline-flex; align-items:center; gap:4px;"><i style="width:12px; height:3px; background:var(--dep); display:inline-block;"></i>PHQ-9 (депресія)</span>
      <span style="display:inline-flex; align-items:center; gap:4px;"><i style="width:12px; height:3px; border-top: 2px dashed var(--primary); display:inline-block;"></i>Тверезість (права вісь)</span>
    </div>
  `;
  
  // Рендеринг клінічного висновку
  renderInterpretation(recs);
}

// Автоматична клінічна інтерпретація графіків
function renderInterpretation(recs) {
  const box = $('chart-interpretation');
  
  if (recs.length < 2) {
    if (recs.length === 1) {
      const lastRec = recs[0];
      const pacsSum = lastRec.pacs.reduce((a,b)=>a+b, 0);
      const gad7Sum = lastRec.gad7.reduce((a,b)=>a+b, 0);
      const phq9Sum = lastRec.phq9.reduce((a,b)=>a+b, 0);
      
      let text = `📊 <b>Поточний стан:</b> На основі першої сесії у пацієнта виявлено:<br>`;
      text += `- Крейвінг (PACS): <b>${pacsSum}</b> балів (${pacsSum >= 15 ? '<span style="color:var(--accent); font-weight:bold;">перевищує поріг ризику зриву</span>' : 'в межах норми'}).<br>`;
      text += `- Тривога (GAD-7): <b>${gad7Sum}</b> балів (${gad7Sum >= 10 ? '<span style="color:var(--anx); font-weight:bold;">помірна/сильна тривога</span>' : 'норма'}).<br>`;
      text += `- Депресія (PHQ-9): <b>${phq9Sum}</b> балів (${phq9Sum >= 10 ? '<span style="color:var(--dep); font-weight:bold;">помірна/сильна депресія</span>' : 'норма'}).<br>`;
      if (lastRec.phq9 && lastRec.phq9[8] > 0) {
        text += `🚨 <strong style="color:var(--anx);">УВАГА:</strong> Виявлено суїцидальні думки! Потрібно обов'язково перевірити наявність контракту безпеки.<br>`;
      }
      text += `<br><i>Збережіть ще хоча б одну сесію для цього пацієнта, щоб побудувати графік та розрахувати динаміку змін у часі.</i>`;
      box.innerHTML = `<div class="read-box info">${text}</div>`;
    } else {
      box.innerHTML = `<div class="read-box">Потрібно мінімум 2 записи в історії, щоб ШІ міг проаналізувати динаміку на тлі тверезості.</div>`;
    }
    return;
  }
  
  const f = recs[0];
  const l = recs[recs.length - 1];
  
  const fPacs = f.pacs.reduce((a,b)=>a+b, 0);
  const lPacs = l.pacs.reduce((a,b)=>a+b, 0);
  const fGad = f.gad7.reduce((a,b)=>a+b, 0);
  const lGad = l.gad7.reduce((a,b)=>a+b, 0);
  
  const soberDaysGrown = l.sober > f.sober + 5;
  const anxietyDecreased = lGad < fGad - 2;
  const anxietyStable = lGad >= fGad - 2;
  
  let text = "";
  let type = "info"; // alert, success, info
  
  // 1. Потяг PACS
  if (lPacs >= 15) {
    text += `⚠️ <b>Підвищений ризик зриву:</b> Поточний рівень крейвінгу (PACS = ${lPacs} балів) перевищує безпечний поріг. Рекомендується посилити роботу над запобіганням зриву та тригерними зонами.<br><br>`;
    type = "alert";
  }
  
  // 2. Суїцидальний ризик
  const hasSuicideHistory = recs.some(r => r.phq9 && r.phq9[8] > 0);
  if (hasSuicideHistory) {
    text += `🚨 <b>Увага до безпеки:</b> В історії пацієнта виявлені суїцидальні наміри (пункт 9 PHQ-9 > 0). Завжди оцінюйте рівень ризику на поточній сесії та перевіряйте наявність антисуїцидального контракту.<br><br>`;
    type = "alert";
  }
  
  // 3. Кореляція тривоги та тверезості
  if (soberDaysGrown && anxietyDecreased) {
    text += `📊 <b>Клінічний висновок:</b> Термін тверезості збільшується (${f.sober} ➔ ${l.sober} дн.), і при цьому рівень тривоги знижується (GAD-7: ${fGad} ➔ ${lGad}). Це вказує на <b>абстинентну тривогу</b>, яка поступово минає самостійно по мірі детоксикації. Продовжуйте підтримуючу терапію.`;
    if (type !== 'alert') type = "success";
  } else if (soberDaysGrown && anxietyStable) {
    text += `📊 <b>Клінічний висновок:</b> Пацієнт тривалий час залишається тверезим (${f.sober} ➔ ${l.sober} дн.), але рівень тривоги залишається високим (GAD-7: ${fGad} ➔ ${lGad}). Це свідчить про те, що <b>тривога не є суто абстинентною</b>. Наявний самостійний Генералізований тривожний розлад (ГТР). Покажіть цей графік пацієнту, обговоріть мішень для КПТ («ви тверезі, але тривога лишилась, отже річ в іншому»).`;
    if (type !== 'alert') type = "info";
  } else {
    text += `📊 <b>Клінічний висновок:</b> Динаміка станів має змішаний або нестабільний характер. Рекомендується проаналізувати зв'язок коливань показників із тригерами тижня (наприклад: "${escapeHtml(l.trigger || 'немає')}").`;
  }
  
  box.innerHTML = `<div class="read-box ${type}">${text}</div>`;
}

// ==========================================================================
// TAB 4: НАЛАШТУВАННЯ (ЛОГІКА)
// ==========================================================================
function setupSettingsTab() {
  // Заповнити поля збереженими значеннями
  $('settings-provider').value = settings.apiProvider || 'openai';
  $('settings-api-key').value = settings.apiKey || '';
  $('settings-openai-model').value = settings.openaiModel || 'gpt-4o-mini';
  $('settings-custom-prompt').value = settings.customSystemPrompt || '';

  // Перемикання відображення полів моделей
  const toggleModelFields = () => {
    const provider = $('settings-provider').value;
    $('group-openai-model').style.display = provider === 'openai' ? 'block' : 'none';
  };
  
  $('settings-provider').onchange = toggleModelFields;
  toggleModelFields();

  // Приховати/показати API-ключ
  $('btn-toggle-key-visibility').onclick = (e) => {
    e.preventDefault();
    const type = $('settings-api-key').type;
    $('settings-api-key').type = type === 'password' ? 'text' : 'password';
    $('btn-toggle-key-visibility').textContent = type === 'password' ? '🔒' : '👁️';
  };

  // Зберегти налаштування
  $('btn-save-settings').onclick = () => {
    settings.apiProvider = $('settings-provider').value;
    settings.apiKey = $('settings-api-key').value.trim();
    settings.openaiModel = $('settings-openai-model').value;
    settings.customSystemPrompt = $('settings-custom-prompt').value;
    
    storage.saveSettings(settings);
    
    // Показуємо успіх
    const successNote = $('settings-saved-success');
    successNote.classList.add('show');
    setTimeout(() => successNote.classList.remove('show'), 2000);
  };

  // Експорт бази даних
  $('btn-export-data').onclick = () => {
    const dataStr = storage.exportData();
    const blob = new Blob([dataStr], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kpt-assistant-db-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Імпорт бази даних
  $('btn-trigger-import').onclick = () => {
    $('settings-import-file').click();
  };

  $('settings-import-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedJson = JSON.parse(event.target.result);
        const success = storage.importData(importedJson);
        
        if (success) {
          alert("Дані успішно імпортовано! Додаток буде перезавантажено.");
          window.location.reload();
        } else {
          alert("Помилка: Неправильний формат файлу резервної копії.");
        }
      } catch (err) {
        alert("Помилка при зчитуванні файлу. Перевірте, чи є він коректним JSON файлом.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Скидаємо інпут
  };

  // Повне очищення
  $('btn-clear-all').onclick = () => {
    if (confirm("УВАГА! Це назавжди видалить ВСІХ пацієнтів, історію прийомів та ваші налаштування. Продовжити?")) {
      storage.clearAll();
      alert("Всі дані видалено. Сторінка буде перезавантажена.");
      window.location.reload();
    }
  };
}
