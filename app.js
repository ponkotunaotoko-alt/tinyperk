
// ===================== DATE HELPERS (timezone-safe) =====================
// YYYY-MM-DD文字列 → ローカル時刻のDateオブジェクト
function parseLocalDate(s) {
  if (!s) return new Date(NaN);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Dateオブジェクトまたはタイムスタンプ → YYYY-MM-DD文字列（ローカル時刻）
function toLocalDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ===================== SUPABASE SYNC =====================
let _supabase = null;

function getSupabase() {
  if (!_supabase && window.supabase && window.SUPABASE_URL) {
    _supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  }
  return _supabase;
}

// Show/hide auth modal
function showAuthModal() {
  const el = document.getElementById('auth-modal-overlay');
  if (el) el.style.display = 'flex';
}
function hideAuthModal() {
  const el = document.getElementById('auth-modal-overlay');
  if (el) el.style.display = 'none';
}

function setAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  if (msg) { el.textContent = msg; el.style.display = 'block'; }
  else { el.style.display = 'none'; }
}

async function authLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { setAuthError('メールとパスワードを入力してください'); return; }
  const btn = document.getElementById('btn-auth-login');
  btn.textContent = '...'; btn.disabled = true;
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  btn.textContent = 'ログイン'; btn.disabled = false;
  if (error) {
    let msg = error.message;
    if (msg === 'Invalid login credentials') msg = 'メールまたはパスワードが違います';
    else if (msg.includes('Email not confirmed')) msg = '📧 メール確認が未完了です。登録時に届いたメールのリンクをクリックしてから再度ログインしてください。';
    setAuthError(msg);
  }
}

async function authSignup() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { setAuthError('メールとパスワードを入力してください'); return; }
  if (password.length < 8) { setAuthError('パスワードは8文字以上にしてください'); return; }
  const btn = document.getElementById('btn-auth-signup');
  btn.textContent = '...'; btn.disabled = true;
  const { error } = await getSupabase().auth.signUp({ email, password });
  btn.textContent = '新規登録'; btn.disabled = false;
  if (error) { setAuthError(error.message); }
  else { setAuthError(''); alert('確認メールを送りました。メール内のリンクをクリックして認証を完了してください。\n※メールが届かない場合はSpamフォルダを確認してください。'); }
}

async function authLogout() {
  await getSupabase().auth.signOut();
  // Clear local state
  localStorage.clear();
  location.reload();
}

function updateSidebarUser(user) {
  const info = document.getElementById('sidebar-user-info');
  const emailEl = document.getElementById('sidebar-user-email');
  if (info) info.style.display = user ? 'block' : 'none';
  if (emailEl && user) emailEl.textContent = user.email;
  // Update settings sync area
  const loggedOut = document.getElementById('sync-logged-out');
  const loggedIn = document.getElementById('sync-logged-in');
  const syncEmail = document.getElementById('sync-user-email');
  if (loggedOut) loggedOut.style.display = user ? 'none' : 'flex';
  if (loggedIn) loggedIn.style.display = user ? 'flex' : 'none';
  if (syncEmail && user) syncEmail.textContent = user.email;
}

async function forceSyncNow() {
  showSyncStatus('同期中...', 10000);
  await syncToSupabase();
  showSyncStatus('✅ 同期完了');
}

function showSyncStatus(msg, durationMs = 2000) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.style.display = 'none', durationMs);
}

// Pull data from Supabase into state + localStorage
async function syncFromSupabase(userId) {
  const sb = getSupabase();
  const { data, error } = await sb.from('user_data').select('*').eq('user_id', userId).single();
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found (first time)
    console.warn('[SYNC] load error:', error.message);
    return;
  }
  if (!data) return; // First time user, no data yet

  if (data.tasks) { state.tasks = data.tasks; saveTasksToStorage(); }
  if (data.timecards) { state.timecards = data.timecards; saveTimecardsToStorage(); }
  if (data.journal_entries) { state.journalEntries = data.journal_entries; saveJournalToStorage(); }
  if (data.business_info && Object.keys(data.business_info).length) {
    state.businessInfo = { ...state.businessInfo, ...data.business_info };
    localStorage.setItem('businessInfo', JSON.stringify(state.businessInfo));
  }
  if (data.client_templates && Object.keys(data.client_templates).length) {
    state.clientTemplates = data.client_templates;
    saveClientTemplatesToStorage();
  }
  showSyncStatus('☁️ データを同期しました');
}

// Push state to Supabase
async function syncToSupabase() {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;

  const payload = {
    user_id: user.id,
    tasks: state.tasks,
    timecards: state.timecards,
    journal_entries: state.journalEntries,
    business_info: state.businessInfo,
    client_templates: state.clientTemplates
  };

  const { error } = await sb.from('user_data').upsert(payload, { onConflict: 'user_id' });
  if (error) console.warn('[SYNC] save error:', error.message);
  else showSyncStatus('☁️ 保存済み');
}

// Debounced sync (wait 2s after last change)
let _syncTimer = null;
function scheduleSyncToSupabase() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToSupabase, 2000);
}

// ===================== END SUPABASE SYNC =====================

// TINYPERK - Task & Invoice Manager v2.0

// ローカルタイムゾーンで YYYY-MM-DD を返す（toISOString()はUTCなので使わない）
function getLocalDateStr(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// State Management
let state = {
  tasks: [],
  timecards: [], // Attendance logs
  selectedDate: getLocalDateStr(),
  currentMonth: new Date(),
  activeTab: 'dashboard', // default to dashboard
  theme: 'light',
  googleClientId: '',
  googleAccessToken: '',
  editingTaskId: null,

  // NEW: Stopwatch global state
  activeTimerTaskId: null,
  timerStartEpoch: null,
  timerAccumulatedSeconds: 0,
  activeBTType: null,       // 'break' | 'travel' | null
  btStartEpoch: null,
  btInterval: null,

  // Steps editor temp state
  editingSteps: [],

  // Task Tray
  trayOpen: false,
  trayFilter: 'all',

  // Client report templates
  clientTemplates: {},

  // Task list tab
  taskListFilter: 'active',
  taskListSort: 'dueDate',
  taskSearchQuery: '',

  // Daily Journal
  journalEntries: {},       // { 'YYYY-MM-DD': { text: '...', updatedAt: '...' } }
  journalDate: getLocalDateStr(),

  // Pomodoro timer
  pomodoro: {
    running: false,
    phase: 'work',   // 'work' | 'break'
    remaining: 25 * 60,
    sessionsToday: 0,
    interval: null,
    workDuration: 25 * 60,
    breakDuration: 5 * 60
  },

  // Business Info for invoices
  businessInfo: {
    name: '', company: '', address: '', phone: '', email: '',
    bankName: '', bankBranch: '', accountType: '普通', accountNumber: '', accountHolder: '',
    invoiceNumber: ''
  },

  // Work hours settings for AI scheduler
  workSettings: {
    startHour: 9,
    endHour: 18,
    workDays: [1, 2, 3, 4, 5]  // Mon-Fri
  },

  // AI scheduling proposals: [{taskId, suggestedDate}]
  schedulingProposals: [],

  // NEW: Deals pipeline
  deals: [],

  // NEW: Contacts
  contacts: [],

  // NEW: Goals
  goals: {
    monthlyRevenue: 0,
    monthlyLearningHours: 0,
    monthlyClientCount: 0
  },

  // NEW: Expenses
  expenses: [],

  // NEW: Ideas
  ideas: [],

  // Contacts filter
  contactsFilter: 'all'
};

let timerInterval = null;

// Encouragement Messages list
const MOTIVATION_MESSAGES = [
  "今日もお疲れ様でした！一歩一歩の積み重ねが素晴らしい未来を作ります！✨",
  "素晴らしい進捗です！自分自身の頑張りをしっかり褒めてあげましょう！😊",
  "無理は禁物です。少し深呼吸して、リラックスする時間も大切にしてくださいね。🍵",
  "今日のアクションが、明日の成果に繋がっています。お見事です！🚀",
  "コツコツと進める姿、とても素敵です。今日もお疲れ様でした！🌟"
];

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered successfully.', reg.scope))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}

// iOSキーボード表示時のスクロール修正
document.addEventListener('focusin', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
  }
});

// ─────────────────────────────────────────────────────────────
// #3 ONBOARDING
// ─────────────────────────────────────────────────────────────
const ONB_STEPS = [
  { icon: '📋', title: 'TINYPERKへようこそ', body: 'フリーランス・個人事業主のためのタスク管理と請求管理アプリです。まず今日のタスクを追加してみましょう。' },
  { icon: '⏱️', title: 'タスクの時間を計測', body: 'タスクを開くとストップウォッチで作業時間を計測できます。見積もり時間と比較して生産性を可視化。' },
  { icon: '🧾', title: '請求金額を自動計算', body: 'タスクに単価を設定するだけで、月次の請求額が自動集計されます。レポート画面でいつでも確認できます。' },
];
let _onbStep = 0;

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _renderOnbStep(0);
}

function _renderOnbStep(i) {
  _onbStep = i;
  const s = ONB_STEPS[i];
  document.getElementById('onb-icon').textContent = s.icon;
  document.getElementById('onb-title').textContent = s.title;
  document.getElementById('onb-body').textContent = s.body;
  document.getElementById('onb-primary-btn').textContent = i < ONB_STEPS.length - 1 ? '次へ →' : '🚀 はじめる';
  ONB_STEPS.forEach((_, idx) => {
    const dot = document.getElementById(`onb-dot-${idx}`);
    if (dot) dot.classList.toggle('active', idx === i);
  });
}

function _onbNext() {
  if (_onbStep < ONB_STEPS.length - 1) {
    _renderOnbStep(_onbStep + 1);
  } else {
    _dismissOnboarding();
  }
}

function _dismissOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) overlay.style.display = 'none';
  localStorage.setItem('onboardingDone', '1');
}

function initOnboarding() {
  if (localStorage.getItem('onboardingDone')) return;
  setTimeout(showOnboarding, 600);
}

// ─────────────────────────────────────────────────────────────
// #4 PWA INSTALL PROMPT
// ─────────────────────────────────────────────────────────────
let _pwaInstallPrompt = null;

function initPWAPrompt() {
  // Don't show if already dismissed
  if (localStorage.getItem('pwaModalDismissed')) return;
  // Don't show on desktop (standalone PWA or wide screen)
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone) return; // iOS standalone

  const overlay = document.getElementById('pwa-modal-overlay');
  const desc = document.getElementById('pwa-modal-desc');
  const installBtn = document.getElementById('pwa-modal-install-btn');
  const closeBtn = document.getElementById('pwa-modal-close-btn');
  if (!overlay) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isIOSSafari = isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios|opios|mercury/i.test(navigator.userAgent);

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show modal for Android Chrome
    desc.textContent = 'TINYPERKをホーム画面に追加すると、アプリのようにすばやく起動できます。';
    installBtn.style.display = 'block';
    overlay.style.display = 'flex';
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    localStorage.setItem('pwaModalDismissed', '1');
    overlay.style.display = 'none';
  });

  closeBtn.addEventListener('click', () => {
    localStorage.setItem('pwaModalDismissed', '1');
    overlay.style.display = 'none';
  });

  // iOS Safari only — show after short delay
  if (isIOSSafari) {
    setTimeout(() => {
      desc.innerHTML = 'Safariの下部にある <strong style="color:#fff">共有ボタン（□↑）</strong> をタップして、<strong style="color:#fff">「ホーム画面に追加」</strong> を選んでください。';
      overlay.style.display = 'flex';
    }, 2000);
  }
}

function triggerPWAInstall() { /* removed */ }

function dismissPWABanner() { /* removed */ }

// ─────────────────────────────────────────────────────────────
// #11 PULL-TO-REFRESH
// ─────────────────────────────────────────────────────────────
function initPullToRefresh() {
  let startY = 0, pulling = false, triggered = false;
  const indicator = document.getElementById('ptr-indicator');
  const THRESHOLD = 80;

  const mainContent = document.querySelector('.main-content');
  if (!mainContent || !indicator) return;

  mainContent.addEventListener('touchstart', e => {
    if (mainContent.scrollTop === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      triggered = false;
    }
  }, { passive: true });

  mainContent.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10) indicator.classList.add('ptr-visible');
    if (dy > THRESHOLD && !triggered) triggered = true;
  }, { passive: true });

  mainContent.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    if (triggered) {
      indicator.classList.add('ptr-refreshing');
      setTimeout(() => {
        renderApp();
        indicator.classList.remove('ptr-visible', 'ptr-refreshing');
      }, 800);
    } else {
      indicator.classList.remove('ptr-visible');
    }
  });
}

// ─────────────────────────────────────────────────────────────
// #13 KEYBOARD NAVIGATION
// ─────────────────────────────────────────────────────────────
function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    // Skip if typing in an input/textarea
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (isModalOpen()) return;

    // Cmd/Ctrl+K → focus search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      switchTab('tasks');
      setTimeout(() => document.getElementById('task-search-input')?.focus(), 100);
      return;
    }

    // Number keys 1-5 → switch tabs
    const tabMap = { '1': 'dashboard', '2': 'tasks', '3': 'reports', '4': 'journal', '5': 'settings' };
    if (!e.metaKey && !e.ctrlKey && !e.altKey && tabMap[e.key]) {
      switchTab(tabMap[e.key]);
      return;
    }

    // N → new task
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openAddTaskModal(state.selectedDate);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// #6 EMPTY STATES helpers (called from renderTaskList, etc.)
// ─────────────────────────────────────────────────────────────
function emptyStateHTML(icon, title, body, actionHTML = '') {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-body">${body}</div>
    ${actionHTML ? `<div class="empty-state-action">${actionHTML}</div>` : ''}
  </div>`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  loadLocalStorage();
  initTheme();
  detectShareLink();
  setupEventListeners();
  resumeActiveTimerOnLoad();
  injectDashboardWidgets(); // NEW: pipeline + idea widgets
  renderApp();
  initOnboarding();
  initPWAPrompt();
  initPullToRefresh();
  initKeyboardNav();
  // Supabase: optional login — check existing session silently
  const _sb = getSupabase();
  if (_sb) {
    _sb.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user) {
        updateSidebarUser(session.user);
        syncFromSupabase(session.user.id).then(() => renderApp());
      }
    });
    _sb.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        hideAuthModal();
        updateSidebarUser(session.user);
        if (event === 'SIGNED_IN') {
          syncFromSupabase(session.user.id).then(() => renderApp());
        }
      } else {
        updateSidebarUser(null);
      }
    });
  }
});

// Load data from localStorage
function loadLocalStorage() {
  try {
    const savedTasks = localStorage.getItem('tasks');
    state.tasks = savedTasks ? JSON.parse(savedTasks) : null;
  } catch(e) {
    console.error('[TINYPERK] tasks parse error:', e);
    state.tasks = null;
  }

  if (!state.tasks) {
    // Inject seed data with dependency fields and spentSeconds
    state.tasks = [
      {
        id: '1',
        name: 'ホームページの初期デザイン作成',
        details: 'クライアント確認用のワイヤーフレームとトップページのモックアップ作成。',
        dueDate: getLocalDateStr(),
        originalDueDate: getLocalDateStr(),
        client: '株式会社テクノロジー',
        amount: 80000,
        status: 'in-progress',
        completedAt: null,
        dependsOnTaskId: null,
        isDeadlineFixed: false,
        spentSeconds: 3600 // 1 hour spent
      },
      {
        id: '2',
        name: 'ロゴデザインの納品',
        details: 'AI, PNG, SVG形式で最終デザインを納品する。',
        dueDate: toLocalDateStr(Date.now() - 86400000), // yesterday
        originalDueDate: toLocalDateStr(Date.now() - 86400000),
        client: 'さくらカフェ',
        amount: 35000,
        status: 'completed',
        completedAt: toLocalDateStr(Date.now() - 86400000),
        dependsOnTaskId: null,
        isDeadlineFixed: false,
        spentSeconds: 1800 // 30 mins spent
      },
      {
        id: '3',
        name: 'システム要件定義書作成',
        details: '開発スケジュールと要求機能一覧を作成し、承認を得る。',
        dueDate: toLocalDateStr(Date.now() + 86400000 * 2), // in 2 days
        originalDueDate: toLocalDateStr(Date.now() + 86400000 * 2),
        client: '株式会社テクノロジー',
        amount: 120000,
        status: 'not-started',
        completedAt: null,
        dependsOnTaskId: '1', // Depends on design task
        isDeadlineFixed: false,
        spentSeconds: 0
      }
    ];
    saveTasksToStorage();
  }

  // Attendance data
  try {
    const savedTimecards = localStorage.getItem('timecards');
    state.timecards = savedTimecards ? JSON.parse(savedTimecards) : null;
  } catch(e) {
    console.error('[TINYPERK] timecards parse error:', e);
    state.timecards = null;
  }

  if (!state.timecards) {
    // Inject seed attendance
    state.timecards = [
      {
        id: toLocalDateStr(Date.now() - 86400000), // yesterday
        date: toLocalDateStr(Date.now() - 86400000),
        clockIn: '09:00',
        clockOut: '17:30',
        moodBefore: '😊',
        moodAfter: '😆',
        reportText: 'ロゴデザインの最終調整を行い、無事納品しました！',
        totalHours: 8.5
      }
    ];
    saveTimecardsToStorage();
  }

  try {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) state.theme = savedTheme;
  } catch(e) {}

  try {
    const savedClientId = localStorage.getItem('googleClientId');
    if (savedClientId) state.googleClientId = savedClientId;
  } catch(e) {}

  try {
    const savedTemplates = localStorage.getItem('clientTemplates');
    state.clientTemplates = savedTemplates ? JSON.parse(savedTemplates) : {};
  } catch(e) {
    console.error('[TINYPERK] clientTemplates parse error:', e);
    state.clientTemplates = {};
  }

  try {
    const savedJournal = localStorage.getItem('journalEntries');
    state.journalEntries = savedJournal ? JSON.parse(savedJournal) : {};
  } catch(e) {
    console.error('[TINYPERK] journalEntries parse error:', e);
    state.journalEntries = {};
  }

  // 事業者情報の復元
  try {
    const savedBizInfo = localStorage.getItem('businessInfo');
    if (savedBizInfo) state.businessInfo = { ...state.businessInfo, ...JSON.parse(savedBizInfo) };
  } catch(e) {}

  // 稼働時間設定の復元
  try {
    const savedWork = localStorage.getItem('workSettings');
    if (savedWork) state.workSettings = { ...state.workSettings, ...JSON.parse(savedWork) };
  } catch(e) {}

  // タイマー状態の復元
  try {
    const timerState = localStorage.getItem('timerState');
    if (timerState) {
      const ts = JSON.parse(timerState);
      state.activeTimerTaskId = ts.taskId || null;
      state.timerStartEpoch = ts.startEpoch || null;
      state.timerAccumulatedSeconds = ts.accumulated || 0;
    }
  } catch(e) {}

  // NEW: 案件データ
  try {
    const d = localStorage.getItem('deals');
    state.deals = d ? JSON.parse(d) : [];
  } catch(e) { state.deals = []; }

  // NEW: コンタクトデータ
  try {
    const d = localStorage.getItem('contacts');
    state.contacts = d ? JSON.parse(d) : [];
  } catch(e) { state.contacts = []; }

  // NEW: 目標データ
  try {
    const d = localStorage.getItem('goals');
    if (d) state.goals = { ...state.goals, ...JSON.parse(d) };
  } catch(e) {}

  // NEW: 経費データ
  try {
    const d = localStorage.getItem('expenses');
    state.expenses = d ? JSON.parse(d) : [];
  } catch(e) { state.expenses = []; }

  // NEW: ひらめきメモ
  try {
    const d = localStorage.getItem('ideas');
    state.ideas = d ? JSON.parse(d) : [];
  } catch(e) { state.ideas = []; }
}

function saveClientTemplatesToStorage() {
  try { localStorage.setItem('clientTemplates', JSON.stringify(state.clientTemplates)); }
  catch(e) { console.error('[TINYPERK] saveClientTemplatesToStorage error:', e); }
  scheduleSyncToSupabase();
}

function saveJournalToStorage() {
  try { localStorage.setItem('journalEntries', JSON.stringify(state.journalEntries)); }
  catch(e) { console.error('[TINYPERK] saveJournalToStorage error:', e); }
}

function saveTasksToStorage() {
  try { localStorage.setItem('tasks', JSON.stringify(state.tasks)); }
  catch(e) { console.error('[TINYPERK] saveTasksToStorage error:', e); }
  scheduleSyncToSupabase();
}

function saveTimecardsToStorage() {
  try { localStorage.setItem('timecards', JSON.stringify(state.timecards)); }
  catch(e) { console.error('[TINYPERK] saveTimecardsToStorage error:', e); }
  scheduleSyncToSupabase();
}

function saveWorkSettings() {
  const startEl = document.getElementById('work-start-time');
  const endEl = document.getElementById('work-end-time');
  const dayCbs = document.querySelectorAll('.work-day-cb');

  if (!startEl || !endEl) return;
  const [sh] = (startEl.value || '09:00').split(':').map(Number);
  const [eh] = (endEl.value || '18:00').split(':').map(Number);
  const workDays = [];
  dayCbs.forEach(cb => { if (cb.checked) workDays.push(parseInt(cb.value)); });

  state.workSettings = { startHour: sh, endHour: eh, workDays };
  try { localStorage.setItem('workSettings', JSON.stringify(state.workSettings)); } catch(e) {}

  const msg = document.getElementById('work-settings-save-msg');
  if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 2000); }
}

function populateWorkSettingsForm() {
  const ws = state.workSettings;
  const startEl = document.getElementById('work-start-time');
  const endEl = document.getElementById('work-end-time');
  if (startEl) startEl.value = String(ws.startHour).padStart(2,'0') + ':00';
  if (endEl) endEl.value = String(ws.endHour).padStart(2,'0') + ':00';
  document.querySelectorAll('.work-day-cb').forEach(cb => {
    cb.checked = (ws.workDays || []).includes(parseInt(cb.value));
  });
}

// ─────────────────────────────────────────────────────────────
// AI SCHEDULER
// ─────────────────────────────────────────────────────────────


// スマートスケジュールをタスク一覧からも開けるモーダル
function openSmartScheduleModal() {
  const unscheduledTasks = state.tasks.filter(t => t.isUnscheduled && t.status !== 'completed');
  
  if (unscheduledTasks.length === 0) {
    alert('日程未定のタスクがありません。\nタスクを作成・編集するとき「日程未定」にチェックを入れてください。');
    return;
  }

  // カレンダー画面に移動してパネルを表示
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('dashboard-screen').classList.add('active');
  document.getElementById('nav-dashboard')?.classList.add('active');
  document.getElementById('mobile-nav-dashboard')?.classList.add('active');
  state.activeTab = 'dashboard';

  renderUnscheduledPanel();

  // unscheduled-panelにスクロール
  setTimeout(() => {
    const panel = document.getElementById('unscheduled-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function runAIScheduler() {
  const unscheduledTasks = state.tasks.filter(t => t.isUnscheduled && t.status !== 'completed');
  if (unscheduledTasks.length === 0) {
    alert('日程未定のタスクはありません。\nタスク作成時に「日程未定」にチェックを入れてください。');
    return;
  }

  const ws = state.workSettings;
  const dailyCapacity = Math.max(1, ws.endHour - ws.startHour); // hours/day

  // Build daily load map from existing scheduled tasks
  const dailyLoad = {};
  state.tasks.filter(t => !t.isUnscheduled && t.dueDate && t.status !== 'completed').forEach(t => {
    const ds = t.dueDate;
    dailyLoad[ds] = (dailyLoad[ds] || 0) + (t.estimatedHours || 0);
  });

  // Sort by priority: high > medium > low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...unscheduledTasks].sort((a, b) =>
    (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
  );

  const proposals = [];
  let cursor = new Date();
  cursor.setDate(cursor.getDate() + 1); // start from tomorrow

  for (const task of sorted) {
    const taskHours = task.estimatedHours || 1;
    let assigned = false;

    for (let tries = 0; tries < 120; tries++) {
      const dow = cursor.getDay();
      const ds = toLocalDateStr(cursor);

      if ((ws.workDays || [1,2,3,4,5]).includes(dow)) {
        const usedLoad = dailyLoad[ds] || 0;
        const available = dailyCapacity - usedLoad;

        if (available >= taskHours || usedLoad === 0) {
          proposals.push({ taskId: task.id, suggestedDate: ds, taskName: task.name, taskHours, priority: task.priority });
          dailyLoad[ds] = (dailyLoad[ds] || 0) + taskHours;
          assigned = true;
          // advance cursor only if day is now full
          if (dailyCapacity - dailyLoad[ds] < 0.5) {
            cursor = new Date(cursor);
            cursor.setDate(cursor.getDate() + 1);
          }
          break;
        }
      }
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }

    if (!assigned) {
      const ds = toLocalDateStr(cursor);
      proposals.push({ taskId: task.id, suggestedDate: ds, taskName: task.name, taskHours, priority: task.priority });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  state.schedulingProposals = proposals;

  // Navigate calendar to the first proposal date
  if (proposals.length > 0) {
    state.currentMonth = parseLocalDate(proposals[0].suggestedDate);
  }

  renderCalendar();
  renderUnscheduledPanel();
}

function acceptProposal(taskId, suggestedDate) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.dueDate = suggestedDate;
  task.originalDueDate = suggestedDate;
  task.isUnscheduled = false;
  state.schedulingProposals = state.schedulingProposals.filter(p => p.taskId !== taskId);
  saveTasksToStorage();
  renderCalendar();
  renderUnscheduledPanel();
  showTrayToast(`✅ 「${task.name}」を ${suggestedDate} に登録しました`);
}

function rejectProposal(taskId) {
  state.schedulingProposals = state.schedulingProposals.filter(p => p.taskId !== taskId);
  renderCalendar();
  renderUnscheduledPanel();
}

function acceptAllProposals() {
  [...state.schedulingProposals].forEach(p => acceptProposal(p.taskId, p.suggestedDate));
}

function renderUnscheduledPanel() {
  const panel = document.getElementById('unscheduled-panel');
  if (!panel) return;

  const unscheduledTasks = state.tasks.filter(t => t.isUnscheduled && t.status !== 'completed');
  const proposals = state.schedulingProposals;

  // Show panel only if there are unscheduled tasks
  if (unscheduledTasks.length === 0 && proposals.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  // Unscheduled tasks list
  const listEl = document.getElementById('unscheduled-tasks-list');
  if (listEl) {
    if (unscheduledTasks.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">日程未定のタスクはありません。</p>';
    } else {
      const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' };
      listEl.innerHTML = unscheduledTasks.map(t => {
        const proposalForTask = proposals.find(p => p.taskId === t.id);
        const proposalBadge = proposalForTask
          ? `<span style="background:var(--primary);color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:10px;margin-left:0.5rem;">提案: ${proposalForTask.suggestedDate}</span>`
          : '';
        return `<div class="tl-task-row" style="cursor:pointer;" onclick="openEditTaskModal('${t.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.25rem;">
            <span style="font-weight:600;">${priorityIcon[t.priority||'medium'] || '🟡'} ${escapeHtml(t.name)}${proposalBadge}</span>
            <span style="font-size:0.8rem;color:var(--text-muted);">⏳ ${t.estimatedHours || '?'}h · ${escapeHtml(t.client)}</span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Proposals section
  const propSection = document.getElementById('ai-proposals-section');
  const propList = document.getElementById('ai-proposals-list');
  if (propSection && propList) {
    if (proposals.length === 0) {
      propSection.style.display = 'none';
    } else {
      propSection.style.display = 'block';
      const priorityLabel = { high: '高', medium: '中', low: '低' };
      const priorityColor = { high: 'var(--danger)', medium: 'var(--warning,#f59e0b)', low: 'var(--success)' };
      propList.innerHTML = proposals.map(p => {
        const task = state.tasks.find(t => t.id === p.taskId);
        if (!task) return '';
        const pColor = priorityColor[task.priority] || 'var(--text-muted)';
        return `<div class="proposal-card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;padding:0.75rem 1rem;border:1.5px dashed var(--primary);border-radius:10px;margin-bottom:0.5rem;background:var(--bg-card);">
          <div style="display:flex;flex-direction:column;gap:0.15rem;">
            <span style="font-weight:700;font-size:0.95rem;">${escapeHtml(task.name)}</span>
            <span style="font-size:0.8rem;color:var(--text-muted);">📅 ${p.suggestedDate} &nbsp;·&nbsp; ⏳ ${p.taskHours}h &nbsp;·&nbsp; <span style="color:${pColor};">優先度: ${priorityLabel[task.priority]||'中'}</span></span>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn btn-primary" style="font-size:0.8rem;padding:0.4rem 0.9rem;" onclick="acceptProposal('${p.taskId}','${p.suggestedDate}')">✅ 承認</button>
            <button class="btn btn-secondary" style="font-size:0.8rem;padding:0.4rem 0.9rem;color:var(--danger);" onclick="rejectProposal('${p.taskId}')">✕ 却下</button>
          </div>
        </div>`;
      }).join('');

      if (proposals.length > 1) {
        propList.innerHTML += `<button class="btn btn-primary" style="width:100%;margin-top:0.25rem;" onclick="acceptAllProposals()">✅ すべて承認</button>`;
      }
    }
  }
}

function saveTimerState() {
  try {
    localStorage.setItem('timerState', JSON.stringify({
      taskId: state.activeTimerTaskId,
      startEpoch: state.timerStartEpoch,
      accumulated: state.timerAccumulatedSeconds
    }));
  } catch(e) {}
}

function clearTimerState() {
  try { localStorage.removeItem('timerState'); } catch(e) {}
}

// Theme Handling
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    // User manually chose → honour it, mark as manual so CSS auto-dark won't override
    state.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-manual-theme', '1');
  } else {
    // Follow OS preference
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    state.theme = prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    // Listen for OS changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('theme')) {
        state.theme = e.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', state.theme);
        updateThemeToggleUI();
      }
    });
  }
  updateThemeToggleUI();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  document.documentElement.setAttribute('data-manual-theme', '1');
  localStorage.setItem('theme', state.theme);
  updateThemeToggleUI();
}

function updateThemeToggleUI() {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = state.theme === 'light' 
      ? `<svg viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Navigation Tabs
  const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  // Add Task Button
  const addButtons = document.querySelectorAll('.btn-add-task, .mobile-nav-add-btn');
  addButtons.forEach(btn => {
    btn.addEventListener('click', () => openAddTaskModal(state.selectedDate));
  });

  // Theme Toggle
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Calendar month navigation
  document.getElementById('prev-month').addEventListener('click', () => navigateMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => navigateMonth(1));
  document.getElementById('today-btn').addEventListener('click', () => {
    state.currentMonth = new Date();
    state.selectedDate = getLocalDateStr();
    renderApp();
  });

  // Modal Close
  const closeBtns = document.querySelectorAll('.close-btn, .btn-cancel');
  closeBtns.forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // Click outside modal content → close & unfreeze
  document.getElementById('task-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Task Form Submit
  document.getElementById('task-form').addEventListener('submit', handleTaskFormSubmit);

  // Enterキーでの意図しない送信を防止（textarea以外でも無効化）
  // 保存は「保存する」ボタンを明示的に押すか Cmd+Enter のみ
  document.getElementById('task-form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tag = e.target.tagName;
    // textarea: Enter で改行（デフォルト動作をそのまま許可）
    if (tag === 'TEXTAREA') return;
    // select: ドロップダウン確定のみ（フォーム送信しない）
    if (tag === 'SELECT') { e.preventDefault(); return; }
    // input: Cmd/Ctrl+Enter のみ保存、通常Enterは何もしない（送信もフォーカス移動もしない）
    if (tag === 'INPUT') {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        document.getElementById('task-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        e.preventDefault(); // 誤送信を防ぐだけ、フォーカスは動かさない
      }
    }
  });

  // Task Tray - toggle
  document.getElementById('task-tray-toggle').addEventListener('click', () => {
    state.trayOpen = !state.trayOpen;
    document.getElementById('task-tray').classList.toggle('open', state.trayOpen);
    document.querySelector('.app-container').classList.toggle('tray-open', state.trayOpen);
  });

  // Task Tray - quick add
  document.getElementById('tray-quick-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      trayQuickAdd(e.target.value);
      e.target.value = '';
    }
  });

  // Task Tray - filter tabs
  document.querySelectorAll('.tray-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tray-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.trayFilter = btn.getAttribute('data-filter');
      renderTaskTray();
    });
  });

  // Invoice Filters
  document.getElementById('report-client-filter').addEventListener('change', renderInvoiceReport);
  document.getElementById('report-month-filter').addEventListener('change', renderInvoiceReport);

  // Google Calendar settings
  document.getElementById('google-client-id-save').addEventListener('click', saveGoogleClientId);
  document.getElementById('google-connect-btn').addEventListener('click', connectGoogleCalendar);

  // Client template management
  document.getElementById('template-load-btn').addEventListener('click', () => {
    const client = document.getElementById('template-client-input').value.trim();
    if (!client) return;
    const tpl = state.clientTemplates[client] || '';
    document.getElementById('template-body-input').value = tpl;
  });
  document.getElementById('template-save-btn').addEventListener('click', () => {
    const client = document.getElementById('template-client-input').value.trim();
    const body = document.getElementById('template-body-input').value.trim();
    if (!client) { alert('クライアント名を入力してください。'); return; }
    if (!body) { alert('テンプレート本文を入力してください。'); return; }
    state.clientTemplates[client] = body;
    saveClientTemplatesToStorage();
    renderClientTemplateList();
    showTrayToast(`「${client}」のテンプレートを保存しました`);
  });
  document.getElementById('template-delete-btn').addEventListener('click', () => {
    const client = document.getElementById('template-client-input').value.trim();
    if (!client || !state.clientTemplates[client]) return;
    if (!confirm(`「${client}」のテンプレートを削除しますか？`)) return;
    delete state.clientTemplates[client];
    saveClientTemplatesToStorage();
    document.getElementById('template-body-input').value = '';
    renderClientTemplateList();
    showTrayToast(`「${client}」のテンプレートを削除しました`);
  });

  // Report modal
  document.getElementById('report-modal-close').addEventListener('click', closeReportModal);
  document.getElementById('report-modal-done').addEventListener('click', closeReportModal);
  document.getElementById('report-modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('report-modal-overlay')) closeReportModal();
  });
  document.getElementById('report-copy-btn').addEventListener('click', () => {
    const text = document.getElementById('report-text-area').value;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('report-copy-btn');
      btn.textContent = '✅ コピーしました';
      setTimeout(() => { btn.textContent = '📋 コピー'; }, 2000);
    });
  });

  // Task list tab: filter buttons
  document.getElementById('tasks-status-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.tl-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.tl-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.taskListFilter = btn.getAttribute('data-filter');
    renderTaskList();
  });
  document.getElementById('tasks-sort-select').addEventListener('change', (e) => {
    state.taskListSort = e.target.value;
    renderTaskList();
  });

  // Task Editor Actions
  document.getElementById('btn-delete-task').addEventListener('click', () => {
    if (state.editingTaskId && confirm('このタスクを削除してもよろしいですか？')) {
      deleteTask(state.editingTaskId);
    }
  });
  document.getElementById('btn-share-task').addEventListener('click', generateSingleTaskShareLink);
  document.getElementById('btn-share-client').addEventListener('click', generateClientShareLink);

  // Clock In / Out
  document.getElementById('btn-clock-in').addEventListener('click', clockIn);
  document.getElementById('btn-clock-out').addEventListener('click', clockOut);

  // Mood Pickers (Dashboard widget)
  document.querySelectorAll('.mood-picker[data-type="before"] .mood-btn').forEach(btn => {
    btn.addEventListener('click', () => saveTodayMood('before', btn.getAttribute('data-mood')));
  });
  document.querySelectorAll('.mood-picker[data-type="after"] .mood-btn').forEach(btn => {
    btn.addEventListener('click', () => saveTodayMood('after', btn.getAttribute('data-mood')));
  });

  // Daily Report Save
  document.getElementById('btn-save-daily-report').addEventListener('click', saveDailyReportMemo);

  // Manual Timecard log override
  document.getElementById('manual-log-toggle').addEventListener('click', () => {
    const el = document.getElementById('manual-log-form-container');
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('manual-timecard-form').addEventListener('submit', handleManualTimecardSubmit);

  // Speech Recognition Mic Buttons
  document.getElementById('mic-btn-nippo').addEventListener('click', () => {
    toggleVoiceRecognition('dashboard-nippo-memo', 'mic-btn-nippo');
  });
  document.getElementById('mic-btn-task-name').addEventListener('click', () => {
    toggleVoiceRecognition('task-name', 'mic-btn-task-name');
  });
  document.getElementById('mic-btn-client').addEventListener('click', () => {
    toggleVoiceRecognition('task-client', 'mic-btn-client');
  });

  // NEW: Daily View triggers
  document.getElementById('btn-open-daily-view').addEventListener('click', () => {
    openDailyViewModal(state.selectedDate);
  });
  document.getElementById('daily-view-prev-day').addEventListener('click', () => navigateDailyViewDate(-1));
  document.getElementById('daily-view-next-day').addEventListener('click', () => navigateDailyViewDate(1));

  // NEW: Stopwatch controls
  document.getElementById('btn-timer-start').addEventListener('click', () => {
    if (state.editingTaskId) startTaskTimer(state.editingTaskId);
  });
  document.getElementById('btn-timer-pause').addEventListener('click', () => {
    pauseTaskTimer();
  });
  document.getElementById('btn-timer-reset').addEventListener('click', () => {
    if (state.editingTaskId && confirm('計測時間をリセットしてもよろしいですか？')) {
      resetTaskTimer(state.editingTaskId);
    }
  });

  // NEW: Floating banner controls
  document.getElementById('btn-floating-timer-pause').addEventListener('click', (e) => {
    e.stopPropagation();
    pauseTaskTimer();
  });
  document.getElementById('btn-floating-timer-open').addEventListener('click', () => {
    if (state.activeTimerTaskId) {
      openEditTaskModal(state.activeTimerTaskId);
    }
  });

  // Page unload auto-save protection
  window.addEventListener('beforeunload', autoSaveTimerOnUnload);

  // Onboarding
  // ステータスラジオ変更時に自動保存
  document.querySelectorAll('input[name="task-status"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const id = document.getElementById('task-id').value;
      if (id) autoSaveTask(); // 編集時のみ自動保存
    });
  });

  const onbPrimary = document.getElementById('onb-primary-btn');
  if (onbPrimary) onbPrimary.addEventListener('click', _onbNext);
  const onbSkip = document.getElementById('onb-skip-btn');
  if (onbSkip) onbSkip.addEventListener('click', _dismissOnboarding);

  // #5 Search
  const searchInput = document.getElementById('task-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.taskSearchQuery = searchInput.value.trim().toLowerCase();
      renderTaskList();
    });
  }

  // Unscheduled checkbox toggle
  const unschCb = document.getElementById('task-unscheduled');
  if (unschCb) unschCb.addEventListener('change', () => _toggleUnscheduledDate(unschCb.checked));

  // Steps editor
  const btnAddStep = document.getElementById('btn-add-step');
  if (btnAddStep) btnAddStep.addEventListener('click', addEditingStep);
  const stepInput = document.getElementById('new-step-input');
  if (stepInput) {
    stepInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addEditingStep(); }
    });
  }

  // ── Journal ──
  const btnSaveJournal = document.getElementById('btn-save-journal');
  if (btnSaveJournal) btnSaveJournal.addEventListener('click', saveJournalEntry);

  const journalTextEl = document.getElementById('journal-text');
  if (journalTextEl) {
    journalTextEl.addEventListener('input', () => {
      const charCountEl = document.getElementById('journal-char-count');
      if (charCountEl) charCountEl.textContent = `${journalTextEl.value.length}文字`;
    });
    // Cmd/Ctrl+Enter で保存
    journalTextEl.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveJournalEntry();
      }
    });
  }

  const journalPrevBtn = document.getElementById('journal-prev-day');
  if (journalPrevBtn) journalPrevBtn.addEventListener('click', () => {
    const d = new Date(state.journalDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    state.journalDate = getLocalDateStr(d);
    renderJournal();
  });

  const journalNextBtn = document.getElementById('journal-next-day');
  if (journalNextBtn) journalNextBtn.addEventListener('click', () => {
    const todayStr = getLocalDateStr();
    const d = new Date(state.journalDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    state.journalDate = getLocalDateStr(d);
    renderJournal();
  });

  const journalTodayBtn = document.getElementById('journal-today-btn');
  if (journalTodayBtn) journalTodayBtn.addEventListener('click', () => {
    state.journalDate = getLocalDateStr();
    renderJournal();
  });
}

// Switch between screens
function switchTab(tab) {
  state.activeTab = tab;
  
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tab) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.querySelectorAll('.screen').forEach(screen => {
    if (screen.id === `${tab}-screen`) {
      screen.classList.add('active');
    } else {
      screen.classList.remove('active');
    }
  });

  if (tab === 'dashboard') {
    renderDashboard();
  } else if (tab === 'calendar') {
    renderCalendar();
    renderSelectedDayTasks();
    renderUnscheduledPanel();
  } else if (tab === 'reports') {
    populateInvoiceClients();
    renderInvoiceReport();
    setTimeout(renderTrendChart, 100);
  } else if (tab === 'settings') {
    renderClientTemplateList();
    populateBusinessInfoForm();
    populateWorkSettingsForm();
  } else if (tab === 'tasks') {
    renderTaskList();
  } else if (tab === 'journal') {
    renderJournal();
  } else if (tab === 'deals') {
    renderDeals();
  } else if (tab === 'contacts') {
    renderContacts();
  } else if (tab === 'goals') {
    renderGoals();
  } else if (tab === 'expenses') {
    renderExpenses();
  } else if (tab === 'ideas') {
    renderIdeas();
  }
  // Sync more-drawer active state
  document.querySelectorAll('.more-drawer-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tab);
  });
}

// Returns true if the task edit modal is currently open
function isModalOpen() {
  return document.getElementById('task-modal-overlay')?.classList.contains('active') || false;
}

// Render overall application UI
function renderApp() {
  if (state.activeTab === 'dashboard') {
    renderDashboard();
  } else if (state.activeTab === 'tasks') {
    renderTaskList();
  } else if (state.activeTab === 'calendar') {
    renderCalendar();
    renderSelectedDayTasks();
    setupCalendarDropZones();
    renderUnscheduledPanel();
  } else if (state.activeTab === 'reports') {
    populateInvoiceClients();
    renderInvoiceReport();
  } else if (state.activeTab === 'journal') {
    renderJournal();
  } else if (state.activeTab === 'deals') {
    renderDeals();
  } else if (state.activeTab === 'contacts') {
    renderContacts();
  } else if (state.activeTab === 'goals') {
    renderGoals();
  } else if (state.activeTab === 'expenses') {
    renderExpenses();
  } else if (state.activeTab === 'ideas') {
    renderIdeas();
  }
  renderTaskTray();
}

// ----------------------------------------------------------------------------
// DASHBOARD RENDERING & ACTIONS
// ----------------------------------------------------------------------------
function renderWeeklySummary() {
  // 今週の日〜土を計算（日曜始まり）
  const today = new Date();
  const todayStr = getLocalDateStr();
  const dow = today.getDay(); // 0=日
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dow + i);
    weekDays.push(toLocalDateStr(d));
  }

  // 今週の稼働時間（各日）
  const hoursPerDay = weekDays.map(ds => {
    const tc = state.timecards.find(t => t.date === ds);
    return tc ? (tc.totalHours || 0) : 0;
  });
  const totalHours = hoursPerDay.reduce((s, h) => s + h, 0);
  const maxHours = Math.max(...hoursPerDay, 1);

  // 今週完了タスクの金額
  const weeklyAmount = state.tasks
    .filter(t => t.status === 'completed' && weekDays.includes(t.completedAt))
    .reduce((s, t) => s + (t.amount || 0) * 1.1, 0);

  // 表示更新
  const rangeEl = document.getElementById('weekly-summary-range');
  const amountEl = document.getElementById('weekly-amount');
  const hoursEl = document.getElementById('weekly-hours-total');
  const chartEl = document.getElementById('weekly-hours-chart');

  if (rangeEl) rangeEl.textContent = `${weekDays[0].slice(5).replace('-','/')} 〜 ${weekDays[6].slice(5).replace('-','/')}`;
  if (amountEl) amountEl.textContent = new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY' }).format(Math.round(weeklyAmount));
  const weeklyTaskSec = weekDays.reduce((sum, ds) => {
    return sum + state.tasks.filter(t => t.dueDate === ds || t.completedAt === ds).reduce((s, t) => s + (t.spentSeconds || 0), 0);
  }, 0);
  const weeklyTaskHours = weeklyTaskSec / 3600;
  if (hoursEl) {
    if (totalHours > 0) {
      hoursEl.textContent = `${totalHours.toFixed(1)}h`;
      hoursEl.title = `タスク計測: ${weeklyTaskHours.toFixed(1)}h`;
    } else if (weeklyTaskHours > 0) {
      hoursEl.textContent = `${weeklyTaskHours.toFixed(1)}h`;
      hoursEl.title = 'タスクストップウォッチ合計';
      hoursEl.style.color = 'var(--secondary)';
    } else {
      hoursEl.textContent = '0h';
    }
  }

  if (chartEl) {
    chartEl.innerHTML = hoursPerDay.map((h, i) => {
      const pct = Math.round((h / maxHours) * 100);
      const isToday = weekDays[i] === todayStr;
      const color = isToday ? 'var(--primary)' : (i === 0 ? 'var(--danger)' : i === 6 ? 'var(--secondary)' : 'var(--border-color)');
      const barColor = isToday ? 'var(--primary)' : (h > 0 ? 'var(--text-muted)' : 'var(--border-color)');
      return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px;">
        <div style="font-size:0.65rem;color:${isToday ? 'var(--primary)' : 'var(--text-muted)'};font-weight:${isToday?'700':'400'};">${h > 0 ? h.toFixed(1) : ''}</div>
        <div style="width:100%;background:${barColor};border-radius:4px 4px 0 0;height:${Math.max(pct, h > 0 ? 8 : 2)}%;transition:height 0.4s ease;opacity:${isToday?'1':'0.65'};"></div>
      </div>`;
    }).join('');
  }
}

function renderDashboard() {
  renderBTLog();
  renderTaskProgressChart();
  renderWeeklySummary();

  const todayStr = getLocalDateStr();
  const todayCard = state.timecards.find(tc => tc.date === todayStr);

  const clockInVal = document.getElementById('dash-clock-in-val');
  const clockOutVal = document.getElementById('dash-clock-out-val');
  const totalHrsVal = document.getElementById('dash-total-hours-val');
  const nippoMemo = document.getElementById('dashboard-nippo-memo');

  // Clear mood actives
  document.querySelectorAll('.mood-btn').forEach(btn => btn.classList.remove('active'));

  if (todayCard) {
    clockInVal.textContent = todayCard.clockIn || '--:--';
    clockOutVal.textContent = todayCard.clockOut || '--:--';
    totalHrsVal.textContent = todayCard.totalHours ? `${todayCard.totalHours.toFixed(1)} 時間` : '--';
    nippoMemo.value = todayCard.reportText || '';

    if (todayCard.moodBefore) {
      const btn = document.querySelector(`.mood-picker[data-type="before"] .mood-btn[data-mood="${todayCard.moodBefore}"]`);
      if (btn) btn.classList.add('active');
    }
    if (todayCard.moodAfter) {
      const btn = document.querySelector(`.mood-picker[data-type="after"] .mood-btn[data-mood="${todayCard.moodAfter}"]`);
      if (btn) btn.classList.add('active');
    }
  } else {
    clockInVal.textContent = '--:--';
    clockOutVal.textContent = '--:--';
    totalHrsVal.textContent = '--';
    nippoMemo.value = '';
  }

  document.getElementById('manual-log-date').value = todayStr;

  // ── ダッシュボード上のジャーナルクイックカード ──
  renderDashboardJournalCard(todayStr);
}

function renderDashboardJournalCard(todayStr) {
  let card = document.getElementById('dashboard-journal-card');
  if (!card) {
    // カードをダッシュボードグリッドに動的に追加（2列目の末尾）
    const grid = document.querySelector('.dashboard-grid');
    if (!grid) return;
    card = document.createElement('div');
    card.id = 'dashboard-journal-card';
    card.className = 'report-card dashboard-journal-card';
    grid.appendChild(card);
  }

  const entry = state.journalEntries[todayStr];
  const saved = entry?.text?.trim() || '';
  const savedAt = entry?.updatedAt ? `最終保存: ${entry.updatedAt.replace('T', ' ')}` : '';

  card.innerHTML = `
    <h3 style="font-size:1.1rem; border-bottom:1px solid var(--border-color); padding-bottom:0.5rem; margin-bottom:1rem;">
      📓 今日の日誌
    </h3>
    <textarea id="dash-journal-text" class="form-control" rows="4"
      placeholder="今日の一言メモ…（Cmd+Enter で保存）"
      style="resize:none;">${escapeHtml(saved)}</textarea>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.75rem;">
      <span style="font-size:0.78rem; color:var(--text-muted);">${savedAt}</span>
      <div style="display:flex; gap:0.5rem; align-items:center;">
        <button class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.9rem;"
          onclick="switchTab('journal')">全履歴を見る →</button>
        <button id="dash-journal-save-btn" class="btn btn-primary" style="font-size:0.85rem; padding:0.5rem 1rem;">
          保存
        </button>
      </div>
    </div>`;

  // イベント登録（都度再バインドする簡易方式）
  const saveBtn = card.querySelector('#dash-journal-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => saveDashboardJournalEntry(todayStr));
  }
  const textarea = card.querySelector('#dash-journal-text');
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveDashboardJournalEntry(todayStr);
      }
    });
  }
}

function saveDashboardJournalEntry(dateStr) {
  const textarea = document.getElementById('dash-journal-text');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!state.journalEntries[dateStr]) state.journalEntries[dateStr] = {};
  state.journalEntries[dateStr].text = text;
  state.journalEntries[dateStr].updatedAt = new Date().toISOString().slice(0, 16);
  saveJournalToStorage();
  renderDashboardJournalCard(dateStr);
  showMotivatorToast('📓 日誌を保存しました', '📓');
}

function renderTaskProgressChart() {
  const total = state.tasks.length;
  const completed = state.tasks.filter(t => t.status === 'completed').length;
  const inProgress = state.tasks.filter(t => t.status === 'in-progress').length;
  const notStarted = state.tasks.filter(t => t.status === 'not-started').length;
  const revision = state.tasks.filter(t => t.status === 'revision').length;

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const ring = document.getElementById('dash-progress-ring');
  const r = 50;
  const circumference = 2 * Math.PI * r;
  ring.style.strokeDasharray = `${circumference} ${circumference}`;

  const offset = circumference - (percent / 100) * circumference;
  ring.style.strokeDashoffset = offset;

  document.getElementById('dash-chart-percentage').textContent = `${percent}%`;

  document.getElementById('lbl-cnt-not-started').textContent = notStarted;
  document.getElementById('lbl-cnt-in-progress').textContent = inProgress + (revision > 0 ? ` (+修正${revision})` : '');
  document.getElementById('lbl-cnt-completed').textContent = completed;

  // 今月の統計でモチベーションカードを更新
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthCompleted = state.tasks.filter(t => t.status === 'completed' && t.completedAt && t.completedAt.startsWith(ym));
  const thisMonthRevenue = Math.round(thisMonthCompleted.reduce((s, t) => s + (t.amount || 0) * 1.1, 0));
  const thisMonthHours = state.timecards.filter(tc => tc.date.startsWith(ym)).reduce((s, tc) => s + (tc.totalHours || 0), 0);

  let emoji = '📊', title = '今月の状況', lines = [];

  if (total === 0) {
    emoji = '🚀'; title = 'さあ、始めましょう！';
    lines = ['「タスク追加」ボタンで', '最初のタスクを登録してみましょう。'];
  } else if (percent === 100) {
    emoji = '🎉'; title = 'すべて完了！';
    lines = ['全タスクが完了しています。', '新しいプロジェクトを追加しましょう！'];
  } else {
    lines = [
      `✅ 今月完了: <strong>${thisMonthCompleted.length}件</strong>`,
      `💰 今月売上(税込): <strong>${new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(thisMonthRevenue)}</strong>`,
      `⏱️ 今月稼働: <strong>${thisMonthHours.toFixed(1)}時間</strong>`,
      inProgress > 0 ? `🔄 進行中: <strong>${inProgress}件</strong>` : ''
    ].filter(Boolean);
  }

  const motivEmoji = document.getElementById('motivator-emoji');
  const motivTitle = document.getElementById('motivator-title');
  const motivBody = document.getElementById('motivator-body');
  if (motivEmoji) motivEmoji.textContent = emoji;
  if (motivTitle) motivTitle.textContent = title;
  if (motivBody) motivBody.innerHTML = lines.map(l => `<span>${l}</span>`).join('');
}

// Attendance Clocking
function clockIn() {
  const todayStr = getLocalDateStr();
  const nowStr = new Date().toTimeString().split(' ')[0].substring(0, 5);

  let todayCard = state.timecards.find(tc => tc.date === todayStr);

  if (todayCard && todayCard.clockIn) {
    alert('本日はすでに出勤打刻しています！');
    return;
  }

  if (!todayCard) {
    todayCard = {
      id: todayStr,
      date: todayStr,
      clockIn: nowStr,
      clockOut: '',
      moodBefore: '',
      moodAfter: '',
      reportText: '',
      totalHours: 0
    };
    state.timecards.push(todayCard);
  } else {
    todayCard.clockIn = nowStr;
  }

  saveTimecardsToStorage();
  renderDashboard();
  showMotivatorToast('おはようございます！今日も無理せず頑張りましょう。', '☀️');
}

function clockOut() {
  const todayStr = getLocalDateStr();
  const nowStr = new Date().toTimeString().split(' ')[0].substring(0, 5);

  let todayCard = state.timecards.find(tc => tc.date === todayStr);

  if (!todayCard || !todayCard.clockIn) {
    alert('出勤打刻が行われていません！');
    return;
  }

  if (todayCard.clockOut) {
    alert('本日はすでに退勤打刻しています！');
    return;
  }

  todayCard.clockOut = nowStr;
  const rawHours = calculateHours(todayCard.clockIn, nowStr);
  const todayBreakSecs = (state.journalEntries[getLocalDateStr()]?.btRecords || [])
    .filter(r => r.type === 'break').reduce((a, r) => a + r.durationSec, 0);
  todayCard.totalHours = Math.max(0, rawHours - todayBreakSecs / 3600);

  saveTimecardsToStorage();
  renderDashboard();
  
  const randomMsg = MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
  showMotivatorToast(randomMsg, '🎉');
}

function calculateHours(startStr, endStr) {
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);

  let diffMins = (endH * 60 + endM) - (startH * 60 + startM);
  if (diffMins < 0) diffMins += 24 * 60;

  return diffMins / 60;
}

function saveTodayMood(type, moodSymbol) {
  const todayStr = getLocalDateStr();
  let todayCard = state.timecards.find(tc => tc.date === todayStr);

  if (!todayCard) {
    todayCard = {
      id: todayStr,
      date: todayStr,
      clockIn: '',
      clockOut: '',
      moodBefore: '',
      moodAfter: '',
      reportText: '',
      totalHours: 0
    };
    state.timecards.push(todayCard);
  }

  if (type === 'before') {
    todayCard.moodBefore = moodSymbol;
  } else {
    todayCard.moodAfter = moodSymbol;
  }

  saveTimecardsToStorage();
  renderDashboard();
  showMotivatorToast('今日の気分を記録しました！', moodSymbol);
}

function saveDailyReportMemo() {
  const todayStr = getLocalDateStr();
  const memoText = document.getElementById('dashboard-nippo-memo').value.trim();

  let todayCard = state.timecards.find(tc => tc.date === todayStr);

  if (!todayCard) {
    todayCard = {
      id: todayStr,
      date: todayStr,
      clockIn: '',
      clockOut: '',
      moodBefore: '',
      moodAfter: '',
      reportText: memoText,
      totalHours: 0
    };
    state.timecards.push(todayCard);
  } else {
    todayCard.reportText = memoText;
  }

  saveTimecardsToStorage();
  renderDashboard();

  const randomMsg = MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
  showMotivatorToast(randomMsg, '📝');
}

function handleManualTimecardSubmit(e) {
  e.preventDefault();

  const date = document.getElementById('manual-log-date').value;
  const clockIn = document.getElementById('manual-log-in').value;
  const clockOut = document.getElementById('manual-log-out').value;
  const moodBefore = document.getElementById('manual-log-mood-before').value;
  const moodAfter = document.getElementById('manual-log-mood-after').value;
  const memo = document.getElementById('manual-log-memo').value.trim();

  if (!date) {
    alert('日付を指定してください。');
    return;
  }

  let totalHours = 0;
  if (clockIn && clockOut) {
    totalHours = calculateHours(clockIn, clockOut);
  }

  let tc = state.timecards.find(x => x.date === date);
  if (!tc) {
    tc = { id: date, date };
    state.timecards.push(tc);
  }

  tc.clockIn = clockIn;
  tc.clockOut = clockOut;
  tc.moodBefore = moodBefore;
  tc.moodAfter = moodAfter;
  tc.reportText = memo;
  tc.totalHours = totalHours;

  saveTimecardsToStorage();
  
  document.getElementById('manual-log-form-container').style.display = 'none';
  document.getElementById('manual-timecard-form').reset();
  renderDashboard();

  showMotivatorToast(`${date}の勤怠記録を保存しました！`, '📅');
}

// ----------------------------------------------------------------------------
// SPEECH TO TEXT (VOICE INPUT) HANDLER
// ----------------------------------------------------------------------------
// 過去に使ったクライアント名をdatalistに反映

// 業務内容オートコンプリート更新
const DEFAULT_WORK_TYPES = ['動画撮影','スチール撮影','動画編集','スチール編集','インタビュー','HP制作'];

function updateWorkTypeSuggestions() {
  const dl = document.getElementById('work-type-suggestions');
  if (!dl) return;
  const fromTasks = state.tasks.map(t => t.workType).filter(Boolean);
  const types = [...new Set([...DEFAULT_WORK_TYPES, ...fromTasks])];
  dl.innerHTML = types.map(t => `<option value="${escapeHTML(t)}">`).join('');
}

function updateClientSuggestions() {
  const datalist = document.getElementById('client-suggestions');
  if (!datalist) return;
  const clients = [...new Set(
    state.tasks
      .map(t => t.client)
      .filter(c => c && c !== '未設定' && c.trim() !== '')
  )].sort();
  datalist.innerHTML = clients.map(c => `<option value="${escapeHtml(c)}">`).join('');

  // Render selectable chips below client input
  const chipsEl = document.getElementById('client-chips');
  if (!chipsEl) return;
  if (clients.length === 0) {
    chipsEl.innerHTML = '';
    return;
  }
  chipsEl.innerHTML = clients.map(c =>
    `<button type="button" class="client-chip" onclick="
      document.getElementById('task-client').value='${c.replace(/'/g, "\\'")}';
      document.querySelectorAll('.client-chip').forEach(el=>el.classList.remove('selected'));
      this.classList.add('selected');
    ">${escapeHtml(c)}</button>`
  ).join('');
}

// Client template list rendering (settings screen)
function renderClientTemplateList() {
  const listEl = document.getElementById('template-client-list');
  if (!listEl) return;
  const clients = Object.keys(state.clientTemplates).sort();
  if (clients.length === 0) {
    listEl.innerHTML = '<span style="font-size:0.85rem;color:var(--text-muted);">登録済みテンプレートはありません</span>';
    return;
  }
  listEl.innerHTML = clients.map(c =>
    `<button class="tray-filter-btn" style="font-size:0.8rem;" onclick="
      document.getElementById('template-client-input').value='${escapeHtml(c)}';
      document.getElementById('template-body-input').value=state.clientTemplates['${c.replace(/'/g,"\\'")}']||'';
    ">${escapeHtml(c)}</button>`
  ).join('');

  // Also populate the datalist
  const datalist = document.getElementById('template-client-suggestions');
  if (datalist) {
    const allClients = [...new Set([
      ...Object.keys(state.clientTemplates),
      ...state.tasks.map(t => t.client).filter(c => c && c !== '未設定')
    ])].sort();
    datalist.innerHTML = allClients.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }
}

// Task list tab rendering
// ============================================================
// WEEKLY INFOGRAPHIC CHART
// ============================================================
function renderWeeklyChart() {
  const el = document.getElementById('weekly-chart');
  if (!el) return;

  // 今週の月〜日を計算
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const days = [];
  const dayNames = ['月', '火', '水', '木', '金', '土', '日'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push({
      label: dayNames[i],
      date: getLocalDateStr(d),
      isToday: getLocalDateStr(d) === getLocalDateStr(today),
      isWeekend: i >= 5
    });
  }

  // 各日のタスク集計
  const stats = days.map(day => {
    const tasks = state.tasks.filter(t => t.dueDate === day.date);
    return {
      ...day,
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      inProgress: tasks.filter(t => t.status === 'in-progress' || t.status === 'revision').length,
      notStarted: tasks.filter(t => t.status === 'not-started').length,
      estHours: tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0),
      tasks
    };
  });

  const maxHours = Math.max(...stats.map(s => s.estHours), 1);
  const maxTasks = Math.max(...stats.map(s => s.total), 1);

  const totalWeekTasks = stats.reduce((s, d) => s + d.total, 0);
  const totalWeekHours = stats.reduce((s, d) => s + d.estHours, 0);

  el.innerHTML = `
    <div class="weekly-chart-header">
      <span class="weekly-chart-title">📊 今週のタスク量</span>
      <span class="weekly-chart-summary">計 ${totalWeekTasks}件 ／ 想定 ${totalWeekHours}h</span>
    </div>
    <div class="weekly-chart-bars">
      ${stats.map(s => {
        const barPct = maxHours > 0 ? Math.round((s.estHours / maxHours) * 100) : (s.total > 0 ? Math.round((s.total / maxTasks) * 100) : 0);
        const compPct = s.total ? Math.round(s.completed / s.total * 100) : 0;
        const ipPct   = s.total ? Math.round(s.inProgress / s.total * 100) : 0;
        const nsPct   = s.total ? Math.round(s.notStarted / s.total * 100) : 0;
        return `
          <div class="weekly-col ${s.isToday ? 'weekly-col-today' : ''} ${s.isWeekend ? 'weekly-col-weekend' : ''}">
            <div class="weekly-bar-wrap">
              ${s.total > 0 ? `<span class="weekly-bar-count">${s.total}</span>` : ''}
              ${s.estHours > 0 ? `<span class="weekly-bar-hours">${s.estHours}h</span>` : ''}
              <div class="weekly-bar" style="height:${barPct}%;">
                <div style="height:${compPct}%;background:var(--success);border-radius:inherit;"></div>
                <div style="height:${ipPct}%;background:var(--primary);"></div>
                <div style="height:${nsPct}%;background:var(--text-muted);"></div>
              </div>
            </div>
            <span class="weekly-day-label ${s.isToday ? 'today' : ''}">${s.label}</span>
            <span class="weekly-date-label">${s.date.slice(5).replace('-', '/')}</span>
          </div>`;
      }).join('')}
    </div>
    <div class="weekly-chart-legend">
      <span class="wc-legend-item"><span class="wc-legend-dot" style="background:var(--success)"></span>完了</span>
      <span class="wc-legend-item"><span class="wc-legend-dot" style="background:var(--primary)"></span>進行中</span>
      <span class="wc-legend-item"><span class="wc-legend-dot" style="background:var(--text-muted)"></span>未着手</span>
    </div>`;
}

// ============================================================
// JOURNAL TIMELINE (9:00-18:00, 1h blocks)
// ============================================================
function renderJournalTimeline() {
  const el = document.getElementById('journal-timeline');
  if (!el) return;

  const date = state.journalDate;
  const entry = state.journalEntries[date] || {};
  const timeline = entry.timeline || {};
  const hours = Array.from({ length: 10 }, (_, i) => String(i + 9).padStart(2, '0'));

  const TL_UNIT = 64; // px per 1h slot

  el.innerHTML = hours.map(h => {
    const slot = timeline[h] || {};

    // このスロットが別スロットに覆われている場合はスキップ
    if (slot._covered) return '';

    // 休憩・移動などの特殊スロット
    if (slot.type === 'break' || slot.type === 'travel') {
      const span = slot.span || 1;
      const spanHeight = span > 1 ? `min-height:${span * TL_UNIT + (span - 1) * 6}px;` : '';
      const endHour = String(parseInt(h) + span).padStart(2, '0');
      const timeLabel = span > 1 ? `${h}:00–${endHour}:00` : `${h}:00`;
      const icon = slot.type === 'break' ? '🍱' : '🚗';
      const label = slot.label || (slot.type === 'break' ? '休憩' : '移動');
      const colorClass = slot.type === 'break' ? 'tl-special-break' : 'tl-special-travel';
      const maxSpan = 18 - parseInt(h) + 1;
      return `
        <div class="tl-slot tl-slot-filled tl-slot-special ${colorClass}"
          data-hour="${h}" data-span="${span}" style="${spanHeight}"
          ondragover="event.preventDefault(); this.classList.add('tl-slot-drag-over');"
          ondragleave="this.classList.remove('tl-slot-drag-over');"
          ondrop="handleTimelineDrop(event, '${h}')">
          <div class="tl-slot-time-col">
            <span class="tl-slot-time">${timeLabel}</span>
            <div class="tl-slot-span-controls">
              <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${h}',-1)" ${span<=1?'disabled':''}>−</button>
              <span class="tl-slot-span-val">${span}h</span>
              <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${h}',1)" ${span>=maxSpan?'disabled':''}>＋</button>
            </div>
          </div>
          <div class="tl-slot-special-body">
            <span class="tl-slot-special-icon">${icon}</span>
            <span class="tl-slot-special-label">${label}</span>
            <div class="tl-slot-special-actions">
              <button class="tl-slot-special-journal-btn" onclick="appendSpecialSlotToJournal('${date}','${h}')" title="日誌に追記">📝</button>
              <button class="tl-slot-remove" onclick="removeTimelineSlot('${date}','${h}')" title="削除">×</button>
            </div>
          </div>
          <div class="tl-resize-handle" onpointerdown="startSlotResize(event,'${date}','${h}')">
            <div class="tl-resize-handle-icon"></div>
          </div>
        </div>`;
    }

    const task = slot.taskId ? state.tasks.find(t => t.id === slot.taskId) : null;
    const span = slot.span || 1;
    const spanHeight = span > 1 ? `min-height:${span * TL_UNIT + (span - 1) * 6}px;` : '';

    const timerHours = task?.spentSeconds > 0
      ? Math.round(task.spentSeconds / 3600 * 10) / 10
      : null;
    const actualH = slot.actualHours !== '' && slot.actualHours != null
      ? slot.actualHours
      : (timerHours || '');
    const estH = task?.estimatedHours || 0;

    const statusColor = {
      'not-started': 'var(--text-muted)',
      'in-progress': 'var(--primary)',
      'revision': '#f97316',
      'completed': 'var(--success)'
    };
    const color = task ? (statusColor[task.status] || 'var(--primary)') : '';

    // 時間レンジ表示
    const endHour = String(parseInt(h) + span).padStart(2, '0');
    const timeLabel = span > 1 ? `${h}:00–${endHour}:00` : `${h}:00`;

    let progressBar = '';
    if (estH > 0 && actualH !== '') {
      const pct = Math.min(Math.round((Number(actualH) / estH) * 100), 100);
      const barColor = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--primary)' : 'var(--warning)';
      progressBar = `
        <div class="tl-slot-progress-wrap">
          <div class="tl-slot-progress-bar" style="width:${pct}%; background:${barColor};"></div>
        </div>`;
    }

    // スパン調整ボタン（タスクあり時のみ）
    const maxSpan = 18 - parseInt(h) + 1;
    const spanControls = task ? `
      <div class="tl-slot-span-controls">
        <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${h}',-1)" title="-1h" ${span <= 1 ? 'disabled' : ''}>−</button>
        <span class="tl-slot-span-val">${span}h</span>
        <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${h}',1)" title="+1h" ${span >= maxSpan ? 'disabled' : ''}>＋</button>
      </div>` : '';

    return `
      <div class="tl-slot ${task ? 'tl-slot-filled' : 'tl-slot-empty'}"
        data-hour="${h}" data-span="${span}"
        style="${spanHeight}"
        ondragover="event.preventDefault(); this.classList.add('tl-slot-drag-over');"
        ondragleave="this.classList.remove('tl-slot-drag-over');"
        ondrop="handleTimelineDrop(event, '${h}')">
        <div class="tl-slot-time-col">
          <span class="tl-slot-time">${timeLabel}</span>
          ${spanControls}
        </div>
        ${task ? `
          <div class="tl-slot-task" style="border-left-color:${color}">
            <div class="tl-slot-task-header">
              <span class="tl-slot-task-name">${escapeHtml(task.name)}</span>
              <span class="tl-slot-task-client">${escapeHtml(task.client)}</span>
            </div>
            ${progressBar}
            <div class="tl-slot-hours">
              ${estH ? `
                <div class="tl-slot-time-block tl-slot-est-block">
                  <span class="tl-slot-time-label">想定</span>
                  <span class="tl-slot-time-val">${estH}h</span>
                </div>` : ''}
              ${timerHours ? `
                <div class="tl-slot-time-block tl-slot-timer-block">
                  <span class="tl-slot-time-label">⏱計測</span>
                  <span class="tl-slot-time-val">${timerHours}h</span>
                </div>` : ''}
              <div class="tl-slot-time-block tl-slot-actual-block">
                <span class="tl-slot-time-label">実績</span>
                <input type="number" class="tl-slot-actual-input" min="0" max="24" step="0.5"
                  value="${actualH}"
                  placeholder="—"
                  onchange="saveTimelineActual('${date}', '${h}', this.value)"
                  onclick="event.stopPropagation()">
                <span class="tl-slot-time-label">h</span>
              </div>
              <button class="tl-slot-remove" onclick="removeTimelineSlot('${date}', '${h}')" title="削除">×</button>
            </div>
            <div class="tl-slot-status-row">
              ${[
                {s:'not-started', lbl:'未着手'},
                {s:'in-progress',  lbl:'進行中'},
                {s:'revision',     lbl:'修正中'},
                {s:'completed',    lbl:'完了'}
              ].map(({s,lbl}) =>
                `<button class="tl-slot-status-btn tl-ss-${s}${task.status===s?' active':''}"
                  onclick="event.stopPropagation();updateTaskStatusFromTimeline('${date}','${h}','${s}')">${lbl}</button>`
              ).join('')}
            </div>
            <div class="tl-slot-memo-row">
              <textarea id="tl-memo-${h}" class="tl-slot-memo" rows="1"
                placeholder="作業メモ…"
                onchange="saveTimelineMemo('${date}','${h}',this.value)"
                oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
                onclick="event.stopPropagation()">${escapeHtml(slot.memo||'')}</textarea>
              <button class="tl-slot-memo-voice-btn" id="tl-voice-${h}"
                onclick="event.stopPropagation();startWhisperRecord('tl-memo-${h}','tl-voice-${h}')"
                title="音声入力">🎤</button>
            </div>
            <div class="tl-resize-handle" onpointerdown="startSlotResize(event,'${date}','${h}')">
              <div class="tl-resize-handle-icon"></div>
            </div>
          </div>` : `
          <span class="tl-slot-placeholder">ここにタスクをドロップ</span>`}
      </div>`;
  }).join('');
}

function handleTimelineDrop(e, hour) {
  e.preventDefault();
  e.currentTarget.classList.remove('tl-slot-drag-over');
  const taskId = e.dataTransfer.getData('text/x-tinyperk-task')
             || e.dataTransfer.getData('text/plain');
  if (!taskId) return;
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const date = state.journalDate;
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].timeline) state.journalEntries[date].timeline = {};
  const timeline = state.journalEntries[date].timeline;

  // 既存の同タスクのスロット・coverを削除
  Object.keys(timeline).forEach(h => {
    if (timeline[h].taskId === taskId || timeline[h]._covered) {
      const src = timeline[h]._covered;
      if (src && timeline[src]?.taskId === taskId) delete timeline[h];
      else if (timeline[h].taskId === taskId) delete timeline[h];
    }
  });

  // 想定時間からスパンを自動設定（未設定なら1h）
  const span = Math.max(1, Math.min(Math.round(task.estimatedHours || 1), 18 - parseInt(hour) + 1));

  // メインスロット
  timeline[hour] = { taskId, actualHours: '', span };

  // カバーされるスロットをマーク
  for (let i = 1; i < span; i++) {
    const coveredH = String(parseInt(hour) + i).padStart(2, '0');
    timeline[coveredH] = { _covered: hour };
  }

  saveJournalToStorage();
  renderJournalTimeline();
}

function adjustSlotSpanTo(date, hour, newSpan) {
  const timeline = state.journalEntries[date]?.timeline;
  if (!timeline || !timeline[hour]?.taskId) return;
  const slot = timeline[hour];
  const maxSpan = 18 - parseInt(hour) + 1;
  newSpan = Math.max(1, Math.min(newSpan, maxSpan));

  // 既存coverを削除
  Object.keys(timeline).forEach(h => {
    if (timeline[h]._covered === hour) delete timeline[h];
  });

  slot.span = newSpan;

  // 新しいcoverをマーク
  for (let i = 1; i < newSpan; i++) {
    const coveredH = String(parseInt(hour) + i).padStart(2, '0');
    if (!timeline[coveredH]?.taskId) {
      timeline[coveredH] = { _covered: hour };
    }
  }

  saveJournalToStorage();
  renderJournalTimeline();
}

function adjustSlotSpan(date, hour, delta) {
  const slot = state.journalEntries[date]?.timeline?.[hour];
  if (!slot?.taskId) return;
  adjustSlotSpanTo(date, hour, (slot.span || 1) + delta);
}

// ドラッグでスロット幅を変更（pointer capture方式）
function startSlotResize(e, date, hour) {
  e.preventDefault();
  e.stopPropagation();
  const TL_UNIT = 70;
  const startY = e.clientY;
  const slot = state.journalEntries[date]?.timeline?.[hour];
  if (!slot) return;
  const startSpan = slot.span || 1;
  let previewSpan = startSpan;

  const handle = e.currentTarget;
  const slotEl = handle.closest('.tl-slot');
  if (slotEl) slotEl.classList.add('tl-slot-resizing');

  // pointer capture で要素外に出ても追跡
  handle.setPointerCapture(e.pointerId);

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);

  function onMove(ev) {
    const delta = ev.clientY - startY;
    const newSpan = Math.max(1, Math.min(startSpan + Math.round(delta / TL_UNIT), 18 - parseInt(hour) + 1));
    if (newSpan === previewSpan) return;
    previewSpan = newSpan;
    if (slotEl) {
      slotEl.style.minHeight = newSpan > 1 ? `${newSpan * 64 + (newSpan - 1) * 6}px` : '';
      const spanVal = slotEl.querySelector('.tl-slot-span-val');
      if (spanVal) spanVal.textContent = `${newSpan}h`;
      const timeEl = slotEl.querySelector('.tl-slot-time');
      if (timeEl) {
        const endH = String(parseInt(hour) + newSpan).padStart(2, '0');
        timeEl.textContent = newSpan > 1 ? `${hour}:00–${endH}:00` : `${hour}:00`;
      }
    }
  }

  function onUp() {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    if (slotEl) slotEl.classList.remove('tl-slot-resizing');
    if (previewSpan !== startSpan) adjustSlotSpanTo(date, hour, previewSpan);
  }
}

// 休憩・移動スロット追加モーダル
function showAddSpecialSlotModal(type) {
  document.getElementById('special-slot-modal')?.remove();
  const icon = type === 'break' ? '🍱' : '🚗';
  const name = type === 'break' ? '休憩' : '移動';
  const hours = Array.from({length: 10}, (_, i) => i + 9);
  const hourOptions = hours.map(h => `<option value="${h}">${String(h).padStart(2,'0')}:00</option>`).join('');

  const modal = document.createElement('div');
  modal.id = 'special-slot-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:320px;">
      <div class="modal-header">
        <h2 class="modal-title">${icon} ${name}を追加</h2>
        <button class="modal-close" onclick="document.getElementById('special-slot-modal').remove()">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem;">
        <div class="form-group">
          <label class="form-label">開始時間</label>
          <select id="ss-hour" class="form-control">${hourOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">時間</label>
          <select id="ss-span" class="form-control">
            <option value="1">1時間</option>
            <option value="2">2時間</option>
            <option value="0.5">30分</option>
            <option value="1.5">1時間30分</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">ラベル（任意）</label>
          <input type="text" id="ss-label" class="form-control" placeholder="${name}" value="${name}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('special-slot-modal').remove()">キャンセル</button>
        <button class="btn btn-primary" onclick="confirmAddSpecialSlot('${type}')">追加</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function confirmAddSpecialSlot(type) {
  const hourVal = parseInt(document.getElementById('ss-hour').value);
  const spanVal = parseFloat(document.getElementById('ss-span').value);
  const label = document.getElementById('ss-label').value.trim() || (type === 'break' ? '休憩' : '移動');
  const hour = String(hourVal).padStart(2, '0');
  const span = Math.max(1, Math.round(spanVal));
  const date = state.journalDate;

  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].timeline) state.journalEntries[date].timeline = {};
  const timeline = state.journalEntries[date].timeline;

  // 既存coverをクリア
  Object.keys(timeline).forEach(h => {
    if (timeline[h]._covered === hour) delete timeline[h];
  });

  timeline[hour] = { type, label, span };

  for (let i = 1; i < span; i++) {
    const covH = String(hourVal + i).padStart(2, '0');
    if (!timeline[covH]?.taskId && !timeline[covH]?.type) {
      timeline[covH] = { _covered: hour };
    }
  }

  saveJournalToStorage();
  document.getElementById('special-slot-modal')?.remove();
  renderJournalTimeline();
}

function appendSpecialSlotToJournal(date, hour) {
  const timeline = state.journalEntries[date]?.timeline;
  if (!timeline?.[hour]) return;
  const slot = timeline[hour];
  const span = slot.span || 1;
  const endH = String(parseInt(hour) + span).padStart(2, '0');
  const icon = slot.type === 'break' ? '🍱' : '🚗';
  const line = `${hour}:00〜${endH}:00 ${icon} ${slot.label}`;

  const ta = document.querySelector('#journal-screen textarea, .journal-write-textarea');
  if (!ta) return;
  const existing = ta.value;
  ta.value = existing ? existing + '\n' + line : line;
  // stateにも反映
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  state.journalEntries[date].text = ta.value;
  saveJournalToStorage();

  // ボタンを一瞬フラッシュ
  const btn = document.querySelector(`.tl-slot[data-hour="${hour}"] .tl-slot-special-journal-btn`);
  if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '📝', 1500); }
}

// 空き時間共有モーダル
function showFreeTimeModal() {
  const date = state.journalDate;
  document.getElementById('free-time-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'free-time-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header">
        <h2 class="modal-title">📋 空き時間を共有</h2>
        <button class="modal-close" onclick="document.getElementById('free-time-modal').remove()">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:0.75rem;">
        <p style="font-size:0.82rem;color:var(--text-muted);">以下をコピーして知り合いに送れます</p>
        <textarea id="free-time-text" class="form-control" style="min-height:180px;font-size:0.88rem;line-height:1.8;resize:vertical;" readonly>${generateFreeTimeText(date, false)}</textarea>
        <label style="font-size:0.82rem;color:var(--text-muted);display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
          <input type="checkbox" id="ft-include-busy" onchange="refreshFreeTimeText()">
          予定タスクも含める
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('free-time-modal').remove()">閉じる</button>
        <button class="btn btn-primary" id="ft-copy-btn" onclick="copyFreeTimeText()">📋 コピー</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function generateFreeTimeText(date, includeBusy) {
  const entry = state.journalEntries[date] || {};
  const timeline = entry.timeline || {};
  const d = new Date(date + 'T00:00:00');
  const dow = ['日','月','火','水','木','金','土'][d.getDay()];
  const dateStr = `${d.getMonth()+1}/${d.getDate()}(${dow})`;

  // 占有時間を収集
  const busyHours = new Set();
  Object.entries(timeline).forEach(([h, slot]) => {
    if (slot.taskId) {
      const span = slot.span || 1;
      for (let i = 0; i < span; i++) busyHours.add(parseInt(h) + i);
    }
    if (slot._covered) busyHours.add(parseInt(h));
  });

  // 空き時間をレンジに変換
  const freeRanges = [];
  let start = null;
  for (let h = 9; h <= 18; h++) {
    const busy = busyHours.has(h);
    if (!busy && start === null) start = h;
    if (busy && start !== null) { freeRanges.push({ start, end: h }); start = null; }
  }
  if (start !== null) freeRanges.push({ start, end: 18 });

  const pad = n => String(n).padStart(2, '0');
  const lines = [`【${dateStr} 空き時間】`, ''];
  if (freeRanges.length === 0) {
    lines.push('空き時間はありません');
  } else {
    freeRanges.forEach(r => lines.push(`・${pad(r.start)}:00 〜 ${pad(r.end)}:00`));
  }

  if (includeBusy) {
    const busySlots = Object.entries(timeline)
      .filter(([, s]) => s.taskId)
      .sort(([a], [b]) => a.localeCompare(b));
    if (busySlots.length > 0) {
      lines.push('', '【予定あり】');
      busySlots.forEach(([h, slot]) => {
        const task = state.tasks.find(t => t.id === slot.taskId);
        const span = slot.span || 1;
        lines.push(`・${h}:00〜${pad(parseInt(h)+span)}:00 ${task?.name || ''}`);
      });
    }
  }
  return lines.join('\n');
}

function refreshFreeTimeText() {
  const incBusy = document.getElementById('ft-include-busy')?.checked;
  const ta = document.getElementById('free-time-text');
  if (ta) ta.value = generateFreeTimeText(state.journalDate, incBusy);
}

function copyFreeTimeText() {
  const ta = document.getElementById('free-time-text');
  if (!ta) return;
  navigator.clipboard.writeText(ta.value).then(() => {
    const btn = document.getElementById('ft-copy-btn');
    if (btn) { btn.textContent = '✓ コピーしました!'; setTimeout(() => btn.textContent = '📋 コピー', 2000); }
  });
}

function saveTimelineActual(date, hour, value) {
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].timeline) state.journalEntries[date].timeline = {};
  if (!state.journalEntries[date].timeline[hour]) state.journalEntries[date].timeline[hour] = {};
  state.journalEntries[date].timeline[hour].actualHours = parseFloat(value) || '';
  saveJournalToStorage();
}

function saveTimelineMemo(date, hour, value) {
  if (!state.journalEntries[date]?.timeline?.[hour]) return;
  state.journalEntries[date].timeline[hour].memo = value;
  saveJournalToStorage();
}

function updateTaskStatusFromTimeline(date, hour, newStatus) {
  const slot = state.journalEntries[date]?.timeline?.[hour];
  if (!slot?.taskId) return;
  const task = state.tasks.find(t => t.id === slot.taskId);
  if (!task) return;
  task.status = newStatus;
  saveData();
  renderJournalTimeline();
}

function removeTimelineSlot(date, hour) {
  if (state.journalEntries[date]?.timeline) {
    delete state.journalEntries[date].timeline[hour];
    saveJournalToStorage();
    renderJournalTimeline();
  }
}

function renderTaskList() {
  renderWeeklyChart();
  const body = document.getElementById('tasks-list-body');
  const capBar = document.getElementById('tasks-capacity-bar');
  if (!body) return;

  const statusOrder = { 'not-started': 0, 'in-progress': 1, 'revision': 2, 'completed': 3 };
  const statusLabel = { 'not-started': '未着手', 'in-progress': '進行中', 'revision': '修正中', 'completed': '完了' };
  const statusClass = { 'not-started': 'status-badge-not-started', 'in-progress': 'status-badge-in-progress', 'revision': 'status-badge-revision', 'completed': 'status-badge-completed' };

  // Filter
  let tasks = [...state.tasks];
  const f = state.taskListFilter;
  if (f === 'active') tasks = tasks.filter(t => t.status !== 'completed');
  else if (f !== 'all') tasks = tasks.filter(t => t.status === f);

  // #5 Search
  const q = state.taskSearchQuery || '';
  if (q) tasks = tasks.filter(t =>
    (t.name || '').toLowerCase().includes(q) ||
    (t.client || '').toLowerCase().includes(q) ||
    (t.details || '').toLowerCase().includes(q)
  );

  // Sync search input value
  const searchEl = document.getElementById('task-search-input');
  if (searchEl && searchEl.value.trim().toLowerCase() !== q) searchEl.value = state.taskSearchQuery || '';

  // Sort
  tasks.sort((a, b) => {
    if (state.taskListSort === 'dueDate') return (a.dueDate || '').localeCompare(b.dueDate || '');
    if (state.taskListSort === 'client') return (a.client || '').localeCompare(b.client || '');
    if (state.taskListSort === 'status') return statusOrder[a.status] - statusOrder[b.status];
    return (a.id || '').localeCompare(b.id || '');
  });

  // Capacity bar
  if (capBar) {
    const total = state.tasks.length;
    const completed = state.tasks.filter(t => t.status === 'completed').length;
    const inProgress = state.tasks.filter(t => t.status === 'in-progress' || t.status === 'revision').length;
    const notStarted = state.tasks.filter(t => t.status === 'not-started').length;
    const compPct = total ? Math.round(completed / total * 100) : 0;
    const ipPct   = total ? Math.round(inProgress / total * 100) : 0;
    const nsPct   = total ? Math.round(notStarted / total * 100) : 0;
    capBar.innerHTML = `
      <div class="cap-bar-labels">
        <span>📊 容量 <strong>${total}件</strong> &nbsp;｜&nbsp; 完了 <strong>${completed}</strong> &nbsp;進行中 <strong>${inProgress}</strong> &nbsp;未着手 <strong>${notStarted}</strong></span>
      </div>
      <div class="cap-bar-track">
        <div class="cap-bar-seg cap-seg-done" style="width:${compPct}%"></div>
        <div class="cap-bar-seg cap-seg-progress" style="width:${ipPct}%"></div>
        <div class="cap-bar-seg cap-seg-todo" style="width:${nsPct}%"></div>
      </div>`;
  }

  if (tasks.length === 0) {
    if (q) {
      body.innerHTML = emptyStateHTML('🔍', '検索結果がありません', `「${q}」に一致するタスクが見つかりませんでした。`);
    } else if (f === 'active') {
      body.innerHTML = emptyStateHTML('🎉', '未完了タスクはありません', '素晴らしい！すべてのタスクが完了しています。',
        `<button class="btn btn-primary" onclick="openAddTaskModal()">＋ 新しいタスクを追加</button>`);
    } else {
      body.innerHTML = emptyStateHTML('📋', 'タスクがありません', 'まだタスクが登録されていません。最初のタスクを追加してみましょう。',
        `<button class="btn btn-primary" onclick="openAddTaskModal()">＋ タスクを追加</button>`);
    }
    return;
  }

  const today = getLocalDateStr();

  body.innerHTML = tasks.map(task => {
    const isOverdue = task.status !== 'completed' && task.dueDate && task.dueDate < today;
    const steps = task.steps || [];
    const doneSteps = steps.filter(s => s.completed).length;
    const stepText = steps.length > 0 ? `<span class="tl-steps">${doneSteps}/${steps.length} ステップ</span>` : '';
    const dueCls = isOverdue ? 'tl-due overdue' : 'tl-due';

    return `
      <div class="tl-task-row" onclick="openEditTaskModal('${task.id}')" role="button" tabindex="0"
        draggable="true" data-task-id="${task.id}"
        ondragstart="handleTaskDragStart(event, '${task.id}')"
        title="ドラッグして日誌に追加できます">
        <div class="tl-status-strip ${task.status}"></div>
        <div class="tl-body">
          <div class="tl-top">
            <span class="tl-name">${escapeHtml(task.name)}</span>
            <span class="status-badge ${statusClass[task.status] || ''}">${statusLabel[task.status] || task.status}</span>
          </div>
          <div class="tl-meta">
            <span class="tl-client">👤 ${escapeHtml(task.client || '—')}</span>
            ${task.isUnscheduled
              ? `<span class="tag-unscheduled">📋 日程未定</span>`
              : `<span class="${dueCls}">📅 ${task.dueDate || '—'}${isOverdue ? ' ⚠️' : ''}</span>`}
            ${stepText}
            ${task.estimatedHours ? `<span class="tl-estimated">⏳ ${task.estimatedHours}h</span>` : ''}
            ${task.amount ? `<span class="tl-amount">¥${Number(task.amount).toLocaleString()}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// JOURNAL (Daily Journal)
// ============================================================

function fmtSeconds(sec) {
  if (!sec || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m > 0 ? m + '分' : ''}`;
  return `${m}分`;
}

function journalDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
}

function renderJournal() {
  const date = state.journalDate;
  const todayStr = getLocalDateStr();

  // ── 日付ラベル更新 ──
  const labelEl = document.getElementById('journal-date-display');
  if (labelEl) labelEl.textContent = journalDateLabel(date);

  const nextBtn = document.getElementById('journal-next-day');
  if (nextBtn) nextBtn.disabled = false;

  // ── 作業サマリー ──
  const summaryEl = document.getElementById('journal-work-summary');
  if (summaryEl) {
    const dayTasks = state.tasks.filter(t =>
      t.dueDate === date || t.completedAt === date
    );
    const timecard = state.timecards.find(tc => tc.date === date);
    const totalTaskSec = dayTasks.reduce((s, t) => s + (t.spentSeconds || 0), 0);

    let html = '<div class="journal-summary-cards">';

    // 稼働時間カード
    const hoursLabel = timecard
      ? `${timecard.clockIn || '--'} → ${timecard.clockOut || '--'}（${timecard.totalHours != null ? timecard.totalHours + 'h' : '--'}）`
      : '記録なし';
    html += `
      <div class="journal-stat-card">
        <span class="journal-stat-icon">🕐</span>
        <div class="journal-stat-body">
          <span class="journal-stat-label">稼働時間</span>
          <span class="journal-stat-value">${hoursLabel}</span>
        </div>
      </div>`;

    // タスク件数カード
    const doneCount = dayTasks.filter(t => t.status === 'completed').length;
    html += `
      <div class="journal-stat-card">
        <span class="journal-stat-icon">✅</span>
        <div class="journal-stat-body">
          <span class="journal-stat-label">タスク</span>
          <span class="journal-stat-value">${dayTasks.length}件${doneCount > 0 ? `（完了 ${doneCount}件）` : ''}</span>
        </div>
      </div>`;

    // ストップウォッチ計測時間カード
    if (totalTaskSec > 0) {
      html += `
        <div class="journal-stat-card">
          <span class="journal-stat-icon">⏱️</span>
          <div class="journal-stat-body">
            <span class="journal-stat-label">計測合計</span>
            <span class="journal-stat-value">${fmtSeconds(totalTaskSec)}</span>
          </div>
        </div>`;
    }

    // 気分カード
    if (timecard && (timecard.moodBefore || timecard.moodAfter)) {
      html += `
        <div class="journal-stat-card">
          <span class="journal-stat-icon">🌡️</span>
          <div class="journal-stat-body">
            <span class="journal-stat-label">気分</span>
            <span class="journal-stat-value">${timecard.moodBefore || '—'} → ${timecard.moodAfter || '—'}</span>
          </div>
        </div>`;
    }

    html += '</div>';

    // タスク一覧テーブル
    if (dayTasks.length > 0) {
      const statusLabel = { 'not-started': '未着手', 'in-progress': '進行中', 'revision': '修正中', 'completed': '完了' };
      const statusColor = { 'not-started': 'var(--text-muted)', 'in-progress': 'var(--primary)', 'revision': '#f97316', 'completed': 'var(--success)' };
      html += `<div class="journal-task-table">`;
      dayTasks.forEach(t => {
        const spent = fmtSeconds(t.spentSeconds);
        html += `
          <div class="journal-task-row" onclick="openEditTaskModal('${t.id}')" title="クリックで編集">
            <span class="journal-task-dot" style="background:${statusColor[t.status] || 'var(--text-muted)'}"></span>
            <span class="journal-task-name">${escapeHtml(t.name)}</span>
            <span class="journal-task-client">${escapeHtml(t.client)}</span>
            <span class="journal-task-status" style="color:${statusColor[t.status]}">${statusLabel[t.status] || t.status}</span>
            ${spent ? `<span class="journal-task-time">⏱ ${spent}</span>` : '<span></span>'}
            <span class="journal-task-edit-btn" onclick="event.stopPropagation();openEditTaskModal('${t.id}')">✏️</span>
          </div>`;
      });
      html += '</div>';
    } else {
      html += `<p class="journal-no-tasks">この日に紐づくタスクはありません</p>`;
    }

    summaryEl.innerHTML = html;
  }

  // ── テキストエリアに既存エントリを反映 ──
  const textEl = document.getElementById('journal-text');
  const savedAtEl = document.getElementById('journal-saved-at');
  const charCountEl = document.getElementById('journal-char-count');
  const entry = state.journalEntries[date];
  if (textEl) {
    textEl.value = entry ? entry.text : '';
    if (charCountEl) charCountEl.textContent = `${textEl.value.length}文字`;
  }
  if (savedAtEl) {
    savedAtEl.textContent = entry
      ? `最終更新: ${entry.updatedAt.replace('T', ' ').slice(0, 16)}`
      : '';
  }

  // ── テキストエリアにD&Dドロップゾーンを設定 ──
  if (textEl) setupJournalDropZone(textEl);

  // ── タイムライン描画 ──
  renderJournalTimeline();

  // ── 過去の記録一覧 ──
  const histList = document.getElementById('journal-history-list');
  const countEl = document.getElementById('journal-entry-count');
  if (histList) {
    const entries = Object.entries(state.journalEntries)
      .filter(([d, e]) => e.text && e.text.trim())
      .sort(([a], [b]) => b.localeCompare(a)); // 新しい順

    if (countEl) countEl.textContent = `${entries.length}件の記録`;

    if (entries.length === 0) {
      histList.innerHTML = `<p class="journal-no-tasks">まだ記録がありません。今日の振り返りを書いてみましょう！</p>`;
    } else {
      histList.innerHTML = entries.map(([d, e]) => {
        const isActive = d === date;
        const preview = e.text.length > 80 ? e.text.slice(0, 80) + '…' : e.text;
        // その日のタスク数
        const taskCount = state.tasks.filter(t => t.dueDate === d || t.completedAt === d).length;
        // ジャーナルドット for calendar
        const hasJournal = !!state.journalEntries[d]?.text?.trim();
        return `
          <div class="journal-history-item ${isActive ? 'active' : ''}" onclick="jumpToJournalDate('${d}')">
            <div class="journal-history-date">
              ${journalDateLabel(d)}
              ${taskCount > 0 ? `<span class="journal-history-badge">${taskCount}件</span>` : ''}
            </div>
            <p class="journal-history-preview">${escapeHtml(preview)}</p>
          </div>`;
      }).join('');
    }
  }
}

// ── タスク → ジャーナル ドラッグ&ドロップ ──

function handleTaskDragStart(e, taskId) {
  e.dataTransfer.setData('text/x-tinyperk-task', taskId);
  e.dataTransfer.effectAllowed = 'copy';
  // ドラッグ中のゴースト表示
  const el = e.currentTarget;
  el.style.opacity = '0.6';
  setTimeout(() => { el.style.opacity = ''; }, 0);
}

function setupJournalDropZone(textarea) {
  if (!textarea || textarea._dropSetup) return;
  textarea._dropSetup = true;

  textarea.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-tinyperk-task')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    textarea.classList.add('journal-drop-active');
  });

  textarea.addEventListener('dragleave', () => {
    textarea.classList.remove('journal-drop-active');
  });

  textarea.addEventListener('drop', (e) => {
    const taskId = e.dataTransfer.getData('text/x-tinyperk-task');
    if (!taskId) return;
    e.preventDefault();
    textarea.classList.remove('journal-drop-active');

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const statusLabel = { 'not-started': '未着手', 'in-progress': '進行中', 'revision': '修正中', 'completed': '完了' };
    const spent = task.spentSeconds > 0 ? ` ⏱${fmtSeconds(task.spentSeconds)}` : '';
    const line = `\n- 【${statusLabel[task.status] || task.status}】${task.name}（${task.client}）${spent}`;

    // カーソル位置に挿入
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + line + after;
    textarea.selectionStart = textarea.selectionEnd = start + line.length;
    textarea.focus();

    // 文字数更新
    const charCountEl = document.getElementById('journal-char-count');
    if (charCountEl) charCountEl.textContent = `${textarea.value.length}文字`;

    showTrayToast(`📌 「${task.name}」を日誌に追加しました`);
  });
}

function saveJournalEntry() {
  const textEl = document.getElementById('journal-text');
  if (!textEl) return;
  const text = textEl.value.trim();
  const date = state.journalDate;

  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  state.journalEntries[date].text = text;
  state.journalEntries[date].updatedAt = new Date().toISOString().slice(0, 16);
  saveJournalToStorage();

  const savedAtEl = document.getElementById('journal-saved-at');
  if (savedAtEl) savedAtEl.textContent = `最終更新: ${state.journalEntries[date].updatedAt.replace('T', ' ')}`;

  // カレンダーのドット更新のため再描画（軽量）
  if (state.activeTab === 'journal') renderJournal();

  showTrayToast('📓 日誌を保存しました');
  scheduleSyncToSupabase();
}

function jumpToJournalDate(dateStr) {
  state.journalDate = dateStr;
  renderJournal();
  // スクロールトップ
  const screen = document.getElementById('journal-screen');
  if (screen) screen.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show report modal when task is completed
function showReportModal(task) {
  const overlay = document.getElementById('report-modal-overlay');
  if (!overlay) return;

  const today = getLocalDateStr();
  const tpl = state.clientTemplates[task.client];
  const hasTemplate = !!tpl;

  let reportText;
  if (hasTemplate) {
    reportText = tpl
      .replace(/\{タスク名\}/g, task.name)
      .replace(/\{クライアント名\}/g, task.client)
      .replace(/\{納期\}/g, task.dueDate || '')
      .replace(/\{完了日\}/g, today);
  } else {
    reportText =
      `${task.client} ご担当者様\n\nお世話になっております。\n「${task.name}」が完了しましたのでご報告いたします。\n\n完了日：${today}\n納期：${task.dueDate || ''}\n\n引き続きよろしくお願いいたします。`;
  }

  document.getElementById('report-task-name').textContent = task.name;
  document.getElementById('report-text-area').value = reportText;
  document.getElementById('report-no-template-hint').style.display = hasTemplate ? 'none' : 'block';
  document.getElementById('report-copy-btn').textContent = '📋 コピー';

  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('active'));
  document.body.classList.add('modal-open');
}

function closeReportModal() {
  const overlay = document.getElementById('report-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  setTimeout(() => { overlay.style.display = 'none'; }, 300);
  document.body.classList.remove('modal-open');
}

// HTML エスケープ（datalist用）
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let voiceRecognition = null;
let _voiceActive = false; // ユーザーが意図的に録音中かどうか

function toggleVoiceRecognition(targetInputId, micButtonId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert('このブラウザは音声入力に対応していません。\nChrome または Safari をお試しください。');
    return;
  }

  const micBtn = document.getElementById(micButtonId);
  const targetInput = document.getElementById(targetInputId);

  // 録音中なら停止
  if (_voiceActive) {
    _voiceActive = false;
    if (voiceRecognition) { try { voiceRecognition.stop(); } catch(e) {} }
    if (micBtn) micBtn.classList.remove('recording');
    return;
  }

  _voiceActive = true;

  // マイクボタンを「録音中」に変更（start前に先行更新してフィードバック向上）
  if (micBtn) micBtn.classList.add('recording');

  // SpeechRecognitionを直接起動（getUserMediaで先に開くと「使用中」エラーになるブラウザがあるため削除）
  const baseText = targetInput ? targetInput.value : '';
  let committedText = baseText; // 確定済みテキスト（セッション中に積み上がる）

  try {
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = 'ja-JP';
    voiceRecognition.continuous = true;       // ボタンを押すまで継続
    voiceRecognition.interimResults = true;   // リアルタイムプレビュー
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
      showTrayToast('🎤 話しかけてください… もう一度タップで停止');
    };

    voiceRecognition.onresult = (event) => {
      if (!targetInput) return;
      let interim = '';
      // event.resultIndex から処理（前回済みの結果を再処理しない）
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim();
          if (t) committedText = committedText ? committedText + ' ' + t : t;
        } else {
          interim += r[0].transcript;
        }
      }
      targetInput.value = interim ? (committedText ? committedText + ' ' + interim : interim) : committedText;
    };

    voiceRecognition.onerror = (e) => {
      console.error('Speech recognition error:', e.error);
      // no-speech は無視して継続（continuousモードでは頻繁に発生）
      if (e.error === 'no-speech') return;
      // その他のエラーは停止
      _voiceActive = false;
      if (micBtn) micBtn.classList.remove('recording');
      const msgs = {
        'not-allowed':         '❌ マイクが拒否されています。ブラウザ設定でマイクを「許可」にしてください。',
        'service-not-allowed': '❌ マイクへのアクセスが許可されていません。',
        'network':             '❌ ネットワークエラー。オンラインか確認してください。',
        'audio-capture':       '❌ マイクが見つかりません。接続を確認してください。',
        'aborted':             '',
      };
      const msg = msgs[e.error];
      if (msg) showTrayToast(msg);
    };

    voiceRecognition.onend = () => {
      // continuousモードでも予期せず終了することがあるため、意図的停止でなければ再起動
      if (_voiceActive) {
        try { voiceRecognition.start(); } catch(e) {
          _voiceActive = false;
          if (micBtn) micBtn.classList.remove('recording');
        }
      } else {
        if (micBtn) micBtn.classList.remove('recording');
      }
    };

    voiceRecognition.start();
  } catch (err) {
    console.error('SpeechRecognition init failed:', err);
    _voiceActive = false;
    if (micBtn) micBtn.classList.remove('recording');
    showTrayToast('❌ 音声入力の起動に失敗しました: ' + err.message);
  }
}

// ----------------------------------------------------------------------------
// SWIPE-TO-DELETE
// ----------------------------------------------------------------------------
function wrapWithSwipeDelete(cardEl, taskId) {
  const wrap = document.createElement('div');
  wrap.className = 'swipe-wrap';

  // 削除ボタン（カード裏に配置）
  const delBtn = document.createElement('button');
  delBtn.className = 'swipe-delete-btn';
  delBtn.innerHTML = '🗑️ 削除';
  delBtn.setAttribute('aria-label', 'タスクを削除');

  // PC用ホバー削除ボタン
  const hoverBtn = document.createElement('button');
  hoverBtn.className = 'tray-delete-hover';
  hoverBtn.innerHTML = '🗑️';
  hoverBtn.setAttribute('aria-label', 'タスクを削除');
  cardEl.appendChild(hoverBtn);

  const doDelete = () => {
    if (!confirm(`「${state.tasks.find(t => t.id === taskId)?.name || 'このタスク'}」を削除しますか？`)) return;
    wrap.classList.add('deleting');
    setTimeout(() => {
      deleteTask(taskId);
    }, 280);
  };

  delBtn.addEventListener('click', (e) => { e.stopPropagation(); doDelete(); });
  hoverBtn.addEventListener('click', (e) => { e.stopPropagation(); doDelete(); });

  // --- Touch swipe ---
  let startX = 0, startY = 0, currentX = 0, isTracking = false, isHorizontal = null;
  const REVEAL_W = 80;

  cardEl.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isTracking = true;
    isHorizontal = null;
    currentX = 0;
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!isTracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // 最初の動きで横か縦か判定
    if (isHorizontal === null) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      isHorizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!isHorizontal) return; // 縦スクロールはパス

    e.preventDefault(); // 横スワイプ確定 → スクロール止める
    currentX = Math.min(0, dx); // 左のみ
    const travel = Math.min(-currentX, REVEAL_W + 20);
    cardEl.style.transform = `translateX(${currentX}px)`;
    cardEl.classList.add('swiping');
    delBtn.style.width = Math.min(-currentX, REVEAL_W) + 'px';
  }, { passive: false });

  cardEl.addEventListener('touchend', () => {
    if (!isTracking) return;
    isTracking = false;
    cardEl.classList.remove('swiping');

    if (-currentX >= cardEl.offsetWidth * 0.45) {
      // フルスワイプ → そのまま削除
      cardEl.style.transition = 'transform 0.25s ease';
      cardEl.style.transform = `translateX(-${cardEl.offsetWidth + 20}px)`;
      delBtn.style.width = '0';
      setTimeout(doDelete, 220);
    } else if (-currentX >= REVEAL_W * 0.7) {
      // 閾値超え → ボタン表示状態にスナップ
      cardEl.style.transition = 'transform 0.2s ease';
      cardEl.style.transform = `translateX(-${REVEAL_W}px)`;
      delBtn.style.width = REVEAL_W + 'px';
      delBtn.style.transition = 'width 0.2s ease';
    } else {
      // スナップバック
      cardEl.style.transition = 'transform 0.2s ease';
      cardEl.style.transform = 'translateX(0)';
      delBtn.style.width = '0';
    }
    currentX = 0;
  });

  // 他の場所タップでスナップバック
  document.addEventListener('touchstart', (e) => {
    if (!wrap.contains(e.target)) {
      cardEl.style.transition = 'transform 0.2s ease';
      cardEl.style.transform = 'translateX(0)';
      delBtn.style.width = '0';
    }
  }, { passive: true });

  wrap.appendChild(delBtn);
  wrap.appendChild(cardEl);
  return wrap;
}

// ----------------------------------------------------------------------------
// TASK TRAY - floating right-side panel
// ----------------------------------------------------------------------------
function renderTaskTray() {
  const list = document.getElementById('tray-task-list');
  const badge = document.getElementById('tray-badge');
  const countEl = document.getElementById('tray-count');
  if (!list) return;

  const all = state.tasks.filter(t => t.status !== 'completed');
  const filtered = state.trayFilter === 'all' ? all : all.filter(t => t.status === state.trayFilter);

  if (badge) badge.textContent = all.length > 0 ? all.length : '';
  if (countEl) countEl.textContent = all.length + '件';

  if (filtered.length === 0) {
    list.innerHTML = `<div class="tray-empty">${all.length === 0 ? '未完了タスクはありません 🎉' : 'このカテゴリーにタスクはありません'}</div>`;
    return;
  }

  const statusLabel = { 'not-started': '未着手', 'in-progress': '進行中', 'revision': '修正中' };
  const statusColor = { 'not-started': 'var(--text-muted)', 'in-progress': 'var(--primary)', 'revision': 'var(--warning)' };

  list.innerHTML = '';
  filtered.forEach(task => {
    const card = document.createElement('div');
    card.className = 'tray-task-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-task-id', task.id);

    const stepsTotal = (task.steps || []).length;
    const stepsDone = (task.steps || []).filter(s => s.completed).length;
    const stepsHtml = stepsTotal > 0
      ? `<span style="color:var(--text-muted);">✓ ${stepsDone}/${stepsTotal}</span>` : '';

    card.innerHTML = `
      <button type="button" class="tray-card-edit" onclick="openEditTaskModal('${task.id}')">✏️</button>
      <div class="tray-card-name">${task.name}</div>
      <div class="tray-card-meta">
        <span class="tray-card-status" style="color:${statusColor[task.status]||'var(--text-muted)'};">${statusLabel[task.status]||task.status}</span>
        <span style="color:var(--text-muted);">${task.client}</span>
        ${stepsHtml}
      </div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">📅 ${task.dueDate||'日付未設定'}</div>
    `;

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    list.appendChild(wrapWithSwipeDelete(card, task.id));
  });
}

function setupCalendarDropZones() {
  document.querySelectorAll('.calendar-day').forEach(day => {
    day.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      day.classList.add('drag-over');
    });
    day.addEventListener('dragleave', (e) => {
      if (!day.contains(e.relatedTarget)) day.classList.remove('drag-over');
    });
    day.addEventListener('drop', (e) => {
      e.preventDefault();
      day.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newDate = day.getAttribute('data-date');
      if (!taskId || !newDate) return;

      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;

      const oldDate = task.dueDate;
      task.dueDate = newDate;

      if (oldDate && oldDate !== newDate) {
        const diffDays = Math.round((new Date(newDate) - new Date(oldDate)) / 86400000);
        if (diffDays !== 0) propagateScheduleShifts(task.id, diffDays);
      }

      saveTasksToStorage();
      renderApp();
      showTrayToast(`「${task.name}」→ ${newDate} に移動`);
    });
  });
}

function trayQuickAdd(name) {
  if (!name.trim()) return;
  const today = getLocalDateStr();
  const task = {
    id: Date.now().toString(),
    name: name.trim(),
    details: '',
    dueDate: today,
    originalDueDate: today,
    client: '未設定',
    amount: 0,
    status: 'not-started',
    completedAt: null,
    dependsOnTaskId: null,
    isDeadlineFixed: false,
    spentSeconds: 0,
    steps: []
  };
  state.tasks.push(task);
  saveTasksToStorage();
  renderApp();
  showTrayToast(`「${task.name}」を追加しました ✓`);
}

function showTrayToast(message) {
  document.querySelectorAll('.tray-toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = 'tray-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ----------------------------------------------------------------------------
// SCHEDULE CALENDAR RENDERING & ENGINE
// ----------------------------------------------------------------------------
function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();

  document.getElementById('calendar-month-year').textContent = `${year}年 ${month + 1}月`;

  const calendarGrid = document.getElementById('calendar-grid');
  const weekdays = Array.from(calendarGrid.querySelectorAll('.calendar-weekday'));
  calendarGrid.innerHTML = '';
  weekdays.forEach(el => calendarGrid.appendChild(el));

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  recalculateDependencyCompressions();

  // 1. Prev month pad
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const prevDate = new Date(year, month - 1, prevMonthTotalDays - i);
    createCalendarDayElement(prevDate, true);
  }

  // 2. Current Month
  for (let d = 1; d <= totalDays; d++) {
    const currentDate = new Date(year, month, d);
    createCalendarDayElement(currentDate, false);
  }

  // 3. Next month pad
  const totalCells = firstDayIndex + totalDays;
  const remainingCells = 42 - totalCells;
  for (let i = 1; i <= remainingCells; i++) {
    const nextDate = new Date(year, month + 1, i);
    createCalendarDayElement(nextDate, true);
  }
}

function createCalendarDayElement(date, isOtherMonth) {
  const grid = document.getElementById('calendar-grid');
  const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  
  const dayDiv = document.createElement('div');
  dayDiv.className = 'calendar-day';
  if (isOtherMonth) dayDiv.classList.add('other-month');
  if (dateStr === getLocalDateStr()) dayDiv.classList.add('today');
  if (dateStr === state.selectedDate) dayDiv.classList.add('selected');
  
  dayDiv.setAttribute('data-date', dateStr);
  dayDiv.innerHTML = `<span class="calendar-day-number">${date.getDate()}</span>`;

  const isOriginalDateForAny = state.tasks.some(t => t.originalDueDate === dateStr && t.originalDueDate !== t.dueDate);
  if (isOriginalDateForAny) {
    dayDiv.classList.add('original-date-indicator');
  }

  const dayTasks = state.tasks.filter(t => t.dueDate === dateStr);
  const taskContainer = document.createElement('div');
  taskContainer.className = 'calendar-day-tasks';

  if (dayTasks.length > 0) {
    dayDiv.classList.add('has-tasks');
    
    const hasInProgress = dayTasks.some(t => t.status === 'in-progress');
    const hasRevision = dayTasks.some(t => t.status === 'revision');
    const allCompleted = dayTasks.every(t => t.status === 'completed');
    const hasCompressedAlert = dayTasks.some(t => t.isCompressed);

    if (hasCompressedAlert) {
      dayDiv.classList.add('compressed-alert');
    }

    if (hasRevision) {
      dayDiv.classList.add('revision-present');
    } else if (hasInProgress) {
      dayDiv.classList.add('in-progress-present');
    } else if (allCompleted) {
      dayDiv.classList.add('completed-only');
    }

    dayTasks.forEach(task => {
      const taskDiv = document.createElement('div');
      taskDiv.className = `calendar-task-item ${task.status}`;
      if (task.isCompressed) taskDiv.classList.add('compressed-alert');
      
      taskDiv.textContent = (task.isCompressed ? '⚠️ ' : '') + task.name;
      taskDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditTaskModal(task.id);
      });
      taskContainer.appendChild(taskDiv);
    });
  }

  dayDiv.appendChild(taskContainer);

  // ジャーナル記録ドット
  const hasJournalEntry = !isOtherMonth && !!state.journalEntries[dateStr]?.text?.trim();
  if (hasJournalEntry) {
    const journalDot = document.createElement('span');
    journalDot.className = 'calendar-journal-dot';
    journalDot.title = '📓 日誌あり';
    dayDiv.appendChild(journalDot);
  }

  // AI提案ドット / items
  const proposalsForDay = state.schedulingProposals.filter(p => p.suggestedDate === dateStr);
  proposalsForDay.forEach(p => {
    const task = state.tasks.find(t => t.id === p.taskId);
    if (!task) return;
    const propDiv = document.createElement('div');
    propDiv.className = 'calendar-task-item proposal-item';
    propDiv.textContent = '✨ ' + task.name;
    propDiv.title = `AI提案: ${task.name}`;
    propDiv.style.cssText = 'border:1.5px dashed var(--primary);background:transparent;color:var(--primary);opacity:0.85;cursor:default;';
    taskContainer.appendChild(propDiv);
    dayDiv.classList.add('has-tasks');
  });

  dayDiv.addEventListener('click', () => {
    state.selectedDate = dateStr;
    document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
    dayDiv.classList.add('selected');
    renderSelectedDayTasks();
  });

  grid.appendChild(dayDiv);
}

function navigateMonth(direction) {
  state.currentMonth.setMonth(state.currentMonth.getMonth() + direction);
  renderApp();
}

function renderSelectedDayTasks() {
  const container = document.getElementById('selected-day-tasks-list');
  const title = document.getElementById('selected-day-title');
  
  const parsedDate = new Date(state.selectedDate);
  title.textContent = `${parsedDate.getFullYear()}年${parsedDate.getMonth() + 1}月${parsedDate.getDate()}日のタスク`;

  const dayTasks = state.tasks.filter(t => t.dueDate === state.selectedDate);
  container.innerHTML = '';

  if (dayTasks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-weight: 500;">
        この日のスケジュールはありません。
      </div>
    `;
    return;
  }

  dayTasks.forEach(task => {
    const card = createTaskCard(task);
    container.appendChild(wrapWithSwipeDelete(card, task.id));
  });
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = `task-card ${task.status === 'completed' ? 'completed-task' : ''} ${task.status === 'revision' ? 'revision-task' : ''}`;
  if (task.isCompressed) card.classList.add('compressed-alert');
  card.setAttribute('data-id', task.id);
  
  const formattedAmount = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(task.amount);
  const warningBadge = task.isCompressed ? `<span class="compressed-badge">期日逼迫</span>` : '';

  // Stopwatch indicator if spentSeconds exists
  const stopwatchIcon = task.spentSeconds ? `⏱️ ${formatSecondsToHHMMSS(task.spentSeconds)}` : '';

  // Steps progress indicator
  const steps = task.steps || [];
  const stepsTotal = steps.length;
  const stepsDone = steps.filter(s => s.completed).length;
  const stepsBadge = stepsTotal > 0 ? `<span class="task-meta-item" style="color:var(--success);font-weight:700;">✓ ${stepsDone}/${stepsTotal} ステップ</span>` : '';

  card.innerHTML = `
    <div class="task-card-left">
      <input type="checkbox" class="task-checkbox" ${task.status === 'completed' ? 'checked' : ''} onclick="handleCheckboxToggle(event, '${task.id}')">
      <div class="task-card-info">
        <div class="task-card-title">
          ${escapeHTML(task.name)}
          ${warningBadge}
        </div>
        <div class="task-card-meta">
          <span class="task-meta-item">
            <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M12 7a4 4 0 100-8 4 4 0 000 8z"/></svg>
            ${escapeHTML(task.client)}
          </span>
          <span class="task-meta-item">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            ${task.dueDate} ${task.originalDueDate !== task.dueDate ? `(当初: ${task.originalDueDate})` : ''}
          </span>
          ${stopwatchIcon ? `<span class="task-meta-item" style="color: var(--secondary); font-weight:700;">${stopwatchIcon}</span>` : ''}
          ${stepsBadge}
        </div>
      </div>
    </div>
    <div class="task-card-right">
      ${task.priority === 'high' ? '<span class="priority-badge priority-high">🔴 高</span>' : task.priority === 'low' ? '<span class="priority-badge priority-low">🟢 低</span>' : ''}
      <span class="task-badge ${task.status}">${statusToJapanese(task.status)}</span>
      <span class="task-amount-badge">${formattedAmount}</span>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('task-checkbox')) {
      openEditTaskModal(task.id);
    }
  });

  return card;
}

function handleCheckboxToggle(event, taskId) {
  event.stopPropagation();
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    if (task.status === 'completed') {
      // 完了 → 修正中（差し戻し）
      task.status = 'revision';
      task.completedAt = null;
    } else if (task.status === 'revision') {
      // 修正中 → 完了（再完了）
      task.status = 'completed';
      task.completedAt = getLocalDateStr();
      triggerConfettiParticles();
      const randomMsg = MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
      showMotivatorToast(randomMsg, '🎉');
    } else {
      task.status = 'completed';
      task.completedAt = getLocalDateStr();
      
      // Stop the timer if it is running on this completed task
      if (state.activeTimerTaskId === taskId) {
        pauseTaskTimer();
      }

      triggerConfettiParticles();
      const randomMsg = MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
      showMotivatorToast(randomMsg, '🎉');
    }
    saveTasksToStorage();
    renderApp();
    googleCalendarSync(task, 'update');
  }
}

// ----------------------------------------------------------------------------
// SMART SCHEDULE PROPAGATION & COMPRESSION ENGINE
// ----------------------------------------------------------------------------
function propagateScheduleShifts(startTaskId, deltaDays) {
  if (deltaDays === 0) return;

  state.tasks.forEach(task => {
    if (task.dependsOnTaskId === startTaskId) {
      if (task.isDeadlineFixed) {
        console.log(`Task ${task.id} deadline is locked. Shifting skipped.`);
      } else {
        const oldDate = parseLocalDate(task.dueDate);
        oldDate.setDate(oldDate.getDate() + deltaDays);
        task.dueDate = toLocalDateStr(oldDate);

        propagateScheduleShifts(task.id, deltaDays);
      }
    }
  });
}

function recalculateDependencyCompressions() {
  state.tasks.forEach(t => t.isCompressed = false);

  state.tasks.forEach(task => {
    if (task.dependsOnTaskId) {
      const parentTask = state.tasks.find(t => t.id === task.dependsOnTaskId);
      if (parentTask) {
        const parentDate = new Date(parentTask.dueDate);
        const childDate = new Date(task.dueDate);

        if (parentDate >= childDate) {
          task.isCompressed = true;
        }
      }
    }
  });
}

// ----------------------------------------------------------------------------
// NEW: DAILY VIEW DIARY MODAL PIPELINE
// ----------------------------------------------------------------------------
function openDailyViewModal(dateStr) {
  state.selectedDate = dateStr;
  
  const parsed = new Date(dateStr);
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
  const dayStr = `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日 (${weekDays[parsed.getDay()]})`;

  document.getElementById('daily-view-title').textContent = `${dayStr} の詳細ログ`;

  // Fetch Attendance Log
  const card = state.timecards.find(tc => tc.date === dateStr);
  const attendanceBody = document.getElementById('daily-view-attendance-body');

  if (card && (card.clockIn || card.clockOut || card.moodBefore || card.moodAfter)) {
    const hours = card.totalHours ? `${card.totalHours.toFixed(1)} 時間` : '未退勤';
    attendanceBody.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; font-size:0.95rem;">
        <div><span style="color:var(--text-muted);">出勤時刻:</span> <strong>${card.clockIn || '--:--'}</strong></div>
        <div><span style="color:var(--text-muted);">退勤時刻:</span> <strong>${card.clockOut || '--:--'}</strong></div>
        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">実稼働労働:</span> <strong style="color:var(--secondary);">${hours}</strong></div>
        <div style="margin-top:0.5rem;"><span style="color:var(--text-muted); display:block; font-size:0.8rem;">始業気分:</span> <span style="font-size:1.5rem;">${card.moodBefore || '未選択'}</span></div>
        <div style="margin-top:0.5rem;"><span style="color:var(--text-muted); display:block; font-size:0.8rem;">終業気分:</span> <span style="font-size:1.5rem;">${card.moodAfter || '未選択'}</span></div>
      </div>
    `;
  } else {
    attendanceBody.innerHTML = `
      <div style="color:var(--text-muted); font-size:0.9rem; text-align:center; padding:1rem 0;">
        勤怠や気分の記録はありません。
      </div>
    `;
  }

  // Fetch Nippo report memo
  const nippoBody = document.getElementById('daily-view-nippo-body');
  if (card && card.reportText) {
    nippoBody.innerHTML = `
      <p style="font-size:0.95rem; white-space:pre-wrap; line-height:1.5;">${escapeHTML(card.reportText)}</p>
    `;
  } else {
    nippoBody.innerHTML = `
      <div style="color:var(--text-muted); font-size:0.9rem; text-align:center; padding:1rem 0;">
        日報の登録はありません。
      </div>
    `;
  }

  // Fetch Scheduled Tasks
  const tasksBody = document.getElementById('daily-view-tasks-body');
  const dayTasks = state.tasks.filter(t => t.dueDate === dateStr);
  tasksBody.innerHTML = '';

  if (dayTasks.length > 0) {
    dayTasks.forEach(task => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:0.75rem; background-color:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:all var(--transition-fast);';
      item.innerHTML = `
        <div>
          <span style="font-weight:600; font-size:0.9rem; text-decoration: ${task.status === 'completed' ? 'line-through' : 'none'}; color:${task.status === 'completed' ? 'var(--text-muted)' : 'var(--text-main)'};">${escapeHTML(task.name)}</span>
          <span style="display:block; font-size:0.75rem; color:var(--text-muted);">${escapeHTML(task.client)}</span>
        </div>
        <span class="task-badge ${task.status}" style="font-size:0.7rem; padding:2px 6px;">${statusToJapanese(task.status)}</span>
      `;
      item.addEventListener('click', () => {
        document.getElementById('daily-view-modal-overlay').classList.remove('active');
        openEditTaskModal(task.id);
      });
      tasksBody.appendChild(item);
    });
  } else {
    tasksBody.innerHTML = `
      <div style="color:var(--text-muted); font-size:0.9rem; text-align:center; padding:1rem 0;">
        この日に期日設定されたタスクはありません。
      </div>
    `;
  }

  document.getElementById('daily-view-modal-overlay').classList.add('active');
}

function navigateDailyViewDate(days) {
  const d = new Date(state.selectedDate);
  d.setDate(d.getDate() + days);
  const nextDateStr = getLocalDateStr(d);
  openDailyViewModal(nextDateStr);
  
  // Highlight calendar selector state in the background
  state.selectedDate = nextDateStr;
  state.currentMonth = new Date(d); // adjust month display
  renderCalendar();
  renderSelectedDayTasks();
}

// ----------------------------------------------------------------------------
// NEW: TASK STOPWATCH TIMER ENGINE
// ----------------------------------------------------------------------------
function startTaskTimer(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  // If already running on this task, exit silently.
  if (state.activeTimerTaskId === taskId) return;

  // If another task is timing, pause it first
  if (state.activeTimerTaskId && state.activeTimerTaskId !== taskId) {
    pauseTaskTimer();
  }

  state.activeTimerTaskId = taskId;
  state.timerStartEpoch = Date.now();
  state.timerAccumulatedSeconds = task.spentSeconds || 0;

  // Save current active timer session to restore on reload
  localStorage.setItem('activeTimer', JSON.stringify({
    taskId: state.activeTimerTaskId,
    startEpoch: state.timerStartEpoch,
    accumulatedSeconds: state.timerAccumulatedSeconds
  }));
  saveTimerState();

  // Render buttons immediately
  document.getElementById('btn-timer-start').style.display = 'none';
  document.getElementById('btn-timer-pause').style.display = 'inline-flex';

  // Floating banner trigger
  document.getElementById('floating-timer-banner-title').textContent = task.name;
  document.getElementById('floating-timer-banner').classList.add('active');

  // Clear previous intervals if any
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.timerStartEpoch) / 1000);
    const totalSecs = state.timerAccumulatedSeconds + elapsed;
    
    // Save live ticks in task state so we don't lose if closed directly
    task.spentSeconds = totalSecs;

    const formatted = formatSecondsToHHMMSS(totalSecs);
    
    // Update digital displays
    const displayEl = document.getElementById('task-stopwatch-val');
    if (displayEl && state.editingTaskId === taskId) {
      displayEl.textContent = formatted;
    }
    const bannerClock = document.getElementById('floating-timer-banner-clock');
    if (bannerClock) {
      bannerClock.textContent = formatted;
    }
  }, 1000);
}

// ── 休憩・移動タイマー ──

let btTimerInterval = null;

function toggleBreakTravelTimer(type) {
  if (state.activeBTType && state.activeBTType !== type) {
    // 別のタイマーが動いていたら先に止める
    stopBreakTravelTimer();
  }

  if (state.activeBTType === type) {
    stopBreakTravelTimer();
  } else {
    startBreakTravelTimer(type);
  }
}

function startBreakTravelTimer(type) {
  state.activeBTType = type;
  state.btStartEpoch = Date.now();

  const icon = type === 'break' ? '🍱' : '🚗';
  const label = type === 'break' ? '休憩中' : '移動中';

  const display = document.getElementById('bt-active-display');
  const labelEl = document.getElementById('bt-active-label');
  if (display) display.style.display = 'flex';
  if (labelEl) labelEl.textContent = `${icon} ${label}`;
  renderBTLog();

  btTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.btStartEpoch) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    const timerEl = document.getElementById('bt-active-timer');
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;
  }, 1000);
}

function stopBreakTravelTimer() {
  if (!state.activeBTType || !state.btStartEpoch) return;

  clearInterval(btTimerInterval);
  btTimerInterval = null;

  const type = state.activeBTType;
  const startEpoch = state.btStartEpoch;
  const endEpoch = Date.now();
  const durationSec = Math.floor((endEpoch - startEpoch) / 1000);

  state.activeBTType = null;
  state.btStartEpoch = null;

  const display = document.getElementById('bt-active-display');
  if (display) display.style.display = 'none';

  // 記録を保存
  const date = getLocalDateStr();
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].btRecords) state.journalEntries[date].btRecords = [];

  const record = { type, startEpoch, endEpoch, durationSec };
  state.journalEntries[date].btRecords.push(record);
  saveJournalToStorage();

  // ジャーナルタイムラインに自動追加
  syncBTRecordToTimeline(date, record);

  // ログ表示を更新
  renderBTLog();
}

function syncBTRecordToTimeline(date, record) {
  const startDate = new Date(record.startEpoch);
  const startHour = startDate.getHours();
  if (startHour < 9 || startHour > 18) return;

  const hour = String(startHour).padStart(2, '0');
  const span = Math.max(1, Math.round(record.durationSec / 3600));
  const label = record.type === 'break' ? '休憩' : '移動';

  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].timeline) state.journalEntries[date].timeline = {};
  const timeline = state.journalEntries[date].timeline;

  // 既存のcoverをクリア
  Object.keys(timeline).forEach(h => {
    if (timeline[h]._covered === hour) delete timeline[h];
  });

  timeline[hour] = { type: record.type, label, span };
  for (let i = 1; i < span; i++) {
    const covH = String(startHour + i).padStart(2, '0');
    if (!timeline[covH]?.taskId && !timeline[covH]?.type) {
      timeline[covH] = { _covered: hour };
    }
  }

  saveJournalToStorage();
  if (state.activeTab === 'journal') renderJournalTimeline();
}

function renderBTLog() {
  const date = getLocalDateStr();
  const records = state.journalEntries[date]?.btRecords || [];

  const fmtDur = s => {
    if (!s) return '--';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
  };

  // 合計時間を種類別に集計
  const breakSecs = records.filter(r => r.type === 'break').reduce((a, r) => a + r.durationSec, 0);
  const travelSecs = records.filter(r => r.type === 'travel').reduce((a, r) => a + r.durationSec, 0);

  const breakEl = document.getElementById('dash-break-total');
  const travelEl = document.getElementById('dash-travel-total');
  if (breakEl) breakEl.textContent = breakSecs > 0 ? fmtDur(breakSecs) : '--';
  if (travelEl) travelEl.textContent = travelSecs > 0 ? fmtDur(travelSecs) : '--';

  // 実稼働時間を再計算（退勤済みの場合のみ）
  const todayCard = state.timecards.find(tc => tc.date === date);
  const totalHrsEl = document.getElementById('dash-total-hours-val');
  if (totalHrsEl && todayCard?.clockIn && todayCard?.clockOut) {
    const rawHours = calculateHours(todayCard.clockIn, todayCard.clockOut);
    const netHours = Math.max(0, rawHours - breakSecs / 3600);
    totalHrsEl.textContent = `${netHours.toFixed(1)} 時間`;
  }

  // ボタン状態を同期
  const breakBtn = document.getElementById('btn-break-toggle');
  const travelBtn = document.getElementById('btn-travel-toggle');
  if (state.activeBTType === 'break') {
    if (breakBtn) { breakBtn.textContent = '終了'; breakBtn.classList.add('active'); }
    if (travelBtn) { travelBtn.textContent = '開始'; travelBtn.classList.remove('active'); }
  } else if (state.activeBTType === 'travel') {
    if (travelBtn) { travelBtn.textContent = '終了'; travelBtn.classList.add('active'); }
    if (breakBtn) { breakBtn.textContent = '開始'; breakBtn.classList.remove('active'); }
  } else {
    if (breakBtn) { breakBtn.textContent = '開始'; breakBtn.classList.remove('active'); }
    if (travelBtn) { travelBtn.textContent = '開始'; travelBtn.classList.remove('active'); }
  }
}

function deleteBTRecord(index) {
  const date = getLocalDateStr();
  if (!state.journalEntries[date]?.btRecords) return;
  state.journalEntries[date].btRecords.splice(index, 1);
  saveJournalToStorage();
  renderBTLog();
}

function syncTimerToJournalTimeline(task) {
  if (!task || !task.spentSeconds) return;
  const todayStr = getLocalDateStr();
  const entry = state.journalEntries[todayStr];
  if (!entry || !entry.timeline) return;

  let updated = false;
  Object.entries(entry.timeline).forEach(([hour, slot]) => {
    if (slot.taskId === task.id) {
      slot.actualHours = Math.round(task.spentSeconds / 3600 * 10) / 10;
      updated = true;
    }
  });

  if (updated) {
    saveJournalToStorage();
    if (state.activeTab === 'journal') renderJournalTimeline();
  }
}

function pauseTaskTimer() {
  if (!state.activeTimerTaskId) return;

  const task = state.tasks.find(t => t.id === state.activeTimerTaskId);
  if (task) {
    const elapsed = Math.floor((Date.now() - state.timerStartEpoch) / 1000);
    const totalSecs = state.timerAccumulatedSeconds + elapsed;
    task.spentSeconds = totalSecs;
    
    saveTasksToStorage();
    syncTimerToJournalTimeline(task);
    if (!isModalOpen()) renderApp();
  }

  // Clear interval
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;

  // Clear active states
  state.activeTimerTaskId = null;
  state.timerStartEpoch = null;
  state.timerAccumulatedSeconds = 0;
  localStorage.removeItem('activeTimer');
  clearTimerState();

  // Update UI components
  document.getElementById('btn-timer-start').style.display = 'inline-flex';
  document.getElementById('btn-timer-pause').style.display = 'none';
  document.getElementById('floating-timer-banner').classList.remove('active');

  // If task edit modal is currently open, reset text
  if (task && state.editingTaskId === task.id) {
    document.getElementById('task-stopwatch-val').textContent = formatSecondsToHHMMSS(task.spentSeconds || 0);
  }
}

function resetTaskTimer(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (state.activeTimerTaskId === taskId) {
    pauseTaskTimer();
  }

  task.spentSeconds = 0;
  saveTasksToStorage();
  renderApp();

  const displayEl = document.getElementById('task-stopwatch-val');
  if (displayEl && state.editingTaskId === taskId) {
    displayEl.textContent = '00:00:00';
  }
}

function formatSecondsToHHMMSS(totalSecs) {
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Resume timer if active on page load
function resumeActiveTimerOnLoad() {
  const activeTimerData = localStorage.getItem('activeTimer');
  if (activeTimerData) {
    try {
      const data = JSON.parse(activeTimerData);
      const task = state.tasks.find(t => t.id === data.taskId);
      
      if (task) {
        state.activeTimerTaskId = data.taskId;
        
        // Compute how much time elapsed while browser was closed/inactive
        const closedTimeElapsed = Math.floor((Date.now() - data.startEpoch) / 1000);
        state.timerStartEpoch = data.startEpoch;
        state.timerAccumulatedSeconds = data.accumulatedSeconds;
        
        // Start running immediately
        startTaskTimer(data.taskId);
      }
    } catch (e) {
      console.error('Failed to restore active timer:', e);
      localStorage.removeItem('activeTimer');
    }
  }
}

// Page unload protection
function autoSaveTimerOnUnload() {
  if (state.activeTimerTaskId) {
    const task = state.tasks.find(t => t.id === state.activeTimerTaskId);
    if (task) {
      const elapsed = Math.floor((Date.now() - state.timerStartEpoch) / 1000);
      task.spentSeconds = state.timerAccumulatedSeconds + elapsed;
      try { localStorage.setItem('tasks', JSON.stringify(state.tasks)); } catch(e) {}
      saveTimerState();
    }
  }
}

// ----------------------------------------------------------------------------
// MODAL FORMS CONTROLS (STOPWATCH SYNC INTEGRATION)
// ----------------------------------------------------------------------------
function populatePredecessorOptions(excludeTaskId) {
  const select = document.getElementById('task-predecessor');
  select.innerHTML = '<option value="">なし（最初に行う）</option>';

  state.tasks.forEach(t => {
    if (t.id !== excludeTaskId) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (期日: ${t.dueDate})`;
      select.appendChild(opt);
    }
  });
}

// ─── Steps / Subtask management ───────────────────────────────────────────────

function initStepsEditor(task) {
  state.editingSteps = (task && task.steps) ? JSON.parse(JSON.stringify(task.steps)) : [];
  renderStepsEditor();
}

function renderStepsEditor() {
  const container = document.getElementById('modal-steps-list');
  const label = document.getElementById('steps-progress-label');
  const bar = document.getElementById('steps-progress-bar');
  if (!container) return;

  const total = state.editingSteps.length;
  const done = state.editingSteps.filter(s => s.completed).length;
  if (label) label.textContent = total > 0 ? `${done} / ${total} 完了` : '';
  if (bar) bar.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';

  container.innerHTML = '';
  state.editingSteps.forEach((step, i) => {
    const item = document.createElement('div');
    item.className = 'step-item';
    item.innerHTML = `
      <input type="checkbox" class="step-checkbox" ${step.completed ? 'checked' : ''} onchange="toggleEditingStep(${i})">
      <span class="step-name ${step.completed ? 'completed' : ''}">${escapeHTML(step.name)}</span>
      ${step.completedAt ? `<span class="step-date">✓ ${step.completedAt}</span>` : ''}
      <button type="button" class="step-delete-btn" onclick="deleteEditingStep(${i})" aria-label="削除">×</button>
    `;
    container.appendChild(item);
  });
}

function addEditingStep() {
  const input = document.getElementById('new-step-input');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  state.editingSteps.push({ name, completed: false, completedAt: null });
  input.value = '';
  renderStepsEditor();
}

function toggleEditingStep(index) {
  const step = state.editingSteps[index];
  if (!step) return;
  step.completed = !step.completed;
  step.completedAt = step.completed ? getLocalDateStr() : null;
  renderStepsEditor();
}

function deleteEditingStep(index) {
  state.editingSteps.splice(index, 1);
  renderStepsEditor();
}

// ──────────────────────────────────────────────────────────────────────────────

function _toggleUnscheduledDate(isUnscheduled) {
  const dueDateEl = document.getElementById('task-due-date');
  if (!dueDateEl) return;
  dueDateEl.disabled = isUnscheduled;
  dueDateEl.style.opacity = isUnscheduled ? '0.4' : '1';
  if (isUnscheduled) dueDateEl.value = '';
}

function openAddTaskModal(prefilledDate) {
  state.editingTaskId = null;
  document.getElementById('modal-title').textContent = '新しいタスクを追加';
  document.getElementById('btn-delete-task').style.display = 'none';
  document.getElementById('modal-share-section').style.display = 'none';
  
  // Hide stopwatch for new tasks
  document.getElementById('modal-stopwatch-section').style.display = 'none';
  
  populatePredecessorOptions(null);

  document.getElementById('task-id').value = '';
  document.getElementById('task-name').value = '';
  document.getElementById('task-details').value = '';
  document.getElementById('task-due-date').value = prefilledDate || getLocalDateStr();
  document.getElementById('task-client').value = '';
  document.getElementById('task-amount').value = '';
  document.getElementById('task-estimated-hours').value = '';
  document.getElementById('task-predecessor').value = '';
  document.getElementById('task-deadline-fixed').checked = false;
  document.querySelector(`input[name="task-status"][value="not-started"]`).checked = true;
  const _prioEl = document.getElementById('task-priority'); if (_prioEl) _prioEl.value = 'medium';
  const _unschEl = document.getElementById('task-unscheduled');
  if (_unschEl) { _unschEl.checked = false; _toggleUnscheduledDate(false); }

  initStepsEditor(null);
  updateClientSuggestions();
  updateWorkTypeSuggestions();

  // スクロール位置を保存してから背景を固定
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  document.getElementById('task-modal-overlay').classList.add('active');
}

function openEditTaskModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.editingTaskId = taskId;
  document.getElementById('modal-title').textContent = 'タスク詳細と編集';
  document.getElementById('btn-delete-task').style.display = 'inline-flex';
  document.getElementById('modal-share-section').style.display = 'flex';

  // Show stopwatch with calculated time
  document.getElementById('modal-stopwatch-section').style.display = 'flex';
  document.getElementById('task-stopwatch-val').textContent = formatSecondsToHHMMSS(task.spentSeconds || 0);

  // Sync Start/Pause buttons based on global state
  if (state.activeTimerTaskId === taskId) {
    document.getElementById('btn-timer-start').style.display = 'none';
    document.getElementById('btn-timer-pause').style.display = 'inline-flex';
  } else {
    document.getElementById('btn-timer-start').style.display = 'inline-flex';
    document.getElementById('btn-timer-pause').style.display = 'none';
  }

  populatePredecessorOptions(taskId);

  document.getElementById('task-id').value = task.id;
  document.getElementById('task-name').value = task.name;
  document.getElementById('task-details').value = task.details;
  const _unschEditEl = document.getElementById('task-unscheduled');
  if (_unschEditEl) { _unschEditEl.checked = !!task.isUnscheduled; _toggleUnscheduledDate(!!task.isUnscheduled); }
  document.getElementById('task-due-date').value = task.dueDate || '';
  document.getElementById('task-client').value = task.client;
  document.getElementById('task-amount').value = task.amount;
  document.getElementById('task-estimated-hours').value = task.estimatedHours || '';
  const prioEl = document.getElementById('task-priority');
  if (prioEl) prioEl.value = task.priority || 'medium';
  const wtEl = document.getElementById('task-work-type');
  if (wtEl) wtEl.value = task.workType || '';
  document.getElementById('task-predecessor').value = task.dependsOnTaskId || '';
  document.getElementById('task-deadline-fixed').checked = task.isDeadlineFixed || false;
  document.querySelector(`input[name="task-status"][value="${task.status}"]`).checked = true;

  initStepsEditor(task);
  updateClientSuggestions();
  updateWorkTypeSuggestions();

  // スクロール位置を保存してから背景を固定
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  document.getElementById('task-modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('task-modal-overlay').classList.remove('active');
  document.getElementById('daily-view-modal-overlay').classList.remove('active');
  // 背景固定を解除してスクロール位置を復元
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, state._scrollY || 0);
}


// 自動保存: ステータス変更などでモーダルを閉じずに保存
function autoSaveTask() {
  const id = document.getElementById('task-id').value;
  if (!id) return; // 新規作成時は自動保存しない
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const isUnscheduled = document.getElementById('task-unscheduled')?.checked || false;
  const statusEl = document.querySelector('input[name="task-status"]:checked');
  const newStatus = statusEl ? statusEl.value : task.status;
  const oldStatus = task.status;

  task.name = document.getElementById('task-name').value.trim() || task.name;
  task.details = document.getElementById('task-details').value.trim();
  task.isUnscheduled = isUnscheduled;
  task.dueDate = isUnscheduled ? null : (document.getElementById('task-due-date').value || task.dueDate);
  task.client = document.getElementById('task-client').value.trim() || task.client;
  task.amount = parseFloat(document.getElementById('task-amount').value) || task.amount;
  task.estimatedHours = parseFloat(document.getElementById('task-estimated-hours').value) || task.estimatedHours;
  task.status = newStatus;
  task.priority = document.getElementById('task-priority')?.value || task.priority;
  task.workType = document.getElementById('task-work-type')?.value.trim() || task.workType || '';

  if (newStatus === 'completed' && oldStatus !== 'completed') {
    task.completedAt = getLocalDateStr();
    if (state.activeTimerTaskId === id) pauseTaskTimer();
    state._pendingReportTask = task;
  } else if (newStatus !== 'completed') {
    task.completedAt = null;
  }

  saveTasksToStorage();
  renderApp();
  showMotivatorToast('自動保存しました', '💾');

  if (state._pendingReportTask) {
    const reportTask = state._pendingReportTask;
    state._pendingReportTask = null;
    closeModal();
    setTimeout(() => showReportModal(reportTask), 200);
  }
}

function handleTaskFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('task-id').value;
  const name = document.getElementById('task-name').value.trim();
  const details = document.getElementById('task-details').value.trim();
  const isUnscheduled = document.getElementById('task-unscheduled')?.checked || false;
  const dueDate = isUnscheduled ? null : (document.getElementById('task-due-date').value || null);
  const client = document.getElementById('task-client').value.trim();
  const amount = parseFloat(document.getElementById('task-amount').value) || 0;
  const estimatedHours = parseFloat(document.getElementById('task-estimated-hours').value) || 0;
  const status = document.querySelector('input[name="task-status"]:checked').value;
  const dependsOnTaskId = document.getElementById('task-predecessor').value || null;
  const isDeadlineFixed = document.getElementById('task-deadline-fixed').checked;
  const priority = document.getElementById('task-priority')?.value || 'medium';
  const workType = document.getElementById('task-work-type')?.value.trim() || '';

  if (!name || !client || (!isUnscheduled && !dueDate)) {
    alert('タスク名、クライアント名は必須です。期日がある場合は入力してください。');
    return;
  }

  let task = null;
  let actionType = 'create';

  if (id) {
    task = state.tasks.find(t => t.id === id);
    if (task) {
      const oldStatus = task.status;
      const oldDueDate = task.dueDate;
      
      task.name = name;
      task.details = details;
      task.isUnscheduled = isUnscheduled;
      task.dueDate = dueDate;
      task.client = client;
      task.amount = amount;
      task.estimatedHours = estimatedHours;
      task.status = status;
      task.dependsOnTaskId = dependsOnTaskId;
      task.isDeadlineFixed = isDeadlineFixed;
      task.priority = priority;
      task.workType = workType;
      // If changed from unscheduled → scheduled, remove any pending proposal
      if (!isUnscheduled) {
        state.schedulingProposals = state.schedulingProposals.filter(p => p.taskId !== id);
      }

      if (status === 'completed' && oldStatus !== 'completed') {
        task.completedAt = getLocalDateStr();
        if (state.activeTimerTaskId === id) pauseTaskTimer();
        state._pendingReportTask = task; // show report modal after save
      } else if (status === 'revision' && oldStatus === 'completed') {
        // 完了 → 修正中：completedAt をクリアし、期日未変更でも伝播ヒントを表示
        task.completedAt = null;
        if (oldDueDate === dueDate) {
          // 期日が変わっていなくても後続タスクに影響がある旨をコンソールに記録
          console.info('[Schedule] Revision: downstream tasks may need manual review for task', id);
        }
      } else if (status !== 'completed' && status !== 'revision') {
        task.completedAt = null;
      }

      // Save steps from editor
      task.steps = JSON.parse(JSON.stringify(state.editingSteps));

      if (oldDueDate !== dueDate) {
        const oldTime = new Date(oldDueDate).getTime();
        const newTime = new Date(dueDate).getTime();
        const diffDays = Math.round((newTime - oldTime) / (86400000));

        propagateScheduleShifts(task.id, diffDays);
      }

      actionType = 'update';
    }
  } else {
    task = {
      id: Date.now().toString(),
      name,
      details,
      isUnscheduled,
      dueDate,
      originalDueDate: dueDate,
      client,
      amount,
      estimatedHours,
      status,
      completedAt: status === 'completed' ? getLocalDateStr() : null,
      dependsOnTaskId,
      isDeadlineFixed,
      priority,
      workType,
      spentSeconds: 0,
      steps: JSON.parse(JSON.stringify(state.editingSteps))
    };
    state.tasks.push(task);
  }

  saveTasksToStorage();
  closeModal();
  renderApp();

  // Show report modal if task was just completed
  if (state._pendingReportTask) {
    const reportTask = state._pendingReportTask;
    state._pendingReportTask = null;
    setTimeout(() => showReportModal(reportTask), 200);
  }

  googleCalendarSync(task, actionType);
}

function deleteTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  
  if (state.activeTimerTaskId === taskId) {
    pauseTaskTimer();
  }

  state.tasks = state.tasks.filter(t => t.id !== taskId);
  
  state.tasks.forEach(t => {
    if (t.dependsOnTaskId === taskId) {
      t.dependsOnTaskId = null;
    }
  });

  saveTasksToStorage();
  closeModal();
  renderApp();

  if (task) {
    googleCalendarSync(task, 'delete');
  }
}

// ----------------------------------------------------------------------------
// INVOICE REPORT PAGE WITH BREAKDOWN INTEGRATION
// ----------------------------------------------------------------------------
function populateInvoiceClients() {
  const select = document.getElementById('report-client-filter');
  const previousValue = select.value;
  
  const clients = [...new Set(state.tasks.map(t => t.client))];
  
  select.innerHTML = '<option value="all">すべてのクライアント</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });

  if (previousValue) select.value = previousValue;

  const monthInput = document.getElementById('report-month-filter');
  if (!monthInput.value) {
    const now = new Date();
    const formattedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthInput.value = formattedMonth;
  }
}

function togglePomodoro() {
  const p = state.pomodoro;
  if (p.running) {
    clearInterval(p.interval);
    p.interval = null;
    p.running = false;
    updatePomodoroBtns();
  } else {
    p.running = true;
    p.interval = setInterval(() => {
      p.remaining--;
      if (p.remaining <= 0) {
        clearInterval(p.interval);
        p.interval = null;
        p.running = false;
        if (p.phase === 'work') {
          p.sessionsToday++;
          p.phase = 'break';
          p.remaining = p.breakDuration;
          showPomodoroNotification('集中セッション完了！5分休憩しましょう ☕');
        } else {
          p.phase = 'work';
          p.remaining = p.workDuration;
          showPomodoroNotification('休憩終了！次のセッションを始めましょう 🍅');
        }
      }
      updatePomodoroDisplay();
    }, 1000);
    updatePomodoroBtns();
  }
}

function resetPomodoro() {
  const p = state.pomodoro;
  clearInterval(p.interval);
  p.interval = null;
  p.running = false;
  p.phase = 'work';
  p.remaining = p.workDuration;
  updatePomodoroDisplay();
  updatePomodoroBtns();
}

function updatePomodoroDisplay() {
  const p = state.pomodoro;
  const min = String(Math.floor(p.remaining / 60)).padStart(2, '0');
  const sec = String(p.remaining % 60).padStart(2, '0');
  const disp = document.getElementById('pomo-display');
  const lbl = document.getElementById('pomo-label');
  const cnt = document.getElementById('pomo-session-count');
  if (disp) disp.textContent = `${min}:${sec}`;
  if (lbl) lbl.textContent = p.phase === 'work' ? '集中タイム 🍅' : '休憩タイム ☕';
  if (cnt) cnt.textContent = `本日 ${p.sessionsToday} セッション`;
}

function updatePomodoroBtns() {
  const btn = document.getElementById('btn-pomo-start');
  if (btn) btn.textContent = state.pomodoro.running ? '⏸ 一時停止' : '▶ 開始';
}

function showPomodoroNotification(msg) {
  if (Notification && Notification.permission === 'granted') {
    new Notification('TINYPERK', { body: msg, icon: './app-icon.png' });
  }
  // Always show in-app toast too
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);background:var(--primary);color:#fff;padding:0.75rem 1.5rem;border-radius:2rem;z-index:9999;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function checkDeadlineReminders() {
  if (!Notification || Notification.permission !== 'granted') return;
  const today = getLocalDateStr();
  // Parse dates in local timezone to avoid UTC midnight offset issues
  const parseLocalDate = s => { const [y,m,d] = s.split('-'); return new Date(y, m-1, d).getTime(); };
  const todayMs = parseLocalDate(today);
  const shown = JSON.parse(localStorage.getItem('reminderShown') || '{}');
  const newShown = { ...shown };

  state.tasks
    .filter(t => t.status !== 'completed' && t.dueDate)
    .forEach(t => {
      const dueMs = parseLocalDate(t.dueDate);
      const diffDays = Math.round((dueMs - todayMs) / 86400000);
      const key = `${t.id}-${t.dueDate}`;

      if (diffDays === 0 && !shown[key + '-0']) {
        new Notification('🚨 本日締め切り！', { body: `「${t.name}」の納期は今日です`, icon: './app-icon.png' });
        newShown[key + '-0'] = true;
      } else if (diffDays === 1 && !shown[key + '-1']) {
        new Notification('⚠️ 明日締め切り', { body: `「${t.name}」の納期は明日です`, icon: './app-icon.png' });
        newShown[key + '-1'] = true;
      } else if (diffDays === 3 && !shown[key + '-3']) {
        new Notification('📌 締め切り3日前', { body: `「${t.name}」の納期まであと3日です`, icon: './app-icon.png' });
        newShown[key + '-3'] = true;
      }
    });

  localStorage.setItem('reminderShown', JSON.stringify(newShown));
}

function saveBusinessInfo() {
  const fields = ['name','company','address','phone','email','bankName','bankBranch','accountType','accountNumber','accountHolder','invoiceNumber'];
  fields.forEach(f => {
    const el = document.getElementById('biz-' + f.replace(/([A-Z])/g, '-$1').toLowerCase());
    if (el) state.businessInfo[f] = el.value.trim();
  });
  // accountType special case
  const typeEl = document.getElementById('biz-account-type');
  if (typeEl) state.businessInfo.accountType = typeEl.value;
  localStorage.setItem('businessInfo', JSON.stringify(state.businessInfo));
  const msg = document.getElementById('biz-save-msg');
  if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 2000); }
  scheduleSyncToSupabase();
}

function populateBusinessInfoForm() {
  const bi = state.businessInfo;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('biz-name', bi.name);
  setVal('biz-company', bi.company);
  setVal('biz-address', bi.address);
  setVal('biz-phone', bi.phone);
  setVal('biz-email', bi.email);
  setVal('biz-bank-name', bi.bankName);
  setVal('biz-bank-branch', bi.bankBranch);
  setVal('biz-account-number', bi.accountNumber);
  setVal('biz-account-holder', bi.accountHolder);
  setVal('biz-invoice-number', bi.invoiceNumber);
  const typeEl = document.getElementById('biz-account-type');
  if (typeEl) typeEl.value = bi.accountType || '普通';
}

function openInvoiceModal() {
  const selectedMonth = document.getElementById('report-month-filter').value;
  const selectedClient = document.getElementById('report-client-filter').value;
  if (!selectedMonth) { alert('対象月を選択してください'); return; }
  document.getElementById('invoice-modal-overlay').style.display = 'flex';
  renderInvoicePreview(selectedMonth, selectedClient);
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal-overlay').style.display = 'none';
}

function printInvoice() {
  window.print();
}

function renderInvoicePreview(selectedMonth, selectedClient) {
  const bi = state.businessInfo;
  const [year, month] = selectedMonth.split('-');
  const monthLabel = `${year}年${parseInt(month)}月`;
  const issueDate = getLocalDateStr();

  const completedTasks = state.tasks.filter(task => {
    if (task.status !== 'completed' || !task.completedAt) return false;
    if (selectedClient !== 'all' && task.client !== selectedClient) return false;
    const compDate = new Date(task.completedAt);
    return compDate.getFullYear().toString() === year && String(compDate.getMonth() + 1).padStart(2, '0') === month;
  });

  const subtotal = completedTasks.reduce((s, t) => s + (t.amount || 0), 0);
  const tax = Math.round(subtotal * 0.1);
  const total = subtotal + tax;

  // Client name for invoice
  const clientName = selectedClient !== 'all' ? selectedClient : (completedTasks[0]?.client || 'ご担当者');

  const rows = completedTasks.map((t, i) => `
    <tr>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc;">${i+1}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc;">${escapeHTML(t.name)}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:center;">${t.completedAt || ''}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">1</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">${new Intl.NumberFormat('ja-JP').format(t.amount || 0)}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">${new Intl.NumberFormat('ja-JP').format(t.amount || 0)}</td>
    </tr>
  `).join('');

  const preview = document.getElementById('invoice-preview');
  preview.innerHTML = `
    <div id="invoice-print-area" style="background:#fff; color:#222; padding:2rem; font-family:'Noto Sans JP',sans-serif; font-size:0.9rem; max-width:720px; margin:0 auto; border:1px solid #ddd;">
      <h1 style="text-align:center; font-size:1.8rem; letter-spacing:0.2em; margin-bottom:2rem; color:#222;">請　求　書</h1>

      <div style="display:flex; justify-content:space-between; margin-bottom:2rem; gap:1rem; flex-wrap:wrap;">
        <!-- 宛先 -->
        <div>
          <div style="font-size:1.1rem; font-weight:700; border-bottom:2px solid #222; padding-bottom:0.25rem; margin-bottom:0.5rem;">${escapeHTML(clientName)} 御中</div>
          <div style="font-size:0.85rem; color:#555;">対象期間: ${monthLabel}</div>
        </div>
        <!-- 発行者情報 -->
        <div style="text-align:right; font-size:0.85rem; line-height:1.7;">
          <div style="font-size:1rem; font-weight:700;">${escapeHTML(bi.company || bi.name || '')}</div>
          ${bi.company && bi.name ? `<div>${escapeHTML(bi.name)}</div>` : ''}
          ${bi.address ? `<div>${escapeHTML(bi.address)}</div>` : ''}
          ${bi.phone ? `<div>TEL: ${escapeHTML(bi.phone)}</div>` : ''}
          ${bi.email ? `<div>${escapeHTML(bi.email)}</div>` : ''}
          ${bi.invoiceNumber ? `<div style="margin-top:0.25rem; font-size:0.8rem; color:#666;">登録番号: ${escapeHTML(bi.invoiceNumber)}</div>` : ''}
          <div style="margin-top:0.25rem;">発行日: ${issueDate}</div>
        </div>
      </div>

      <!-- 合計 -->
      <div style="background:#f5f5f5; border:1px solid #ccc; padding:1rem 1.5rem; margin-bottom:1.5rem; border-radius:4px;">
        <span style="font-size:0.9rem;">ご請求金額（税込）</span>
        <span style="font-size:2rem; font-weight:900; margin-left:1rem; color:#1a1a2e;">¥${new Intl.NumberFormat('ja-JP').format(total)}</span>
      </div>

      <!-- 明細テーブル -->
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:1.5rem;">
        <thead>
          <tr style="background:#222; color:#fff;">
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:2.5rem;">#</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc;">品目・作業内容</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:5.5rem;">完了日</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:3rem; text-align:right;">数量</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:6rem; text-align:right;">単価</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:6rem; text-align:right;">金額</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6" style="padding:1rem; text-align:center; border:1px solid #ccc; color:#888;">完了タスクがありません</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right; font-weight:700;">小計</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(subtotal)}</td>
          </tr>
          <tr>
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">消費税（10%）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(tax)}</td>
          </tr>
          <tr style="background:#f0f0f0; font-weight:700;">
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">合計（税込）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(total)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- 振込先 -->
      ${(bi.bankName || bi.accountNumber) ? `
      <div style="border:1px solid #ccc; border-radius:4px; padding:1rem 1.25rem; font-size:0.85rem;">
        <div style="font-weight:700; margin-bottom:0.5rem;">お振込先</div>
        <div>${escapeHTML(bi.bankName || '')} ${escapeHTML(bi.bankBranch || '')}</div>
        <div>${escapeHTML(bi.accountType || '普通')}　${escapeHTML(bi.accountNumber || '')}</div>
        <div>口座名義：${escapeHTML(bi.accountHolder || '')}</div>
      </div>
      ` : '<div style="color:#999; font-size:0.85rem; text-align:center;">設定画面で振込先を登録すると請求書に表示されます</div>'}

      <div style="margin-top:1.5rem; font-size:0.8rem; color:#888; text-align:center;">
        お振込期日：${monthLabel}末日まで　／　本請求書に関するお問い合わせはメールにてお願いいたします。
      </div>
    </div>
  `;
}

function exportCSV() {
  const selectedMonth = document.getElementById('report-month-filter').value;
  const selectedClient = document.getElementById('report-client-filter').value;

  // Build task rows
  const rows = [['タスク名','クライアント','優先度','ステータス','期日','完了日','金額(税別)','金額(税込)','計測時間(h)']];
  state.tasks
    .filter(t => {
      if (selectedClient !== 'all' && t.client !== selectedClient) return false;
      if (selectedMonth) {
        const d = t.completedAt || t.dueDate;
        if (!d || !d.startsWith(selectedMonth)) return false;
      }
      return true;
    })
    .forEach(t => {
      const prioLabel = {high:'高',medium:'中',low:'低'}[t.priority||'medium'];
      const taxIncl = Math.round((t.amount||0)*1.1);
      const hours = t.spentSeconds ? (t.spentSeconds/3600).toFixed(2) : '';
      rows.push([t.name, t.client, prioLabel, t.status, t.dueDate||'', t.completedAt||'', t.amount||0, taxIncl, hours]);
    });

  // Add timecard rows
  rows.push([]);
  rows.push(['日付','出勤','退勤','総稼働時間(h)','休憩(h)']);
  state.timecards
    .filter(tc => !selectedMonth || tc.date.startsWith(selectedMonth))
    .forEach(tc => {
      rows.push([tc.date, tc.clockIn||'', tc.clockOut||'', (tc.totalHours||0).toFixed(2), '']);
    });

  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const bom = '﻿'; // UTF-8 BOM for Excel
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tinyperk_${selectedMonth || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderInvoiceReport() {
  const selectedClient = document.getElementById('report-client-filter').value;
  const selectedMonth = document.getElementById('report-month-filter').value;

  if (!selectedMonth) return;

  // Render trend chart
  setTimeout(renderTrendChart, 50);

  const [year, month] = selectedMonth.split('-');
  
  // 1. Completed tasks matching criteria
  const completedTasks = state.tasks.filter(task => {
    if (task.status !== 'completed' || !task.completedAt) return false;
    if (selectedClient !== 'all' && task.client !== selectedClient) return false;
    
    const compDate = new Date(task.completedAt);
    return compDate.getFullYear().toString() === year && String(compDate.getMonth() + 1).padStart(2, '0') === month;
  });

  // 2. Sum Timecard Hours
  let timecardHours = 0;
  state.timecards.forEach(tc => {
    if (tc.date.startsWith(selectedMonth)) {
      timecardHours += tc.totalHours || 0;
    }
  });

  // 3. NEW: Sum Stopwatch Task Measured seconds for completed tasks
  let stopwatchSeconds = 0;
  completedTasks.forEach(task => {
    stopwatchSeconds += task.spentSeconds || 0;
  });
  const stopwatchHours = stopwatchSeconds / 3600;

  // Combined Total
  const combinedTotalHours = timecardHours + stopwatchHours;
  // 税込金額 = 税別単価 × 1.1（消費税10%）
  const totalAmount = Math.round(completedTasks.reduce((sum, t) => sum + (t.amount || 0) * 1.1, 0));
  const taskCount = completedTasks.length;

  // Render KPI values
  animateCounter(document.getElementById('report-total-count'), taskCount);
  animateCounter(document.getElementById('report-total-amount'), totalAmount, true);
  
  // Show Combined Total Hours
  const hoursEl = document.getElementById('report-total-hours');
  if (hoursEl) {
    animateCounter(hoursEl, Math.round(combinedTotalHours * 10) / 10, false, true);
  }

  // Update detailed breakdown stats in details section if elements exist
  const cardHoursBreakdown = document.getElementById('report-hours-breakdown');
  if (cardHoursBreakdown) {
    cardHoursBreakdown.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem; border-top:1px solid var(--border-color); padding-top:0.5rem;">
        <div style="display:flex; justify-content:space-between;">
          <span>・タイムカード労働合計:</span>
          <span><strong>${timecardHours.toFixed(1)} 時間</strong></span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>・タスクタイマー計測合計:</span>
          <span><strong>${stopwatchHours.toFixed(2)} 時間</strong> (${formatSecondsToHHMMSS(stopwatchSeconds)})</span>
        </div>
      </div>
    `;
  }

  // Render Table
  const tableBody = document.getElementById('report-table-body');
  tableBody.innerHTML = '';

  if (completedTasks.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          指定された条件に一致する完了タスクはありません。
        </td>
      </tr>
    `;
    return;
  }

  // Render client breakdown chart
  renderClientBreakdown(completedTasks, selectedMonth);
  // Render time comparison & work-type analysis
  renderTimeComparison(completedTasks);
  renderWorkTypeAnalysis(completedTasks);
  renderWorkTypeRevenue(completedTasks);
  renderEstimationGuide();

  completedTasks.forEach(task => {
    const taxExcl = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(task.amount || 0);
    const taxIncl = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round((task.amount || 0) * 1.1));
    const stopwatchMeta = task.spentSeconds ? `<br><small style="color: var(--secondary); font-weight:700;">⏱️ ${formatSecondsToHHMMSS(task.spentSeconds)} 計測</small>` : '';

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 1rem 0.5rem; font-weight: 600;">
        ${escapeHTML(task.name)}
        ${stopwatchMeta}
      </td>
      <td style="padding: 1rem 0.5rem; color: var(--text-muted);">${escapeHTML(task.client)}</td>
      <td style="padding: 1rem 0.5rem; color: var(--text-muted);">${task.completedAt}</td>
      <td style="padding: 1rem 0.5rem; text-align: right; font-weight: 700; color: var(--secondary);">
        ${taxIncl}
        <br><small style="color: var(--text-muted); font-weight:400;">(税別: ${taxExcl})</small>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}



// ── 業務種別別 売上・実績サマリー（今月フィルター済み） ──────────────────
function renderWorkTypeRevenue(tasks) {
  const section = document.getElementById('work-type-revenue-section');
  const container = document.getElementById('work-type-revenue-table');
  if (!section || !container) return;

  if (tasks.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  // 全タスクを業務種別でグループ（未設定は「未分類」）
  const groups = {};
  tasks.forEach(t => {
    const wt = t.workType || '未分類';
    if (!groups[wt]) groups[wt] = { count: 0, revenue: 0, hours: 0, countMeasured: 0 };
    groups[wt].count++;
    groups[wt].revenue += t.amount || 0;
    if (t.spentSeconds > 0) {
      groups[wt].hours += t.spentSeconds / 3600;
      groups[wt].countMeasured++;
    }
  });

  const entries = Object.entries(groups).sort((a, b) => b[1].revenue - a[1].revenue);
  const totalRev = entries.reduce((s, [, g]) => s + g.revenue, 0);
  const maxRev = Math.max(...entries.map(([, g]) => g.revenue), 1);
  const fmt = v => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round(v));

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.75rem;">
      ${entries.map(([wt, g]) => {
        const revPct = Math.round((g.revenue / maxRev) * 100);
        const sharePct = totalRev > 0 ? Math.round(g.revenue / totalRev * 100) : 0;
        const avgH = g.countMeasured > 0 ? Math.round(g.hours / g.countMeasured * 10) / 10 : null;
        const hourlyRate = avgH > 0 ? Math.round(g.revenue / g.countMeasured / avgH) : null;
        return `
          <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:1rem 1.25rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
              <span style="font-weight:700;font-size:0.95rem;">${escapeHTML(wt)}</span>
              <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
                <span style="font-size:0.8rem;color:var(--text-muted);">${g.count}件</span>
                ${avgH !== null ? `<span style="font-size:0.8rem;color:var(--primary);">⏱ 平均 ${avgH}h</span>` : ''}
                ${hourlyRate ? `<span style="font-size:0.8rem;color:var(--secondary);">時給 ${fmt(hourlyRate)}</span>` : ''}
                <span style="font-size:0.95rem;font-weight:700;color:var(--text-primary);">${fmt(g.revenue * 1.1)}</span>
                <span style="font-size:0.78rem;background:var(--primary-glow);color:var(--primary);padding:2px 8px;border-radius:10px;">${sharePct}%</span>
              </div>
            </div>
            <div style="height:6px;background:var(--border-color);border-radius:4px;overflow:hidden;">
              <div style="width:${revPct}%;height:100%;background:var(--primary);border-radius:4px;transition:width 0.8s ease;"></div>
            </div>
          </div>`;
      }).join('')}
    </div>
    <div style="text-align:right;font-size:0.8rem;color:var(--text-muted);margin-top:0.75rem;">
      合計: ${fmt(totalRev * 1.1)}（税込）
    </div>`;
}

// ── 見積もり参考データ（全期間の完了タスク集計） ────────────────────
function renderEstimationGuide() {
  const section = document.getElementById('estimation-guide-section');
  const container = document.getElementById('estimation-guide-table');
  if (!section || !container) return;

  // 全期間の計測済み完了タスク
  const allMeasured = state.tasks.filter(t => t.status === 'completed' && (t.spentSeconds > 0 || t.estimatedHours > 0) && t.workType);
  if (allMeasured.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const groups = {};
  allMeasured.forEach(t => {
    const wt = t.workType;
    if (!groups[wt]) groups[wt] = { actualHours: [], estHours: [], amounts: [] };
    if (t.spentSeconds > 0) groups[wt].actualHours.push(t.spentSeconds / 3600);
    if (t.estimatedHours > 0) groups[wt].estHours.push(t.estimatedHours);
    if (t.amount > 0) groups[wt].amounts.push(t.amount);
  });

  // デフォルト業務種別を先頭に、残りは件数順
  const defaultTypes = DEFAULT_WORK_TYPES.filter(d => groups[d]);
  const otherTypes = Object.keys(groups).filter(k => !DEFAULT_WORK_TYPES.includes(k)).sort((a, b) => groups[b].actualHours.length - groups[a].actualHours.length);
  const orderedTypes = [...defaultTypes, ...otherTypes];

  const avg = arr => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length*10)/10 : null;
  const min = arr => arr.length ? Math.round(Math.min(...arr)*10)/10 : null;
  const max = arr => arr.length ? Math.round(Math.max(...arr)*10)/10 : null;
  const fmt = v => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round(v));

  const rows = orderedTypes.map(wt => {
    const g = groups[wt];
    const n = g.actualHours.length;
    const avgA = avg(g.actualHours);
    const minA = min(g.actualHours);
    const maxA = max(g.actualHours);
    const avgAmt = avg(g.amounts);
    const hourlyRate = avgA > 0 && avgAmt > 0 ? avgAmt / avgA : null;

    // 目安ゲージ（min〜max の範囲表示）
    const maxAllMax = Math.max(...orderedTypes.map(k => max(groups[k].actualHours) || 0), 1);
    const minPct = minA !== null ? Math.round(minA / maxAllMax * 100) : 0;
    const maxPct = maxA !== null ? Math.round(maxA / maxAllMax * 100) : 0;

    return `
      <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:1rem 1.25rem;margin-bottom:0.75rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
          <div>
            <span style="font-weight:700;font-size:0.95rem;">${escapeHTML(wt)}</span>
            <span style="font-size:0.78rem;color:var(--text-muted);margin-left:0.5rem;">${n}件の実績</span>
          </div>
          <div style="display:flex;gap:1.25rem;flex-wrap:wrap;align-items:center;">
            ${avgAmt ? `<div style="text-align:center;"><div style="font-size:0.7rem;color:var(--text-muted);">平均単価</div><div style="font-weight:700;color:var(--secondary);font-size:0.9rem;">${fmt(avgAmt)}</div></div>` : ''}
            ${hourlyRate ? `<div style="text-align:center;"><div style="font-size:0.7rem;color:var(--text-muted);">時給換算</div><div style="font-weight:700;color:var(--primary);font-size:0.9rem;">${fmt(hourlyRate)}/h</div></div>` : ''}
          </div>
        </div>
        ${avgA !== null ? `
        <div style="margin-bottom:0.35rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;">
            <span>実績時間の目安</span>
            <span><strong style="color:var(--text-primary);">${avgA}h</strong> 平均（${minA}h〜${maxA}h）</span>
          </div>
          <div style="position:relative;height:10px;background:var(--border-color);border-radius:6px;overflow:hidden;">
            <div style="position:absolute;left:${minPct}%;width:${maxPct - minPct}%;height:100%;background:var(--primary);opacity:0.35;border-radius:6px;"></div>
            <div style="position:absolute;left:${Math.round(avgA/maxAllMax*100)}%;transform:translateX(-50%);width:3px;height:100%;background:var(--primary);border-radius:2px;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-muted);margin-top:2px;">
            <span>最短 ${minA}h</span><span>平均 ${avgA}h</span><span>最長 ${maxA}h</span>
          </div>
        </div>` : '<div style="font-size:0.82rem;color:var(--text-muted);">タイマー計測データなし</div>'}
      </div>`;
  }).join('');

  container.innerHTML = rows || '<p style="color:var(--text-muted);">業務内容を入力したタスクの計測データがありません。</p>';
}

// ── 予定 vs 実績 振り返り ──────────────────────────────────────────
function renderTimeComparison(tasks) {
  const section = document.getElementById('time-comparison-section');
  const container = document.getElementById('time-comparison-table');
  if (!section || !container) return;

  // タイマー計測があるタスクのみ
  const measured = tasks.filter(t => t.spentSeconds > 0 || t.estimatedHours > 0);
  if (measured.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const rows = measured.map(t => {
    const est = t.estimatedHours || 0;
    const actual = t.spentSeconds ? Math.round(t.spentSeconds / 3600 * 10) / 10 : null;
    const diff = (est > 0 && actual !== null) ? Math.round((actual - est) * 10) / 10 : null;
    const pct = (est > 0 && actual !== null) ? Math.round((actual / est) * 100) : null;

    let barColor = 'var(--success)';
    let diffLabel = '';
    if (diff !== null) {
      if (diff > 0) { barColor = 'var(--danger)'; diffLabel = `<span style="color:var(--danger)">+${diff}h 超過</span>`; }
      else if (diff < 0) { barColor = 'var(--success)'; diffLabel = `<span style="color:var(--success)">${diff}h 節約</span>`; }
      else { diffLabel = '<span style="color:var(--text-muted)">ぴったり</span>'; }
    }

    const barWidth = est > 0 && actual !== null ? Math.min(pct, 200) : 0;
    const barDisplay = est > 0 ? `
      <div style="position:relative;height:6px;background:var(--border-color);border-radius:4px;margin-top:4px;overflow:hidden;">
        <div style="width:${Math.min(barWidth, 100)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.6s;"></div>
        ${pct > 100 ? `<div style="position:absolute;top:0;right:0;width:${Math.min(barWidth-100,100)}%;height:100%;background:var(--danger);opacity:0.5;border-radius:0 4px 4px 0;"></div>` : ''}
      </div>` : '';

    return `
      <tr style="border-bottom:1px solid var(--border-color);">
        <td style="padding:0.75rem 0.5rem;font-weight:600;font-size:0.88rem;">${escapeHTML(t.name)}</td>
        <td style="padding:0.75rem 0.5rem;font-size:0.82rem;color:var(--text-muted);">${escapeHTML(t.workType || '—')}</td>
        <td style="padding:0.75rem 0.5rem;text-align:center;font-size:0.88rem;">${est > 0 ? est + 'h' : '—'}</td>
        <td style="padding:0.75rem 0.5rem;text-align:center;font-size:0.88rem;font-weight:700;">${actual !== null ? actual + 'h' : '—'}</td>
        <td style="padding:0.75rem 0.5rem;font-size:0.82rem;">${diffLabel}${barDisplay}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;min-width:480px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);font-size:0.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;">
            <th style="padding:0.5rem;">タスク名</th>
            <th style="padding:0.5rem;">業務内容</th>
            <th style="padding:0.5rem;text-align:center;">予定</th>
            <th style="padding:0.5rem;text-align:center;">実績</th>
            <th style="padding:0.5rem;">差分</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── 業務内容別 平均時間・単価分析 ─────────────────────────────────
function renderWorkTypeAnalysis(tasks) {
  const section = document.getElementById('work-type-section');
  const container = document.getElementById('work-type-table');
  if (!section || !container) return;

  const withType = tasks.filter(t => t.workType);
  if (withType.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  // 業務内容でグループ化
  const groups = {};
  withType.forEach(t => {
    const wt = t.workType;
    if (!groups[wt]) groups[wt] = { tasks: [], totalEst: 0, totalActual: 0, totalAmount: 0, countMeasured: 0 };
    groups[wt].tasks.push(t);
    groups[wt].totalEst += t.estimatedHours || 0;
    if (t.spentSeconds > 0) {
      groups[wt].totalActual += t.spentSeconds / 3600;
      groups[wt].countMeasured++;
    }
    groups[wt].totalAmount += t.amount || 0;
  });

  const rows = Object.entries(groups)
    .sort((a, b) => b[1].tasks.length - a[1].tasks.length)
    .map(([wt, g]) => {
      const count = g.tasks.length;
      const avgEst = g.totalEst > 0 ? Math.round(g.totalEst / count * 10) / 10 : null;
      const avgActual = g.countMeasured > 0 ? Math.round(g.totalActual / g.countMeasured * 10) / 10 : null;
      const avgAmount = count > 0 ? Math.round(g.totalAmount / count) : 0;
      const hourlyRate = avgActual > 0 && avgAmount > 0
        ? Math.round(avgAmount / avgActual)
        : (avgEst > 0 && avgAmount > 0 ? Math.round(avgAmount / avgEst) : null);

      const fmt = v => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(v);

      return `
        <tr style="border-bottom:1px solid var(--border-color);">
          <td style="padding:0.85rem 0.5rem;font-weight:700;font-size:0.9rem;">${escapeHTML(wt)}</td>
          <td style="padding:0.85rem 0.5rem;text-align:center;">${count}件</td>
          <td style="padding:0.85rem 0.5rem;text-align:center;">${avgEst !== null ? avgEst + 'h' : '—'}</td>
          <td style="padding:0.85rem 0.5rem;text-align:center;font-weight:700;color:var(--primary);">${avgActual !== null ? avgActual + 'h' : '—'}</td>
          <td style="padding:0.85rem 0.5rem;text-align:right;">${fmt(avgAmount)}</td>
          <td style="padding:0.85rem 0.5rem;text-align:right;font-weight:700;color:var(--secondary);">${hourlyRate ? fmt(hourlyRate) + '/h' : '—'}</td>
        </tr>`;
    }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;min-width:520px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);font-size:0.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;">
            <th style="padding:0.5rem;">業務内容</th>
            <th style="padding:0.5rem;text-align:center;">件数</th>
            <th style="padding:0.5rem;text-align:center;">平均予定</th>
            <th style="padding:0.5rem;text-align:center;">平均実績</th>
            <th style="padding:0.5rem;text-align:right;">平均単価</th>
            <th style="padding:0.5rem;text-align:right;">時給換算</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.75rem;">
        ※ 時給換算は「平均単価 ÷ 平均実績時間」で算出（実績未計測の場合は予定時間で算出）
      </p>
    </div>`;
}

function renderClientBreakdown(completedTasks, selectedMonth) {
  const section = document.getElementById('client-breakdown-section');
  const chart = document.getElementById('client-breakdown-chart');
  if (!section || !chart) return;

  if (completedTasks.length === 0) {
    section.style.display = 'none';
    return;
  }

  // Group by client
  const clientMap = {};
  completedTasks.forEach(task => {
    const c = task.client || '未設定';
    if (!clientMap[c]) clientMap[c] = { hours: 0, amount: 0, count: 0 };
    clientMap[c].hours += (task.spentSeconds || 0) / 3600;
    clientMap[c].amount += task.amount || 0;
    clientMap[c].count++;
  });

  // Also add timecard hours for the month (distribute equally if multiple clients)
  // We keep timecard separate in the summary card and only show task-based hours here

  const clients = Object.entries(clientMap).sort((a, b) => b[1].amount - a[1].amount);
  const maxAmount = Math.max(...clients.map(([, v]) => v.amount), 1);

  chart.innerHTML = clients.map(([name, data]) => {
    const barPct = Math.max(4, (data.amount / maxAmount) * 100);
    const amountStr = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round(data.amount * 1.1));
    const hoursStr = data.hours > 0 ? `${data.hours.toFixed(1)}h` : `${data.count}件`;
    return `
      <div class="client-bar-row">
        <div class="client-bar-name">${escapeHTML(name)}</div>
        <div class="client-bar-track">
          <div class="client-bar-fill" style="width:${barPct}%"></div>
        </div>
        <div class="client-bar-meta">
          <span class="client-bar-hours">${hoursStr}</span>
          <span class="client-bar-amount">${amountStr}</span>
        </div>
      </div>
    `;
  }).join('');

  section.style.display = 'block';
}

function renderTrendChart() {
  const canvas = document.getElementById('trend-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  canvas.width = W;
  canvas.height = 120;

  // Gather last 6 months
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const hours = months.map(m => {
    return state.timecards
      .filter(tc => tc.date.startsWith(m))
      .reduce((s, tc) => s + (tc.totalHours || 0), 0);
  });

  const maxH = Math.max(...hours, 1);
  const padL = 36, padR = 16, padT = 12, padB = 32;
  const chartW = W - padL - padR;
  const chartH = 120 - padT - padB;

  // Background
  ctx.clearRect(0, 0, W, 120);

  // Grid lines
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#7b7390' : '#9b9997';
  const lineColor = '#5b4cf5';

  [0, 0.5, 1].forEach(frac => {
    const y = padT + chartH * (1 - frac);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxH * frac) + 'h', padL - 4, y + 4);
  });

  // Area fill
  ctx.beginPath();
  months.forEach((m, i) => {
    const x = padL + (i / (months.length - 1)) * chartW;
    const y = padT + chartH * (1 - hours[i] / maxH);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(padL + chartW, padT + chartH);
  ctx.lineTo(padL, padT + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(91,76,245,0.18)');
  grad.addColorStop(1, 'rgba(91,76,245,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  months.forEach((m, i) => {
    const x = padL + (i / (months.length - 1)) * chartW;
    const y = padT + chartH * (1 - hours[i] / maxH);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots + labels
  months.forEach((m, i) => {
    const x = padL + (i / (months.length - 1)) * chartW;
    const y = padT + chartH * (1 - hours[i] / maxH);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.strokeStyle = isDark ? '#1a1625' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Month label
    ctx.fillStyle = textColor;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.slice(5) + '月', x, padT + chartH + 16);
    // Value label
    if (hours[i] > 0) {
      ctx.fillStyle = lineColor;
      ctx.font = '10px sans-serif';
      ctx.fillText(hours[i].toFixed(1) + 'h', x, y - 8);
    }
  });
}

function animateCounter(element, targetValue, isCurrency = false, isFloat = false) {
  let start = 0;
  const duration = 400;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = progress * (2 - progress);
    
    let currentValue = start + (targetValue - start) * easeProgress;

    if (isCurrency) {
      element.textContent = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round(currentValue));
    } else if (isFloat) {
      element.textContent = `${currentValue.toFixed(1)} 時間`;
    } else {
      element.textContent = Math.round(currentValue);
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

// ----------------------------------------------------------------------------
// CONFETTI PHYSICS SYSTEM (GRAVITY CANVAS EFFECT)
// ----------------------------------------------------------------------------
let confettiParticles = [];
let confettiCtx = null;
let confettiAnimationId = null;

function triggerConfettiParticles() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;

  confettiCtx = canvas.getContext('2d');
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  confettiParticles = [];
  const colors = ['#818cf8', '#2dd4bf', '#34d399', '#f87171', '#fbbf24', '#c084fc'];
  
  for (let i = 0; i < 90; i++) {
    confettiParticles.push({
      x: window.innerWidth / 2,
      y: window.innerHeight + 10,
      size: Math.random() * 8 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      angle: Math.random() * Math.PI * 0.4 + Math.PI * 1.3,
      speed: Math.random() * 12 + 15,
      gravity: 0.45,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: Math.random() * 0.1 - 0.05,
      opacity: 1,
      drag: 0.96
    });
  }

  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  updateConfettiCanvas();
}

function updateConfettiCanvas() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas || confettiParticles.length === 0) return;

  confettiCtx.clearRect(0, 0, canvas.width, canvas.height);

  confettiParticles.forEach((p, idx) => {
    p.speed *= p.drag;
    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed + p.gravity;
    p.rotation += p.rotationSpeed;
    
    if (p.y > canvas.height * 0.75) {
      p.opacity -= 0.02;
    }

    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rotation);
    confettiCtx.fillStyle = p.color;
    confettiCtx.globalAlpha = Math.max(p.opacity, 0);
    
    confettiCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    confettiCtx.restore();

    if (p.opacity <= 0 || p.y > canvas.height + 20) {
      confettiParticles.splice(idx, 1);
    }
  });

  if (confettiParticles.length > 0) {
    confettiAnimationId = requestAnimationFrame(updateConfettiCanvas);
  } else {
    confettiCtx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ----------------------------------------------------------------------------
// TOAST MOTIVATIONAL NOTIFICATION
// ----------------------------------------------------------------------------
let toastTimer = null;

function showMotivatorToast(message, emoji = '✨') {
  const toast = document.getElementById('motivator-toast');
  if (!toast) return;

  document.getElementById('toast-icon').textContent = emoji;
  document.getElementById('toast-text').textContent = message;

  toast.classList.add('active');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('active');
  }, 4500);
}

// ----------------------------------------------------------------------------
// CLIENT PROGRESS-SHARING (100% SECURE & SERVERLESS)
// ----------------------------------------------------------------------------
function detectShareLink() {
  const urlParams = new URLSearchParams(window.location.search);
  const shareData = urlParams.get('share');
  
  if (shareData) {
    try {
      const decodedJson = atob(shareData);
      const payload = JSON.parse(decodedJson);
      enterSharedViewMode(payload);
    } catch (e) {
      console.error('Failed to parse share link:', e);
      alert('無効な共有リンクです。');
    }
  }
}

function enterSharedViewMode(payload) {
  const appContainer = document.querySelector('.app-container');
  if (appContainer) appContainer.style.display = 'none';
  
  let sharedDiv = document.getElementById('shared-view-screen');
  if (!sharedDiv) {
    sharedDiv = document.createElement('div');
    sharedDiv.id = 'shared-view-screen';
    sharedDiv.className = 'shared-view-container';
    document.body.appendChild(sharedDiv);
  }
  
  sharedDiv.style.display = 'flex';

  if (payload.type === 'single-task') {
    renderSharedSingleTask(payload.data, sharedDiv);
  } else if (payload.type === 'client-tasks') {
    renderSharedClientTasks(payload.client, payload.data, sharedDiv);
  }
}

function renderSharedSingleTask(task, container) {
  const isNotStarted = task.status === 'not-started';
  const isInProgress = task.status === 'in-progress';
  const isCompleted = task.status === 'completed';

  container.innerHTML = `
    <div class="shared-card">
      <div class="shared-logo-header">
        <svg style="width: 32px; height: 32px; stroke: var(--primary); fill: none; stroke-width: 2.5;" viewBox="0 0 24 24">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span style="font-family:'Outfit'; font-weight:800; font-size:1.2rem;">進捗確認ダッシュボード</span>
      </div>
      
      <div style="border-bottom:1px solid var(--border-color); padding-bottom:1rem; text-align:center;">
        <h2 style="font-size:1.5rem; margin-bottom:0.5rem; color:var(--text-main);">${escapeHTML(task.name)}</h2>
        <span class="task-badge ${task.status}">${statusToJapanese(task.status)}</span>
      </div>

      <div class="shared-status-timeline">
        <div class="shared-timeline-step ${isNotStarted || isInProgress || isCompleted ? 'completed' : ''}">1</div>
        <div class="shared-timeline-step ${isInProgress ? 'active' : ''} ${isCompleted ? 'completed' : ''}">2</div>
        <div class="shared-timeline-step ${isCompleted ? 'completed' : ''}">3</div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); font-weight:700; margin-top:-1rem; padding: 0 0.25rem;">
        <span>未着手</span>
        <span style="margin-left: -5px;">進行中</span>
        <span>完了</span>
      </div>

      <div style="display:flex; flex-direction:column; gap:1rem; background-color:var(--bg-dark); padding:1.25rem; border-radius:var(--radius-md); border:1px solid var(--glass-border);">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700; display:block; text-transform:uppercase;">クライアント名</span>
          <span style="font-weight:600;">${escapeHTML(task.client)}</span>
        </div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700; display:block; text-transform:uppercase;">詳細メモ</span>
          <p style="font-size:0.95rem; color:var(--text-main); white-space:pre-line;">${escapeHTML(task.details || '詳細はありません。')}</p>
        </div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700; display:block; text-transform:uppercase;">納期・期日</span>
          <span style="font-weight:700; color:var(--primary);">${task.dueDate}</span>
        </div>
      </div>

      <div style="text-align:center; font-size:0.75rem; color:var(--text-muted);">
        この進捗リンクは安全に共有されています。金額や勤怠などの機密情報は含まれていません。
      </div>
    </div>
  `;
}

function renderSharedClientTasks(clientName, tasks, container) {
  let tasksHtml = '';
  
  if (tasks.length === 0) {
    tasksHtml = `
      <div style="text-align:center; padding:2rem; color:var(--text-muted);">
        進捗中のプロジェクトはありません。
      </div>
    `;
  } else {
    tasks.forEach(task => {
      tasksHtml += `
        <div style="padding:1rem; background-color:var(--bg-dark); border-radius:var(--radius-md); border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h4 style="font-size:1.05rem; margin-bottom:0.25rem;">${escapeHTML(task.name)}</h4>
            <span style="font-size:0.8rem; color:var(--text-muted);">期日: ${task.dueDate}</span>
          </div>
          <span class="task-badge ${task.status}">${statusToJapanese(task.status)}</span>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <div class="shared-card" style="max-width: 600px;">
      <div class="shared-logo-header">
        <svg style="width: 32px; height: 32px; stroke: var(--primary); fill: none; stroke-width: 2.5;" viewBox="0 0 24 24">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span style="font-family:'Outfit'; font-weight:800; font-size:1.2rem;">進捗確認ダッシュボード</span>
      </div>

      <div style="border-bottom:1px solid var(--border-color); padding-bottom:1rem; text-align:center;">
        <span style="font-size:0.8rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; display:block;">CLIENT</span>
        <h2 style="font-size:1.5rem; color:var(--text-main);">${escapeHTML(clientName)} 様</h2>
      </div>

      <div style="display:flex; flex-direction:column; gap:1rem; max-height:40vh; overflow-y:auto; padding-right:5px;">
        <span style="font-size:0.8rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">タスク進捗一覧</span>
        ${tasksHtml}
      </div>

      <div style="text-align:center; font-size:0.75rem; color:var(--text-muted); border-top:1px solid var(--border-color); padding-top:1rem;">
        この進捗リンクは安全に共有されています。金額や勤怠などの機密情報は含まれていません。
      </div>
    </div>
  `;
}

function generateSingleTaskShareLink() {
  if (!state.editingTaskId) return;
  const task = state.tasks.find(t => t.id === state.editingTaskId);
  if (!task) return;

  const sharePayload = {
    type: 'single-task',
    data: {
      name: task.name,
      details: task.details,
      dueDate: task.dueDate,
      client: task.client,
      status: task.status
    }
  };

  const shareUrl = buildShareUrl(sharePayload);
  copyToClipboard(shareUrl, 'このタスクの共有リンクをコピーしました！');
}

function generateClientShareLink() {
  if (!state.editingTaskId) return;
  const task = state.tasks.find(t => t.id === state.editingTaskId);
  if (!task) return;

  const clientName = task.client;
  const clientTasks = state.tasks
    .filter(t => t.client === clientName)
    .map(t => ({
      name: t.name,
      dueDate: t.dueDate,
      status: t.status
    }));

  const sharePayload = {
    type: 'client-tasks',
    client: clientName,
    data: clientTasks
  };

  const shareUrl = buildShareUrl(sharePayload);
  copyToClipboard(shareUrl, `${clientName}様の全タスク共有リンクをコピーしました！`);
}

function buildShareUrl(payload) {
  const jsonStr = JSON.stringify(payload);
  const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
  return window.location.origin + window.location.pathname + '?share=' + base64;
}

function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => {
    alert(successMsg);
  }).catch(err => {
    window.prompt('コピーするには下のリンクを選択してください:', text);
  });
}

function statusToJapanese(status) {
  switch (status) {
    case 'not-started': return '未着手';
    case 'in-progress': return '進行中';
    case 'revision': return '修正中';
    case 'completed': return '完了';
    default: return status || '';
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ----------------------------------------------------------------------------
// GOOGLE CALENDAR SYNC INTEGRATION
// ----------------------------------------------------------------------------
function saveGoogleClientId() {
  const clientId = document.getElementById('google-client-id-input').value.trim();
  if (clientId) {
    state.googleClientId = clientId;
    localStorage.setItem('googleClientId', clientId);
    alert('Google Client IDを保存しました！');
    renderGoogleStatusUI();
  } else {
    alert('有効なClient IDを入力してください。');
  }
}

function renderGoogleStatusUI() {
  const statusEl = document.getElementById('google-status-container');
  if (state.googleAccessToken) {
    statusEl.innerHTML = `
      <div class="google-connected-badge">
        <svg style="width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:2.5;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
        Googleカレンダー連携中
      </div>
    `;
  } else if (state.googleClientId) {
    statusEl.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">Client ID保存済み。接続ボタンを押して認証してください。</span>`;
  } else {
    statusEl.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">未接続</span>`;
  }
}

function connectGoogleCalendar() {
  if (!state.googleClientId) {
    alert('まずSettingsでGoogle Client IDを入力し保存してください。');
    return;
  }

  if (typeof google === 'undefined') {
    alert('Google APIクライアントの読み込みに失敗しました。インターネット接続と、広告ブロッカーの設定を確認してください。');
    return;
  }

  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: state.googleClientId,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          state.googleAccessToken = tokenResponse.access_token;
          alert('Googleカレンダーに正常に接続されました！');
          renderGoogleStatusUI();
          bulkSyncTasksToGoogle();
        }
      }
    });
    client.requestAccessToken();
  } catch (err) {
    console.error('Google auth error:', err);
    alert('認証開始中にエラーが発生しました: ' + err.message);
  }
}

function googleCalendarSync(task, action) {
  if (!state.googleAccessToken) return;

  const calendarId = 'primary';
  const headers = {
    'Authorization': `Bearer ${state.googleAccessToken}`,
    'Content-Type': 'application/json'
  };

  const eventBody = {
    'summary': `[タスク] ${task.name} (${task.client})`,
    'description': `${task.details || ''}\n\n[Status]: ${statusToJapanese(task.status)}\n[Amount]: ￥${task.amount.toLocaleString()}`,
    'start': { 'date': task.dueDate },
    'end': { 'date': task.dueDate }
  };

  if (action === 'create') {
    fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(eventBody)
    })
    .then(res => res.json())
    .then(data => {
      if (data.id) {
        task.googleEventId = data.id;
        saveTasksToStorage();
      }
    })
    .catch(err => console.error('Error Google sync:', err));
  } else if (action === 'update' && task.googleEventId) {
    fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${task.googleEventId}`, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify(eventBody)
    })
    .catch(err => console.error('Error Google update:', err));
  } else if (action === 'delete' && task.googleEventId) {
    fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${task.googleEventId}`, {
      method: 'DELETE',
      headers: headers
    })
    .catch(err => console.error('Error Google delete:', err));
  }
}

function bulkSyncTasksToGoogle() {
  state.tasks.forEach(task => {
    if (!task.googleEventId) {
      googleCalendarSync(task, 'create');
    }
  });
}

// ============================================================
// NEW FEATURES v50: deals / contacts / goals / expenses / ideas
// ============================================================

// ---- Storage helpers ----
function saveDeals()    { try { localStorage.setItem('deals',    JSON.stringify(state.deals));    } catch(e){} }
function saveContacts() { try { localStorage.setItem('contacts', JSON.stringify(state.contacts)); } catch(e){} }
function saveGoals()    { try { localStorage.setItem('goals',    JSON.stringify(state.goals));    } catch(e){} }
function saveExpenses() { try { localStorage.setItem('expenses', JSON.stringify(state.expenses)); } catch(e){} }
function saveIdeas()    { try { localStorage.setItem('ideas',    JSON.stringify(state.ideas));    } catch(e){} }

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ---- More Drawer ----
function openMoreDrawer() {
  document.getElementById('more-drawer').classList.add('open');
  document.getElementById('more-drawer-overlay').classList.add('open');
  document.body.classList.add('drawer-open');
}
function closeMoreDrawer() {
  document.getElementById('more-drawer').classList.remove('open');
  document.getElementById('more-drawer-overlay').classList.remove('open');
  document.body.classList.remove('drawer-open');
}

// ============================================================
// 💼 DEALS — 案件パイプライン
// ============================================================
const DEAL_STAGES = [
  { key: 'lead',        label: 'リード',  color: '#64748b', emoji: '🌱' },
  { key: 'negotiation', label: '商談中',  color: '#0ea5e9', emoji: '💬' },
  { key: 'proposal',    label: '提案中',  color: '#f59e0b', emoji: '📝' },
  { key: 'won',         label: '受注',    color: '#16a34a', emoji: '🎉' },
];

function renderDeals() {
  renderDealStats();
  renderDealKanban();
}

function renderDealStats() {
  const el = document.getElementById('deals-pipeline-stats');
  if (!el) return;
  const active = state.deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const won    = state.deals.filter(d => d.stage === 'won');
  const pipeline = active.reduce((s,d) => s + (d.amount||0) * (d.probability||50)/100, 0);
  const wonAmt   = won.reduce((s,d) => s + (d.amount||0), 0);
  el.innerHTML = `
    <div class="deal-stat-card">
      <div class="deal-stat-label">パイプライン総額</div>
      <div class="deal-stat-value" style="color:var(--primary)">¥${pipeline.toLocaleString()}</div>
      <div class="deal-stat-sub">期待値（確度込み）</div>
    </div>
    <div class="deal-stat-card">
      <div class="deal-stat-label">進行中案件</div>
      <div class="deal-stat-value">${active.length} 件</div>
      <div class="deal-stat-sub">リード〜提案</div>
    </div>
    <div class="deal-stat-card">
      <div class="deal-stat-label">受注済み</div>
      <div class="deal-stat-value" style="color:var(--success)">¥${wonAmt.toLocaleString()}</div>
      <div class="deal-stat-sub">${won.length} 件</div>
    </div>`;
}

function renderDealKanban() {
  const el = document.getElementById('deals-kanban');
  if (!el) return;
  el.innerHTML = DEAL_STAGES.map(stage => {
    const cards = state.deals.filter(d => d.stage === stage.key);
    const total = cards.reduce((s,d) => s + (d.amount||0), 0);
    return `
      <div class="kanban-col">
        <div class="kanban-col-header">
          <span>${stage.emoji} ${stage.label}</span>
          <span class="kanban-count">${cards.length}</span>
        </div>
        ${total > 0 ? `<div class="kanban-total">¥${total.toLocaleString()}</div>` : ''}
        <div class="kanban-cards" id="kanban-${stage.key}">
          ${cards.map(d => renderDealCard(d)).join('')}
        </div>
        <button class="kanban-add-btn" onclick="openDealModal(null,'${stage.key}')">+ 追加</button>
      </div>`;
  }).join('');
}

function renderDealCard(d) {
  const stage = DEAL_STAGES.find(s => s.key === d.stage);
  const prob = d.probability || 50;
  const overdue = d.dueDate && d.dueDate < getLocalDateStr() && d.stage !== 'won';
  return `
    <div class="kanban-card ${overdue?'overdue':''}" onclick="openDealModal('${d.id}')">
      <div class="kanban-card-title">${escHtml(d.title)}</div>
      ${d.client ? `<div class="kanban-card-client">🏢 ${escHtml(d.client)}</div>` : ''}
      ${d.amount ? `<div class="kanban-card-amount">¥${d.amount.toLocaleString()}</div>` : ''}
      <div class="kanban-card-footer">
        <div class="prob-bar"><div class="prob-fill" style="width:${prob}%;background:${stage?.color}"></div></div>
        <span class="prob-val">${prob}%</span>
        ${d.dueDate ? `<span class="kanban-due ${overdue?'overdue':''}">${overdue?'⚠️ ':''}${d.dueDate.slice(5)}</span>` : ''}
      </div>
    </div>`;
}

function openDealModal(id = null, defaultStage = 'lead') {
  const deal = id ? state.deals.find(d => d.id === id) : null;
  const contactOptions = state.contacts.map(c =>
    `<option value="${c.id}" ${deal?.contactId===c.id?'selected':''}>${escHtml(c.name)}${c.company?' ('+escHtml(c.company)+')':''}</option>`
  ).join('');
  const stageOptions = DEAL_STAGES.map(s =>
    `<option value="${s.key}" ${(deal?.stage||defaultStage)===s.key?'selected':''}>${s.emoji} ${s.label}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'deal-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">${deal ? '案件を編集' : '新しい案件'}</h2>
        <button class="close-btn" onclick="closeDealModal()">✕</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="deal-edit-id" value="${deal?.id||''}">
        <div class="form-group">
          <label class="form-label">案件名 <span style="color:var(--danger)">*</span></label>
          <input type="text" id="deal-title" class="form-input" placeholder="例: LP制作" value="${escHtml(deal?.title||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">クライアント名</label>
          <input type="text" id="deal-client" class="form-input" placeholder="会社名・個人名" value="${escHtml(deal?.client||'')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">ステージ</label>
            <select id="deal-stage" class="form-input">${stageOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">確度 (%)</label>
            <input type="number" id="deal-probability" class="form-input" min="0" max="100" value="${deal?.probability||50}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">金額 (税抜)</label>
            <input type="number" id="deal-amount" class="form-input" placeholder="0" value="${deal?.amount||''}">
          </div>
          <div class="form-group">
            <label class="form-label">期限</label>
            <input type="date" id="deal-due" class="form-input" value="${deal?.dueDate||''}">
          </div>
        </div>
        ${contactOptions ? `<div class="form-group"><label class="form-label">コンタクト紐付け</label><select id="deal-contact" class="form-input"><option value="">なし</option>${contactOptions}</select></div>` : ''}
        <div class="form-group">
          <label class="form-label">メモ</label>
          <textarea id="deal-notes" class="form-input" rows="3" placeholder="商談内容・次のアクションなど">${escHtml(deal?.notes||'')}</textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <div>
          ${deal ? `<button class="btn btn-danger" onclick="deleteDeal('${deal.id}')">削除</button>` : ''}
          ${deal && deal.stage === 'won' ? `<button class="btn btn-secondary" onclick="convertDealToTask('${deal.id}')">📋 タスクに変換</button>` : ''}
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button class="btn btn-secondary" onclick="closeDealModal()">キャンセル</button>
          <button class="btn btn-primary" onclick="saveDeal()">保存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  setTimeout(() => document.getElementById('deal-title')?.focus(), 100);
}

function closeDealModal() {
  const el = document.getElementById('deal-modal-overlay');
  if (el) el.remove();
  const sy = state._scrollY || 0;
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, sy);
}

function saveDeal() {
  const title = document.getElementById('deal-title').value.trim();
  if (!title) { document.getElementById('deal-title').focus(); return; }
  const id = document.getElementById('deal-edit-id').value;
  const deal = {
    id: id || genId(),
    title,
    client: document.getElementById('deal-client').value.trim(),
    stage: document.getElementById('deal-stage').value,
    probability: parseInt(document.getElementById('deal-probability').value)||50,
    amount: parseFloat(document.getElementById('deal-amount').value)||0,
    dueDate: document.getElementById('deal-due').value||'',
    contactId: document.getElementById('deal-contact')?.value||'',
    notes: document.getElementById('deal-notes').value.trim(),
    createdAt: id ? (state.deals.find(d=>d.id===id)?.createdAt || getLocalDateStr()) : getLocalDateStr(),
    updatedAt: getLocalDateStr()
  };
  if (id) {
    const idx = state.deals.findIndex(d => d.id === id);
    if (idx >= 0) state.deals[idx] = deal;
  } else {
    state.deals.push(deal);
  }
  saveDeals();
  closeDealModal();
  renderDeals();
  renderDashboard(); // update dashboard pipeline widget
}

function deleteDeal(id) {
  if (!confirm('この案件を削除しますか？')) return;
  state.deals = state.deals.filter(d => d.id !== id);
  saveDeals();
  closeDealModal();
  renderDeals();
}

function convertDealToTask(dealId) {
  const deal = state.deals.find(d => d.id === dealId);
  if (!deal) return;
  const task = {
    id: genId(),
    name: deal.title,
    details: deal.notes || '',
    dueDate: deal.dueDate || getLocalDateStr(),
    originalDueDate: deal.dueDate || getLocalDateStr(),
    client: deal.client || '',
    amount: deal.amount || 0,
    status: 'not-started',
    completedAt: null,
    dependsOnTaskId: null,
    isDeadlineFixed: !!deal.dueDate,
    spentSeconds: 0
  };
  state.tasks.push(task);
  saveTasksToStorage();
  closeDealModal();
  alert(`タスク「${deal.title}」を追加しました。`);
}

// ============================================================
// 👤 CONTACTS — コンタクト管理
// ============================================================
const CONTACT_TAGS = [
  { key: 'all',      label: 'すべて' },
  { key: 'prospect', label: '見込み客', color: '#7c6af5' },
  { key: 'partner',  label: '協力者',   color: '#0ea5e9' },
  { key: 'mentor',   label: 'メンター', color: '#f59e0b' },
  { key: 'other',    label: 'その他',   color: '#64748b' },
];

function renderContacts() {
  renderContactFilters();
  renderContactList();
}

function renderContactFilters() {
  const el = document.getElementById('contacts-filters');
  if (!el) return;
  el.innerHTML = CONTACT_TAGS.map(t =>
    `<button class="tag-filter-btn ${state.contactsFilter===t.key?'active':''}" onclick="setContactFilter('${t.key}')">${t.label}</button>`
  ).join('');
}

function setContactFilter(f) {
  state.contactsFilter = f;
  renderContacts();
}

function renderContactList() {
  const el = document.getElementById('contacts-list');
  if (!el) return;
  const today = getLocalDateStr();
  let list = state.contacts;
  if (state.contactsFilter !== 'all') list = list.filter(c => c.tag === state.contactsFilter);
  // Sort: follow-up overdue first, then by followUpDate
  list = [...list].sort((a,b) => {
    const aOver = a.followUpDate && a.followUpDate <= today;
    const bOver = b.followUpDate && b.followUpDate <= today;
    if (aOver && !bOver) return -1;
    if (!aOver && bOver) return 1;
    return (a.followUpDate||'9999') < (b.followUpDate||'9999') ? -1 : 1;
  });

  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👤</div><div class="empty-state-title">コンタクトがまだいません</div><div class="empty-state-body">名刺交換した方や出会った方を登録しましょう</div><button class="btn btn-primary empty-state-action" onclick="openContactModal()">最初のコンタクトを追加</button></div>`;
    return;
  }

  el.innerHTML = list.map(c => {
    const tag = CONTACT_TAGS.find(t => t.key === c.tag);
    const overdue = c.followUpDate && c.followUpDate <= today;
    const soon = c.followUpDate && c.followUpDate > today && c.followUpDate <= addDays(today, 3);
    return `
      <div class="contact-card" onclick="openContactModal('${c.id}')">
        <div class="contact-avatar">${c.name.charAt(0)}</div>
        <div class="contact-info">
          <div class="contact-name">${escHtml(c.name)}</div>
          ${c.company ? `<div class="contact-company">🏢 ${escHtml(c.company)}</div>` : ''}
          ${c.metAt ? `<div class="contact-meta">📍 ${escHtml(c.metAt)}</div>` : ''}
        </div>
        <div class="contact-right">
          ${tag && tag.key !== 'all' ? `<span class="contact-tag" style="background:${tag.color}22;color:${tag.color}">${tag.label}</span>` : ''}
          ${c.followUpDate ? `<div class="contact-followup ${overdue?'overdue':soon?'soon':''}">${overdue?'⚠️ ':soon?'⏰ ':'📅 '}${c.followUpDate.slice(5)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}

function openContactModal(id = null) {
  const c = id ? state.contacts.find(x => x.id === id) : null;
  const tagOptions = CONTACT_TAGS.filter(t=>t.key!=='all').map(t =>
    `<option value="${t.key}" ${(c?.tag||'other')===t.key?'selected':''}>${t.label}</option>`
  ).join('');
  const dealOptions = state.deals.map(d =>
    `<option value="${d.id}" ${c?.linkedDealId===d.id?'selected':''}>${escHtml(d.title)}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'contact-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">${c ? 'コンタクトを編集' : '新しいコンタクト'}</h2>
        <button class="close-btn" onclick="closeContactModal()">✕</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="contact-edit-id" value="${c?.id||''}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">お名前 <span style="color:var(--danger)">*</span></label>
            <input type="text" id="contact-name" class="form-input" placeholder="山田 太郎" value="${escHtml(c?.name||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">会社名</label>
            <input type="text" id="contact-company" class="form-input" placeholder="株式会社〇〇" value="${escHtml(c?.company||'')}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">タグ</label>
            <select id="contact-tag" class="form-input">${tagOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">出会った日</label>
            <input type="date" id="contact-met-date" class="form-input" value="${c?.metDate||''}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">出会った場所・きっかけ</label>
          <input type="text" id="contact-met-at" class="form-input" placeholder="〇〇交流会、SNSなど" value="${escHtml(c?.metAt||'')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">メール</label>
            <input type="email" id="contact-email" class="form-input" value="${escHtml(c?.email||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">電話番号</label>
            <input type="tel" id="contact-phone" class="form-input" value="${escHtml(c?.phone||'')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">フォロー期日 <span style="font-size:0.8em;color:var(--text-muted)">（この日までに連絡する）</span></label>
          <input type="date" id="contact-followup" class="form-input" value="${c?.followUpDate||''}">
        </div>
        ${dealOptions ? `<div class="form-group"><label class="form-label">紐付け案件</label><select id="contact-deal" class="form-input"><option value="">なし</option>${dealOptions}</select></div>` : ''}
        <div class="form-group">
          <label class="form-label">メモ</label>
          <textarea id="contact-notes" class="form-input" rows="3" placeholder="共通の話題、次回話したいことなど">${escHtml(c?.notes||'')}</textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        ${c ? `<button class="btn btn-danger" onclick="deleteContact('${c.id}')">削除</button>` : '<div></div>'}
        <div style="display:flex;gap:0.75rem;">
          <button class="btn btn-secondary" onclick="closeContactModal()">キャンセル</button>
          <button class="btn btn-primary" onclick="saveContact()">保存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  setTimeout(() => document.getElementById('contact-name')?.focus(), 100);
}

function closeContactModal() {
  const el = document.getElementById('contact-modal-overlay');
  if (el) el.remove();
  const sy = state._scrollY || 0;
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, sy);
}

function saveContact() {
  const name = document.getElementById('contact-name').value.trim();
  if (!name) { document.getElementById('contact-name').focus(); return; }
  const id = document.getElementById('contact-edit-id').value;
  const contact = {
    id: id || genId(),
    name,
    company: document.getElementById('contact-company').value.trim(),
    tag: document.getElementById('contact-tag').value,
    metDate: document.getElementById('contact-met-date').value,
    metAt: document.getElementById('contact-met-at').value.trim(),
    email: document.getElementById('contact-email').value.trim(),
    phone: document.getElementById('contact-phone').value.trim(),
    followUpDate: document.getElementById('contact-followup').value,
    linkedDealId: document.getElementById('contact-deal')?.value||'',
    notes: document.getElementById('contact-notes').value.trim(),
    createdAt: id ? (state.contacts.find(c=>c.id===id)?.createdAt||getLocalDateStr()) : getLocalDateStr()
  };
  if (id) {
    const idx = state.contacts.findIndex(c => c.id === id);
    if (idx >= 0) state.contacts[idx] = contact;
  } else {
    state.contacts.push(contact);
  }
  saveContacts();
  closeContactModal();
  renderContacts();
}

function deleteContact(id) {
  if (!confirm('このコンタクトを削除しますか？')) return;
  state.contacts = state.contacts.filter(c => c.id !== id);
  saveContacts();
  closeContactModal();
  renderContacts();
}

// ============================================================
// 🎯 GOALS — 目標管理
// ============================================================
function renderGoals() {
  const el = document.getElementById('goals-content');
  if (!el) return;
  const today = getLocalDateStr();
  const thisMonth = today.slice(0,7);
  // Actual revenue this month
  const actualRevenue = state.tasks
    .filter(t => t.status === 'completed' && t.completedAt && t.completedAt.startsWith(thisMonth))
    .reduce((s,t) => s + (t.amount||0), 0);
  // Pipeline expected this month
  const pipelineRevenue = state.deals
    .filter(d => d.stage !== 'won' && (!d.dueDate || d.dueDate.startsWith(thisMonth)))
    .reduce((s,d) => s + (d.amount||0) * (d.probability||50)/100, 0);
  // Learning hours this month (ideas with 学習 tag... or we just track total ideas)
  const wonDeals = state.deals.filter(d => d.stage === 'won').length;
  const gRev = state.goals.monthlyRevenue || 0;
  const gLearn = state.goals.monthlyLearningHours || 0;
  const gClients = state.goals.monthlyClientCount || 0;

  function gauge(val, max, color) {
    const pct = max > 0 ? Math.min(100, Math.round(val/max*100)) : 0;
    return `<div class="goal-gauge-track"><div class="goal-gauge-fill" style="width:${pct}%;background:${color}"></div></div><span class="goal-gauge-pct">${pct}%</span>`;
  }

  el.innerHTML = `
    <div class="goals-grid">
      <div class="goal-card">
        <div class="goal-card-header">
          <span class="goal-icon">💰</span>
          <span class="goal-title">月収目標</span>
          <button class="goal-edit-btn" onclick="openGoalSettingModal()">⚙️ 設定</button>
        </div>
        <div class="goal-target">目標: ¥${gRev.toLocaleString()}</div>
        <div class="goal-progress-row">
          <div class="goal-actual">確定: <strong style="color:var(--success)">¥${actualRevenue.toLocaleString()}</strong></div>
          <div class="goal-pipeline">見込み: <strong style="color:var(--primary)">+¥${Math.round(pipelineRevenue).toLocaleString()}</strong></div>
        </div>
        ${gauge(actualRevenue + pipelineRevenue, gRev, 'var(--primary)')}
        ${gRev > 0 ? `<div class="goal-note">あと ¥${Math.max(0,gRev - actualRevenue).toLocaleString()} で達成</div>` : ''}
      </div>

      <div class="goal-card">
        <div class="goal-card-header">
          <span class="goal-icon">🤝</span>
          <span class="goal-title">受注件数目標</span>
        </div>
        <div class="goal-target">目標: ${gClients} 件/月</div>
        <div class="goal-progress-row">
          <div class="goal-actual">受注済み: <strong style="color:var(--success)">${wonDeals} 件</strong></div>
        </div>
        ${gauge(wonDeals, gClients, 'var(--secondary)')}
      </div>

      <div class="goal-card goal-card-wide">
        <div class="goal-card-header">
          <span class="goal-icon">📚</span>
          <span class="goal-title">学習・インプット目標</span>
        </div>
        <div class="goal-target">目標: 月 ${gLearn} 時間</div>
        <div class="goal-note" style="margin-top:0.5rem;color:var(--text-muted)">
          💡 ひらめきメモタブから学習ログを記録できます
        </div>
        <div class="goal-progress-row" style="margin-top:0.75rem;">
          <button class="btn btn-secondary" onclick="switchTab('ideas')">ひらめきメモへ →</button>
        </div>
      </div>
    </div>

    <!-- Goal Setting Form (inline) -->
    <div class="report-card" style="margin-top:1.5rem;" id="goal-settings-card" style="display:none;">
      <h3 style="margin-bottom:1rem;font-size:1.05rem;">⚙️ 目標を設定する</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;">
        <div class="form-group">
          <label class="form-label">月収目標 (円)</label>
          <input type="number" id="goal-monthly-revenue" class="form-input" placeholder="500000" value="${state.goals.monthlyRevenue||''}">
        </div>
        <div class="form-group">
          <label class="form-label">受注件数目標 (件/月)</label>
          <input type="number" id="goal-client-count" class="form-input" placeholder="3" value="${state.goals.monthlyClientCount||''}">
        </div>
        <div class="form-group">
          <label class="form-label">月間学習時間目標 (時間)</label>
          <input type="number" id="goal-learning-hours" class="form-input" placeholder="10" value="${state.goals.monthlyLearningHours||''}">
        </div>
      </div>
      <div style="margin-top:1rem;">
        <button class="btn btn-primary" onclick="saveGoalSettings()">目標を保存</button>
      </div>
    </div>`;
}

function openGoalSettingModal() {
  const card = document.getElementById('goal-settings-card');
  if (!card) return;
  card.style.display = card.style.display === 'none' ? 'block' : 'none';
}

function saveGoalSettings() {
  state.goals.monthlyRevenue = parseFloat(document.getElementById('goal-monthly-revenue').value)||0;
  state.goals.monthlyClientCount = parseInt(document.getElementById('goal-client-count').value)||0;
  state.goals.monthlyLearningHours = parseFloat(document.getElementById('goal-learning-hours').value)||0;
  saveGoals();
  document.getElementById('goal-settings-card').style.display = 'none';
  renderGoals();
}

// ============================================================
// 💴 EXPENSES — 経費管理
// ============================================================
const EXPENSE_CATEGORIES = [
  { key: 'transport',    label: '交通費',     emoji: '🚃', color: '#0ea5e9' },
  { key: 'equipment',    label: '機材・消耗品', emoji: '🖥️', color: '#7c6af5' },
  { key: 'learning',     label: '学習・書籍',  emoji: '📚', color: '#f59e0b' },
  { key: 'subscription', label: 'サブスク',    emoji: '📱', color: '#16a34a' },
  { key: 'meal',         label: '交際費',      emoji: '🍽️', color: '#ef4444' },
  { key: 'other',        label: 'その他',      emoji: '📦', color: '#64748b' },
];

function renderExpenses() {
  const el = document.getElementById('expenses-content');
  if (!el) return;
  const today = getLocalDateStr();
  const thisMonth = today.slice(0,7);
  const monthExpenses = state.expenses.filter(e => e.date && e.date.startsWith(thisMonth));
  const totalExp = monthExpenses.reduce((s,e) => s + (e.amount||0), 0);
  const totalRev = state.tasks
    .filter(t => t.status === 'completed' && t.completedAt && t.completedAt.startsWith(thisMonth))
    .reduce((s,t) => s + (t.amount||0), 0);

  // Category breakdown
  const byCategory = {};
  EXPENSE_CATEGORIES.forEach(c => byCategory[c.key] = 0);
  monthExpenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + (e.amount||0); });

  // Month selector
  const months = [...new Set(state.expenses.map(e => e.date?.slice(0,7)).filter(Boolean))];
  months.sort().reverse();
  const currentMonthLabel = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long'});

  el.innerHTML = `
    <div class="expense-summary-row">
      <div class="expense-summary-card">
        <div class="expense-summary-label">今月の支出</div>
        <div class="expense-summary-value" style="color:var(--danger)">¥${totalExp.toLocaleString()}</div>
      </div>
      <div class="expense-summary-card">
        <div class="expense-summary-label">今月の売上</div>
        <div class="expense-summary-value" style="color:var(--success)">¥${totalRev.toLocaleString()}</div>
      </div>
      <div class="expense-summary-card" style="border-color:var(--primary)">
        <div class="expense-summary-label">実質利益（概算）</div>
        <div class="expense-summary-value" style="color:var(--primary)">¥${(totalRev - totalExp).toLocaleString()}</div>
      </div>
    </div>

    <div class="expense-cat-chart">
      ${EXPENSE_CATEGORIES.map(cat => {
        const amt = byCategory[cat.key]||0;
        if (!amt) return '';
        const pct = totalExp > 0 ? Math.round(amt/totalExp*100) : 0;
        return `<div class="expense-cat-row">
          <span class="expense-cat-emoji">${cat.emoji}</span>
          <span class="expense-cat-label">${cat.label}</span>
          <div class="expense-cat-bar-track"><div class="expense-cat-bar-fill" style="width:${pct}%;background:${cat.color}"></div></div>
          <span class="expense-cat-amt">¥${amt.toLocaleString()}</span>
        </div>`;
      }).join('')}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin:1.25rem 0 0.75rem;">
      <h3 style="font-size:1rem;margin:0;">${currentMonthLabel} の明細</h3>
      <button class="btn btn-secondary" onclick="exportExpensesCSV()" style="font-size:0.8rem;padding:0.4rem 0.75rem;">📥 CSV</button>
    </div>
    <div id="expenses-list">
      ${monthExpenses.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">💴</div><div class="empty-state-title">経費がまだありません</div><button class="btn btn-primary empty-state-action" onclick="openExpenseModal()">経費を追加</button></div>` :
        [...monthExpenses].sort((a,b)=>b.date<a.date?-1:1).map(e => renderExpenseItem(e)).join('')
      }
    </div>`;
}

function renderExpenseItem(e) {
  const cat = EXPENSE_CATEGORIES.find(c => c.key === e.category) || EXPENSE_CATEGORIES.at(-1);
  return `<div class="expense-item" onclick="openExpenseModal('${e.id}')">
    <span class="expense-item-emoji">${cat.emoji}</span>
    <div class="expense-item-info">
      <div class="expense-item-memo">${escHtml(e.memo||cat.label)}</div>
      <div class="expense-item-date">${e.date} · ${cat.label}</div>
    </div>
    <div class="expense-item-amount">¥${(e.amount||0).toLocaleString()}</div>
  </div>`;
}

function openExpenseModal(id = null) {
  const e = id ? state.expenses.find(x => x.id === id) : null;
  const catOptions = EXPENSE_CATEGORIES.map(c =>
    `<option value="${c.key}" ${(e?.category||'other')===c.key?'selected':''}>${c.emoji} ${c.label}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'expense-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2 class="modal-title">${e ? '経費を編集' : '経費を追加'}</h2>
        <button class="close-btn" onclick="closeExpenseModal()">✕</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="expense-edit-id" value="${e?.id||''}">
        <div class="form-group">
          <label class="form-label">カテゴリ</label>
          <select id="expense-category" class="form-input">${catOptions}</select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">金額 (円) <span style="color:var(--danger)">*</span></label>
            <input type="number" id="expense-amount" class="form-input" placeholder="0" value="${e?.amount||''}">
          </div>
          <div class="form-group">
            <label class="form-label">日付</label>
            <input type="date" id="expense-date" class="form-input" value="${e?.date||getLocalDateStr()}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">メモ</label>
          <input type="text" id="expense-memo" class="form-input" placeholder="内容を簡単に" value="${escHtml(e?.memo||'')}">
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        ${e ? `<button class="btn btn-danger" onclick="deleteExpense('${e.id}')">削除</button>` : '<div></div>'}
        <div style="display:flex;gap:0.75rem;">
          <button class="btn btn-secondary" onclick="closeExpenseModal()">キャンセル</button>
          <button class="btn btn-primary" onclick="saveExpense()">保存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  setTimeout(() => document.getElementById('expense-amount')?.focus(), 100);
}

function closeExpenseModal() {
  const el = document.getElementById('expense-modal-overlay');
  if (el) el.remove();
  const sy = state._scrollY || 0;
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, sy);
}

function saveExpense() {
  const amount = parseFloat(document.getElementById('expense-amount').value);
  if (!amount || amount <= 0) { document.getElementById('expense-amount').focus(); return; }
  const id = document.getElementById('expense-edit-id').value;
  const expense = {
    id: id || genId(),
    category: document.getElementById('expense-category').value,
    amount,
    date: document.getElementById('expense-date').value || getLocalDateStr(),
    memo: document.getElementById('expense-memo').value.trim()
  };
  if (id) {
    const idx = state.expenses.findIndex(e => e.id === id);
    if (idx >= 0) state.expenses[idx] = expense;
  } else {
    state.expenses.push(expense);
  }
  saveExpenses();
  closeExpenseModal();
  renderExpenses();
}

function deleteExpense(id) {
  if (!confirm('この経費を削除しますか？')) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveExpenses();
  closeExpenseModal();
  renderExpenses();
}

function exportExpensesCSV() {
  const rows = [['日付','カテゴリ','金額','メモ']];
  const today = getLocalDateStr();
  const thisMonth = today.slice(0,7);
  state.expenses
    .filter(e => e.date?.startsWith(thisMonth))
    .sort((a,b) => a.date < b.date ? -1 : 1)
    .forEach(e => {
      const cat = EXPENSE_CATEGORIES.find(c => c.key === e.category)?.label || e.category;
      rows.push([e.date, cat, e.amount, e.memo||'']);
    });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expenses_${thisMonth}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 🎙️ WHISPER — ローカル音声文字起こし (Transformers.js)
// ============================================================
let _whisperPipeline  = null;
let _whisperLoading   = false;
let _mediaRecorder    = null;
let _audioChunks      = [];

/**
 * @xenova/transformers の pipeline を動的ロード（初回のみモデルDL）
 * モデルは whisper-small (日本語精度良好, ~244MB, ブラウザにキャッシュされる)
 */
async function _loadWhisperModel() {
  if (_whisperPipeline) return _whisperPipeline;
  if (_whisperLoading)  return null; // 二重呼び出し防止
  _whisperLoading = true;
  try {
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
    );
    env.allowLocalModels = false;
    _whisperPipeline = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      { language: 'japanese' }
    );
    return _whisperPipeline;
  } finally {
    _whisperLoading = false;
  }
}

/** 録音した Blob を Float32Array (16kHz) → Whisper で文字起こし */
async function _transcribeBlob(blob, mimeType) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }
  const float32 = decoded.getChannelData(0);
  const pipe = await _loadWhisperModel();
  const result = await pipe(float32, { language: 'japanese', task: 'transcribe' });
  return (result.text || '').trim().replace(/^[。、\s]+/, '');
}

/**
 * 汎用 Whisper 音声入力
 * @param {string}   textareaId  - 結果を追記する textarea の id（省略可）
 * @param {string}   btnId       - マイクボタンの id
 * @param {function} [onResult]  - カスタムコールバック (text) => void
 */
async function startWhisperRecord(textareaId, btnId, onResult) {
  const btn = document.getElementById(btnId);

  // 録音中 → 停止して文字起こし開始
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
    return;
  }

  // マイク取得
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    alert('マイクへのアクセスが拒否されました。\nブラウザのアドレスバー横のマイクアイコンから許可してください。');
    return;
  }

  _audioChunks = [];

  // 対応 mimeType を自動選択
  const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';

  _mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  _mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) _audioChunks.push(e.data); };

  _mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());

    if (btn) { btn.textContent = '⏳'; btn.disabled = true; btn.classList.remove('recording'); }

    const blob = new Blob(_audioChunks, { type: mimeType || 'audio/webm' });
    try {
      if (!_whisperPipeline && btn) {
        btn.title = 'モデルを初回ダウンロード中 (~244MB)…';
      }
      const text = await _transcribeBlob(blob, mimeType);
      if (!text) return;
      if (onResult) {
        onResult(text);
      } else if (textareaId) {
        const ta = document.getElementById(textareaId);
        if (ta) {
          const sep = ta.value && !ta.value.endsWith('\n') ? '\n' : '';
          ta.value += sep + text;
          ta.dispatchEvent(new Event('input',  { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
        }
      }
    } catch (err) {
      console.error('Whisper error:', err);
      alert('文字起こしに失敗しました。\n' + (err.message || err));
    } finally {
      if (btn) { btn.textContent = '🎤'; btn.disabled = false; btn.title = '音声入力'; }
      _mediaRecorder = null;
    }
  };

  _mediaRecorder.start(200); // 200ms ごとにデータ収集
  if (btn) {
    btn.textContent = '⏹';
    btn.classList.add('recording');
    btn.title = '録音中 — もう一度クリックで停止';
  }
}

// ============================================================
// 💡 IDEAS — ひらめきメモ
// ============================================================
let _voiceRecognition = null;
let _ideaVoiceActive  = false;

function renderIdeas() {
  const el = document.getElementById('ideas-content');
  if (!el) return;
  const topIdeas = [...state.ideas].sort((a,b) => (b.count||1)-(a.count||1));

  el.innerHTML = `
    <!-- Quick Input -->
    <div class="idea-input-card">
      <h3 style="font-size:1rem;margin-bottom:0.75rem;">💬 今思っていること・気になること</h3>
      <div class="idea-input-row">
        <input type="text" id="idea-text-input" class="form-input idea-text-field"
          placeholder="思いついたことをそのまま入力..."
          onkeydown="if(event.key==='Enter'){addIdeaFromInput();}"
        >
        <button class="btn idea-voice-btn" id="idea-voice-btn" onclick="toggleVoiceInput()" title="音声入力">
          🎤
        </button>
        <button class="btn btn-primary" onclick="addIdeaFromInput()">記録</button>
      </div>
      <div id="voice-status" class="voice-status" style="display:none;">🔴 録音中... 話しかけてください</div>
    </div>

    <!-- Stats row -->
    ${state.ideas.length > 0 ? `
    <div class="idea-stats-row">
      <div class="idea-stat">💡 合計 <strong>${state.ideas.length}</strong> 件</div>
      <div class="idea-stat">🔥 最多 <strong>${topIdeas[0]?.text?.slice(0,12)||'-'}</strong> (×${topIdeas[0]?.count||1})</div>
    </div>` : ''}

    <!-- Mind Map (if 3+ ideas) -->
    ${state.ideas.length >= 3 ? `
    <div class="report-card" style="margin-bottom:1.25rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h3 style="font-size:1rem;margin:0;">🗺️ マインドマップ</h3>
        <span style="font-size:0.75rem;color:var(--text-muted)">丸の大きさ＝本気度</span>
      </div>
      <div style="overflow-x:auto;">
        ${renderIdeaMindmap(topIdeas.slice(0,8))}
      </div>
    </div>` : ''}

    <!-- Ranked list -->
    <div class="report-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h3 style="font-size:1rem;margin:0;">🔥 本気度ランキング</h3>
      </div>
      ${state.ideas.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">💡</div><div class="empty-state-title">アイデアがまだありません</div><div class="empty-state-body">気になること、やってみたいこと、なんでも入力してみましょう</div></div>` :
        topIdeas.map((idea, i) => renderIdeaRow(idea, i)).join('')
      }
    </div>`;
}

function renderIdeaRow(idea, rank) {
  const maxCount = Math.max(...state.ideas.map(i=>i.count||1));
  const pct = maxCount > 0 ? Math.round((idea.count||1)/maxCount*100) : 0;
  const heat = pct >= 80 ? '🔥🔥' : pct >= 50 ? '🔥' : pct >= 30 ? '✨' : '';
  return `<div class="idea-row">
    <div class="idea-rank">${rank < 3 ? ['🥇','🥈','🥉'][rank] : rank+1}</div>
    <div class="idea-content">
      <div class="idea-text">${escHtml(idea.text)} ${heat}</div>
      <div class="idea-meta">×${idea.count||1} 回 · ${idea.createdAt||''}</div>
    </div>
    <div class="idea-actions">
      <div class="idea-bar-track"><div class="idea-bar-fill" style="width:${pct}%"></div></div>
      <div style="display:flex;gap:0.5rem;margin-top:0.35rem;">
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" onclick="incrementIdea('${idea.id}')" title="もう一度思った">+1</button>
        <button class="btn btn-primary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" onclick="promoteIdeaToDeal('${idea.id}')" title="案件にする">💼</button>
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;color:var(--danger)" onclick="deleteIdea('${idea.id}')">✕</button>
      </div>
    </div>
  </div>`;
}

function renderIdeaMindmap(ideas) {
  const W = 560, H = 260;
  const cx = W/2, cy = H/2;
  const maxCount = Math.max(...ideas.map(i=>i.count||1), 1);
  const nodes = ideas.slice(0,8);
  const n = nodes.length;
  const paths = [];
  const circles = [];
  const texts = [];

  // Center node
  circles.push(`<circle cx="${cx}" cy="${cy}" r="30" fill="var(--primary)" opacity="0.9"/>`);
  texts.push(`<text x="${cx}" y="${cy+4}" text-anchor="middle" fill="white" font-size="11" font-weight="bold">マイ</text>`);

  nodes.forEach((idea, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI/2;
    const r = 95;
    const nx = cx + Math.cos(angle) * r;
    const ny = cy + Math.sin(angle) * r;
    const nodeR = 16 + Math.round((idea.count||1)/maxCount * 18);
    const hue = Math.round((i/n) * 240);
    const col = `hsl(${hue},70%,55%)`;
    const shortText = idea.text.slice(0,8) + (idea.text.length>8?'…':'');
    paths.push(`<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--border-color)" stroke-width="1.5" opacity="0.6"/>`);
    circles.push(`<circle cx="${nx}" cy="${ny}" r="${nodeR}" fill="${col}" opacity="0.85" style="cursor:pointer" onclick="incrementIdea('${idea.id}')"/>`);
    texts.push(`<text x="${nx}" y="${ny+4}" text-anchor="middle" fill="white" font-size="${nodeR>24?10:9}" font-weight="600">${escHtmlSvg(shortText)}</text>`);
    // count badge
    texts.push(`<text x="${nx + nodeR - 4}" y="${ny - nodeR + 8}" text-anchor="middle" fill="var(--text-muted)" font-size="9">×${idea.count||1}</text>`);
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${paths.join('')}${circles.join('')}${texts.join('')}
  </svg>`;
}

function escHtmlSvg(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addIdeaFromInput() {
  const input = document.getElementById('idea-text-input');
  const text = input?.value?.trim();
  if (!text) return;
  addIdea(text);
  input.value = '';
  input.focus();
}

function addIdea(text) {
  if (!text) return;
  // Check for similar existing idea (simple: same text ignoring case/spaces)
  const normalised = text.toLowerCase().replace(/\s+/g,'');
  const existing = state.ideas.find(i => i.text.toLowerCase().replace(/\s+/g,'') === normalised);
  if (existing) {
    existing.count = (existing.count||1) + 1;
    existing.updatedAt = getLocalDateStr();
  } else {
    state.ideas.push({
      id: genId(),
      text,
      count: 1,
      createdAt: getLocalDateStr(),
      updatedAt: getLocalDateStr()
    });
  }
  saveIdeas();
  if (state.activeTab === 'ideas') renderIdeas();
}

function incrementIdea(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea) return;
  idea.count = (idea.count||1) + 1;
  idea.updatedAt = getLocalDateStr();
  saveIdeas();
  renderIdeas();
}

function deleteIdea(id) {
  state.ideas = state.ideas.filter(i => i.id !== id);
  saveIdeas();
  renderIdeas();
}

function promoteIdeaToDeal(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea) return;
  // Pre-fill deal modal with idea text
  openDealModal();
  setTimeout(() => {
    const titleInput = document.getElementById('deal-title');
    if (titleInput) titleInput.value = idea.text;
  }, 50);
  switchTab('deals');
}

function toggleVoiceInput() {
  startVoiceInput();
}

function startVoiceInput() {
  startWhisperRecord('idea-text-input', 'idea-voice-btn', (text) => {
    const input = document.getElementById('idea-text-input');
    if (input) { input.value = text; }
    const status = document.getElementById('voice-status');
    if (status) status.style.display = 'none';
    addIdeaFromInput();
  });
  // 録音開始時に voice-status を表示
  const status = document.getElementById('voice-status');
  if (status) status.textContent = '🔴 録音中 — もう一度 🎤 を押すと停止';
  if (status) status.style.display = 'block';
}

function stopVoiceInput() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
  const status = document.getElementById('voice-status');
  if (status) status.style.display = 'none';
}

// ============================================================
// DASHBOARD additions: pipeline widget + follow-up reminders
// ============================================================
function renderDashboardPipelineWidget() {
  const el = document.getElementById('dashboard-pipeline-widget');
  if (!el) return;
  const active = state.deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const pipeline = active.reduce((s,d) => s + (d.amount||0) * (d.probability||50)/100, 0);
  const today = getLocalDateStr();
  const followUps = state.contacts.filter(c => c.followUpDate && c.followUpDate <= addDays(today, 3));

  el.innerHTML = `
    <div class="dash-widget-row">
      <div class="dash-mini-card" onclick="switchTab('deals')">
        <div style="font-size:0.75rem;color:var(--text-muted)">見込み売上</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--primary)">¥${Math.round(pipeline).toLocaleString()}</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">${active.length}件の案件</div>
      </div>
      ${followUps.length > 0 ? `
      <div class="dash-mini-card" onclick="switchTab('contacts')" style="border-color:var(--warning)">
        <div style="font-size:0.75rem;color:var(--text-muted)">フォロー期限</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--warning)">${followUps.length}件</div>
        <div style="font-size:0.7rem;color:var(--text-muted)">要フォローアップ</div>
      </div>` : ''}
    </div>`;
}

// ============================================================
// DASHBOARD idea quick capture widget
// ============================================================
function renderDashboardIdeaWidget() {
  const el = document.getElementById('dashboard-idea-widget');
  if (!el) return;
  const topIdeas = [...state.ideas].sort((a,b) => (b.count||1)-(a.count||1)).slice(0,3);
  el.innerHTML = `
    <div class="idea-quick-input-row">
      <input type="text" class="form-input" id="dash-idea-input" placeholder="💡 気になったことを一言..."
        onkeydown="if(event.key==='Enter'){addIdeaFromDash();}">
      <button class="btn btn-primary" onclick="addIdeaFromDash()">記録</button>
    </div>
    ${topIdeas.length > 0 ? `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
      ${topIdeas.map(i => `<span class="idea-chip" onclick="incrementIdea('${i.id}')" title="もう一度思った">${escHtml(i.text.slice(0,12))} ×${i.count||1}</span>`).join('')}
    </div>` : ''}`;
}

function addIdeaFromDash() {
  const input = document.getElementById('dash-idea-input');
  const text = input?.value?.trim();
  if (!text) return;
  addIdea(text);
  input.value = '';
  renderDashboardIdeaWidget();
}

// ============================================================
// Patch renderDashboard to inject new widgets
// ============================================================
const _origRenderDashboard = renderDashboard;
renderDashboard = function() {
  _origRenderDashboard();
  // Inject pipeline widget if slot exists
  const pw = document.getElementById('dashboard-pipeline-widget');
  if (pw) renderDashboardPipelineWidget();
  const iw = document.getElementById('dashboard-idea-widget');
  if (iw) renderDashboardIdeaWidget();
};

// HTML injection for dashboard widgets (called once on load)
function injectDashboardWidgets() {
  const summaryCard = document.getElementById('weekly-summary-card');
  if (!summaryCard || document.getElementById('dashboard-pipeline-widget')) return;

  // Pipeline widget — insert after weekly-summary-card
  const pipelineDiv = document.createElement('div');
  pipelineDiv.className = 'report-card';
  pipelineDiv.style.marginBottom = '1.5rem';
  pipelineDiv.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
      <h3 style="font-size:1.05rem;margin:0;">💼 パイプライン &amp; フォロー</h3>
      <button class="btn btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.7rem;" onclick="switchTab('deals')">詳細 →</button>
    </div>
    <div id="dashboard-pipeline-widget"></div>`;
  summaryCard.after(pipelineDiv);

  // Idea quick-capture — append to dashboard grid
  const grid = document.querySelector('#dashboard-screen .dashboard-grid');
  if (grid) {
    const ideaDiv = document.createElement('div');
    ideaDiv.className = 'report-card';
    ideaDiv.style.gridColumn = '1 / -1';
    ideaDiv.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h3 style="font-size:1.05rem;margin:0;">💡 ひらめきメモ</h3>
        <button class="btn btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.7rem;" onclick="switchTab('ideas')">全部見る →</button>
      </div>
      <div id="dashboard-idea-widget"></div>`;
    grid.appendChild(ideaDiv);
  }
}

// Helper
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// 🎯 FOCUS MODE — フォーカスモード v50
// ============================================================

const FOCUS_THEMES = {
  nature:       ['forest', 'mountains', 'lake', 'waterfall', 'flowers'],
  architecture: ['architecture', 'building', 'city', 'interior', 'design'],
  minimal:      ['minimal', 'white', 'clean', 'abstract', 'texture'],
  workspace:    ['desk', 'workspace', 'coffee', 'laptop', 'office'],
  abstract:     ['art', 'abstract', 'colorful', 'geometric', 'pattern']
};

const FOCUS_RADIO_FALLBACKS = {
  lofi:      [{ name:'Lo-Fi Hip Hop Radio', url:'https://streams.ilovemusic.de/iloveradio17.mp3' },
              { name:'ChillHop Radio', url:'https://streams.ilovemusic.de/iloveradio23.mp3' }],
  jazz:      [{ name:'Jazz FM', url:'https://jazz-wr02.ice.infomaniak.ch/jazz-wr02-128.mp3' },
              { name:'Smooth Jazz', url:'https://ice1.somafm.com/smoothjazz-128-mp3' }],
  classical: [{ name:'Classical Radio', url:'https://ice1.somafm.com/seventies-128-mp3' },
              { name:'Baroque FM', url:'https://baroquefm.out.airtime.pro/baroquefm_a' }],
  ambient:   [{ name:'Drone Zone', url:'https://ice1.somafm.com/dronezone-128-mp3' },
              { name:'Space Ambient', url:'https://ice1.somafm.com/spacestation-128-mp3' }],
  pop:       [{ name:'J-Pop Radio', url:'https://streams.ilovemusic.de/iloveradio2.mp3' },
              { name:'Pop Hits', url:'https://streams.ilovemusic.de/iloveradio.mp3' }]
};

let _focusState = {
  active: false,
  bgIndex: 0,
  bgLayer: 'a',       // 'a' or 'b'
  theme: 'nature',
  speed: 60,          // seconds between image changes
  bgTimer: null,
  ringTimer: null,
  taskId: null,
  radioStations: [],
  radioIndex: 0,
  radioPlaying: false
};

// ---- Open / Close ----
function openFocusMode(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  _focusState.taskId = taskId;
  _focusState.active = true;

  const overlay = document.getElementById('focus-overlay');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('active');

  // Task name
  document.getElementById('focus-task-name').textContent = '⚡ ' + task.name;
  document.getElementById('focus-phase-label').textContent = '集中タイム ⚡';

  // Load initial backgrounds
  loadFocusBackground(true);

  // Start bg cycling
  if (_focusState.speed > 0) {
    _focusState.bgTimer = setInterval(() => loadFocusBackground(false), _focusState.speed * 1000);
  }

  // Start ring animation ticker (syncs with timerInterval in main app)
  _focusState.ringTimer = setInterval(() => updateFocusTimer(), 1000);

  // Mountain progress
  updateFocusMountain();

  // Task dots
  renderFocusTaskDots();

  // Load default radio
  loadRadioStations(document.getElementById('focus-radio-genre')?.value || 'lofi');

  // Prevent screen sleep (Wake Lock API)
  requestWakeLock();
}

function closeFocusMode() {
  _focusState.active = false;
  const overlay = document.getElementById('focus-overlay');
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');

  if (_focusState.bgTimer) { clearInterval(_focusState.bgTimer); _focusState.bgTimer = null; }
  if (_focusState.ringTimer) { clearInterval(_focusState.ringTimer); _focusState.ringTimer = null; }

  // Stop radio
  const audio = document.getElementById('focus-audio');
  if (audio) { audio.pause(); audio.src = ''; }
  _focusState.radioPlaying = false;
  const playBtn = document.getElementById('focus-radio-play');
  if (playBtn) playBtn.textContent = '▶';

  // Release wake lock
  releaseWakeLock();
}

function closeFocusModeManual() {
  // Close focus overlay but DON'T stop the timer
  closeFocusMode();
}

// ---- Background image cycling ----
const _loadedBgUrls = new Set();

function loadFocusBackground(immediate) {
  const theme = _focusState.theme;
  const keywords = FOCUS_THEMES[theme] || FOCUS_THEMES.nature;
  const kw = keywords[_focusState.bgIndex % keywords.length];
  _focusState.bgIndex++;

  // Use Picsum for reliable free images + add Unsplash source as hint text
  const seed = Math.floor(Math.random() * 1000);
  const url = `https://picsum.photos/seed/${Date.now() + seed}/1920/1080`;

  const layerIn  = _focusState.bgLayer === 'a' ? 'focus-bg-a' : 'focus-bg-b';
  const layerOut = _focusState.bgLayer === 'a' ? 'focus-bg-b' : 'focus-bg-a';

  // Preload
  const img = new Image();
  img.onload = () => {
    const inEl  = document.getElementById(layerIn);
    const outEl = document.getElementById(layerOut);
    if (!inEl || !outEl) return;
    inEl.style.backgroundImage = `url(${img.src})`;
    if (immediate) {
      inEl.style.opacity = '1';
      outEl.style.opacity = '0';
    } else {
      inEl.style.opacity = '1';
      outEl.style.opacity = '0';
    }
    _focusState.bgLayer = _focusState.bgLayer === 'a' ? 'b' : 'a';
  };
  img.src = url;
}

// ---- Timer ring update ----
function updateFocusTimer() {
  if (!state.activeTimerTaskId) return;
  const elapsed = Math.floor((Date.now() - state.timerStartEpoch) / 1000);
  const total = (state.timerAccumulatedSeconds || 0) + elapsed;

  // Display
  const disp = document.getElementById('focus-timer-display');
  if (disp) disp.textContent = formatSecondsToHHMMSS(total);

  // Ring progress (based on 25-min pomodoro cycle)
  const cycle = 25 * 60;
  const prog = (total % cycle) / cycle;
  const circumference = 339.3;
  const offset = circumference * (1 - prog);
  const ring = document.getElementById('focus-ring-progress');
  if (ring) {
    ring.style.strokeDashoffset = offset.toFixed(1);
    // Colour: start warm, get cool as session progresses
    const hue = Math.round(260 - prog * 80); // purple → blue
    ring.style.stroke = `hsl(${hue}, 80%, 70%)`;
  }

  // Update mountain every 30s
  if (total % 30 === 0) updateFocusMountain();
}

// ---- Mountain SVG ----
function updateFocusMountain() {
  const wrap = document.getElementById('focus-mountain-svg-wrap');
  const pctEl = document.getElementById('focus-mountain-pct');
  if (!wrap) return;

  const today = getLocalDateStr();
  const todayTasks = state.tasks.filter(t => t.dueDate === today || t.completedAt === today);
  const done = todayTasks.filter(t => t.status === 'completed').length;
  const total = Math.max(todayTasks.length, 1);
  const pct = Math.round(done / total * 100);
  if (pctEl) pctEl.textContent = `${pct}%`;

  // Sky color based on time of day
  const h = new Date().getHours();
  let skyTop, skyBot;
  if (h < 5)       { skyTop='#0a0a1a'; skyBot='#1a1a3a'; }
  else if (h < 7)  { skyTop='#1a1464'; skyBot='#f97316'; }
  else if (h < 10) { skyTop='#1e3a8a'; skyBot='#fde68a'; }
  else if (h < 17) { skyTop='#1d4ed8'; skyBot='#93c5fd'; }
  else if (h < 19) { skyTop='#7c3aed'; skyBot='#f97316'; }
  else if (h < 21) { skyTop='#1e1b4b'; skyBot='#c084fc'; }
  else             { skyTop='#0a0a1a'; skyBot='#1e1b4b'; }

  // Climber Y position: 130 (base) → 20 (summit)
  const climberY = Math.round(130 - (pct / 100) * 110);
  // Climber X roughly follows mountain slope
  const climberX = Math.round(75 + (pct / 100) * (-35));

  const atSummit = pct >= 100;
  const stars = h >= 19 || h < 6 ? Array.from({length:8},(_,i)=>{
    const sx=10+i*15+Math.random()*8, sy=5+Math.random()*25;
    return `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="1" fill="white" opacity="${(0.5+Math.random()*0.5).toFixed(2)}"/>`;
  }).join('') : '';

  wrap.innerHTML = `
    <svg viewBox="0 0 150 150" width="90" height="90" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="msky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${skyTop}"/>
          <stop offset="100%" stop-color="${skyBot}"/>
        </linearGradient>
        <linearGradient id="mmtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e2e8f0"/>
          <stop offset="40%" stop-color="#94a3b8"/>
          <stop offset="100%" stop-color="#475569"/>
        </linearGradient>
      </defs>
      <!-- Sky -->
      <rect x="0" y="0" width="150" height="150" fill="url(#msky)"/>
      ${stars}
      <!-- Back mountains -->
      <polygon points="10,150 55,60 100,150" fill="#334155" opacity="0.6"/>
      <polygon points="60,150 110,50 145,150" fill="#1e293b" opacity="0.5"/>
      <!-- Main mountain -->
      <polygon points="0,150 75,20 150,150" fill="url(#mmtn)"/>
      <!-- Snow cap -->
      <polygon points="68,36 75,20 82,36 78,38 72,38" fill="white" opacity="0.9"/>
      <!-- Path dots showing progress -->
      ${Array.from({length:5},(_,i)=>{
        const p=i/4; const py=Math.round(130-p*110); const px=Math.round(75-p*35);
        const filled = pct >= p*100;
        return `<circle cx="${px}" cy="${py}" r="2.5" fill="${filled?'#fde68a':'rgba(255,255,255,0.3)'}"/>`;
      }).join('')}
      <!-- Climber -->
      ${atSummit ? `
        <!-- Summit flag -->
        <line x1="40" y1="20" x2="40" y2="8" stroke="#fde68a" stroke-width="1.5"/>
        <polygon points="40,8 50,12 40,16" fill="#ef4444"/>
        <text x="75" y="135" text-anchor="middle" font-size="22">🧗</text>
        <text x="75" y="148" text-anchor="middle" font-size="7" fill="#fde68a" font-weight="bold">SUMMIT! 🎉</text>
      ` : `
        <text x="${climberX}" y="${climberY+8}" text-anchor="middle" font-size="14">🧗</text>
      `}
      <!-- Base label -->
      ${!atSummit ? `<text x="75" y="148" text-anchor="middle" font-size="6.5" fill="rgba(255,255,255,0.6)">${done}/${total} タスク完了</text>` : ''}
    </svg>`;
}

// ---- Task dots ----
function renderFocusTaskDots() {
  const el = document.getElementById('focus-task-dots');
  if (!el) return;
  const today = getLocalDateStr();
  const todayTasks = state.tasks.filter(t => t.dueDate === today || t.completedAt === today).slice(0, 12);
  el.innerHTML = todayTasks.map((t, i) => {
    const cls = t.status === 'completed' ? 'done' : (t.id === _focusState.taskId ? 'active' : '');
    return `<div class="focus-task-dot ${cls}" title="${t.name}"></div>`;
  }).join('');
}

// ---- Radio ----
async function loadRadioStations(genre) {
  const statusEl = document.getElementById('focus-radio-status');
  const listEl = document.getElementById('focus-radio-stations');
  if (statusEl) statusEl.textContent = '読み込み中...';
  if (listEl) listEl.innerHTML = '';

  // Try Radio Browser API
  try {
    const query = encodeURIComponent(genre === 'lofi' ? 'chill' : genre);
    const url = `https://de1.api.radio-browser.info/json/stations/search?tag=${query}&limit=15&order=votes&reverse=true&hidebroken=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const valid = data.filter(s => s.url_resolved && s.name).slice(0, 8);
      if (valid.length > 0) {
        _focusState.radioStations = valid.map(s => ({ name: s.name, url: s.url_resolved }));
        renderRadioStationList();
        if (statusEl) statusEl.textContent = `${valid.length}局見つかりました`;
        return;
      }
    }
  } catch(e) { /* fall through to fallback */ }

  // Fallback to hardcoded stations
  _focusState.radioStations = FOCUS_RADIO_FALLBACKS[genre] || FOCUS_RADIO_FALLBACKS.lofi;
  renderRadioStationList();
  if (statusEl) statusEl.textContent = 'フォールバック局を使用中';
}

function renderRadioStationList() {
  const el = document.getElementById('focus-radio-stations');
  if (!el) return;
  el.innerHTML = _focusState.radioStations.map((s, i) =>
    `<div class="focus-station-item ${i === _focusState.radioIndex && _focusState.radioPlaying ? 'playing' : ''}"
      onclick="playRadioStation(${i})">${s.name}</div>`
  ).join('');
}

function playRadioStation(idx) {
  _focusState.radioIndex = idx;
  const station = _focusState.radioStations[idx];
  if (!station) return;
  const audio = document.getElementById('focus-audio');
  if (!audio) return;
  const statusEl = document.getElementById('focus-radio-status');
  const playBtn = document.getElementById('focus-radio-play');

  audio.pause();
  audio.src = station.url;
  audio.volume = parseFloat(document.getElementById('focus-volume')?.value || 0.5);

  const playPromise = audio.play();
  if (playPromise) {
    playPromise.then(() => {
      _focusState.radioPlaying = true;
      if (playBtn) playBtn.textContent = '⏸';
      if (statusEl) statusEl.textContent = '▶ ' + station.name;
      renderRadioStationList();
    }).catch(() => {
      if (statusEl) statusEl.textContent = '❌ 再生できませんでした';
      _focusState.radioPlaying = false;
    });
  }
}

function focusRadioToggle() {
  const audio = document.getElementById('focus-audio');
  const playBtn = document.getElementById('focus-radio-play');
  if (!audio) return;
  if (_focusState.radioPlaying) {
    audio.pause();
    _focusState.radioPlaying = false;
    if (playBtn) playBtn.textContent = '▶';
  } else {
    if (!audio.src || audio.src === window.location.href) {
      playRadioStation(_focusState.radioIndex);
    } else {
      audio.play().then(() => {
        _focusState.radioPlaying = true;
        if (playBtn) playBtn.textContent = '⏸';
      }).catch(() => {});
    }
  }
}

function focusRadioPrev() {
  const n = _focusState.radioStations.length;
  if (!n) return;
  playRadioStation((_focusState.radioIndex - 1 + n) % n);
}
function focusRadioNext() {
  const n = _focusState.radioStations.length;
  if (!n) return;
  playRadioStation((_focusState.radioIndex + 1) % n);
}
function setFocusVolume(v) {
  const audio = document.getElementById('focus-audio');
  if (audio) audio.volume = parseFloat(v);
}

// ---- Focus settings callbacks ----
function toggleFocusSettings() {
  const panel = document.getElementById('focus-settings-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function changeFocusTheme(theme) {
  _focusState.theme = theme;
  _focusState.bgIndex = 0;
  if (_focusState.bgTimer) { clearInterval(_focusState.bgTimer); _focusState.bgTimer = null; }
  loadFocusBackground(true);
  if (_focusState.speed > 0) {
    _focusState.bgTimer = setInterval(() => loadFocusBackground(false), _focusState.speed * 1000);
  }
}

function changeFocusSpeed(val) {
  _focusState.speed = parseInt(val);
  if (_focusState.bgTimer) { clearInterval(_focusState.bgTimer); _focusState.bgTimer = null; }
  if (_focusState.speed > 0) {
    _focusState.bgTimer = setInterval(() => loadFocusBackground(false), _focusState.speed * 1000);
  }
}

function toggleFocusFullscreen() {
  const el = document.getElementById('focus-overlay');
  const btn = document.getElementById('focus-fullscreen-btn');
  if (!document.fullscreenElement) {
    el.requestFullscreen?.().then(() => { if (btn) btn.textContent = '⛶'; }).catch(() => {});
  } else {
    document.exitFullscreen?.();
    if (btn) btn.textContent = '⛶';
  }
}

// ---- Wake Lock ----
let _wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      _wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch(e) {}
}
function releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}

// ---- Hook into existing startTaskTimer / pauseTaskTimer ----
// Use assignment (not function declaration) to avoid hoisting conflict
const _origStartTaskTimer = startTaskTimer;
startTaskTimer = function(taskId) {
  _origStartTaskTimer(taskId);
  // Small delay so timer state is fully set
  setTimeout(() => {
    if (state.activeTimerTaskId && !_focusState.active) {
      openFocusMode(state.activeTimerTaskId);
    }
  }, 300);
};

const _origPauseTaskTimer = pauseTaskTimer;
pauseTaskTimer = function() {
  _origPauseTaskTimer();
  if (_focusState.active) closeFocusMode();
};
