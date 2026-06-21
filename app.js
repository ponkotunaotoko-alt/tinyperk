
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
  else { setAuthError(''); showToastSuccess('確認メールを送りました。メール内のリンクをクリックして認証を完了してください。\n※メールが届かない場合はSpamフォルダを確認してください。'); }
}

let _authLogoutInProgress = false;
async function authLogout() {
  if (_authLogoutInProgress) return;
  _authLogoutInProgress = true;
  const btn = document.querySelector('[onclick*="authLogout"]');
  if (btn) btn.disabled = true;
  try {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    localStorage.clear();
    location.reload();
  } catch(e) {
    console.error('[TINYPERK] authLogout error:', e);
    showToastError('ログアウトに失敗しました。再度お試しください。');
    _authLogoutInProgress = false;
    if (btn) btn.disabled = false;
  }
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

let _forcePullInProgress = false;
async function forcePullNow() {
  if (_forcePullInProgress) return;
  _forcePullInProgress = true;
  const btn = document.getElementById('btn-force-pull');
  if (btn) btn.disabled = true;
  showSyncStatus('クラウドから取得中...', 10000);
  try {
    const sb = getSupabase();
    const { data } = sb ? await sb.auth.getUser() : { data: null };
    if (!data?.user) { showSyncStatus('❌ ログインされていません'); return; }
    await syncFromSupabase(data.user.id);
    renderApp();
    showSyncStatus('✅ 最新データを取得しました');
  } catch(e) {
    console.error('[TINYPERK] forcePullNow error:', e);
    showSyncStatus('❌ 取得失敗');
    showToastError('クラウドからの取得に失敗しました: ' + (e.message || '不明なエラー'));
  } finally {
    _forcePullInProgress = false;
    if (btn) btn.disabled = false;
  }
}

let _forceSyncInProgress = false;
async function forceSyncNow() {
  if (_forceSyncInProgress) return;
  _forceSyncInProgress = true;
  const btn = document.getElementById('btn-force-sync');
  if (btn) btn.disabled = true;
  showSyncStatus('同期中...', 10000);
  try {
    await syncToSupabase();
    showSyncStatus('✅ 同期完了');
  } catch(e) {
    console.error('[TINYPERK] forceSyncNow error:', e);
    showSyncStatus('❌ 同期失敗');
    showToastError('同期に失敗しました: ' + (e.message || '不明なエラー'));
  } finally {
    _forceSyncInProgress = false;
    if (btn) btn.disabled = false;
  }
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
  if (!sb) { console.warn('[SYNC] Supabase not initialized'); return; }
  try {
    const { data, error } = await sb.from('user_data').select('*').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found (first time)
      console.warn('[SYNC] load error:', error.message);
      return;
    }
    if (!data) return; // First time user, no data yet

    if (Array.isArray(data.tasks))     { state.tasks = data.tasks; saveTasksToStorage(); }
    if (Array.isArray(data.timecards)) { state.timecards = data.timecards; saveTimecardsToStorage(); }
    if (data.journal_entries && typeof data.journal_entries === 'object') {
      state.journalEntries = data.journal_entries; saveJournalToStorage();
    }
    if (data.business_info && typeof data.business_info === 'object' && Object.keys(data.business_info).length) {
      state.businessInfo = { ...state.businessInfo, ...data.business_info };
      localStorage.setItem('businessInfo', JSON.stringify(state.businessInfo));
    }
    if (data.client_templates && typeof data.client_templates === 'object' && Object.keys(data.client_templates).length) {
      state.clientTemplates = data.client_templates;
      saveClientTemplatesToStorage();
    }
    if (data.extra_data && typeof data.extra_data === 'object') {
      const ex = data.extra_data;
      if (Array.isArray(ex.contacts))     { state.contacts = ex.contacts; saveContacts(); }
      if (Array.isArray(ex.deals))        { state.deals = ex.deals; saveDeals(); }
      if (Array.isArray(ex.expenses))     { state.expenses = ex.expenses; saveExpenses(); }
      if (Array.isArray(ex.ideas))        { state.ideas = ex.ideas; saveIdeas(); }
      if (Array.isArray(ex.learningLogs)) { state.learningLogs = ex.learningLogs; saveLearningLogs(); }
      if (Array.isArray(ex.projects))     { state.projects = ex.projects; saveProjectsToStorage(); }
      if (ex.goals && typeof ex.goals === 'object') { state.goals = ex.goals; saveGoals(); }
    }
    showSyncStatus('☁️ データを同期しました');
  } catch(e) {
    console.error('[SYNC] syncFromSupabase error:', e);
    showSyncStatus('❌ 読込み失敗');
  }
}

// Push state to Supabase
let _syncToSupabaseInProgress = false;
async function syncToSupabase() {
  const sb = getSupabase();
  if (!sb) return;
  if (_syncToSupabaseInProgress) return;
  _syncToSupabaseInProgress = true;
  try {
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError || !authData?.user) { _syncToSupabaseInProgress = false; return; }
    const user = authData.user;

    const payload = {
      user_id: user.id,
      tasks: state.tasks,
      timecards: state.timecards,
      journal_entries: state.journalEntries,
      business_info: state.businessInfo,
      client_templates: state.clientTemplates,
      extra_data: {
        contacts: state.contacts,
        deals: state.deals,
        expenses: state.expenses,
        ideas: state.ideas,
        learningLogs: state.learningLogs,
        projects: state.projects,
        goals: state.goals
      }
    };

    const { error } = await sb.from('user_data').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.warn('[SYNC] save error:', error.message);
      showSyncStatus('❌ 保存失敗');
    } else {
      showSyncStatus('☁️ 保存済み');
    }
  } catch(e) {
    console.error('[SYNC] syncToSupabase exception:', e);
    showSyncStatus('❌ 保存失敗');
  } finally {
    _syncToSupabaseInProgress = false;
  }
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
  activeTab: 'dashboard',
  weeklyOffset: 0,  // 0=今週, -1=先週 ... // default to dashboard
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
  completedMonthFilter: '', // 'YYYY-MM' or '' (= current month)
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

  // NEW: Learning logs
  learningLogs: [],

  // Contacts filter
  contactsFilter: 'all',

  // Projects (B案: タスクをグループ化するプロジェクト)
  projects: []
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
// ─── メモ画面タブ切替（ひらめき / 目標） ────────────────────────────
function switchMemoTab(which) {
  const ideasSec = document.getElementById('memo-ideas-section');
  const goalsSec = document.getElementById('memo-goals-section');
  const tabIdeas = document.getElementById('memo-tab-ideas');
  const tabGoals = document.getElementById('memo-tab-goals');
  if (!ideasSec || !goalsSec) return;

  if (which === 'goals') {
    ideasSec.style.display = 'none';
    goalsSec.style.display = '';
    tabIdeas?.classList.remove('active');
    tabGoals?.classList.add('active');
    renderGoals();
  } else {
    goalsSec.style.display = 'none';
    ideasSec.style.display = '';
    tabGoals?.classList.remove('active');
    tabIdeas?.classList.add('active');
    renderIdeas();
  }
}

// ─── showToast — alert() 代替（全アプリ共通） ──────────────────────────────
function showToast(msg, type = 'info', duration = 3200) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  clearTimeout(el._timer);
  el.className = 'app-toast app-toast--' + type;
  el.textContent = msg;
  el.classList.add('visible');
  el._timer = setTimeout(() => el.classList.remove('visible'), duration);
}

function showToastError(msg)   { showToast(msg, 'error', 4000); }
function showToastSuccess(msg) { showToast(msg, 'success', 2800); }
function showToastInfo(msg)    { showToast(msg, 'info', 3200); }


// ─── キーボード自動閉じ（iOS PWA対応） ──────────────────────────────────
document.addEventListener('touchend', (e) => {
  if (!e.target.closest('input, textarea, select, [contenteditable]')) {
    if (document.activeElement && 
        (document.activeElement.tagName === 'INPUT' ||
         document.activeElement.tagName === 'TEXTAREA' ||
         document.activeElement.tagName === 'SELECT')) {
      document.activeElement.blur();
    }
  }
}, { passive: true });

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
    // 他端末での更新を取り込むため、アプリに復帰した（タブ/PWAがフォアグラウンドに戻った）タイミングで
    // クラウドから最新データを自動取得する（例: スマホで編集→PCに切り替えた直後など）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      _sb.auth.getUser().then(({ data }) => {
        if (data?.user) syncFromSupabase(data.user.id).then(() => renderApp());
      });
    });
  }
});

// Load data from localStorage
// Safe helper: parse localStorage value as array (returns null if missing/invalid)
function _safeParseArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch(e) {
    console.warn('[TINYPERK] localStorage parse error for key "' + key + '":', e);
    return null;
  }
}

function loadLocalStorage() {
  state.tasks = _safeParseArray('tasks');

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
  state.timecards = _safeParseArray('timecards');

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
  state.deals = _safeParseArray('deals') || [];

  // NEW: コンタクトデータ
  state.contacts = _safeParseArray('contacts') || [];

  // NEW: 目標データ
  try {
    const d = localStorage.getItem('goals');
    if (d) {
      const parsed = JSON.parse(d);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        state.goals = { ...state.goals, ...parsed };
      }
    }
  } catch(e) { console.warn('[TINYPERK] goals parse error:', e); }

  // NEW: 経費データ
  state.expenses = _safeParseArray('expenses') || [];

  // NEW: ひらめきメモ
  state.ideas = _safeParseArray('ideas') || [];

  // NEW: 学習ログ
  state.learningLogs = _safeParseArray('learningLogs') || [];

  // プロジェクト
  state.projects = _safeParseArray('projects') || [];
}

function saveClientTemplatesToStorage() {
  try { localStorage.setItem('clientTemplates', JSON.stringify(state.clientTemplates)); }
  catch(e) { console.error('[TINYPERK] saveClientTemplatesToStorage error:', e); }
  scheduleSyncToSupabase();
}

function saveJournalToStorage() {
  try { localStorage.setItem('journalEntries', JSON.stringify(state.journalEntries)); }
  catch(e) { console.error('[TINYPERK] saveJournalToStorage error:', e); }
  scheduleSyncToSupabase();
}

function saveTasksToStorage() {
  try { localStorage.setItem('tasks', JSON.stringify(state.tasks)); }
  catch(e) { console.error('[TINYPERK] saveTasksToStorage error:', e); }
  scheduleSyncToSupabase();
}

function saveProjectsToStorage() {
  try { localStorage.setItem('projects', JSON.stringify(state.projects)); }
  catch(e) { console.error('[TINYPERK] saveProjectsToStorage error:', e); }
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
    showToastInfo('日程未定のタスクがありません。\nタスクを作成・編集するとき「日程未定」にチェックを入れてください。');
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
    showToastInfo('日程未定のタスクはありません。\nタスク作成時に「日程未定」にチェックを入れてください。');
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
    if (!client) { showToastError('クライアント名を入力してください。'); return; }
    if (!body) { showToastError('テンプレート本文を入力してください。'); return; }
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
    const monthRow = document.getElementById('tasks-month-filter-row');
    if (monthRow) monthRow.style.display = state.taskListFilter === 'completed' ? 'flex' : 'none';
    if (state.taskListFilter === 'completed') buildMonthFilterOptions();
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

  // Clock In / Out は index.html の onclick 属性で呼ぶ（二重登録を防ぐため addEventListener は使わない）

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
  // ステータスラジオ変更時に自動保存 + 入金ステータスの表示切替
  document.querySelectorAll('input[name="task-status"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const id = document.getElementById('task-id').value;
      if (id) autoSaveTask(); // 編集時のみ自動保存
      // 完了時のみ入金ステータスフィールドを表示
      const pgEl = document.getElementById('payment-status-group');
      if (pgEl) pgEl.style.display = radio.value === 'completed' ? 'block' : 'none';
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

  // ノルマ日・完成予定日 → バッファヒント更新
  const dueDateInput    = document.getElementById('task-due-date');
  const targetDateInput = document.getElementById('task-target-date');
  if (dueDateInput)    dueDateInput.addEventListener('change', _updateBufferHint);
  if (targetDateInput) targetDateInput.addEventListener('change', _updateBufferHint);

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

// ─── 完了タスク 月次フィルター ────────────────────────────────────────
function buildMonthFilterOptions() {
  const sel = document.getElementById('tasks-month-select');
  if (!sel) return;
  // 完了タスクが存在する月一覧を収集
  const months = new Set();
  state.tasks.filter(t => t.status === 'completed').forEach(t => {
    const d = t.completedAt || t.dueDate || '';
    if (d.length >= 7) months.add(d.slice(0,7));
  });
  const currentMonth = getLocalDateStr().slice(0,7);
  months.add(currentMonth); // 今月は常に含む
  const sorted = [...months].sort().reverse(); // 新しい月が先頭
  sel.innerHTML = sorted.map(m => {
    const [y, mo] = m.split('-');
    const label = `${y}年${parseInt(mo)}月`;
    return `<option value="${m}">${label}</option>`;
  }).join('');
  // デフォルト = state.completedMonthFilter or 今月
  const target = state.completedMonthFilter || currentMonth;
  sel.value = months.has(target) ? target : sorted[0];
  state.completedMonthFilter = sel.value;
}

function onTaskMonthChange(val) {
  state.completedMonthFilter = val;
  renderTaskList();
}

function switchTab(tab) {
  state.activeTab = tab;

  // タブタイトル更新（App Store / PWA品質）
  const _tabTitles = {
    dashboard:'TINYPERK — ホーム', tasks:'TINYPERK — タスク',
    journal:'TINYPERK — 日誌',   deals:'TINYPERK — 案件',
    reports:'TINYPERK — レポート', expenses:'TINYPERK — 経費',
    memo:'TINYPERK — メモ',       calendar:'TINYPERK — カレンダー',
    settings:'TINYPERK — 設定',   weekly:'TINYPERK — 週次',
  };
  document.title = _tabTitles[tab] || 'TINYPERK';

  // ページ切替時に最上部へスクロール
  const _mc = document.querySelector('.main-content');
  if (_mc) _mc.scrollTop = 0;
  window.scrollTo(0, 0);

  // その他セクション: 対象タブなら自動展開
  const _moreTabs = ['memo','expenses','deals','calendar','reports','settings'];
  const _moreSection = document.getElementById('sidebar-more-section');
  const _moreBtn = document.getElementById('sidebar-more-btn');
  if (_moreSection && _moreBtn) {
    if (_moreTabs.includes(tab)) {
      _moreSection.style.display = 'block';
      _moreBtn.setAttribute('aria-expanded','true');
    }
  }
  
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tab) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // goals/ideas/contacts は memo にリダイレクト
  if (tab === 'goals' || tab === 'ideas') {
    tab = 'memo';
    state.activeTab = 'memo';
    if (tab === 'goals') setTimeout(() => switchMemoTab('goals'), 0);
  }
  if (tab === 'contacts') { tab = 'memo'; state.activeTab = 'memo'; }

  document.querySelectorAll('.screen').forEach(screen => {
    if (screen.id === tab + '-screen') {
      screen.classList.add('active');
      screen.style.display = '';
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
    loadClaudeApiKeyStatus();
    loadGeminiApiKeyStatus();
    loadWordPressConfigStatus();
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
  } else if (tab === 'memo') {
    renderIdeas();
    renderGoals();
  } else if (tab === 'expenses') {
    renderExpenses();
  } else if (tab === 'ideas') {
    renderIdeas();
  } else if (tab === 'weekly') {
    renderWeeklyReport();
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
  // 型ガード: 壊れたlocalStorageからロードした場合の保険
  if (!Array.isArray(state.tasks))       state.tasks = [];
  if (!Array.isArray(state.timecards))   state.timecards = [];
  if (!Array.isArray(state.deals))       state.deals = [];
  if (!Array.isArray(state.contacts))    state.contacts = [];
  if (!Array.isArray(state.expenses))    state.expenses = [];
  if (!Array.isArray(state.ideas))       state.ideas = [];
  if (!Array.isArray(state.learningLogs)) state.learningLogs = [];
  if (!Array.isArray(state.projects))    state.projects = [];

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
  // 今週の月〜日を計算（月曜始まり）
  const today = new Date();
  const todayStr = getLocalDateStr();
  const dow = today.getDay(); // 0=日
  const mondayOffset = (dow + 6) % 7; // Sun→6, Mon→0, Tue→1...
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - mondayOffset + i);
    weekDays.push(toLocalDateStr(d));
  }

  // 今週の稼働時間（各日）
  const hoursPerDay = weekDays.map(ds => {
    const tc = state.timecards.find(t => t.date === ds);
    return tc ? (tc.totalHours || 0) : 0;
  });
  const totalHours = hoursPerDay.reduce((s, h) => s + h, 0);
  const maxHours = Math.max(...hoursPerDay, 1);

  // 今週完了タスクの金額（税抜き）
  const weeklyAmount = state.tasks
    .filter(t => t.status === 'completed' && weekDays.includes(t.completedAt))
    .reduce((s, t) => s + (t.amount || 0), 0);

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
      // 月曜始まり: i=5が土, i=6が日
      const color = isToday ? 'var(--primary)' : (i === 6 ? 'var(--danger)' : i === 5 ? 'var(--secondary)' : 'var(--border-color)');
      const barColor = isToday ? 'var(--primary)' : (h > 0 ? 'var(--text-muted)' : 'var(--border-color)');
      return `<div onclick="goToJournalDate('${weekDays[i]}')" title="${weekDays[i]}の日誌を開く" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px;cursor:pointer;">
        <div style="font-size:0.65rem;color:${isToday ? 'var(--primary)' : 'var(--text-muted)'};font-weight:${isToday?'700':'400'};">${h > 0 ? h.toFixed(1) : ''}</div>
        <div style="width:100%;background:${barColor};border-radius:4px 4px 0 0;height:${Math.max(pct, h > 0 ? 8 : 2)}%;transition:height 0.4s ease;opacity:${isToday?'1':'0.65'};"></div>
      </div>`;
    }).join('');
  }
}

// ─── 収入予測（見込み3ヶ月） ───────────────────────────────────────────
function renderIncomeForecast() {
  const el = document.getElementById('income-forecast-months');
  if (!el) return;

  const now = new Date();
  const months = [0, 1, 2].map(offset => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: offset === 0 ? '今月' : offset === 1 ? '来月' : '再来月',
      month: d.getMonth() + 1,
      total: 0,
      count: 0,
    };
  });

  (state.tasks || []).forEach(task => {
    if (!task.dueDate || !task.amount) return;
    const done = task.status === 'done' || task.status === 'billed';
    if (done) return;   // 完了済みは除外
    const key = task.dueDate.substring(0, 7);
    const m = months.find(m => m.key === key);
    if (m) {
      m.total += parseFloat(task.amount) || 0;
      m.count++;
    }
  });

  el.innerHTML = months.map(m => `
    <div class="income-forecast-month">
      <div class="income-forecast-month-label">${m.label}</div>
      <div class="income-forecast-amount">
        ${m.total > 0
          ? '¥' + Math.round(m.total).toLocaleString('ja-JP')
          : '<span class="income-forecast-empty">—</span>'}
      </div>
      ${m.count > 0 ? `<div class="income-forecast-count">${m.count}件</div>` : ''}
    </div>
  `).join('');
}

function renderDashboard() {
  renderBTLog();
  renderTaskProgressChart();
  renderWeeklySummary();
  renderIncomeForecast();

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

  // ── Vintage Ticker ──
  updateDashboardTicker();

  // ── 週クイックカード ──
  renderDashboardWeekQuick();

  // ── 月末請求リマインダー ──
  checkInvoiceReminder();

  // ── 感情コピー（稼働時間の下） ──
  const thisMonth = todayStr.slice(0,7);
  const monthHours = state.timecards
    .filter(tc => tc.date.startsWith(thisMonth))
    .reduce((s,tc) => s+(tc.totalHours||0), 0);
  const emotionalEl = document.getElementById('dash-emotional-copy');
  if (emotionalEl) emotionalEl.textContent = getEmotionalHoursCopy(todayCard?.totalHours||0, monthHours);

  // ── 今日の最優先3件 ──
  renderTop3Tasks(todayStr);
}

function renderDashboardWeekQuick() {
  const card = document.getElementById('dash-week-quick');
  if (!card) return;
  const today = new Date();
  const dow = today.getDay();
  const mondayOffset = (dow + 6) % 7;
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - mondayOffset + i);
    weekDays.push(toLocalDateStr(d));
  }
  const tasks = state.tasks || [];
  const pending  = tasks.filter(t => t.status === 'not-started').length;
  const inProg   = tasks.filter(t => t.status === 'in-progress').length;
  const revision = tasks.filter(t => t.status === 'revision').length;
  const done     = tasks.filter(t => t.status === 'completed' && weekDays.includes(t.completedAt)).length;
  const totalHrs = weekDays.reduce((s, ds) => {
    const tc = state.timecards.find(t => t.date === ds);
    return s + (tc?.totalHours || 0);
  }, 0);
  const weekRevenue = tasks
    .filter(t => t.status === 'completed' && weekDays.includes(t.completedAt))
    .reduce((s, t) => s + (t.amount || 0), 0);

  // クライアント別タスク数
  const clientMap = {};
  tasks.filter(t => weekDays.includes(t.dueDate || '') || weekDays.includes(t.completedAt || ''))
    .forEach(t => { if (t.client) clientMap[t.client] = (clientMap[t.client] || 0) + 1; });
  const topClients = Object.entries(clientMap).sort((a,b)=>b[1]-a[1]).slice(0,3);

  const fmt = v => new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(Math.round(v));
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:2px solid var(--primary);padding-bottom:0.5rem;">
      <h3 style="font-size:1.4rem;letter-spacing:0.08em;">THIS WEEK</h3>
      <button class="btn btn-secondary" onclick="switchTab('weekly')" style="font-size:0.78rem;padding:0.3rem 0.7rem;border-radius:2px;">詳細 →</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
      <div style="text-align:center;">
        <div style="font-size:1.5rem;font-family:var(--font-vintage);color:var(--primary);">${totalHrs.toFixed(1)}h</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">稼働時間</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:1.5rem;font-family:var(--font-vintage);color:var(--success);">${done}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">完了タスク</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:1.1rem;font-family:var(--font-vintage);color:var(--text-main);">${fmt(weekRevenue)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">今週売上</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:1.1rem;font-family:var(--font-vintage);color:var(--primary);">${inProg + revision}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">進行中</div>
      </div>
    </div>
    ${topClients.length ? `<div style="font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border-color);padding-top:0.6rem;">
      <div style="font-weight:600;margin-bottom:0.3rem;font-family:var(--font-vintage);letter-spacing:0.05em;">TODAY'S CLIENTS</div>
      ${topClients.map(([c,n])=>`<div style="display:flex;justify-content:space-between;"><span>${c}</span><span style="color:var(--primary);font-family:var(--font-vintage);">${n}</span></div>`).join('')}
    </div>` : ''}
  `;
}

function updateDashboardTicker() {
  const tickerA = document.getElementById('ticker-text-a');
  const tickerB = document.getElementById('ticker-text-b');
  if (!tickerA || !tickerB) return;

  const todayStr = getLocalDateStr();
  const todayCard = state.timecards.find(tc => tc.date === todayStr);
  const tasks = state.tasks || [];
  const pending  = tasks.filter(t => t.status === 'not-started').length;
  const inProg   = tasks.filter(t => t.status === 'in-progress').length;
  const done     = tasks.filter(t => t.status === 'completed').length;
  const total    = tasks.length;
  const clockIn  = todayCard?.clockIn  || '--:--';
  const clockOut = todayCard?.clockOut || '--:--';
  const hrs      = todayCard?.totalHours ? `${todayCard.totalHours.toFixed(1)}H` : '--';

  const greetings = ['STAY FOCUSED', 'GET IT DONE', 'KEEP MOVING', 'MAKE IT HAPPEN'];
  const greet = greetings[new Date().getHours() % greetings.length];

  const sep = '<span class="ticker-sep">✦</span>';
  const items = [
    `${greet}`,
    `IN: ${clockIn}`,
    `OUT: ${clockOut}`,
    `TODAY: ${hrs}`,
    `TASKS: ${total}`,
    `PENDING: ${pending}`,
    `IN PROGRESS: ${inProg}`,
    `DONE: ${done}`,
    `${new Date().toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})}`,
  ];
  const html = items.map((s, i) => i < items.length - 1 ? s + sep : s).join('') + sep;
  // A+B で継ぎ目なしループ
  tickerA.innerHTML = html;
  tickerB.innerHTML = html;
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

// 休日トグル（日誌）
function toggleJournalHoliday() {
  const date = state.journalDate || getLocalDateStr();
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  state.journalEntries[date].isHoliday = !state.journalEntries[date].isHoliday;
  saveJournalToStorage();
  renderJournal();
  showTrayToast(state.journalEntries[date].isHoliday ? '🌴 休日に設定しました' : '休日設定を解除しました');
}

function isHolidayDate(d) {
  return !!state.journalEntries[d]?.isHoliday;
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
  const thisMonthRevenue = Math.round(thisMonthCompleted.reduce((s, t) => s + (t.amount || 0), 0));
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
      `💰 今月売上(税抜): <strong>${new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(thisMonthRevenue)}</strong>`,
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
function addStampAnim(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.remove('stamp-anim');
  void btn.offsetWidth; // reflow
  btn.classList.add('stamp-anim');
  btn.addEventListener('animationend', () => btn.classList.remove('stamp-anim'), { once: true });
}

function clockIn() {
  const todayStr = getLocalDateStr();
  const nowStr = new Date().toTimeString().split(' ')[0].substring(0, 5);

  let todayCard = state.timecards.find(tc => tc.date === todayStr);

  if (todayCard && todayCard.clockIn) {
    showToastInfo('本日はすでに出勤打刻しています！');
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
    showToastError('出勤打刻が行われていません！');
    return;
  }

  if (todayCard.clockOut) {
    showToastError('本日はすでに退勤打刻しています！');
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

function clockInFromJournal() {
  if (navigator.vibrate) navigator.vibrate([30, 50, 100]);
  clockIn();
  renderJournal();
}

function clockOutFromJournal() {
  if (navigator.vibrate) navigator.vibrate([30, 50, 30, 50, 100]);
  clockOut();
  renderJournal();
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
    showToastInfo('日付を指定してください。');
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
      <span class="wc-legend-item"><span class="wc-legend-dot" style="background:var(--primary)"></span>IN PROGRESS</span>
      <span class="wc-legend-item"><span class="wc-legend-dot" style="background:var(--text-muted)"></span>PENDING</span>
    </div>`;
}

// ============================================================
// JOURNAL TIMELINE (9:00-18:00, 1h blocks)
// ============================================================
function toggleJournalTaskPanel() {
  const body = document.querySelector('.journal-task-body');
  const btn  = document.querySelector('.journal-task-toggle');
  const chev = document.querySelector('.journal-task-chevron');
  if (!body) return;
  const nowOpen = body.style.display !== 'none';
  const next = !nowOpen;
  body.style.display = next ? 'block' : 'none';
  if (chev) chev.textContent = next ? '▲' : '▼';
  if (btn)  btn.setAttribute('aria-expanded', next);
  localStorage.setItem('journal-task-panel-open', next ? '1' : '0');
}

// ── タイムライン: 30分刻み + 2トラック(並行スケジュール)共通ヘルパー ──
const TL_DAY_START_MIN = 9 * 60;   // 09:00
const TL_DAY_END_MIN   = 19 * 60;  // 19:00（最終スロット開始 18:30）
const TL_STEP_MIN      = 30;       // 1スロット = 30分
const TL_UNIT_PX        = 46;      // 1スロットあたりの高さ(px)

function tlMinToHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + String(m).padStart(2, '0');
}
function tlParseKey(key) {
  const m = /^(\d{4})(b)?$/.exec(String(key));
  if (!m) return { hhmm: String(key), track: 'a', min: NaN };
  const hh = parseInt(m[1].slice(0, 2), 10), mm = parseInt(m[1].slice(2, 4), 10);
  return { hhmm: m[1], track: m[2] ? 'b' : 'a', min: hh * 60 + mm };
}
function tlKeyFor(min, track) {
  return tlMinToHHMM(min) + (track === 'b' ? 'b' : '');
}
function tlTimeLabel(key) {
  const { min } = tlParseKey(key);
  if (Number.isNaN(min)) return String(key);
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function tlSlotsList() {
  const out = [];
  for (let m = TL_DAY_START_MIN; m < TL_DAY_END_MIN; m += TL_STEP_MIN) out.push(tlMinToHHMM(m));
  return out;
}
function tlMaxSpan(key) {
  const { min } = tlParseKey(key);
  if (Number.isNaN(min)) return 1;
  return Math.max(1, Math.round((TL_DAY_END_MIN - min) / TL_STEP_MIN));
}
function tlAddSteps(key, n) {
  const { min, track } = tlParseKey(key);
  return tlKeyFor(min + n * TL_STEP_MIN, track);
}
function tlRangeLabel(key, span) {
  const startLabel = tlTimeLabel(key);
  if (!span || span <= 1) return startLabel;
  return `${startLabel}–${tlTimeLabel(tlAddSteps(key, span))}`;
}
function tlSpanLabel(span) {
  const totalMin = (span || 1) * TL_STEP_MIN;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

// 旧データ（1時間刻み・キー="09".."18"）を30分刻みキー（"0900"等）に移行
function migrateTimelineToHalfHour(date) {
  const entry = state.journalEntries[date];
  if (!entry || !entry.timeline) return;
  const tl = entry.timeline;
  const hasOld = Object.keys(tl).some(k => /^\d{2}$/.test(k));
  if (!hasOld) return;
  const migrated = {};
  Object.keys(tl).forEach(k => {
    const slot = tl[k] || {};
    if (/^\d{2}$/.test(k)) {
      const newKey = k + '00';
      const newSlot = { ...slot };
      if (typeof newSlot.span === 'number') newSlot.span = Math.max(1, Math.round(newSlot.span * 2));
      if (typeof newSlot._covered === 'string' && /^\d{2}$/.test(newSlot._covered)) {
        newSlot._covered = newSlot._covered + '00';
      }
      migrated[newKey] = newSlot;
    } else {
      migrated[k] = slot;
    }
  });
  entry.timeline = migrated;
  saveJournalToStorage();
}

function renderJournalTimeline() {
  const el = document.getElementById('journal-timeline');
  if (!el) return;

  const date = state.journalDate;
  migrateTimelineToHalfHour(date);
  const entry = state.journalEntries[date] || {};
  const timeline = entry.timeline || {};

  // ── タイムライン上部: タスクを追加するクイックバー ──
  const quickBarEl = document.getElementById('journal-timeline-quickbar');
  if (quickBarEl) {
    // 未完了タスクを全て表示（日付に関わらず）+ 今日完了分も含む
    const todayTasks = state.tasks.filter(t =>
      t.status !== 'completed' || t.completedAt === date
    ).sort((a, b) => {
      const order = { 'in-progress': 0, 'not-started': 1, 'revision': 2, 'completed': 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });
    const statusColor = { 'not-started': 'var(--text-muted)', 'in-progress': 'var(--primary)', 'revision': '#f97316', 'completed': 'var(--success)' };
    if (todayTasks.length > 0) {
      quickBarEl.innerHTML = `
        <div class="tl-quickbar-label">📋 タスクを追加</div>
        <div class="tl-quickbar-list">
          ${todayTasks.map(t => `
            <button class="tl-quickbar-btn"
              onclick="showTimeslotPicker('${t.id}')"
              draggable="true"
              ondragstart="handleTaskDragStart(event,'${t.id}')"
              ontouchstart="tlTouchDragStart(event,'${t.id}')"
              ontouchmove="tlTouchDragMove(event)"
              ontouchend="tlTouchDragEnd(event)"
              title="クリック→時間選択 / PCドラッグ→スロットに配置">
              <span class="tl-quickbar-dot" style="background:${statusColor[t.status]||'var(--text-muted)'}"></span>
              <span class="tl-quickbar-name">${escapeHtml(t.name.slice(0,14))}${t.name.length>14?'…':''}</span>
              <span class="tl-quickbar-pin">⠿</span>
            </button>
          `).join('')}
        </div>`;
      quickBarEl.style.display = 'block';
    } else {
      quickBarEl.style.display = 'none';
    }
  }

  function renderTlCell(key) {
    const slot = timeline[key] || {};

    // このスロットが別スロットに覆われている場合はスキップ
    if (slot._covered) return '';

    // 休憩・移動・所用などの特殊スロット
    if (slot.type === 'break' || slot.type === 'travel' || slot.type === 'errand') {
      const span = slot.span || 1;
      const spanHeight = span > 1 ? `min-height:${span * TL_UNIT_PX + (span - 1) * 6}px;` : '';
      const timeLabel = tlRangeLabel(key, span);
      const iconMap = { break: '🍱', travel: '🚗', errand: slot.errandSub === 'private' ? '🏠' : '🤝' };
      const labelMap = { break: '休憩', travel: '移動', errand: '所用' };
      const icon = iconMap[slot.type] || '📅';
      const label = slot.label || labelMap[slot.type] || slot.type;
      const colorClass = (slot.type === 'break' ? 'tl-special-break'
                       : slot.type === 'travel' ? 'tl-special-travel'
                       : 'tl-special-errand')
                       + (slot.type === 'break' && span >= 4 ? ' tl-break-long' : '');
      // MTG連携案件名
      const dealName = (slot.errandSub === 'mtg' && slot.errandDealId)
        ? (() => { const d = state.deals?.find(x => x.id === slot.errandDealId); return d ? `<span class="tl-errand-deal">🔗 ${escHtml(d.title)}</span>` : ''; })()
        : '';
      const maxSpan = tlMaxSpan(key);
      return `
        <div class="tl-slot tl-slot-filled tl-slot-special ${colorClass}"
          data-hour="${key}" data-span="${span}" style="${spanHeight}"
          ondragover="event.preventDefault(); this.classList.add('tl-slot-drag-over');"
          ondragleave="this.classList.remove('tl-slot-drag-over');"
          ondrop="handleTimelineDrop(event, '${key}')">
          <div class="tl-slot-time-col">
            <span class="tl-slot-time">${timeLabel}</span>
            <div class="tl-slot-span-controls">
              <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${key}',-1)" ${span<=1?'disabled':''}>−</button>
              <span class="tl-slot-span-val">${tlSpanLabel(span)}</span>
              <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${key}',1)" ${span>=maxSpan?'disabled':''}>＋</button>
            </div>
          </div>
          <div class="tl-slot-special-body">
            <span class="tl-slot-special-icon">${icon}</span>
            <div class="tl-slot-special-label-wrap">
              <span class="tl-slot-special-label">${label}</span>
              ${dealName}
            </div>
            <div class="tl-slot-special-actions">
              ${(slot.type === 'travel' || slot.type === 'errand') ? (
                slot.location
                  ? `<button class="tl-slot-pin-btn tl-slot-pin-set" onclick="openLocationPinModal('${date}','${key}')" title="${slot.location.label ? escHtml(slot.location.label) : '行き先を確認・編集'}">📍</button>`
                  : `<button class="tl-slot-pin-btn" onclick="openLocationPinModal('${date}','${key}')" title="行き先をピン留め">📌</button>`
              ) : ''}
              <button class="tl-slot-special-journal-btn" onclick="appendSpecialSlotToJournal('${date}','${key}')" title="日誌に追記">📝</button>
              <button class="tl-slot-remove" onclick="removeTimelineSlot('${date}','${key}')" title="削除">×</button>
            </div>
          </div>
          <div class="tl-resize-handle" onpointerdown="startSlotResize(event,'${date}','${key}')">
            <div class="tl-resize-handle-icon"></div>
          </div>
        </div>`;
    }

    const task = slot.taskId ? state.tasks.find(t => t.id === slot.taskId) : null;
    const isActiveTimer = task && state.activeTimerTaskId === task.id && !!state.timerStartEpoch;
    const span = slot.span || 1;
    const spanHeight = span > 1 ? `min-height:${span * TL_UNIT_PX + (span - 1) * 6}px;` : '';

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
    const timeLabel = tlRangeLabel(key, span);

    let progressBar = '';
    if (estH > 0 && actualH !== '') {
      const pct = Math.min(Math.round((Number(actualH) / estH) * 100), 100);
      const barColor = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--primary)' : 'var(--primary)';
      progressBar = `
        <div class="tl-slot-progress-wrap">
          <div class="tl-slot-progress-bar" style="width:${pct}%; background:${barColor};"></div>
        </div>`;
    }

    // スパン調整ボタン（タスクあり時のみ）
    const maxSpan = tlMaxSpan(key);
    const spanControls = task ? `
      <div class="tl-slot-span-controls">
        <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${key}',-1)" title="-30分" ${span <= 1 ? 'disabled' : ''}>−</button>
        <span class="tl-slot-span-val">${tlSpanLabel(span)}</span>
        <button class="tl-slot-span-btn" onclick="adjustSlotSpan('${date}','${key}',1)" title="+30分" ${span >= maxSpan ? 'disabled' : ''}>＋</button>
      </div>` : '';

    return `
      <div class="tl-slot ${task ? 'tl-slot-filled' : 'tl-slot-empty'}"
        data-hour="${key}" data-span="${span}"
        style="${spanHeight}"
        ondragover="event.preventDefault(); this.classList.add('tl-slot-drag-over');"
        ondragleave="this.classList.remove('tl-slot-drag-over');"
        ondrop="handleTimelineDrop(event, '${key}')">
        <div class="tl-slot-time-col">
          <span class="tl-slot-time">${timeLabel}</span>
          ${spanControls}
        </div>
        ${task ? `
          <div class="tl-slot-task tl-status-${task.status}" style="border-left-color:${color}">
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
                  onchange="saveTimelineActual('${date}', '${key}', this.value)"
                  onclick="event.stopPropagation()">
                <span class="tl-slot-time-label">h</span>
              </div>
              <button class="tl-slot-remove" onclick="removeTimelineSlot('${date}', '${key}')" title="削除">×</button>
            </div>
            <div class="tl-slot-status-row">
              ${[
                {s:'not-started', lbl:'PENDING'},
                {s:'in-progress',  lbl:'IN PROGRESS'},
                {s:'revision',     lbl:'REVISION'},
                {s:'completed',    lbl:'DONE'}
              ].map(({s,lbl}) =>
                `<button class="tl-slot-status-btn tl-ss-${s}${task.status===s?' active':''}"
                  onclick="event.stopPropagation();updateTaskStatusFromTimeline('${date}','${key}','${s}')">${lbl}</button>`
              ).join('')}
            </div>
            <div class="tl-slot-memo-row">
              <textarea id="tl-memo-${key}" class="tl-slot-memo" rows="1"
                placeholder="作業メモ…"
                onchange="saveTimelineMemo('${date}','${key}',this.value)"
                oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
                onclick="event.stopPropagation()">${escapeHtml(slot.memo||'')}</textarea>
              <button class="tl-slot-memo-voice-btn" id="tl-voice-${key}"
                onclick="event.stopPropagation();startWhisperRecord('tl-memo-${key}','tl-voice-${key}')"
                title="音声入力">🎤</button>
            </div>
            <div class="tl-slot-sw-row">
              <button class="tl-slot-sw-btn${isActiveTimer ? ' running' : ''}"
                id="tl-sw-btn-${key}"
                onclick="event.stopPropagation();toggleTimelineTimer('${date}','${key}')"
                title="${isActiveTimer ? '停止 → 実績時間に反映' : '計測開始'}">
                ${isActiveTimer ? '⏸' : '▶'}
                <span class="tl-sw-disp">${isActiveTimer ? formatSecondsToHHMMSS(task.spentSeconds||0) : '計測'}</span>
              </button>
            </div>
            <div class="tl-resize-handle" onpointerdown="startSlotResize(event,'${date}','${key}')">
              <div class="tl-resize-handle-icon"></div>
            </div>
          </div>` : `
          <span class="tl-slot-placeholder">ここにタスクをドロップ</span>`}
      </div>`;
  }

  const slotKeys = tlSlotsList();
  const trackAHtml = slotKeys.map(renderTlCell).join('');
  const trackBHtml = slotKeys.map(k => renderTlCell(k + 'b')).join('');

  el.innerHTML = `
    <div class="tl-tracks-wrap">
      <div class="tl-track tl-track-a">${trackAHtml}</div>
      <div class="tl-track tl-track-b">
        <div class="tl-track-b-label">＋ 並行スケジュール（同じ時間帯にもう1件入れる）</div>
        ${trackBHtml}
      </div>
    </div>`;

  renderPlanActualSummary(date);
}

// ── 予定 vs 実績まとめ（日誌末尾の自動集計） ──
function renderPlanActualSummary(date) {
  const el = document.getElementById('journal-plan-actual');
  if (!el) return;

  const entry = state.journalEntries[date] || {};
  const timeline = entry.timeline || {};

  let plannedTaskH = 0;
  let actualTaskH = 0;
  let breakH = 0;
  let travelH = 0;
  let errandH = 0;
  let taskCount = 0;
  const taskRows = [];

  Object.keys(timeline).forEach(h => {
    const slot = timeline[h];
    if (!slot || slot._covered) return;
    const span = slot.span || 1;
    const spanHours = Math.round(span * (TL_STEP_MIN / 60) * 100) / 100;

    if (slot.type === 'break') { breakH += spanHours; return; }
    if (slot.type === 'travel') { travelH += spanHours; return; }
    if (slot.type === 'errand') { errandH += spanHours; return; }

    if (slot.taskId) {
      const task = state.tasks.find(t => t.id === slot.taskId);
      const timerHours = task?.spentSeconds > 0 ? Math.round(task.spentSeconds / 3600 * 10) / 10 : null;
      const actualH = slot.actualHours !== '' && slot.actualHours != null
        ? Number(slot.actualHours)
        : (timerHours || 0);
      plannedTaskH += spanHours;
      actualTaskH += actualH;
      taskCount++;
      taskRows.push({ name: task ? task.name : (slot.label || 'タスク'), planned: spanHours, actual: actualH, status: task?.status || 'not-started' });
    }
  });

  // 何も記録がなければ非表示
  if (taskCount === 0 && breakH === 0 && travelH === 0 && errandH === 0) {
    el.innerHTML = '';
    return;
  }

  const achievePct = plannedTaskH > 0 ? Math.round((actualTaskH / plannedTaskH) * 100) : null;
  const diffH = Math.round((actualTaskH - plannedTaskH) * 10) / 10;
  const diffLabel = diffH > 0 ? `+${diffH}h 超過` : diffH < 0 ? `${diffH}h 短縮` : '予定通り';
  const diffClass = diffH > 0 ? 'pa-diff-over' : diffH < 0 ? 'pa-diff-under' : 'pa-diff-even';

  let html = `
    <div class="pa-header">📊 予定 vs 実績まとめ</div>
    <div class="pa-row pa-row-main">
      <span class="pa-label">タスク予定</span>
      <span class="pa-val">${plannedTaskH}h</span>
      <span class="pa-arrow">→</span>
      <span class="pa-label">実績</span>
      <span class="pa-val">${actualTaskH}h</span>
      ${achievePct != null ? `<span class="pa-pct">達成率 ${achievePct}%</span>` : ''}
    </div>
    <div class="pa-row pa-diff-row ${diffClass}">${diffLabel}</div>`;

  if (breakH > 0 || travelH > 0 || errandH > 0) {
    html += `<div class="pa-row pa-sub-row">`;
    if (breakH > 0) html += `<span class="pa-sub-item${breakH >= 2 ? ' pa-sub-warn' : ''}">🍱 休憩 ${breakH}h</span>`;
    if (travelH > 0) html += `<span class="pa-sub-item">🚗 移動 ${travelH}h</span>`;
    if (errandH > 0) html += `<span class="pa-sub-item">🤝 所用 ${errandH}h</span>`;
    html += `</div>`;
  }

  if (taskRows.length > 0) {
    const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION', 'completed': 'DONE' };
    html += `<div class="pa-task-list">` + taskRows.map(r => {
      const rowDiff = Math.round((r.actual - r.planned) * 10) / 10;
      const rowClass = rowDiff > 0 ? 'pa-diff-over' : rowDiff < 0 ? 'pa-diff-under' : '';
      return `<div class="pa-task-row pa-status-${r.status}">
        <span class="pa-task-status-dot pa-ss-${r.status}" title="${statusLabel[r.status]||''}"></span>
        <span class="pa-task-name">${escapeHtml(r.name.slice(0, 16))}${r.name.length > 16 ? '…' : ''}</span>
        <span class="pa-task-vals">予定${r.planned}h / 実績${r.actual}h</span>
        <span class="pa-task-diff ${rowClass}">${rowDiff > 0 ? '+' : ''}${rowDiff}h</span>
      </div>`;
    }).join('') + `</div>`;
  }

  el.innerHTML = html;
}

function handleTimelineDrop(e, hour) {
  e.preventDefault();
  e.currentTarget.classList.remove('tl-slot-drag-over');
  const taskId = e.dataTransfer.getData('text/x-tinyperk-task')
             || e.dataTransfer.getData('text/plain');
  if (!taskId) return;
  const task = state.tasks.find(t => String(t.id) === String(taskId));
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

  // 想定時間からスパンを自動設定（30分単位・未設定なら30分）
  const wantSpan = Math.max(1, Math.round((task.estimatedHours || 0.5) * 2));
  const span = Math.min(wantSpan, tlMaxSpan(hour));

  // メインスロット
  timeline[hour] = { taskId, actualHours: '', span };

  // カバーされるスロットをマーク
  for (let i = 1; i < span; i++) {
    timeline[tlAddSteps(hour, i)] = { _covered: hour };
  }

  saveJournalToStorage();
  renderJournalTimeline();
}

function adjustSlotSpanTo(date, hour, newSpan) {
  const timeline = state.journalEntries[date]?.timeline;
  if (!timeline || !timeline[hour]?.taskId) return;
  const slot = timeline[hour];
  const maxSpan = tlMaxSpan(hour);
  newSpan = Math.max(1, Math.min(newSpan, maxSpan));

  // 既存coverを削除
  Object.keys(timeline).forEach(h => {
    if (timeline[h]._covered === hour) delete timeline[h];
  });

  slot.span = newSpan;

  // 新しいcoverをマーク
  for (let i = 1; i < newSpan; i++) {
    const coveredH = tlAddSteps(hour, i);
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
  const TL_UNIT = TL_UNIT_PX + 6;
  const startY = e.clientY;
  const slot = state.journalEntries[date]?.timeline?.[hour];
  if (!slot) return;
  const startSpan = slot.span || 1;
  const maxSpan = tlMaxSpan(hour);
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
    const newSpan = Math.max(1, Math.min(startSpan + Math.round(delta / TL_UNIT), maxSpan));
    if (newSpan === previewSpan) return;
    previewSpan = newSpan;
    if (slotEl) {
      slotEl.style.minHeight = newSpan > 1 ? `${newSpan * TL_UNIT_PX + (newSpan - 1) * 6}px` : '';
      const spanVal = slotEl.querySelector('.tl-slot-span-val');
      if (spanVal) spanVal.textContent = tlSpanLabel(newSpan);
      const timeEl = slotEl.querySelector('.tl-slot-time');
      if (timeEl) timeEl.textContent = tlRangeLabel(hour, newSpan);
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

// 休憩・移動・所用スロット追加モーダル
function showAddSpecialSlotModal(type) {
  document.getElementById('special-slot-modal')?.remove();
  const meta = {
    break:  { icon: '🍱', name: '休憩' },
    travel: { icon: '🚗', name: '移動' },
    errand: { icon: '📅', name: '所用' },
  };
  const { icon, name } = meta[type] || meta.break;
  const hourOptions = tlSlotsList().map(k => `<option value="${k}">${tlTimeLabel(k)}</option>`).join('');

  // 所用専用フィールド: 種別 + 案件連携
  let errandFields = '';
  if (type === 'errand') {
    const activeDeals = (state.deals || []).filter(d => d.stage !== 'won' && d.stage !== 'lost');
    const dealOptions = activeDeals.length
      ? activeDeals.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.title)}</option>`).join('')
      : '<option value="">（案件なし）</option>';
    errandFields = `
        <div class="form-group">
          <label class="form-label">種別</label>
          <div style="display:flex;gap:1rem;">
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="radio" name="errand-sub" value="mtg" id="errand-sub-mtg" onchange="toggleErrandDealField()" checked>
              <span>🤝 MTG</span>
            </label>
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="radio" name="errand-sub" value="private" id="errand-sub-private" onchange="toggleErrandDealField()">
              <span>🏠 私用</span>
            </label>
          </div>
        </div>
        <div class="form-group" id="errand-deal-field">
          <label class="form-label">案件と連携 <span style="font-size:0.75rem;color:var(--text-muted);">（任意）見込みに反映</span></label>
          <select id="errand-deal-id" class="form-control">
            <option value="">連携しない</option>
            ${dealOptions}
          </select>
        </div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'special-slot-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:340px;">
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
          <label class="form-label">列</label>
          <div style="display:flex;gap:1rem;">
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="radio" name="ss-track" value="a" checked><span>メイン</span>
            </label>
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="radio" name="ss-track" value="b"><span>並行（2列目）</span>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">時間</label>
          <select id="ss-span" class="form-control">
            <option value="0.5">30分</option>
            <option value="1">1時間</option>
            <option value="1.5">1時間30分</option>
            <option value="2">2時間</option>
            <option value="3">3時間</option>
            <option value="4">4時間</option>
            <option value="5">5時間</option>
            <option value="6">6時間</option>
          </select>
        </div>
        ${errandFields}
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

function toggleErrandDealField() {
  const isMtg = document.getElementById('errand-sub-mtg')?.checked;
  const field = document.getElementById('errand-deal-field');
  if (field) field.style.display = isMtg ? '' : 'none';
}

function confirmAddSpecialSlot(type) {
  const baseKey = document.getElementById('ss-hour').value;
  const track = document.querySelector('input[name="ss-track"]:checked')?.value || 'a';
  const hour = track === 'b' ? baseKey + 'b' : baseKey;
  const spanVal = parseFloat(document.getElementById('ss-span').value);
  const defaultLabel = { break: '休憩', travel: '移動', errand: '所用' }[type] || type;
  const label = document.getElementById('ss-label').value.trim() || defaultLabel;
  const span = Math.max(1, Math.round(spanVal * 2));
  const date = state.journalDate;

  // 所用の追加情報
  let errandSub = null, errandDealId = null;
  if (type === 'errand') {
    errandSub = document.querySelector('input[name="errand-sub"]:checked')?.value || 'mtg';
    errandDealId = errandSub === 'mtg' ? (document.getElementById('errand-deal-id')?.value || '') : '';
  }

  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].timeline) state.journalEntries[date].timeline = {};
  const timeline = state.journalEntries[date].timeline;

  // 既存coverをクリア
  Object.keys(timeline).forEach(h => {
    if (timeline[h]._covered === hour) delete timeline[h];
  });

  const finalSpan = Math.min(span, tlMaxSpan(hour));
  timeline[hour] = { type, label, span: finalSpan, ...(errandSub ? { errandSub, errandDealId } : {}) };

  for (let i = 1; i < finalSpan; i++) {
    const covH = tlAddSteps(hour, i);
    if (!timeline[covH]?.taskId && !timeline[covH]?.type) {
      timeline[covH] = { _covered: hour };
    }
  }

  saveJournalToStorage();

  // MTG + 案件連携 → lastContactを更新
  if (type === 'errand' && errandSub === 'mtg' && errandDealId) {
    const deal = state.deals.find(d => d.id === errandDealId);
    if (deal) {
      deal.lastContact = date;
      saveDeals();
      showToastSuccess(`📅 「${deal.title}」の最終コンタクト日を更新しました`);
    }
  }

  document.getElementById('special-slot-modal')?.remove();
  renderJournalTimeline();
}

function appendSpecialSlotToJournal(date, hour) {
  const timeline = state.journalEntries[date]?.timeline;
  if (!timeline?.[hour]) return;
  const slot = timeline[hour];
  const span = slot.span || 1;
  const iconMap = { break: '🍱', travel: '🚗', errand: slot.errandSub === 'private' ? '🏠' : '🤝' };
  const icon = iconMap[slot.type] || '📅';
  let line = `${tlRangeLabel(hour, span)} ${icon} ${slot.label}`;
  if (slot.type === 'errand' && slot.errandSub === 'mtg' && slot.errandDealId) {
    const deal = state.deals?.find(d => d.id === slot.errandDealId);
    if (deal) line += `（案件: ${deal.title}）`;
  }

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

  // 占有時間を収集（メイン・並行どちらかが埋まっていれば占有とみなす）
  const busySlotMins = new Set();
  Object.entries(timeline).forEach(([k, slot]) => {
    if (!slot) return;
    if (slot.taskId || slot.type) {
      const span = slot.span || 1;
      const { min } = tlParseKey(k);
      if (!Number.isNaN(min)) {
        for (let i = 0; i < span; i++) busySlotMins.add(min + i * TL_STEP_MIN);
      }
    }
  });

  // 空き時間をレンジに変換
  const freeRanges = [];
  let start = null;
  for (let m = TL_DAY_START_MIN; m < TL_DAY_END_MIN; m += TL_STEP_MIN) {
    const busy = busySlotMins.has(m);
    if (!busy && start === null) start = m;
    if (busy && start !== null) { freeRanges.push({ start, end: m }); start = null; }
  }
  if (start !== null) freeRanges.push({ start, end: TL_DAY_END_MIN });

  const lines = [`【${dateStr} 空き時間】`, ''];
  if (freeRanges.length === 0) {
    lines.push('空き時間はありません');
  } else {
    freeRanges.forEach(r => lines.push(`・${tlTimeLabel(tlMinToHHMM(r.start))} 〜 ${tlTimeLabel(tlMinToHHMM(r.end))}`));
  }

  if (includeBusy) {
    const busySlots = Object.entries(timeline)
      .filter(([, s]) => s && s.taskId)
      .sort(([a], [b]) => tlParseKey(a).min - tlParseKey(b).min);
    if (busySlots.length > 0) {
      lines.push('', '【予定あり】');
      busySlots.forEach(([k, slot]) => {
        const task = state.tasks.find(t => t.id === slot.taskId);
        const span = slot.span || 1;
        lines.push(`・${tlRangeLabel(k, span)} ${task?.name || ''}`);
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
  renderPlanActualSummary(date);
}

function saveTimelineMemo(date, hour, value) {
  if (!state.journalEntries[date]?.timeline?.[hour]) return;
  state.journalEntries[date].timeline[hour].memo = value;
  saveJournalToStorage();
}

function toggleTimelineTimer(date, hour) {
  const slot = state.journalEntries[date]?.timeline?.[hour];
  if (!slot?.taskId) return;
  const task = state.tasks.find(t => t.id === slot.taskId);
  if (!task) return;

  if (state.activeTimerTaskId === task.id && state.timerStartEpoch) {
    // 停止 → 実績時間を自動反映（pauseTaskTimer が syncTimerToJournalTimeline を呼ぶ）
    pauseTaskTimer();
  } else {
    // 開始（別タスクのタイマーが動いていれば自動停止）
    startTaskTimer(task.id);
    // タイムラインカードのボタンを即時 running 状態に
    const btn = document.getElementById(`tl-sw-btn-${hour}`);
    if (btn) {
      btn.classList.add('running');
      btn.title = '停止 → 実績時間に反映';
      btn.innerHTML = '⏸ <span class="tl-sw-disp">00:00:00</span>';
    }
  }
}

function updateTaskStatusFromTimeline(date, hour, newStatus) {
  const slot = state.journalEntries[date]?.timeline?.[hour];
  if (!slot?.taskId) return;
  const task = state.tasks.find(t => t.id === slot.taskId);
  if (!task) return;
  task.status = newStatus;
  saveTasksToStorage();
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
  const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION', 'completed': 'DONE' };
  const statusClass = { 'not-started': 'status-badge-not-started', 'in-progress': 'status-badge-in-progress', 'revision': 'status-badge-revision', 'completed': 'status-badge-completed' };

  // Filter
  let tasks = [...state.tasks];
  const f = state.taskListFilter;
  if (f === 'active') tasks = tasks.filter(t => t.status !== 'completed');
  else if (f === 'completed') {
    tasks = tasks.filter(t => t.status === 'completed');
    // 月次フィルター
    const selMonth = state.completedMonthFilter || getLocalDateStr().slice(0,7);
    tasks = tasks.filter(t => {
      const d = t.completedAt || t.dueDate || '';
      return d.startsWith(selMonth);
    });
  } else if (f !== 'all') tasks = tasks.filter(t => t.status === f);

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

  function taskRowHTML(task) {
    const isOverdue = task.status !== 'completed' && task.dueDate && task.dueDate < today;
    const steps = task.steps || [];
    const doneSteps = steps.filter(s => s.completed).length;
    const stepText = steps.length > 0 ? `<span class="tl-steps">${doneSteps}/${steps.length} ステップ</span>` : '';
    const dueCls = isOverdue ? 'tl-due overdue' : 'tl-due';
    return `
      <div class="task-row-wrap" data-task-id="${task.id}">
        <div class="task-row-delete-bg">🗑️</div>
        <div class="task-row-swipe tl-task-row" onclick="openEditTaskModal('${task.id}')" role="button" tabindex="0"
          draggable="true"
          ondragstart="handleTaskDragStart(event, '${task.id}')"
          title="ドラッグして日誌に追加 / 左スワイプで削除">
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
                : `<span class="${dueCls}">🎯 ${task.dueDate || '—'}${isOverdue ? ' ⚠️' : ''}</span>`}
              ${task.targetDate && !task.isUnscheduled
                ? `<span class="tl-target-date">✅ ${task.targetDate}</span>`
                : ''}
              ${stepText}
              ${task.estimatedHours ? `<span class="tl-estimated">⏳ ${task.estimatedHours}h</span>` : ''}
              ${task.amount ? `<span class="tl-amount">¥${Number(task.amount).toLocaleString()}</span>` : ''}
            </div>
          </div>
          <button type="button" class="tl-journal-btn" onclick="event.stopPropagation();addTaskToJournal('${task.id}')" title="日誌に追加">📓</button>
        </div>
      </div>`;
  }

  // プロジェクトグループ表示
  if (state.projects.length > 0) {
    const grouped = {};
    tasks.forEach(t => {
      const key = t.projectId || '__none__';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    });

    let html = '';
    // プロジェクトありのグループを先に
    state.projects.forEach(proj => {
      const pts = grouped[proj.id] || [];
      if (pts.length === 0) return;
      const doneCount = pts.filter(t => t.status === 'completed').length;
      const pct = Math.round(doneCount / pts.length * 100);
      html += `
        <div class="project-group">
          <div class="project-group-header">
            <span class="project-group-icon">📁</span>
            <span class="project-group-name">${escapeHtml(proj.name)}</span>
            <span class="project-group-progress">${doneCount}/${pts.length}</span>
            <div class="project-group-bar"><div class="project-group-bar-fill" style="width:${pct}%"></div></div>
            <button class="project-group-delete" onclick="deleteProject('${proj.id}')" title="プロジェクト削除">✕</button>
          </div>
          ${pts.map(taskRowHTML).join('')}
        </div>`;
    });
    // プロジェクト未割り当て
    const none = grouped['__none__'] || [];
    if (none.length > 0) {
      html += `<div class="project-group project-group-none">
        <div class="project-group-header"><span class="project-group-icon">📋</span><span class="project-group-name">未分類</span></div>
        ${none.map(taskRowHTML).join('')}
      </div>`;
    }
    body.innerHTML = html;
  } else {
    body.innerHTML = tasks.map(taskRowHTML).join('');
  }

  initSwipeToDelete();
}

// ============================================================
// SWIPE TO DELETE
// ============================================================
function initSwipeToDelete() {
  document.querySelectorAll('.task-row-wrap').forEach(wrap => {
    const inner = wrap.querySelector('.task-row-swipe');
    if (!inner || wrap._swipeInit) return;
    wrap._swipeInit = true;

    let startX = 0, startY = 0, dx = 0;
    const THRESHOLD = 80;

    wrap.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
    }, { passive: true });

    wrap.addEventListener('touchmove', e => {
      dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > Math.abs(dx)) { dx = 0; return; } // vertical scroll
      if (dx < 0) {
        inner.style.transform = `translateX(${Math.max(dx, -THRESHOLD - 20)}px)`;
      }
    }, { passive: true });

    wrap.addEventListener('touchend', () => {
      if (dx < -THRESHOLD) {
        // 削除確定アニメーション
        inner.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        inner.style.transform = 'translateX(-100%)';
        inner.style.opacity = '0';
        setTimeout(() => {
          const taskId = wrap.dataset.taskId;
          state.tasks = state.tasks.filter(t => t.id !== taskId);
          saveTasksToStorage();
          renderTaskList();
        }, 220);
      } else {
        inner.style.transition = 'transform 0.2s ease';
        inner.style.transform = 'translateX(0)';
        setTimeout(() => { inner.style.transition = ''; }, 200);
      }
    });
  });
}

// ============================================================
// PROJECTS (B案: タスクをグループ化)
// ============================================================
function openAddProjectModal() {
  const name = prompt('プロジェクト名を入力してください\n例: 取材→記事制作（〇〇誌）');
  if (!name || !name.trim()) return;
  const proj = { id: 'proj_' + Date.now(), name: name.trim() };
  state.projects.push(proj);
  saveProjectsToStorage();
  renderTaskList();
}

function deleteProject(projId) {
  if (!confirm('プロジェクトを削除しますか？（タスクは未分類に移動します）')) return;
  state.projects = state.projects.filter(p => p.id !== projId);
  state.tasks.forEach(t => { if (t.projectId === projId) t.projectId = null; });
  saveProjectsToStorage();
  saveTasksToStorage();
  renderTaskList();
}

function assignTaskToProject(taskId, projId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (task) { task.projectId = projId || null; saveTasksToStorage(); }
}

// ============================================================
// タッチ対応: タップで時間割にタスクを追加
// ============================================================
function showTimeslotPicker(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  // 既存ピッカーを削除
  const existing = document.getElementById('timeslot-picker-overlay');
  if (existing) existing.remove();

  const date = state.journalDate;
  const timeline = state.journalEntries[date]?.timeline || {};
  const slots = tlSlotsList();

  const overlay = document.createElement('div');
  overlay.id = 'timeslot-picker-overlay';
  overlay.className = 'timeslot-picker-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const renderBtn = (key) => {
    const slot = timeline[key];
    const occupied = slot && !slot._covered && (slot.taskId || slot.type);
    const occupiedName = occupied ? (slot.taskId ? (state.tasks.find(t => t.id === slot.taskId)?.name || '') : (slot.label || '')) : '';
    return `<button class="timeslot-picker-btn${occupied ? ' occupied' : ''}"
      onclick="assignTaskToTimeslot('${taskId}','${key}');document.getElementById('timeslot-picker-overlay').remove();">
      <span class="timeslot-hour">${tlTimeLabel(key)}</span>
      ${occupied ? `<span class="timeslot-occupied-label">${escapeHtml(occupiedName.slice(0,8))}…</span>` : ''}
    </button>`;
  };

  const box = document.createElement('div');
  box.className = 'timeslot-picker-box';
  box.innerHTML = `
    <div class="timeslot-picker-title">📌 ${escapeHtml(task.name)}<br><small>時間割に追加する時間を選択（メイン列）</small></div>
    <div class="timeslot-picker-grid">
      ${slots.map(renderBtn).join('')}
    </div>
    <div class="timeslot-picker-title" style="margin-top:0.75rem;"><small>並行スケジュール（2列目）に追加する場合</small></div>
    <div class="timeslot-picker-grid">
      ${slots.map(k => renderBtn(k + 'b')).join('')}
    </div>
    <button class="btn btn-secondary" style="width:100%;margin-top:0.75rem;" onclick="document.getElementById('timeslot-picker-overlay').remove()">キャンセル</button>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function assignTaskToTimeslot(taskId, hour) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const date = state.journalDate;
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].timeline) state.journalEntries[date].timeline = {};
  const timeline = state.journalEntries[date].timeline;

  // 既存の同タスクスロットを削除
  Object.keys(timeline).forEach(k => {
    if (timeline[k].taskId === taskId) {
      const span = timeline[k].span || 1;
      for (let i = 0; i < span; i++) {
        delete timeline[tlAddSteps(k, i)];
      }
    }
  });

  const wantSpan = Math.max(1, Math.round((task.estimatedHours || 0.5) * 2));
  const span = Math.min(wantSpan, tlMaxSpan(hour));
  timeline[hour] = { taskId, actualHours: '', span };
  for (let i = 1; i < span; i++) {
    timeline[tlAddSteps(hour, i)] = { _covered: hour };
  }

  saveJournalToStorage();
  renderJournalTimeline();
  showMotivatorToast(`${tlTimeLabel(hour)} に追加しました`, '📌');
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

  // ── 休日トグル表示 ──
  const isHoliday = isHolidayDate(date);
  const holidayBtn = document.getElementById('journal-holiday-btn');
  if (holidayBtn) {
    holidayBtn.textContent = isHoliday ? '🌴 休日（タップで解除）' : '🌴 休日にする';
    holidayBtn.classList.toggle('is-holiday', isHoliday);
  }
  const holidayBanner = document.getElementById('journal-holiday-banner');
  if (holidayBanner) {
    if (isHoliday) {
      holidayBanner.className = 'journal-holiday-banner';
      holidayBanner.style.display = 'block';
      holidayBanner.textContent = '🌴 この日は休日として記録されています';
    } else {
      holidayBanner.style.display = 'none';
    }
  }

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
      ? `${timecard.clockIn || '--'} → ${timecard.clockOut || '--'}（${timecard.totalHours != null ? parseFloat(timecard.totalHours).toFixed(1) + 'h' : '--'}）`
      : '記録なし';
    const isToday = date === todayStr;
    let clockBtns = '';
    if (isToday) {
      if (!timecard?.clockIn) {
        clockBtns = `<button class="journal-clock-btn journal-clock-in" onclick="clockInFromJournal()">PUNCH IN</button>`;
      } else if (!timecard?.clockOut) {
        clockBtns = `<button class="journal-clock-btn journal-clock-out" onclick="clockOutFromJournal()">PUNCH OUT</button>`;
      }
    }
    html += `
      <div class="journal-stat-card journal-stat-card-wide">
        <span class="journal-stat-icon">🕐</span>
        <div class="journal-stat-body">
          <span class="journal-stat-label">稼働時間</span>
          <span class="journal-stat-value">${hoursLabel}</span>
        </div>
        ${clockBtns}
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

    summaryEl.innerHTML = html;

    renderPlanActualSummary(date);

    // タスク一覧は時間割の下に表示（PC: 折りたたみ式）
    const taskListEl = document.getElementById('journal-task-list');
    if (taskListEl) {
      const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION', 'completed': 'DONE' };
      const statusColor = { 'not-started': 'var(--text-muted)', 'in-progress': 'var(--primary)', 'revision': '#f97316', 'completed': 'var(--success)' };
      // PC(≥768px)はデフォルト折りたたみ、スマホはデフォルト展開
      const isPC = window.innerWidth >= 768;
      const savedOpen = localStorage.getItem('journal-task-panel-open');
      const isOpen = savedOpen !== null ? savedOpen === '1' : !isPC;
      const chevron = isOpen ? '▲' : '▼';
      let tlHtml = `
        <div class="journal-task-table-section">
          <button class="journal-task-toggle" onclick="toggleJournalTaskPanel()" aria-expanded="${isOpen}">
            <span>📋 今日のタスク <span class="journal-task-count">${dayTasks.length}件</span></span>
            <span class="journal-task-chevron">${chevron}</span>
          </button>
          <div class="journal-task-body" style="display:${isOpen ? 'block' : 'none'};">`;
      if (dayTasks.length > 0) {
        tlHtml += `<div class="journal-task-table">`;
        dayTasks.forEach(t => {
          const spent = fmtSeconds(t.spentSeconds);
          tlHtml += `
            <div class="journal-task-row" onclick="openEditTaskModal('${t.id}')" title="ドラッグして振り返りに追加 / クリックで編集"
              draggable="true" ondragstart="handleTaskDragStart(event, '${t.id}')">
              <span class="journal-task-dot" style="background:${statusColor[t.status] || 'var(--text-muted)'}"></span>
              <span class="journal-task-name">${escapeHtml(t.name)}</span>
              <span class="journal-task-client">${escapeHtml(t.client)}</span>
              <span class="journal-task-status" style="color:${statusColor[t.status]}">${statusLabel[t.status] || t.status}</span>
              ${spent ? `<span class="journal-task-time">⏱ ${spent}</span>` : '<span></span>'}
              <button class="journal-task-pin-btn" onclick="event.stopPropagation();showTimeslotPicker('${t.id}')" title="時間割に追加">📌</button>
              <span class="journal-task-edit-btn" onclick="event.stopPropagation();openEditTaskModal('${t.id}')">✏️</span>
            </div>`;
        });
        tlHtml += '</div>';
      } else {
        tlHtml += `<p class="journal-no-tasks">この日に紐づくタスクはありません</p>`;
      }
      tlHtml += '</div></div>';
      taskListEl.innerHTML = tlHtml;
    }
  }

  // ── テキストエリアに既存エントリを反映 ──
  const textEl = document.getElementById('journal-text');
  const savedAtEl = document.getElementById('journal-saved-at');
  const charCountEl = document.getElementById('journal-char-count');
  const entry = state.journalEntries[date];
  if (textEl) {
    const rawText = entry?.text || '';
    textEl.value = (rawText === 'undefined') ? '' : rawText;
    if (charCountEl) charCountEl.textContent = `${textEl.value.length}文字`;
  }
  if (savedAtEl) {
    savedAtEl.textContent = (entry && entry.updatedAt)
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
      .filter(([d, e]) => (e.text && e.text.trim()) || e.isHoliday)
      .sort(([a], [b]) => b.localeCompare(a)); // 新しい順

    if (countEl) countEl.textContent = `${entries.length}件の記録`;

    if (entries.length === 0) {
      histList.innerHTML = `<p class="journal-no-tasks">まだ記録がありません。今日の振り返りを書いてみましょう！</p>`;
    } else {
      histList.innerHTML = entries.map(([d, e]) => {
        const isActive = d === date;
        const preview = e.text && e.text.trim() ? (e.text.length > 80 ? e.text.slice(0, 80) + '…' : e.text) : (e.isHoliday ? '🌴 休日' : '');
        // その日のタスク数
        const taskCount = state.tasks.filter(t => t.dueDate === d || t.completedAt === d).length;
        // ジャーナルドット for calendar
        const hasJournal = !!state.journalEntries[d]?.text?.trim();
        return `
          <div class="journal-history-item ${isActive ? 'active' : ''}" onclick="jumpToJournalDate('${d}')">
            <div class="journal-history-date">
              ${journalDateLabel(d)}
              ${e.isHoliday ? `<span class="journal-history-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;">🌴 休日</span>` : ''}
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

    // t.id はNumber、taskIdはdataTransfer経由でString → String()で統一比較
    const task = state.tasks.find(t => String(t.id) === String(taskId));
    if (!task) return;

    const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION', 'completed': 'DONE' };
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

// スマホ用：タップで日誌にタスクを追記（タスクリストの 📓 ボタン）
function addTaskToJournal(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  if (!task) return;
  const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION', 'completed': 'DONE' };
  const spent = task.spentSeconds > 0 ? ` ⏱${fmtSeconds(task.spentSeconds)}` : '';
  const line = `\n- 【${statusLabel[task.status] || task.status}】${task.name}（${task.client || '—'}）${spent}`;

  const date = state.journalDate || getLocalDateStr();
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  state.journalEntries[date].text = (state.journalEntries[date].text || '') + line;
  saveJournalToStorage();

  // 日誌タブが開いていれば textarea も更新
  const textEl = document.getElementById('journal-text');
  if (textEl && state.activeTab === 'journal') {
    textEl.value = state.journalEntries[date].text;
  }

  showTrayToast(`📓 「${task.name}」を日誌に追加しました`);
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

// 他タブ（ダッシュボード・週次レポート等）から指定日の日誌へ遷移
function goToJournalDate(dateStr) {
  switchTab('journal');
  jumpToJournalDate(dateStr);
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
  document.body.style.top = '';
  if (state._scrollY) window.scrollTo(0, state._scrollY);
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
    showToastError('このブラウザは音声入力に対応していません。\nChrome または Safari をお試しください。');
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

  const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION' };
  const statusColor = { 'not-started': 'var(--text-muted)', 'in-progress': 'var(--primary)', 'revision': 'var(--primary)', 'completed': 'var(--success)' };

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

    const _h = escapeHtml;
    card.innerHTML = `
      <button type="button" class="tray-card-edit" onclick="openEditTaskModal('${_h(String(task.id))}')">✏️</button>
      <div class="tray-card-name">${_h(task.name || '')}</div>
      <div class="tray-card-meta">
        <span class="tray-card-status" style="color:${statusColor[task.status]||'var(--text-muted)'};">${statusLabel[task.status]||_h(task.status||'')}</span>
        <span style="color:var(--text-muted);">${_h(task.client || '')}</span>
        ${stepsHtml}
      </div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">📅 ${_h(task.dueDate||'日付未設定')}</div>
    `;

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    // ── スワイプジェスチャー（右→完了 / 左→翌日送り） ──
    (function attachSwipe(el, taskId) {
      let startX = 0, startY = 0, moved = false;
      el.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        moved = false;
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
          moved = true;
          const clamp = Math.max(-120, Math.min(120, dx));
          el.style.transform = `translateX(${clamp}px)`;
          el.style.transition = 'none';
          el.style.opacity = 1 - Math.abs(clamp) / 180;
          // 色のヒント
          if (clamp > 30)       el.style.boxShadow = '0 0 0 2px #5a8a5e';
          else if (clamp < -30) el.style.boxShadow = '0 0 0 2px #c8a96e';
          else                  el.style.boxShadow = '';
        }
      }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (!moved) return;
        const dx = e.changedTouches[0].clientX - startX;
        el.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        el.style.transform = '';
        el.style.opacity   = '';
        el.style.boxShadow = '';
        if (dx > 72) {
          // 右スワイプ → 完了
          el.style.transform = 'translateX(110%)';
          el.style.opacity   = '0';
          setTimeout(() => {
            const t = (state.tasks || []).find(t => t.id == taskId);
            if (t) {
              t.status = 'completed';
              t.completedAt = t.completedAt || getLocalDateStr();
              saveTasksToStorage();
              renderTaskTray();
              showUndoBanner('タスクを完了しました', () => {
                t.status = 'in-progress';
                t.completedAt = null;
                saveTasksToStorage(); renderTaskTray();
              });
            }
          }, 240);
        } else if (dx < -72) {
          // 左スワイプ → 翌日送り
          el.style.transform = 'translateX(-110%)';
          el.style.opacity   = '0';
          setTimeout(() => {
            const t = (state.tasks || []).find(t => t.id == taskId);
            if (t) {
              const d = t.dueDate ? parseLocalDate(t.dueDate) : new Date();
              d.setDate(d.getDate() + 1);
              const prev = t.dueDate;
              t.dueDate = toLocalDateStr(d);
              saveTasksToStorage();
              renderTaskTray();
              showUndoBanner('翌日に送りました', () => {
                t.dueDate = prev;
                saveTasksToStorage(); renderTaskTray();
              });
            }
          }, 240);
        }
      }, { passive: true });
    })(card, task.id);

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

  // 月曜始まり: Mon=0, Tue=1, ..., Sun=6
  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
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
  card.setAttribute('data-status', task.status);
  card._prevStatus = task.status;
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

  // Render buttons immediately (modal may not be open)
  const _startBtn = document.getElementById('btn-timer-start');
  const _pauseBtn = document.getElementById('btn-timer-pause');
  if (_startBtn) _startBtn.style.display = 'none';
  if (_pauseBtn) _pauseBtn.style.display = 'inline-flex';

  // Floating banner trigger
  const _bannerTitle = document.getElementById('floating-timer-banner-title');
  const _banner = document.getElementById('floating-timer-banner');
  if (_bannerTitle) _bannerTitle.textContent = task.name;
  if (_banner) _banner.classList.add('active');

  // Clear previous intervals if any
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.timerStartEpoch) / 1000);
    const totalSecs = state.timerAccumulatedSeconds + elapsed;

    // Save live ticks in task state so we don't lose if closed directly
    task.spentSeconds = totalSecs;

    const formatted = formatSecondsToHHMMSS(totalSecs);

    // Update task modal display
    const displayEl = document.getElementById('task-stopwatch-val');
    if (displayEl && state.editingTaskId === taskId) {
      displayEl.textContent = formatted;
    }
    const bannerClock = document.getElementById('floating-timer-banner-clock');
    if (bannerClock) bannerClock.textContent = formatted;

    // Update timeline card SW displays (all cards showing this task)
    document.querySelectorAll('.tl-slot-sw-btn.running .tl-sw-disp').forEach(el => {
      el.textContent = formatted;
    });
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
  migrateTimelineToHalfHour(date);
  const startDate = new Date(record.startEpoch);
  const startMin = startDate.getHours() * 60 + startDate.getMinutes();
  const roundedMin = Math.round(startMin / TL_STEP_MIN) * TL_STEP_MIN;
  if (roundedMin < TL_DAY_START_MIN || roundedMin >= TL_DAY_END_MIN) return;

  const hour = tlMinToHHMM(roundedMin);
  const span = Math.max(1, Math.min(Math.round(record.durationSec / 60 / TL_STEP_MIN), tlMaxSpan(hour)));
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
    const covH = tlAddSteps(hour, i);
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
  if (breakEl) {
    breakEl.textContent = breakSecs > 0 ? fmtDur(breakSecs) : '--';
    breakEl.classList.toggle('bt-break-warn', breakSecs >= 7200);
  }
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

// ============================================================
// 休憩・移動の手動管理（タイマーを使わず分単位で直接入力）
// ============================================================

function openBTManageModal() {
  document.getElementById('bt-manage-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'bt-manage-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:380px;">
      <div class="modal-header">
        <h2 class="modal-title">🍱🚗 休憩・移動を手動管理</h2>
        <button class="modal-close" onclick="document.getElementById('bt-manage-modal').remove()">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem;">
        <div class="form-group">
          <label class="form-label">🍱 休憩を追加（分）</label>
          <div style="display:flex;gap:0.5rem;">
            <input type="number" id="bt-manual-break-min" class="form-control" placeholder="例：30" min="1" step="1" style="flex:1;">
            <button class="btn btn-secondary" onclick="addManualBTRecord('break')">追加</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">🚗 移動を追加（分）</label>
          <div style="display:flex;gap:0.5rem;">
            <input type="number" id="bt-manual-travel-min" class="form-control" placeholder="例：20" min="1" step="1" style="flex:1;">
            <button class="btn btn-secondary" onclick="addManualBTRecord('travel')">追加</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">本日の記録</label>
          <div id="bt-manage-list" class="bt-manage-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="document.getElementById('bt-manage-modal').remove()">閉じる</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  renderBTManageList();
}

function renderBTManageList() {
  const el = document.getElementById('bt-manage-list');
  if (!el) return;
  const date = getLocalDateStr();
  const records = state.journalEntries[date]?.btRecords || [];
  if (!records.length) {
    el.innerHTML = `<div style="font-size:0.82rem;color:var(--text-muted);">まだ記録がありません</div>`;
    return;
  }
  const fmtDur = s => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`;
  };
  el.innerHTML = records.map((r, i) => `
    <div class="bt-manage-row">
      <span class="bt-manage-row-icon">${r.type === 'break' ? '🍱' : '🚗'}</span>
      <span class="bt-manage-row-label">${r.type === 'break' ? '休憩' : '移動'} ${fmtDur(r.durationSec)}${r.manual ? '（手動）' : ''}</span>
      <button class="bt-manage-row-del" onclick="removeBTRecordFromModal(${i})" title="削除">×</button>
    </div>`).join('');
}

function addManualBTRecord(type) {
  const input = document.getElementById(`bt-manual-${type}-min`);
  const minutes = parseInt(input?.value, 10);
  if (!minutes || minutes <= 0) {
    showToastInfo('分数を入力してください。');
    return;
  }
  const date = getLocalDateStr();
  if (!state.journalEntries[date]) state.journalEntries[date] = {};
  if (!state.journalEntries[date].btRecords) state.journalEntries[date].btRecords = [];

  const now = Date.now();
  const record = { type, startEpoch: now - minutes * 60000, endEpoch: now, durationSec: minutes * 60, manual: true };
  state.journalEntries[date].btRecords.push(record);
  syncBTRecordToTimeline(date, record);
  saveJournalToStorage();

  if (input) input.value = '';
  renderBTLog();
  renderBTManageList();
  if (state.activeTab === 'journal') renderJournalTimeline();
  showToastSuccess(`${type === 'break' ? '🍱 休憩' : '🚗 移動'} ${minutes}分を追加しました`);
}

function removeBTRecordFromModal(index) {
  deleteBTRecord(index);
  renderBTManageList();
  if (state.activeTab === 'journal') renderJournalTimeline();
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
  // タイムラインカードのrunningクラスを全て解除（小さいストップウォッチの表示も止める）
  document.querySelectorAll('.tl-slot-sw-btn.running').forEach(btn => {
    btn.classList.remove('running');
    btn.title = '計測開始';
    const disp = btn.querySelector('.tl-sw-disp');
    if (disp && task) disp.textContent = formatSecondsToHHMMSS(task.spentSeconds || 0);
  });
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

// ノルマ日・完成予定日の「バッファ」表示
function _updateBufferHint() {
  const hintEl = document.getElementById('task-buffer-hint');
  if (!hintEl) return;
  const due    = document.getElementById('task-due-date')?.value;
  const target = document.getElementById('task-target-date')?.value;
  if (!due || !target) { hintEl.textContent = ''; return; }
  const dueMs    = new Date(due).getTime();
  const targetMs = new Date(target).getTime();
  const bufDays  = Math.round((dueMs - targetMs) / 86400000);
  if (bufDays < 0) {
    hintEl.textContent = `⚠️ 完成予定がノルマより${Math.abs(bufDays)}日後になっています`;
    hintEl.style.color = 'var(--danger)';
  } else if (bufDays === 0) {
    hintEl.textContent = '⚠️ 完成予定とノルマが同日です。余裕を持つと安心です。';
    hintEl.style.color = 'var(--warning, #f0a030)';
  } else {
    hintEl.textContent = `✓ ノルマまで ${bufDays}日の余裕があります`;
    hintEl.style.color = 'var(--success)';
  }
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
  const _sdEl = document.getElementById('task-start-date'); if (_sdEl) _sdEl.value = '';
  document.getElementById('task-due-date').value = prefilledDate || getLocalDateStr();
  const _tdEl = document.getElementById('task-target-date'); if (_tdEl) _tdEl.value = '';
  const _bufEl = document.getElementById('task-buffer-hint'); if (_bufEl) _bufEl.textContent = '';
  document.getElementById('task-client').value = '';
  document.getElementById('task-amount').value = '';
  document.getElementById('task-estimated-hours').value = '';
  document.getElementById('task-predecessor').value = '';
  document.getElementById('task-deadline-fixed').checked = false;
  document.querySelector(`input[name="task-status"][value="not-started"]`).checked = true;
  const _psEl = document.getElementById('task-payment-status'); if (_psEl) _psEl.value = '';
  const _pgEl = document.getElementById('payment-status-group'); if (_pgEl) _pgEl.style.display = 'none';
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
  const _startEl = document.getElementById('task-start-date');
  if (_startEl) _startEl.value = task.startDate || '';
  document.getElementById('task-due-date').value = task.dueDate || '';
  const _targetEl = document.getElementById('task-target-date');
  if (_targetEl) _targetEl.value = task.targetDate || '';
  _updateBufferHint();
  document.getElementById('task-client').value = task.client;
  setTimeout(updateSamePriceHint, 80);
  document.getElementById('task-amount').value = task.amount;
  document.getElementById('task-estimated-hours').value = task.estimatedHours || '';
  const prioEl = document.getElementById('task-priority');
  if (prioEl) prioEl.value = task.priority || 'medium';
  const wtEl = document.getElementById('task-work-type');
  if (wtEl) wtEl.value = task.workType || '';
  document.getElementById('task-predecessor').value = task.dependsOnTaskId || '';
  document.getElementById('task-deadline-fixed').checked = task.isDeadlineFixed || false;
  // 'done'/'billed'など旧ステータス値も安全に処理
  const _validStatuses = ['not-started', 'in-progress', 'revision', 'completed'];
  const _safeStatus = _validStatuses.includes(task.status) ? task.status : 'not-started';
  const _radioEl = document.querySelector(`input[name="task-status"][value="${_safeStatus}"]`);
  if (_radioEl) _radioEl.checked = true;
  // 入金ステータス
  const _psEditEl = document.getElementById('task-payment-status');
  if (_psEditEl) _psEditEl.value = task.paymentStatus || '';
  const _pgEditEl = document.getElementById('payment-status-group');
  if (_pgEditEl) _pgEditEl.style.display = task.status === 'completed' ? 'block' : 'none';

  initStepsEditor(task);
  updateClientSuggestions();
  updateWorkTypeSuggestions();

  // プロジェクトセレクターを更新
  const projSel = document.getElementById('task-project');
  if (projSel) {
    projSel.innerHTML = '<option value="">\u2014 未分類 \u2014</option>';
    state.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (task.projectId === p.id) opt.selected = true;
      projSel.appendChild(opt);
    });
  }

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
  const _projSelAuto = document.getElementById('task-project');
  if (_projSelAuto) task.projectId = _projSelAuto.value || null;

  if (newStatus === 'completed' && oldStatus !== 'completed') {
    task.completedAt = getLocalDateStr();
    if (state.activeTimerTaskId === id) pauseTaskTimer();
    state._pendingReportTask = task;
    // 完了スタンプアニメーション
    setTimeout(() => {
      const card = document.querySelector(`[data-task-id="${id}"]`);
      if (card) {
        card.style.position = 'relative';
        card.classList.add('stamp-complete-anim');
        if (navigator.vibrate) navigator.vibrate([20, 40, 60]);
        setTimeout(() => card.classList.remove('stamp-complete-anim'), 700);
      }
    }, 100);
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
  const startDate = document.getElementById('task-start-date')?.value || null;
  const dueDate = isUnscheduled ? null : (document.getElementById('task-due-date').value || null);
  const targetDate = document.getElementById('task-target-date')?.value || null;
  const client = document.getElementById('task-client').value.trim();
  const amount = parseFloat(document.getElementById('task-amount').value) || 0;
  const estimatedHours = parseFloat(document.getElementById('task-estimated-hours').value) || 0;
  const _statusRadio = document.querySelector('input[name="task-status"]:checked');
  const status = _statusRadio ? _statusRadio.value : 'not-started';
  const dependsOnTaskId = document.getElementById('task-predecessor').value || null;
  const isDeadlineFixed = document.getElementById('task-deadline-fixed').checked;
  const priority = document.getElementById('task-priority')?.value || 'medium';
  const workType = document.getElementById('task-work-type')?.value.trim() || '';
  const paymentStatus = document.getElementById('task-payment-status')?.value || '';

  if (!name || !client || (!isUnscheduled && !dueDate)) {
    showToastError('タスク名、クライアント名は必須です。期日がある場合は入力してください。');
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
      task.startDate = startDate;
      task.dueDate = dueDate;
      task.targetDate = targetDate;
      task.client = client;
      task.amount = amount;
      task.estimatedHours = estimatedHours;
      task.status = status;
      task.dependsOnTaskId = dependsOnTaskId;
      task.isDeadlineFixed = isDeadlineFixed;
      task.priority = priority;
      task.workType = workType;
      task.paymentStatus = paymentStatus;
      const _projSelSub = document.getElementById('task-project');
      if (_projSelSub) task.projectId = _projSelSub.value || null;
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
      startDate,
      dueDate,
      targetDate,
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
      paymentStatus,
      projectId: (document.getElementById('task-project')?.value) || null,
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
  try {
    const today = getLocalDateStr();
    const _parseDateMs = s => { const [y,m,d] = s.split('-'); return new Date(+y, +m-1, +d).getTime(); };
    const todayMs = _parseDateMs(today);
    let shown = {};
    try { shown = JSON.parse(localStorage.getItem('reminderShown') || '{}') || {}; } catch(_) {}
    const newShown = { ...shown };

    (state.tasks || [])
      .filter(t => t.status !== 'completed' && t.dueDate)
      .forEach(t => {
        try {
          const dueMs = _parseDateMs(t.dueDate);
          const diffDays = Math.round((dueMs - todayMs) / 86400000);
          const key = `${t.id}-${t.dueDate}`;
          const name = t.name ? `「${t.name}」` : 'タスク';

          if (diffDays === 0 && !shown[key + '-0']) {
            new Notification('🚨 本日締め切り！', { body: `${name}の納期は今日です`, icon: './app-icon.png' });
            newShown[key + '-0'] = true;
          } else if (diffDays === 1 && !shown[key + '-1']) {
            new Notification('⚠️ 明日締め切り', { body: `${name}の納期は明日です`, icon: './app-icon.png' });
            newShown[key + '-1'] = true;
          } else if (diffDays === 3 && !shown[key + '-3']) {
            new Notification('📌 締め切り3日前', { body: `${name}の納期まであと3日です`, icon: './app-icon.png' });
            newShown[key + '-3'] = true;
          }
        } catch(_) {}
      });

    try { localStorage.setItem('reminderShown', JSON.stringify(newShown)); } catch(_) {}
  } catch(e) {
    console.warn('[TINYPERK] checkDeadlineReminders error:', e);
  }
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
  if (!selectedMonth) { showToastError('対象月を選択してください'); return; }
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
  const withholding = document.getElementById('invoice-withholding')?.checked;
  const withholdingAmt = withholding ? Math.round(subtotal * 0.1021) : 0;
  const netTotal = total - withholdingAmt;
  // クライアントによって税込/税抜の希望が異なるため切替可能（デフォルト: 税抜き）
  const taxExclMode = document.getElementById('invoice-tax-excl')?.checked ?? true;
  const mainAmountLabel = `ご請求金額（${taxExclMode ? '税抜' : '税込'}${withholding ? '・源泉控除後' : ''}）`;
  const mainAmount = taxExclMode ? (subtotal - withholdingAmt) : netTotal;

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
        <span style="font-size:0.9rem;">${mainAmountLabel}</span>
        <span style="font-size:2rem; font-weight:900; margin-left:1rem; color:#1a1a2e;">¥${new Intl.NumberFormat('ja-JP').format(mainAmount)}</span>
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
          ${taxExclMode ? '' : `
          <tr>
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">消費税（10%）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(tax)}</td>
          </tr>
          `}
          <tr style="background:#f0f0f0; font-weight:700;">
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">合計（${taxExclMode ? '税抜' : '税込'}）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(taxExclMode ? subtotal : total)}</td>
          </tr>
          ${withholding ? `
          <tr>
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right; color:#c0392b;">源泉徴収税額（10.21%）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right; color:#c0392b;">▲¥${new Intl.NumberFormat('ja-JP').format(withholdingAmt)}</td>
          </tr>
          <tr style="background:#fff3e0; font-weight:900; font-size:1.05em;">
            <td colspan="5" style="padding:0.5rem 0.75rem; border:2px solid #e67e22; text-align:right;">差引ご請求金額</td>
            <td style="padding:0.5rem 0.75rem; border:2px solid #e67e22; text-align:right; color:#d35400;">¥${new Intl.NumberFormat('ja-JP').format(mainAmount)}</td>
          </tr>
          ` : ''}
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
  // 完了売上（税抜・確定分）
  const totalAmount = Math.round(completedTasks.reduce((sum, t) => sum + (t.amount || 0), 0));
  const taskCount = completedTasks.length;

  // 見込み売上（税抜・未完了分）— 対象月に期日があり、まだ完了していないタスク
  const forecastTasks = state.tasks.filter(task => {
    if (task.status === 'completed') return false;
    if (selectedClient !== 'all' && task.client !== selectedClient) return false;
    return (task.dueDate || '').startsWith(selectedMonth);
  });
  const totalForecast = Math.round(forecastTasks.reduce((sum, t) => sum + (t.amount || 0), 0));

  // 4. 月間休日数
  const totalHolidays = Object.entries(state.journalEntries || {})
    .filter(([d, e]) => d.startsWith(selectedMonth) && e.isHoliday).length;

  // Render KPI values
  animateCounter(document.getElementById('report-total-count'), taskCount);
  animateCounter(document.getElementById('report-total-amount'), totalAmount, true);
  const forecastEl = document.getElementById('report-total-forecast');
  if (forecastEl) forecastEl.textContent = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(totalForecast);
  const holidaysEl = document.getElementById('report-total-holidays');
  if (holidaysEl) holidaysEl.textContent = `${totalHolidays} 日`;
  
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
  // 入金管理
  renderPaymentTracker();

  completedTasks.forEach(task => {
    const taxExcl = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(task.amount || 0);
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
        ${taxExcl}
        <br><small style="color: var(--text-muted); font-weight:400;">（税抜）</small>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}



// ── 入金管理 ──────────────────────────────────────────────────────────────
function renderPaymentTracker() {
  const section = document.getElementById('payment-tracker-section');
  const el = document.getElementById('payment-tracker-content');
  if (!el) return;

  const billable = state.tasks.filter(t => t.status === 'completed' && (t.amount || 0) > 0);
  if (billable.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = 'block';

  const fmt = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
  const groups = [
    { key: '', label: '💼 未請求', color: '#64748b', tasks: billable.filter(t => !t.paymentStatus) },
    { key: 'invoiced', label: '📤 請求済み', color: '#f59e0b', tasks: billable.filter(t => t.paymentStatus === 'invoiced') },
    { key: 'paid', label: '✅ 入金済み', color: '#16a34a', tasks: billable.filter(t => t.paymentStatus === 'paid') }
  ];

  const totalUnpaid = groups[0].tasks.reduce((s,t)=>s+(t.amount||0),0);
  const totalInvoiced = groups[1].tasks.reduce((s,t)=>s+(t.amount||0),0);
  const totalPaid = groups[2].tasks.reduce((s,t)=>s+(t.amount||0),0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:1.25rem;">
      <div style="background:var(--bg-secondary);border-radius:10px;padding:0.85rem;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem;">未請求</div>
        <div style="font-size:1.1rem;font-weight:700;color:#64748b;">${fmt(totalUnpaid)}</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:10px;padding:0.85rem;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem;">請求済み</div>
        <div style="font-size:1.1rem;font-weight:700;color:#f59e0b;">${fmt(totalInvoiced)}</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:10px;padding:0.85rem;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem;">入金済み</div>
        <div style="font-size:1.1rem;font-weight:700;color:#16a34a;">${fmt(totalPaid)}</div>
      </div>
    </div>
    ${groups.map(g => g.tasks.length === 0 ? '' : `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.82rem;font-weight:700;color:${g.color};margin-bottom:0.5rem;">${g.label} (${g.tasks.length}件 / ${fmt(g.tasks.reduce((s,t)=>s+(t.amount||0),0))})</div>
        ${g.tasks.slice(0,8).map(t => `
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0;border-bottom:1px solid var(--border-light);">
            <div style="flex:1;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(t.name)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${t.client||''}</div>
            <div style="font-size:0.82rem;font-weight:700;white-space:nowrap;">${fmt(t.amount||0)}</div>
            <select onchange="setPaymentStatus('${t.id}',this.value)" style="font-size:0.75rem;padding:0.2rem 0.35rem;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;">
              <option value="" ${!t.paymentStatus?'selected':''}>未請求</option>
              <option value="invoiced" ${t.paymentStatus==='invoiced'?'selected':''}>請求済み</option>
              <option value="paid" ${t.paymentStatus==='paid'?'selected':''}>入金済み</option>
            </select>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
}

function setPaymentStatus(taskId, status) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.paymentStatus = status;
  saveTasksToStorage();
  renderPaymentTracker();
}

// ── 見積書 ──────────────────────────────────────────────────────────────────
function openEstimateModal() {
  closeInvoiceModal();
  document.getElementById('estimate-modal-overlay').style.display = 'flex';
  refreshEstimatePreview();
}

function closeEstimateModal() {
  document.getElementById('estimate-modal-overlay').style.display = 'none';
}

function refreshEstimatePreview() {
  const client = document.getElementById('estimate-client')?.value.trim() || '';
  const days = parseInt(document.getElementById('estimate-validity')?.value || '30');
  renderEstimatePreview(client, days);
}

function renderEstimatePreview(clientName, validDays = 30) {
  const bi = state.businessInfo;
  const issueDate = getLocalDateStr();
  const expiryD = new Date(); expiryD.setDate(expiryD.getDate() + validDays);
  const expiryDate = toLocalDateStr(expiryD);

  // Use active (non-completed) tasks as estimate items, or allow manual items
  const estimateTasks = state.tasks.filter(t =>
    t.status !== 'completed' && t.amount > 0 &&
    (!clientName || t.client.includes(clientName) || clientName.includes(t.client))
  );

  const subtotal = estimateTasks.reduce((s, t) => s + (t.amount || 0), 0);
  const tax = Math.round(subtotal * 0.1);
  const total = subtotal + tax;
  const displayClient = clientName || '（クライアント名を入力）';
  // クライアントによって税込/税抜の希望が異なるため切替可能（デフォルト: 税抜き）
  const taxExclMode = document.getElementById('estimate-tax-excl')?.checked ?? true;
  const mainAmount = taxExclMode ? subtotal : total;

  const rows = estimateTasks.length > 0 ? estimateTasks.map((t, i) => `
    <tr>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc;">${i+1}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc;">${escapeHTML(t.name)}${t.workType?` <span style="font-size:0.8em;color:#888;">[${escapeHTML(t.workType)}]</span>`:''}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:center;">${t.estimatedHours ? t.estimatedHours+'h' : '—'}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">1</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">${new Intl.NumberFormat('ja-JP').format(t.amount || 0)}</td>
      <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">${new Intl.NumberFormat('ja-JP').format(t.amount || 0)}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" style="padding:1rem; text-align:center; border:1px solid #ccc; color:#888;">進行中のタスクがありません（上部でクライアント名を入力してください）</td></tr>';

  const preview = document.getElementById('estimate-preview');
  preview.innerHTML = `
    <div id="estimate-print-area" style="background:#fff; color:#222; padding:2rem; font-family:'Noto Sans JP',sans-serif; font-size:0.9rem; max-width:720px; margin:0 auto; border:1px solid #ddd;">
      <h1 style="text-align:center; font-size:1.8rem; letter-spacing:0.2em; margin-bottom:2rem; color:#222;">御　見　積　書</h1>

      <div style="display:flex; justify-content:space-between; margin-bottom:2rem; gap:1rem; flex-wrap:wrap;">
        <div>
          <div style="font-size:1.1rem; font-weight:700; border-bottom:2px solid #222; padding-bottom:0.25rem; margin-bottom:0.5rem;">${escapeHTML(displayClient)} 御中</div>
          <div style="font-size:0.85rem; color:#555;">見積発行日: ${issueDate}</div>
          <div style="font-size:0.85rem; color:#c0392b;">有効期限: ${expiryDate}（${validDays}日間）</div>
        </div>
        <div style="text-align:right; font-size:0.85rem; line-height:1.7;">
          <div style="font-size:1rem; font-weight:700;">${escapeHTML(bi.company || bi.name || '')}</div>
          ${bi.company && bi.name ? `<div>${escapeHTML(bi.name)}</div>` : ''}
          ${bi.address ? `<div>${escapeHTML(bi.address)}</div>` : ''}
          ${bi.phone ? `<div>TEL: ${escapeHTML(bi.phone)}</div>` : ''}
          ${bi.email ? `<div>${escapeHTML(bi.email)}</div>` : ''}
          ${bi.invoiceNumber ? `<div style="margin-top:0.25rem; font-size:0.8rem; color:#666;">登録番号: ${escapeHTML(bi.invoiceNumber)}</div>` : ''}
        </div>
      </div>

      <div style="background:#f5f5f5; border:1px solid #ccc; padding:1rem 1.5rem; margin-bottom:1.5rem; border-radius:4px;">
        <span style="font-size:0.9rem;">御見積金額（${taxExclMode ? '税抜' : '税込'}）</span>
        <span style="font-size:2rem; font-weight:900; margin-left:1rem; color:#1a1a2e;">¥${new Intl.NumberFormat('ja-JP').format(mainAmount)}</span>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:1.5rem;">
        <thead>
          <tr style="background:#222; color:#fff;">
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:2.5rem;">#</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc;">品目・作業内容</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:4rem; text-align:center;">想定時間</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:3rem; text-align:right;">数量</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:6rem; text-align:right;">単価</th>
            <th style="padding:0.5rem 0.75rem; border:1px solid #ccc; width:6rem; text-align:right;">金額</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right; font-weight:700;">小計</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(subtotal)}</td>
          </tr>
          ${taxExclMode ? '' : `
          <tr>
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">消費税（10%）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(tax)}</td>
          </tr>
          `}
          <tr style="background:#f0f0f0; font-weight:700;">
            <td colspan="5" style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">合計（${taxExclMode ? '税抜' : '税込'}）</td>
            <td style="padding:0.5rem 0.75rem; border:1px solid #ccc; text-align:right;">¥${new Intl.NumberFormat('ja-JP').format(mainAmount)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:1.5rem; font-size:0.8rem; color:#888;">
        <div style="font-weight:700; margin-bottom:0.25rem; color:#444;">備考</div>
        <div>・本見積書の有効期限は${expiryDate}までです。</div>
        <div>・消費税は10%で計算しています。</div>
        ${bi.invoiceNumber ? '<div>・適格請求書発行事業者（インボイス登録済み）</div>' : ''}
      </div>
    </div>
  `;
}

// ── 確定申告サポートカード ────────────────────────────────────────────────────
function renderAnnualTaxSupportCard() {
  const thisYear = new Date().getFullYear().toString();
  const yearRevenue = state.tasks
    .filter(t => t.status === 'completed' && t.completedAt && t.completedAt.startsWith(thisYear))
    .reduce((s, t) => s + (t.amount || 0), 0);
  const yearExpenses = state.expenses
    .filter(e => e.date && e.date.startsWith(thisYear))
    .reduce((s, e) => s + (e.amount || 0), 0);
  const netIncome = yearRevenue - yearExpenses;
  const basicDeduction = 480000; // 基礎控除（令和6年〜）
  const blueDeduction  = 650000; // 青色申告特別控除（65万円）
  const taxableIncome = Math.max(0, netIncome - basicDeduction - blueDeduction);

  // 所得税速算表（令和5年分）
  let estimatedTax = 0;
  if (taxableIncome <= 1950000)      estimatedTax = taxableIncome * 0.05;
  else if (taxableIncome <= 3300000) estimatedTax = taxableIncome * 0.10 - 97500;
  else if (taxableIncome <= 6950000) estimatedTax = taxableIncome * 0.20 - 427500;
  else if (taxableIncome <= 9000000) estimatedTax = taxableIncome * 0.23 - 636000;
  else                               estimatedTax = taxableIncome * 0.33 - 1536000;
  estimatedTax = Math.max(0, Math.round(estimatedTax));

  const fmt = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');

  return `
    <div style="background:linear-gradient(135deg,var(--bg-secondary),var(--primary-glow));border:1px solid var(--border-color);border-radius:14px;padding:1.25rem;margin-bottom:1.25rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;">
        <span style="font-size:1.2rem;">🗂️</span>
        <span style="font-weight:700;font-size:0.95rem;">${thisYear}年 確定申告サポート</span>
        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">概算・参考値</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.65rem;margin-bottom:0.75rem;">
        <div style="background:var(--bg-card);border-radius:10px;padding:0.75rem;">
          <div style="font-size:0.72rem;color:var(--text-muted);">年間売上（税別）</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--success);">${fmt(yearRevenue)}</div>
        </div>
        <div style="background:var(--bg-card);border-radius:10px;padding:0.75rem;">
          <div style="font-size:0.72rem;color:var(--text-muted);">年間経費</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--danger);">${fmt(yearExpenses)}</div>
        </div>
        <div style="background:var(--bg-card);border-radius:10px;padding:0.75rem;">
          <div style="font-size:0.72rem;color:var(--text-muted);">差引所得（概算）</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--primary);">${fmt(netIncome)}</div>
        </div>
        <div style="background:var(--bg-card);border-radius:10px;padding:0.75rem;">
          <div style="font-size:0.72rem;color:var(--text-muted);">推定所得税（概算）</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--warning);">${fmt(estimatedTax)}</div>
        </div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.6;">
        ※ 青色申告特別控除65万円・基礎控除48万円を適用した概算です。社会保険料控除等は含みません。正確な税額は税理士へご相談ください。
      </div>
    </div>
  `;
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
                <span style="font-size:0.95rem;font-weight:700;color:var(--text-main);">${fmt(g.revenue)}</span>
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
      合計: ${fmt(totalRev)}（税抜）
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
            <span><strong style="color:var(--text-main);">${avgA}h</strong> 平均（${minA}h〜${maxA}h）</span>
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
    const amountStr = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round(data.amount));
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
      showToastError('無効な共有リンクです。');
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

      <div style="display:flex; flex-direction:column; gap:1rem; background-color:var(--bg-dark); padding:1.25rem; border-radius:var(--radius-md); border:1px solid var(--border-color);">
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
        <div style="padding:1rem; background-color:var(--bg-dark); border-radius:var(--radius-md); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
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
    showToastInfo(successMsg);
  }).catch(err => {
    window.prompt('コピーするには下のリンクを選択してください:', text);
  });
}

function statusToJapanese(status) {
  switch (status) {
    case 'not-started': return 'PENDING';
    case 'in-progress': return 'IN PROGRESS';
    case 'revision': return 'REVISION';
    case 'completed': return 'DONE';
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
    showToastSuccess('Google Client IDを保存しました！');
    renderGoogleStatusUI();
  } else {
    showToastError('有効なClient IDを入力してください。');
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
    showToastError('まずSettingsでGoogle Client IDを入力し保存してください。');
    return;
  }

  if (typeof google === 'undefined') {
    showToastError('Google APIクライアントの読み込みに失敗しました。インターネット接続と、広告ブロッカーの設定を確認してください。');
    return;
  }

  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: state.googleClientId,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          state.googleAccessToken = tokenResponse.access_token;
          showToastSuccess('Googleカレンダーに正常に接続されました！');
          renderGoogleStatusUI();
          bulkSyncTasksToGoogle();
        }
      }
    });
    client.requestAccessToken();
  } catch (err) {
    console.error('Google auth error:', err);
    showToastError('認証開始中にエラーが発生しました: ' + err.message);
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
function saveDeals()    { try { localStorage.setItem('deals',    JSON.stringify(state.deals));    } catch(e){} scheduleSyncToSupabase(); }
function saveContacts() { try { localStorage.setItem('contacts', JSON.stringify(state.contacts)); } catch(e){} scheduleSyncToSupabase(); }
function saveGoals()    { try { localStorage.setItem('goals',    JSON.stringify(state.goals));    } catch(e){} scheduleSyncToSupabase(); }
function saveLearningLogs() { try { localStorage.setItem('learningLogs', JSON.stringify(state.learningLogs)); } catch(e){} scheduleSyncToSupabase(); }
function saveExpenses() { try { localStorage.setItem('expenses', JSON.stringify(state.expenses)); } catch(e){} scheduleSyncToSupabase(); }
function saveIdeas()    { try { localStorage.setItem('ideas',    JSON.stringify(state.ideas));    } catch(e){} scheduleSyncToSupabase(); }

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
  const pipeline = active.reduce((s,d) => s + (d.amount||0), 0);
  const wonAmt   = won.reduce((s,d) => s + (d.amount||0), 0);
  el.innerHTML = `
    <div class="deal-stat-card">
      <div class="deal-stat-label">パイプライン総額</div>
      <div class="deal-stat-value" style="color:var(--primary)">¥${pipeline.toLocaleString()}</div>
      <div class="deal-stat-sub">合計金額</div>
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
          <input type="text" id="deal-title" class="form-control" placeholder="例: LP制作" value="${escHtml(deal?.title||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">クライアント名</label>
          <input type="text" id="deal-client" class="form-control" placeholder="会社名・個人名" value="${escHtml(deal?.client||'')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">ステージ</label>
            <select id="deal-stage" class="form-control">${stageOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">確度 (%)</label>
            <input type="number" id="deal-probability" class="form-control" min="0" max="100" value="${deal?.probability||50}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">金額 (税抜)</label>
            <input type="number" id="deal-amount" class="form-control" placeholder="0" value="${deal?.amount||''}">
          </div>
          <div class="form-group">
            <label class="form-label">期限</label>
            <input type="date" id="deal-due" class="form-control" value="${deal?.dueDate||''}">
          </div>
        </div>
        ${contactOptions ? `<div class="form-group"><label class="form-label">コンタクト紐付け</label><select id="deal-contact" class="form-control"><option value="">なし</option>${contactOptions}</select></div>` : ''}
        <div class="form-group">
          <label class="form-label">メモ</label>
          <textarea id="deal-notes" class="form-control" rows="3" placeholder="商談内容・次のアクションなど">${escHtml(deal?.notes||'')}</textarea>
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
  showToastSuccess(`タスク「${deal.title}」を追加しました。`);
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
          ${c.area ? `<div class="contact-meta">🗺️ ${escHtml(c.area)}</div>` : ''}
        </div>
        <div class="contact-right">
          ${c.relationship ? `<div class="contact-relationship">${escHtml(c.relationship)}</div>` : ''}
          <div class="contact-meet-row" onclick="event.stopPropagation()">
            <span class="contact-meet-count">🤝 ${c.meetCount || 0}回</span>
            <button class="contact-meet-plus" onclick="incrementMeetCount('${c.id}', event)" title="会った回数を+1">＋1</button>
          </div>
          ${tag && tag.key !== 'all' ? `<span class="contact-tag" style="background:${tag.color}22;color:${tag.color}">${tag.label}</span>` : ''}
          ${c.followUpDate ? `<div class="contact-followup ${overdue?'overdue':soon?'soon':''}">${overdue?'⚠️ ':soon?'⏰ ':'📅 '}${c.followUpDate.slice(5)}</div>` : ''}
          ${getClientRelationBadge(c.name)}
        </div>
      </div>`;
  }).join('');
}

function incrementMeetCount(id, event) {
  if (event) event.stopPropagation();
  const c = state.contacts.find(x => x.id === id);
  if (!c) return;
  c.meetCount = (c.meetCount || 0) + 1;
  saveContacts();
  renderContacts();
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
      <div class="ocr-bar">
        <button class="btn-ocr" id="btn-ocr" onclick="scanBusinessCard()">📷 名刺を読み取る</button>
        <input type="file" id="business-card-input" accept="image/*" style="display:none" onchange="processBizCardImage(event)">
        <span id="ocr-status" class="ocr-status-msg" style="display:none"></span>
      </div>
      <div class="modal-body">
        <input type="hidden" id="contact-edit-id" value="${c?.id||''}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">お名前 <span style="color:var(--danger)">*</span></label>
            <input type="text" id="contact-name" class="form-control" placeholder="山田 太郎" value="${escHtml(c?.name||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">会社名</label>
            <input type="text" id="contact-company" class="form-control" placeholder="株式会社〇〇" value="${escHtml(c?.company||'')}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">タグ</label>
            <select id="contact-tag" class="form-control">${tagOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">出会った日</label>
            <input type="date" id="contact-met-date" class="form-control" value="${c?.metDate||''}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">出会った場所・きっかけ</label>
          <input type="text" id="contact-met-at" class="form-control" placeholder="〇〇交流会、SNSなど" value="${escHtml(c?.metAt||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">活動エリア <span style="font-size:0.8em;color:var(--text-muted)">（市区町村・地域名。地図表示に使用）</span></label>
          <input type="text" id="contact-area" class="form-control" placeholder="渋谷区、大阪市など" value="${escHtml(c?.area||'')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">関係性</label>
            <input type="text" id="contact-relationship" class="form-control" placeholder="取引先、友人、紹介者など" value="${escHtml(c?.relationship||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">会った回数</label>
            <input type="number" id="contact-meet-count" class="form-control" min="0" step="1" value="${c?.meetCount||0}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">メール</label>
            <input type="email" id="contact-email" class="form-control" value="${escHtml(c?.email||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">電話番号</label>
            <input type="tel" id="contact-phone" class="form-control" value="${escHtml(c?.phone||'')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">フォロー期日 <span style="font-size:0.8em;color:var(--text-muted)">（この日までに連絡する）</span></label>
          <input type="date" id="contact-followup" class="form-control" value="${c?.followUpDate||''}">
        </div>
        ${dealOptions ? `<div class="form-group"><label class="form-label">紐付け案件</label><select id="contact-deal" class="form-control"><option value="">なし</option>${dealOptions}</select></div>` : ''}
        <div class="form-group">
          <label class="form-label">メモ</label>
          <textarea id="contact-notes" class="form-control" rows="3" placeholder="共通の話題、次回話したいことなど">${escHtml(c?.notes||'')}</textarea>
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
    area: document.getElementById('contact-area').value.trim(),
    relationship: document.getElementById('contact-relationship').value.trim(),
    meetCount: parseInt(document.getElementById('contact-meet-count').value) || 0,
    email: document.getElementById('contact-email').value.trim(),
    phone: document.getElementById('contact-phone').value.trim(),
    followUpDate: document.getElementById('contact-followup').value,
    linkedDealId: document.getElementById('contact-deal')?.value||'',
    notes: document.getElementById('contact-notes').value.trim(),
    createdAt: id ? (state.contacts.find(c=>c.id===id)?.createdAt||getLocalDateStr()) : getLocalDateStr()
  };
  // 活動エリアが変わっていなければ、地図用の座標キャッシュを保持（変わったら再取得させる）
  if (id) {
    const prev = state.contacts.find(c => c.id === id);
    if (prev && prev.area === contact.area && prev.areaCoords) contact.areaCoords = prev.areaCoords;
  }
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
// 🗺️ 地図機能（移動先ピン留め / コンタクト活動エリア表示）
// 共通: Leaflet + OpenStreetMap（APIキー不要）
// ============================================================

// 活動エリア名 → おおよその緯度経度（Nominatim無料ジオコーディング）
async function geocodeAreaText(query) {
  if (!query) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) { /* オフライン・APIエラー時は無視 */ }
  return null;
}

function closeMapModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    if (el._leafletMap) { try { el._leafletMap.remove(); } catch (e) {} }
    el.remove();
  }
}

// ── 移動・所用スロットの地図ピン留め ──
function openLocationPinModal(date, hour) {
  if (typeof L === 'undefined') { showToastSuccess('⚠️ 地図の読み込みに失敗しました。オンライン環境で再度お試しください'); return; }
  document.getElementById('pin-map-modal')?.remove();
  const slot = state.journalEntries?.[date]?.timeline?.[hour];
  if (!slot) return;
  const existing = slot.location || null;

  const modal = document.createElement('div');
  modal.id = 'pin-map-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <h2 class="modal-title">📍 行き先をピン留め</h2>
        <button class="modal-close" onclick="closeMapModal('pin-map-modal')">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:0.75rem;">
        <div style="font-size:0.8rem;color:var(--text-muted);">地図をタップしてピンを立ててください</div>
        <div id="pin-map-canvas" style="width:100%;height:260px;border-radius:10px;overflow:hidden;border:1px solid var(--border);"></div>
        <div class="form-group">
          <label class="form-label">メモ（任意）</label>
          <input type="text" id="pin-map-label" class="form-control" placeholder="例：A社オフィス" value="${existing ? escHtml(existing.label || '') : ''}">
        </div>
        ${existing ? `<button type="button" class="btn btn-secondary" style="align-self:flex-start;" onclick="openLocationInMaps(${existing.lat},${existing.lng},event)">🧭 Googleマップで開く</button>` : ''}
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        ${existing ? `<button class="btn btn-danger" onclick="removeSlotLocation('${date}','${hour}')">ピンを削除</button>` : '<div></div>'}
        <div style="display:flex;gap:0.75rem;">
          <button class="btn btn-secondary" onclick="closeMapModal('pin-map-modal')">キャンセル</button>
          <button class="btn btn-primary" onclick="saveSlotLocation('${date}','${hour}')">保存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  setTimeout(() => {
    const center = existing ? [existing.lat, existing.lng] : [35.681236, 139.767125]; // デフォルト: 東京駅
    const map = L.map('pin-map-canvas').setView(center, existing ? 15 : 11);
    modal._leafletMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);
    let marker = existing ? L.marker(center).addTo(map) : null;
    modal._pinLatLng = existing ? { lat: existing.lat, lng: existing.lng } : null;
    map.on('click', (e) => {
      modal._pinLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (marker) marker.setLatLng(e.latlng); else marker = L.marker(e.latlng).addTo(map);
    });
  }, 50);
}

function saveSlotLocation(date, hour) {
  const modal = document.getElementById('pin-map-modal');
  const latLng = modal?._pinLatLng;
  if (!latLng) { showToastSuccess('⚠️ 地図をタップしてピンを立ててください'); return; }
  const label = document.getElementById('pin-map-label')?.value.trim() || '';
  const slot = state.journalEntries?.[date]?.timeline?.[hour];
  if (!slot) return;
  slot.location = { lat: latLng.lat, lng: latLng.lng, label };
  saveJournalToStorage();
  closeMapModal('pin-map-modal');
  renderJournalTimeline();
  showToastSuccess('📍 行き先を保存しました');
}

function removeSlotLocation(date, hour) {
  const slot = state.journalEntries?.[date]?.timeline?.[hour];
  if (slot) delete slot.location;
  saveJournalToStorage();
  closeMapModal('pin-map-modal');
  renderJournalTimeline();
}

function openLocationInMaps(lat, lng, event) {
  if (event) event.stopPropagation();
  window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank', 'noopener');
}

// ── コンタクト一覧の地図表示 ──
async function openContactsMapModal() {
  if (typeof L === 'undefined') { showToastSuccess('⚠️ 地図の読み込みに失敗しました。オンライン環境で再度お試しください'); return; }
  document.getElementById('contacts-map-modal')?.remove();
  const targets = state.contacts.filter(c => c.area && c.area.trim());

  const modal = document.createElement('div');
  modal.id = 'contacts-map-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:520px;">
      <div class="modal-header">
        <h2 class="modal-title">🗺️ コンタクトを地図で見る</h2>
        <button class="modal-close" onclick="closeMapModal('contacts-map-modal')">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:0.5rem;">
        ${targets.length ? '' : `<div class="empty-state"><div class="empty-state-body">コンタクトに「活動エリア」を登録すると、ここに地図表示されます</div></div>`}
        <div id="contacts-map-status" style="font-size:0.78rem;color:var(--text-muted);"></div>
        <div id="contacts-map-canvas" style="width:100%;height:360px;border-radius:10px;overflow:hidden;border:1px solid var(--border);${targets.length?'':'display:none;'}"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeMapModal('contacts-map-modal')">閉じる</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  if (!targets.length) return;

  const statusEl = document.getElementById('contacts-map-status');
  statusEl.textContent = '地図を読み込み中…';

  const map = L.map('contacts-map-canvas').setView([35.681236, 139.767125], 6);
  modal._leafletMap = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19
  }).addTo(map);

  const points = [];
  let didCacheUpdate = false;
  for (const c of targets) {
    if (!document.getElementById('contacts-map-modal')) return; // モーダルが閉じられたら中断
    let coords = c.areaCoords;
    if (!coords) {
      coords = await geocodeAreaText(c.area);
      if (coords) { c.areaCoords = coords; didCacheUpdate = true; }
      await new Promise(r => setTimeout(r, 1100)); // Nominatim利用ポリシー: 1req/秒以下
    }
    if (coords) {
      const marker = L.marker([coords.lat, coords.lng]).addTo(map);
      marker.bindPopup(`<strong>${escHtml(c.name)}</strong>${c.company ? `<br>${escHtml(c.company)}` : ''}<br>📍 ${escHtml(c.area)}`);
      points.push([coords.lat, coords.lng]);
    }
  }
  if (didCacheUpdate) saveContacts();
  if (points.length) map.fitBounds(points, { padding: [30, 30], maxZoom: 13 });
  statusEl.textContent = `${points.length}/${targets.length}件を表示中`;
}

// ============================================================
// 🎯 GOALS — 目標管理
// ============================================================
// ── 学習タイプ定義 ──
const LEARNING_TYPES = [
  { key:'book',    emoji:'📖', label:'書籍',       unit:'ページ', unitShort:'p' },
  { key:'video',   emoji:'🎥', label:'動画/コース', unit:'時間',   unitShort:'h' },
  { key:'article', emoji:'📄', label:'記事/ドキュメント', unit:'%', unitShort:'%' },
  { key:'course',  emoji:'🎓', label:'オンラインコース', unit:'%', unitShort:'%' },
  { key:'podcast', emoji:'🎧', label:'ポッドキャスト', unit:'時間', unitShort:'h' },
];

function getLearningType(key) {
  return LEARNING_TYPES.find(t => t.key === key) || LEARNING_TYPES[0];
}

function renderLearningGoalCard(gLearn, thisMonth) {
  // タスクの 学習・書籍 workType からの稼働時間
  const taskLearnSecs = state.tasks
    .filter(t => t.workType === '学習・書籍' && t.spentSeconds > 0)
    .reduce((s, t) => s + (t.spentSeconds || 0), 0);
  const taskLearnH = Math.round(taskLearnSecs / 3600 * 10) / 10;

  // 学習ログの合計時間換算（動画・ポッドキャストは h、書籍はページ/300→h換算）
  const logH = state.learningLogs.reduce((s, l) => {
    const t = getLearningType(l.type);
    if (t.unitShort === 'h') return s + (l.progress || 0);
    if (t.unitShort === 'p') return s + (l.progress || 0) / 300; // 300p/h 概算
    return s + ((l.progress || 0) / 100) * (l.target || 1) / 10; // % → 概算h
  }, 0);
  const totalH = Math.round((taskLearnH + logH) * 10) / 10;

  const pct = gLearn > 0 ? Math.min(100, Math.round(totalH / gLearn * 100)) : 0;
  const barColor = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--primary)' : 'var(--primary)';

  const logsHtml = state.learningLogs.length === 0
    ? `<div class="learning-empty">📌 学習中のものを追加してみましょう</div>`
    : state.learningLogs.map(l => {
        const lt = getLearningType(l.type);
        const p = Math.min(100, l.target > 0 ? Math.round((l.progress||0)/l.target*100) : 0);
        const bc = p >= 100 ? 'var(--success)' : p >= 50 ? 'var(--primary)' : 'var(--primary)';
        return `
          <div class="learning-item" id="ll-${l.id}">
            <div class="learning-item-header">
              <span class="learning-type-badge">${lt.emoji}</span>
              <span class="learning-item-title">${escapeHtml(l.title)}</span>
              <button class="learning-del-btn" onclick="deleteLearningLog('${l.id}')" title="削除">×</button>
            </div>
            <div class="learning-progress-row">
              <div class="goal-gauge-track" style="flex:1">
                <div class="goal-gauge-fill" style="width:${p}%;background:${bc}"></div>
              </div>
              <span class="learning-progress-label">${l.progress||0}/${l.target} ${lt.unitShort} (${p}%)</span>
            </div>
            <div class="learning-bump-row">
              ${[1,5,10].map(n =>
                `<button class="learning-bump-btn" onclick="bumpLearningProgress('${l.id}',${n})">+${n}${lt.unitShort}</button>`
              ).join('')}
              <input type="number" class="learning-manual-input" min="0" max="${l.target||9999}"
                value="${l.progress||0}" onchange="setLearningProgress('${l.id}',this.value)"
                onclick="event.stopPropagation()" title="直接入力">
            </div>
            ${l.notes ? `<div class="learning-notes">${escapeHtml(l.notes)}</div>` : ''}
          </div>`;
      }).join('');

  // タスク由来の学習時間
  const taskItemsHtml = taskLearnH > 0 ? `
    <div class="learning-task-link">
      ⏱ タスク計測（学習・書籍）: <strong>${taskLearnH}h</strong>
      <span class="learning-task-note">— タスク画面の稼働時間から自動集計</span>
    </div>` : '';

  return `
    <div class="goal-card goal-card-wide">
      <div class="goal-card-header">
        <span class="goal-icon">📚</span>
        <span class="goal-title">学習・インプット目標</span>
        <button class="goal-edit-btn" onclick="openGoalSettingModal()">⚙️ 設定</button>
      </div>
      <div class="goal-target">目標: 月 ${gLearn} 時間 <span style="color:var(--text-muted);font-size:0.85rem;font-weight:400;">実績: ${totalH}h</span></div>
      <div class="goal-gauge-track" style="margin:0.5rem 0 0.3rem;">
        <div class="goal-gauge-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <span class="goal-gauge-pct">${pct}%</span>

      ${taskItemsHtml}

      <div class="learning-list">${logsHtml}</div>

      <!-- クイック追加フォーム -->
      <div class="learning-add-form">
        <select id="ll-type" class="form-input learning-type-sel">
          ${LEARNING_TYPES.map(t => `<option value="${t.key}">${t.emoji} ${t.label}</option>`).join('')}
        </select>
        <input type="text" id="ll-title" class="form-input learning-title-inp" placeholder="タイトルを入力…"
          onkeydown="if(event.key==='Enter')addLearningLog()">
        <input type="number" id="ll-target" class="form-input learning-target-inp" placeholder="目標(ページ/時間/%)" min="1">
        <button class="btn btn-primary" onclick="addLearningLog()">追加</button>
      </div>
    </div>`;
}

function addLearningLog() {
  const title = document.getElementById('ll-title')?.value?.trim();
  if (!title) { document.getElementById('ll-title')?.focus(); return; }
  const type = document.getElementById('ll-type')?.value || 'book';
  const target = parseInt(document.getElementById('ll-target')?.value) || 100;
  state.learningLogs.push({
    id: genId(),
    title, type, target,
    progress: 0,
    notes: '',
    createdAt: getLocalDateStr(),
    updatedAt: getLocalDateStr()
  });
  saveLearningLogs();
  document.getElementById('ll-title').value = '';
  document.getElementById('ll-target').value = '';
  renderGoals();
}

function bumpLearningProgress(id, amount) {
  const log = state.learningLogs.find(l => l.id === id);
  if (!log) return;
  log.progress = Math.min(log.target, (log.progress || 0) + amount);
  log.updatedAt = getLocalDateStr();
  saveLearningLogs();
  renderGoals();
}

function setLearningProgress(id, value) {
  const log = state.learningLogs.find(l => l.id === id);
  if (!log) return;
  log.progress = Math.min(log.target, Math.max(0, parseInt(value) || 0));
  log.updatedAt = getLocalDateStr();
  saveLearningLogs();
  renderGoals();
}

function deleteLearningLog(id) {
  state.learningLogs = state.learningLogs.filter(l => l.id !== id);
  saveLearningLogs();
  renderGoals();
}

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

      ${renderLearningGoalCard(gLearn, thisMonth)}
    </div>

    <!-- Goal Setting Form (inline) -->
    <div class="report-card" style="margin-top:1.5rem;" id="goal-settings-card" style="display:none;">
      <h3 style="margin-bottom:1rem;font-size:1.05rem;">⚙️ 目標を設定する</h3>
      <div style="display:grid;grid-template-columns:1fr;gap:0.8rem;">
        <div class="form-group">
          <label class="form-label">月収目標 (円)</label>
          <input type="number" id="goal-monthly-revenue" class="form-control" placeholder="500000" value="${state.goals.monthlyRevenue||''}">
        </div>
        <div class="form-group">
          <label class="form-label">受注件数目標 (件/月)</label>
          <input type="number" id="goal-client-count" class="form-control" placeholder="3" value="${state.goals.monthlyClientCount||''}">
        </div>
        <div class="form-group">
          <label class="form-label">月間学習時間目標 (時間)</label>
          <input type="number" id="goal-learning-hours" class="form-control" placeholder="10" value="${state.goals.monthlyLearningHours||''}">
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
    ${renderAnnualTaxSupportCard()}
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
          <select id="expense-category" class="form-control">${catOptions}</select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label class="form-label">金額 (円) <span style="color:var(--danger)">*</span></label>
            <input type="number" id="expense-amount" class="form-control" placeholder="0" value="${e?.amount||''}">
          </div>
          <div class="form-group">
            <label class="form-label">日付</label>
            <input type="date" id="expense-date" class="form-control" value="${e?.date||getLocalDateStr()}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">メモ</label>
          <input type="text" id="expense-memo" class="form-control" placeholder="内容を簡単に" value="${escHtml(e?.memo||'')}">
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
let _speechRec        = null;   // SpeechRecognition インスタンス追跡
let _audioChunks      = [];

/**
 * @xenova/transformers の pipeline を動的ロード（初回のみモデルDL）
 * モデルは whisper-small (日本語精度良好, ~244MB, ブラウザにキャッシュされる)
 */
async function _loadWhisperModel(progressBtn) {
  if (_whisperPipeline) return _whisperPipeline;
  if (_whisperLoading) {
    // 既にロード中の場合は完了を待つ
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (!_whisperLoading) { clearInterval(t); resolve(_whisperPipeline); }
      }, 300);
    });
  }
  _whisperLoading = true;
  try {
    if (progressBtn) { progressBtn.title = 'ライブラリ読み込み中…'; }
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
    );
    env.allowLocalModels = false;
    if (progressBtn) { progressBtn.title = 'モデル初回DL中 (~244MB)。キャッシュ後は高速です'; }
    _whisperPipeline = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      {
        language: 'japanese',
        progress_callback: (p) => {
          if (progressBtn && p.progress != null) {
            progressBtn.title = `モデルDL中… ${Math.round(p.progress)}%`;
          }
        }
      }
    );
    return _whisperPipeline;
  } finally {
    _whisperLoading = false;
  }
}

/** 録音した Blob を Float32Array (16kHz) → Whisper で文字起こし */
async function _transcribeBlob(blob, mimeType, progressBtn) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }
  const float32 = decoded.getChannelData(0);
  const pipe = await _loadWhisperModel(progressBtn);
  if (!pipe) throw new Error('Whisperモデルのロードに失敗しました');
  if (progressBtn) progressBtn.title = '文字起こし中…';
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

  // SpeechRecognition 録音中 → 停止
  if (_speechRec) {
    try { _speechRec.stop(); } catch (_) {}
    _speechRec = null;
    if (btn) { btn.textContent = '🎤'; btn.classList.remove('recording'); btn.title = '音声入力'; }
    return;
  }

  // MediaRecorder 録音中 → 停止して文字起こし開始
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
    return;
  }

  // COOP/COEP非対応環境（GitHub Pages / iPhone Safari）はWeb Speech APIにフォールバック
  if (!window.crossOriginIsolated) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      _speechRec = rec;
      rec.lang = 'ja-JP';
      rec.continuous = true;       // ユーザーが手動停止するまで継続
      rec.interimResults = false;
      if (btn) { btn.textContent = '⏹'; btn.title = '録音中 — もう一度クリックで停止'; btn.classList.add('recording'); }

      const resetBtn = () => {
        _speechRec = null;
        if (btn) { btn.textContent = '🎤'; btn.classList.remove('recording'); btn.title = '音声入力'; }
      };

      rec.onresult = (e) => {
        const text = Array.from(e.results)
          .filter(r => r.isFinal)
          .map(r => r[0].transcript)
          .join('');
        if (!text) return;
        if (onResult) {
          onResult(text);
        } else if (textareaId) {
          const ta = document.getElementById(textareaId);
          if (ta) {
            const sep = ta.value && !ta.value.endsWith('\n') ? '\n' : '';
            ta.value += sep + text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      };
      rec.onerror = (e) => {
        // no-speech は無音が続いただけ — エラー表示しない
        if (e.error !== 'no-speech') {
          const msg = { 'not-allowed': 'マイクのアクセスが拒否されています。ブラウザ設定を確認してください。',
                        'audio-capture': 'マイクが見つかりません。接続を確認してください。',
                        'network': 'ネットワークエラーが発生しました。' }[e.error] || `音声認識エラー: ${e.error}`;
          showToastError(msg);
        }
        resetBtn();
      };
      rec.onend = () => { resetBtn(); };
      try {
        rec.start();
      } catch (e) {
        showToastError('音声認識を開始できませんでした。');
        resetBtn();
      }
      return;
    }
    showToastError('このブラウザは音声入力に対応していません。\nChrome / Safari をお試しください。');
    return;
  }

  // マイク取得（Whisper用）
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    showToastError('マイクへのアクセスが拒否されました。\nブラウザのアドレスバー横のマイクアイコンから許可してください。');
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
      const text = await _transcribeBlob(blob, mimeType, btn);
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
      showToastError('文字起こしに失敗しました: ' + (err.message || err));
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
        <button class="btn" id="idea-photo-btn" onclick="document.getElementById('idea-photo-input').click()" title="写真を添付">
          📷
        </button>
        <input type="file" id="idea-photo-input" accept="image/*" style="display:none;" onchange="handleIdeaPhotoSelect(event)">
        <button class="btn btn-primary" onclick="addIdeaFromInput()">記録</button>
      </div>
      <div id="idea-photo-preview" style="display:none;margin-top:0.5rem;align-items:center;gap:0.5rem;" >
        <img id="idea-photo-preview-img" src="" style="max-width:64px;max-height:64px;border-radius:8px;object-fit:cover;">
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" onclick="clearIdeaPhotoPreview()">✕ 写真を外す</button>
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
  const isLoading = _ideaDraftLoading.has(idea.id);
  const draftBtnLabel = isLoading ? '⏳ 生成中…' : (idea.blogDraft ? '✍️ 再生成' : '✍️ 記事化');
  return `<div class="idea-row">
    <div class="idea-rank">${rank < 3 ? ['🥇','🥈','🥉'][rank] : rank+1}</div>
    <div class="idea-content">
      ${idea.photo ? `<img src="${idea.photo}" style="max-width:84px;max-height:84px;border-radius:8px;object-fit:cover;margin-bottom:0.4rem;display:block;">` : ''}
      <div class="idea-text">${escHtml(idea.text)} ${heat}</div>
      <div class="idea-meta">×${idea.count||1} 回 · ${idea.createdAt||''}</div>
      ${idea.blogDraft ? renderIdeaBlogDraft(idea) : ''}
    </div>
    <div class="idea-actions">
      <div class="idea-bar-track"><div class="idea-bar-fill" style="width:${pct}%"></div></div>
      <div style="display:flex;gap:0.5rem;margin-top:0.35rem;flex-wrap:wrap;">
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" onclick="incrementIdea('${idea.id}')" title="もう一度思った">+1</button>
        <button class="btn btn-primary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" onclick="promoteIdeaToDeal('${idea.id}')" title="案件にする">💼</button>
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" ${isLoading?'disabled':''} onclick="generateBlogDraftFromIdea('${idea.id}')" title="AIでブログ記事の草稿を作る">${draftBtnLabel}</button>
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;color:var(--danger)" onclick="deleteIdea('${idea.id}')">✕</button>
      </div>
    </div>
  </div>`;
}

function renderIdeaBlogDraft(idea) {
  const d = idea.blogDraft;
  if (!d) return '';
  const wpReady = isWordPressConfigured();
  const isPublishing = _ideaPublishLoading.has(idea.id);
  const pub = idea.publishedPost;
  const publishBtnLabel = isPublishing ? '⏳ 投稿中…' : (pub ? '🌐 下書きを更新' : '🌐 公開する');
  return `<div class="report-card" style="margin-top:0.6rem;padding:0.75rem;background:var(--bg-secondary, #f7f5f0);">
    <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.4rem;">📝 ブログ草稿（${d.generatedAt||''}）</div>
    <input type="text" class="form-input" id="draft-title-${idea.id}" value="${escHtml(d.title||'')}" style="font-weight:600;margin-bottom:0.4rem;" onchange="updateIdeaBlogDraftField('${idea.id}','title',this.value)">
    <textarea class="form-input" id="draft-body-${idea.id}" rows="5" style="font-size:0.85rem;line-height:1.6;" onchange="updateIdeaBlogDraftField('${idea.id}','body',this.value)">${escHtml(d.body||'')}</textarea>
    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;">
      <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" onclick="copyIdeaBlogDraft('${idea.id}')">📋 コピー</button>
      <button class="btn btn-primary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" ${isPublishing?'disabled':''} onclick="publishIdeaToWordPress('${idea.id}')" title="${wpReady?'WordPressに下書きとして投稿します（公開操作はWordPress側で行います）':'未設定の場合はクリック後に設定画面へ移動できます'}">${publishBtnLabel}</button>
      <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;color:var(--danger)" onclick="deleteIdeaBlogDraft('${idea.id}')">草稿を削除</button>
    </div>
    ${!wpReady ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">※ 設定画面でWordPress連携（サイトURL・アプリケーションパスワード）を登録すると、ここから下書き投稿できます。</div>` : ''}
    ${pub ? `<div style="font-size:0.78rem;color:var(--success, #4ade80);margin-top:0.5rem;">✅ ${pub.publishedAt} に下書き投稿済み（status: ${pub.status}） — <a href="${escHtml(pub.editLink||pub.link||'#')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">WordPressで確認・本公開する →</a></div>` : ''}
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

// ── 気づきへの写真添付（記事化のネタとして使う・保存前のプレビューのみ） ──
let _pendingIdeaPhoto = null; // { dataUrl, mediaType }

function handleIdeaPhotoSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _pendingIdeaPhoto = { dataUrl: e.target.result, mediaType: (file.type && file.type.startsWith('image/')) ? file.type : 'image/jpeg' };
    const preview = document.getElementById('idea-photo-preview');
    const img = document.getElementById('idea-photo-preview-img');
    if (img) img.src = _pendingIdeaPhoto.dataUrl;
    if (preview) preview.style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

function clearIdeaPhotoPreview() {
  _pendingIdeaPhoto = null;
  const input = document.getElementById('idea-photo-input');
  if (input) input.value = '';
  const preview = document.getElementById('idea-photo-preview');
  if (preview) preview.style.display = 'none';
}

function addIdeaFromInput() {
  const input = document.getElementById('idea-text-input');
  const text = input?.value?.trim();
  if (!text) return;
  addIdea(text, _pendingIdeaPhoto?.dataUrl || null);
  input.value = '';
  input.focus();
  clearIdeaPhotoPreview();
}

function addIdea(text, photo) {
  if (!text) return;
  // Check for similar existing idea (simple: same text ignoring case/spaces)
  const normalised = text.toLowerCase().replace(/\s+/g,'');
  const existing = state.ideas.find(i => i.text.toLowerCase().replace(/\s+/g,'') === normalised);
  if (existing) {
    existing.count = (existing.count||1) + 1;
    existing.updatedAt = getLocalDateStr();
    if (photo && !existing.photo) existing.photo = photo;
  } else {
    state.ideas.push({
      id: genId(),
      text,
      count: 1,
      photo: photo || null,
      blogDraft: null,
      createdAt: getLocalDateStr(),
      updatedAt: getLocalDateStr()
    });
  }
  saveIdeas();
  if (state.activeTab === 'ideas') renderIdeas();
}

// ── 気づき → AIブログ草稿生成（Phase1: 生成のみ・公開はPhase2で対応） ──
const _ideaDraftLoading = new Set();

async function generateBlogDraftFromIdea(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea || _ideaDraftLoading.has(id)) return;

  const geminiKey = localStorage.getItem(_GEMINI_KEY_STORE);
  if (!geminiKey) {
    alert('ブログ草稿の生成にはGemini APIキー（無料）が必要です。設定画面で登録してください。');
    return;
  }

  _ideaDraftLoading.add(id);
  renderIdeas();

  try {
    const prompt = `以下は個人事業主が日々の気づき・メモとして記録した一文です。これを元に、本人の体験談として読めるブログ記事の草稿を作成してください。
気づきメモ: 「${idea.text}」

JSONのみを返してください（前後の説明不要）。
フォーマット: {"title":"記事タイトル（20字程度・読みたくなる見出し）","body":"記事本文（300〜500字程度・親しみやすい一人称の文体・段落分けは\\nで表現）"}`;

    const parts = [{ text: prompt }];
    if (idea.photo) {
      const m = idea.photo.match(/^data:([^;]+);base64,(.+)$/);
      if (m) parts.unshift({ inline_data: { mime_type: m[1], data: m[2] } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const raw = err?.error?.message || '';
      if (resp.status === 400 && raw.includes('API_KEY')) throw new Error('GeminiのAPIキーが無効です。設定画面で確認してください。');
      if (resp.status === 429) throw new Error('Geminiの無料枠を超えました。しばらく待ってから再試行してください。');
      throw new Error(`Gemini APIエラー (${resp.status})`);
    }
    const data = await resp.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('草稿を解析できませんでした。もう一度試してください。');
    const draft = JSON.parse(jsonMatch[0]);

    idea.blogDraft = {
      title: draft.title || '',
      body: draft.body || '',
      generatedAt: getLocalDateStr()
    };
    saveIdeas();
  } catch (err) {
    console.error('[BlogDraft]', err);
    alert(`草稿の生成に失敗しました: ${err.message || '不明なエラー'}`);
  } finally {
    _ideaDraftLoading.delete(id);
    renderIdeas();
  }
}

function updateIdeaBlogDraftField(id, field, value) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea || !idea.blogDraft) return;
  idea.blogDraft[field] = value;
  saveIdeas();
}

function copyIdeaBlogDraft(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea || !idea.blogDraft) return;
  const text = `${idea.blogDraft.title}\n\n${idea.blogDraft.body}`;
  navigator.clipboard?.writeText(text).then(() => {
    alert('コピーしました。お使いのブログ・HPの編集画面に貼り付けてください。');
  }).catch(() => {
    alert('コピーに失敗しました。');
  });
}

function deleteIdeaBlogDraft(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea) return;
  idea.blogDraft = null;
  saveIdeas();
  renderIdeas();
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
  const isRecording = _mediaRecorder && _mediaRecorder.state !== 'inactive';
  const status = document.getElementById('voice-status');
  startWhisperRecord('idea-text-input', 'idea-voice-btn', (text) => {
    const input = document.getElementById('idea-text-input');
    if (input) { input.value = text; }
    const st = document.getElementById('voice-status');
    if (st) st.style.display = 'none';
    addIdeaFromInput();
  });
  if (!isRecording) {
    if (status) { status.textContent = '🔴 録音中 — もう一度 🎤 を押すと停止'; status.style.display = 'block'; }
  } else {
    if (status) { status.textContent = '⏳ 文字起こし中…'; }
  }
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
  const pipeline = active.reduce((s,d) => s + (d.amount||0), 0);
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
      <div class="dash-mini-card" onclick="switchTab('contacts')" style="border-color:var(--primary)">
        <div style="font-size:0.75rem;color:var(--text-muted)">フォロー期限</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--primary)">${followUps.length}件</div>
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
      <input type="text" class="form-control" id="dash-idea-input" placeholder="💡 気になったことを一言..."
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
        <button class="btn btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.7rem;" onclick="switchTab('memo')">全部見る →</button>
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

// ─── ルールベースタスクパーサー（APIキー不要・完全無料） ─────────────────
function parseTaskRuleBased(text, hints = {}) {
  const today = new Date();
  const todayStr = getLocalDateStr();

  // ── 日付抽出 ──────────────────────────────────────────
  let dueDate = '';

  // YYYY-MM-DD / YYYY/MM/DD
  const isoMatch = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (isoMatch) {
    dueDate = `${isoMatch[1]}-${String(isoMatch[2]).padStart(2,'0')}-${String(isoMatch[3]).padStart(2,'0')}`;
  }

  // M/D or MM/DD (例: 6/25, 12/31)
  if (!dueDate) {
    const slashMatch = text.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/);
    if (slashMatch) {
      const m = parseInt(slashMatch[1]), d = parseInt(slashMatch[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const yr = today.getFullYear();
        const dt = new Date(yr, m - 1, d);
        if (dt < today) dt.setFullYear(yr + 1);
        dueDate = toLocalDateStr(dt);
      }
    }
  }

  // M月D日 / M月D
  if (!dueDate) {
    const jpMatch = text.match(/(\d{1,2})月(\d{1,2})日?/);
    if (jpMatch) {
      const m = parseInt(jpMatch[1]), d = parseInt(jpMatch[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const yr = today.getFullYear();
        const dt = new Date(yr, m - 1, d);
        if (dt < today) dt.setFullYear(yr + 1);
        dueDate = toLocalDateStr(dt);
      }
    }
  }

  // 相対日付
  if (!dueDate) {
    const _addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return toLocalDateStr(d); };
    const _monthEnd = (offset) => {
      const d = new Date(today.getFullYear(), today.getMonth() + 1 + offset, 0);
      return toLocalDateStr(d);
    };
    if (/今日|本日/.test(text))     dueDate = todayStr;
    else if (/明後日|あさって/.test(text)) dueDate = _addDays(2);
    else if (/明日/.test(text))       dueDate = _addDays(1);
    else if (/再来週/.test(text))     dueDate = _addDays(14);
    else if (/来週中|来週末/.test(text)) dueDate = _addDays(7);
    else if (/来週/.test(text))       dueDate = _addDays(7);
    else if (/今週中|今週末|週内/.test(text)) {
      const dow = today.getDay(); // 0=Sun
      dueDate = _addDays((5 - dow + 7) % 7 || 5);
    }
    else if (/来月末/.test(text))     dueDate = _monthEnd(1);
    else if (/今月末|月末/.test(text)) dueDate = _monthEnd(0);
  }

  // ── 金額抽出 ──────────────────────────────────────────
  let amount = 0;
  const manMatch = text.match(/(\d+(?:\.\d+)?)万円/);
  if (manMatch) amount = Math.round(parseFloat(manMatch[1]) * 10000);
  if (!amount) {
    const yenSymMatch = text.match(/[¥￥](\d[\d,]*)/);
    if (yenSymMatch) amount = parseInt(yenSymMatch[1].replace(/,/g, ''));
  }
  if (!amount) {
    const yenMatch = text.match(/(\d[\d,]{2,})円/);
    if (yenMatch) amount = parseInt(yenMatch[1].replace(/,/g, ''));
  }

  // ── 時間抽出 ──────────────────────────────────────────
  let estimatedHours = 0;
  const hMatch = text.match(/(\d+(?:\.\d+)?)\s*[時hH]間?/);
  if (hMatch) estimatedHours = parseFloat(hMatch[1]);

  // ── 優先度 ──────────────────────────────────────────
  let priority = 'medium';
  if (/急ぎ|至急|ASAP|asap|緊急|urgent|すぐ|早急|急いで/.test(text)) priority = 'high';
  if (/余裕|急がない|いつでも|のんびり/.test(text)) priority = 'low';

  // ── タスク名（改良版） ──────────────────────────────────────────────────
  const skipPhrases = /^(お疲れ様|お世話になって|ご連絡いただき|よろしくお願い|ご確認のほど|ありがとうございます|ありがとう|初めまして|いつもお世話|いつも|拝啓|連日|すみません|失礼します|お忙しい|お時間)/;
  // 日時のみ・挨拶のみ行を判定
  // 日時のみ行: 数字/スラッシュ/曜日漢字/時刻記号などで構成されるか、行頭が日付パターン
  const isDateTimeLine  = (l) =>
    /^[\d\/\-年月日（）()〜~:：\s,、。！!月火水木金土日曜]+$/.test(l) ||
    /^\d{1,2}[\/月]\d{1,2}[\s（(（]/.test(l);
  const isGreetingLine  = (l) => skipPhrases.test(l) || /^(ご確認|ご相談|ご依頼|お願い|よろしく)/.test(l);

  const rawLines = text.split(/\n/).map(l => l.trim()).filter(l => l.length >= 2);

  // ① ■/◆/●/▶ で始まる行を探す（日時だけの行は次の行へ）
  let name = '';
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (/^[■◆●▶▸➤→]/.test(l)) {
      const body = l.replace(/^[■◆●▶▸➤→]\s*/, '').trim();
      if (!isDateTimeLine(body) && !isGreetingLine(body) && body.length >= 3) {
        name = body; break;
      }
      // ■ 行が日時のみ → 次の行が本題
      if (isDateTimeLine(body) && i + 1 < rawLines.length) {
        const nextLine = rawLines[i + 1].trim();
        if (!isDateTimeLine(nextLine) && !isGreetingLine(nextLine) && nextLine.length >= 3) {
          name = nextLine; break;
        }
      }
    }
  }

  // ② カタカナ・英語の固有名詞を含む行を優先
  if (!name) {
    for (const l of rawLines) {
      if (isGreetingLine(l) || isDateTimeLine(l)) continue;
      if (/[ァ-ヿA-Za-z]{3,}/.test(l) && l.length >= 4) { name = l; break; }
    }
  }

  // ③ 最初の意味のある行
  if (!name) {
    for (const l of rawLines) {
      if (isGreetingLine(l) || isDateTimeLine(l)) continue;
      if (l.length >= 4) { name = l; break; }
    }
  }

  if (!name && rawLines.length > 0) name = rawLines[0];

  // 住所・括弧内の長い補足を除去してタスク名を簡潔に
  name = name
    .replace(/（[^）]{15,}）/g, '')   // 長い括弧内（住所など）を削除
    .replace(/\([^)]{15,}\)/g, '')
    .replace(/[「」『』【】]/g, '')
    .replace(/^\d{1,2}[月\/]\d{1,2}.*/, '') // 行頭が日付なら削除
    .trim()
    .substring(0, 38);

  // ジャンルが指定されている場合は接頭辞を付ける
  if (hints.workType && name && !name.startsWith('【')) {
    name = `【${hints.workType}】${name}`.substring(0, 40);
  }

  // ── 業務種別 ──────────────────────────────────────────
  let workType = '';
  const workMap = [
    ['取材', '取材'], ['撮影', '撮影'], ['動画', '動画撮影'], ['編集', '編集'],
    ['執筆|ライティング|原稿', '執筆'], ['デザイン', 'デザイン'],
    ['打ち合わせ|ミーティング|MTG|打合せ', '打ち合わせ'],
    ['納品', '納品'], ['校正|修正', '修正・校正']
  ];
  for (const [pat, label] of workMap) {
    if (new RegExp(pat).test(text)) { workType = label; break; }
  }

  // ── メモ（dueDate に関わる一文） ──────────────────────────────────────
  let memo = '';
  const memoLine = rawLines.find(l => l.includes('ください') || l.includes('お願い') || l.includes('確認'));
  if (memoLine && memoLine !== name) memo = memoLine.substring(0, 50);

  // ── ユーザー補足ヒントで上書き ─────────────────────────────────────────
  if (hints.workType) workType = hints.workType;
  if (hints.dueDate)  dueDate  = hints.dueDate;
  if (hints.note) {
    if (!memo) memo = hints.note.substring(0, 50);
    // 補足メモに「急ぎ」系キーワードがあれば優先度を上げる
    if (!/(急ぎ|至急|ASAP|緊急|早急)/.test(text) && /(急ぎ|至急|ASAP|緊急|早急)/.test(hints.note)) {
      priority = 'high';
    }
  }

  return { name, client: '', dueDate, amount, estimatedHours, priority, workType, memo };
}

// ─── AI呼び出し共通（Claude / Gemini 両対応） ─────────────────────────────
const _CLAUDE_KEY_STORE  = 'tinyperk_claude_api_key';
const _GEMINI_KEY_STORE  = 'tinyperk_gemini_api_key';

async function _callAIForTaskParse(text, hints = {}) {
  const claudeKey = localStorage.getItem(_CLAUDE_KEY_STORE);
  const geminiKey = localStorage.getItem(_GEMINI_KEY_STORE);

  // ── 日付計算ヘルパー ─────────────────────────────────────────────────
  const todayStr = getLocalDateStr();
  const _addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toLocalDateStr(d); };
  const _monthEnd = (mo) => toLocalDateStr(new Date(new Date().getFullYear(), new Date().getMonth() + 1 + mo, 0));
  const dow       = new Date().getDay(); // 0=日
  const weekdayJa = ['日','月','火','水','木','金','土'][dow] + '曜日';
  const tomorrow      = _addDays(1);
  const dayAfter      = _addDays(2);
  const thisFri       = _addDays((5 - dow + 7) % 7 || 7);   // 今週金曜
  const nextMon       = _addDays((8 - dow)  % 7 || 7);      // 来週月曜
  const nextFri       = _addDays((5 - dow + 7) % 7 + 7);    // 来週金曜
  const thisMonthEnd  = _monthEnd(0);
  const nextMonthEnd  = _monthEnd(1);
  // few-shot例用: 6/25の日付（過去なら翌年）
  const ex0625 = (() => {
    const yr = new Date().getFullYear();
    const d = new Date(yr, 5, 25);
    if (d < new Date()) d.setFullYear(yr + 1);
    return toLocalDateStr(d);
  })();

  // ── プロンプト（システム指示）─────────────────────────────────────────
  const systemPrompt =
`あなたはフリーランサーのタスク管理AIです。LINEやメールの文章からタスク情報を抽出し、JSONのみを返してください（説明文・コードブロック不要）。

今日: ${todayStr}（${weekdayJa}）

【フィールドルール】
name: 以下のルールで40字以内のタスク名を作る。
  ① 絶対にタスク名にしてはいけない内容: 挨拶・定型文（「お疲れ様」「お世話になっております」「よろしくお願いします」「ご確認のほど」「初めまして」「いつもお世話」など）
  ② 「■」「◆」「●」「【】」で始まる行は重要な情報を示す。ただしその行が日付・時刻だけなら無視して次の行を見る。
  ③ 店舗名・会社名・人名・イベント名・固有名詞（カタカナ・英語の名称）が含まれる行をタスク名の核にする。住所情報は省く。
  ④ ユーザーが業務ジャンルを指定した場合: 「【ジャンル名】固有名詞」形式にする。例: workType=取材 → 「【取材】Leggero｜Effortless Body Studio」
  ⑤ ジャンル未指定の場合: 「動詞＋目的語」で要約。例「バナーデザイン3案制作」「LP原稿執筆（2000字）」
client: 送信者の会社名・人名。署名・「○○株式会社」・「○○より」から抽出。不明なら ""
dueDate: YYYY-MM-DD形式に変換:
  今日/本日 → ${todayStr}
  明日 → ${tomorrow}
  明後日/あさって → ${dayAfter}
  今週中/今週末/週内 → ${thisFri}（今週金曜）
  来週/来週頭 → ${nextMon}（来週月曜）
  来週中/来週末 → ${nextFri}（来週金曜）
  今月末/月末 → ${thisMonthEnd}
  来月末 → ${nextMonthEnd}
  ○月○日 → 当年のYYYY-MM-DD（過去日付は翌年）
  ○/○ → 当年のYYYY-MM-DD
  不明 → ""
amount: 税別金額（整数）。「3万円」→30000。税込表記は÷1.1して小数切捨て。¥・円記号も対応。不明→0
estimatedHours: 作業時間（数値）。半日→4、丸1日→8、不明→0
priority:
  "high" → 急ぎ/至急/ASAP/緊急/早急、または締切が${tomorrow}以前（3日以内）
  "low"  → 急がない/余裕あり/いつでも
  "medium" → それ以外
workType: 次の中から1つ選ぶ → 「取材」「執筆・ライティング」「撮影」「動画編集」「デザイン」「構成・編集」「Web制作」「打ち合わせ」「資料作成」「その他」
memo: 修正条件・素材の有無・特記事項を1〜2文。重要情報がなければ ""
${(hints.workType || hints.dueDate || hints.note) ? `
【ユーザーが入力した補足情報（文章よりも優先して採用すること）】
${hints.workType ? `業務ジャンル: ${hints.workType}` : ''}
${hints.dueDate  ? `締め切りの目安: ${hints.dueDate}` : ''}
${hints.note     ? `補足メモ: ${hints.note}` : ''}`.replace(/\n+/g, '\n').trim() : ''}

【例1】
入力: 「お世話になっております。広告部の田中です。来週末までにECサイトのTOPバナー3案のデザインをお願いしたいです。PC/SP両対応で。予算は税込44,000円です。急ぎではないです。」
出力: {"name":"ECサイトTOPバナーデザイン3案","client":"広告部 田中","dueDate":"${nextFri}","amount":40000,"estimatedHours":0,"priority":"low","workType":"デザイン","memo":"PC・SP両対応。税込44,000円（税別40,000円）。"}

【例2】
入力: 「至急お願いします！明日の午前中に商品写真10点のリサイズと書き出しをお願いできますか。2万円でお願いしたいです。」
出力: {"name":"商品写真リサイズ・書き出し（10点）","client":"","dueDate":"${tomorrow}","amount":20000,"estimatedHours":0,"priority":"high","workType":"撮影","memo":"明日午前中納品希望。商品写真10点のリサイズと書き出し。"}

【例3】
入力: 「山田さん、取材記事の原稿（2000字）を月末までにお願いできますか。ギャラは¥35,000でいかがでしょう。写真素材はこちらで用意します。」
出力: {"name":"取材記事原稿執筆（2000字）","client":"","dueDate":"${thisMonthEnd}","amount":35000,"estimatedHours":0,"priority":"medium","workType":"執筆・ライティング","memo":"写真素材はクライアント提供。"}

【例4（挨拶始まり・■パターン・ジャンル指定あり）】
入力: 「お疲れ様です！\\n6/25にもう一件、ご相談させてください！\\n■6/25（木）11:00〜\\nLeggero（レジェロ）｜Effortless Body Studio（川崎市高津区溝口２丁目）\\nご確認のほどよろしくお願いします！」
補足情報: 業務ジャンル=取材
出力: {"name":"【取材】Leggero（レジェロ）｜Effortless Body Studio","client":"","dueDate":"${ex0625}","amount":0,"estimatedHours":0,"priority":"medium","workType":"取材","memo":"6/25（木）11:00〜。川崎市高津区溝口。"}`;

  const userMessage = `以下の文章からタスク情報を抽出してください:\n\n${text}`;

  // ── Gemini（無料・推奨） ──────────────────────────────────────────────
  if (geminiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 800,
          responseMimeType: 'application/json'
        }
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const raw = err?.error?.message || '';
      if (resp.status === 400 && raw.includes('API_KEY')) throw new Error('GeminiのAPIキーが無効です。設定画面で確認してください。');
      if (resp.status === 429) throw new Error('Gemini APIの無料枠を超えました。しばらく待ってから再試行してください。');
      throw new Error(`Gemini APIエラー (${resp.status})${raw ? ': ' + raw : ''}`);
    }
    const data = await resp.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // responseMimeType:json で直接パースを試みる、失敗時は正規表現でフォールバック
    try { return JSON.parse(rawText); } catch (_) {}
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Gemini解析結果を読み取れませんでした');
    return JSON.parse(jsonMatch[0]);
  }

  // ── Claude（有料） ────────────────────────────────────────────────────
  if (claudeKey) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const raw = err?.error?.message || '';
      if (resp.status === 401) throw new Error('Claude APIキーが無効です。設定画面で再登録してください。');
      if (resp.status === 429 || raw.toLowerCase().includes('credit') || raw.toLowerCase().includes('balance'))
        throw new Error('Claude APIクレジットが不足しています。console.anthropic.com で追加してください。');
      throw new Error(`Claude APIエラー (${resp.status})`);
    }
    const data = await resp.json();
    const rawText = data.content?.[0]?.text || '';
    try { return JSON.parse(rawText); } catch (_) {}
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude解析結果を読み取れませんでした');
    return JSON.parse(jsonMatch[0]);
  }

  // ── APIキーなし → ルールベース ────────────────────────────────────────
  return null; // caller will fall back to parseTaskRuleBased
}

// ─── Gemini APIキー管理（無料・推奨） ────────────────────────────────────
async function saveGeminiApiKey() {
  const input    = document.getElementById('gemini-api-key-input');
  const statusEl = document.getElementById('gemini-api-key-status');
  if (!input) return;
  const key = input.value.trim();
  if (!key) {
    if (statusEl) { statusEl.textContent = 'キーを入力してください。'; statusEl.style.color = 'var(--danger)'; }
    return;
  }

  // 接続テスト（保存前に有効か確認）
  if (statusEl) { statusEl.textContent = '⏳ 接続テスト中…'; statusEl.style.color = 'var(--text-muted)'; }
  try {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(testUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'OK' }] }] })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${resp.status}`;
      if (statusEl) {
        statusEl.textContent = `❌ キーが無効です: ${msg}`;
        statusEl.style.color = 'var(--danger)';
      }
      return; // 保存しない
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = `❌ 接続失敗: ${e.message || 'ネットワークエラー'}`;
      statusEl.style.color = 'var(--danger)';
    }
    return;
  }

  localStorage.setItem(_GEMINI_KEY_STORE, key);
  input.value = '';
  if (statusEl) {
    statusEl.textContent = `✅ 保存済み・接続確認OK — ${_maskKey(key)}`;
    statusEl.style.color = 'var(--success)';
  }
}

function clearGeminiApiKey() {
  localStorage.removeItem(_GEMINI_KEY_STORE);
  const input    = document.getElementById('gemini-api-key-input');
  const statusEl = document.getElementById('gemini-api-key-status');
  if (input) input.value = '';
  if (statusEl) { statusEl.textContent = '削除しました。'; statusEl.style.color = 'var(--text-muted)'; }
}

function loadGeminiApiKeyStatus() {
  const statusEl = document.getElementById('gemini-api-key-status');
  if (!statusEl) return;
  const key = localStorage.getItem(_GEMINI_KEY_STORE);
  if (key) {
    statusEl.textContent = `✅ 登録済み — ${_maskKey(key)}`;
    statusEl.style.color = 'var(--success)';
  } else {
    statusEl.textContent = 'APIキー未登録。登録するとAIによる高精度解析が使えます。';
    statusEl.style.color = 'var(--text-muted)';
  }
}

// ─── Claude APIキー管理 ────────────────────────────────────────────
// (Claudeキーは名刺OCR専用として残す; LINEパースはGemini/ルールベースを優先)

function saveClaudeApiKey() {
  const input = document.getElementById('claude-api-key-input');
  const statusEl = document.getElementById('claude-api-key-status');
  if (!input) return;
  const key = input.value.trim();
  if (!key) {
    if (statusEl) { statusEl.textContent = 'キーを入力してください。'; statusEl.style.color = 'var(--danger)'; }
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    if (statusEl) { statusEl.textContent = 'キーの形式が正しくありません（sk-ant-… で始まります）。'; statusEl.style.color = 'var(--danger)'; }
    return;
  }
  localStorage.setItem(_CLAUDE_KEY_STORE, key);
  input.value = '';
  if (statusEl) {
    statusEl.textContent = `✅ 保存済み — ${_maskKey(key)}`;
    statusEl.style.color = 'var(--success)';
  }
}

function clearClaudeApiKey() {
  localStorage.removeItem(_CLAUDE_KEY_STORE);
  const input = document.getElementById('claude-api-key-input');
  const statusEl = document.getElementById('claude-api-key-status');
  if (input) input.value = '';
  if (statusEl) { statusEl.textContent = '削除しました。'; statusEl.style.color = 'var(--text-muted)'; }
}

function loadClaudeApiKeyStatus() {
  const statusEl = document.getElementById('claude-api-key-status');
  if (!statusEl) return;
  const key = localStorage.getItem(_CLAUDE_KEY_STORE);
  if (key) {
    statusEl.textContent = `✅ 登録済み — ${_maskKey(key)}`;
    statusEl.style.color = 'var(--success)';
  } else {
    statusEl.textContent = 'APIキー未登録。名刺読み取りには登録が必要です。';
    statusEl.style.color = 'var(--text-muted)';
  }
}

function _maskKey(key) {
  if (key.length <= 12) return '****';
  return key.slice(0, 10) + '…' + key.slice(-4);
}

// ─── WordPress連携（ブログ自動投稿 Phase2） ────────────────────────────
const _WP_SITE_STORE  = 'tinyperk_wp_site_url';
const _WP_USER_STORE  = 'tinyperk_wp_username';
const _WP_APPPW_STORE = 'tinyperk_wp_app_password';

function getWordPressConfig() {
  return {
    siteUrl: (localStorage.getItem(_WP_SITE_STORE) || '').trim().replace(/\/+$/, ''),
    username: (localStorage.getItem(_WP_USER_STORE) || '').trim(),
    appPassword: (localStorage.getItem(_WP_APPPW_STORE) || '').trim()
  };
}

function isWordPressConfigured() {
  const c = getWordPressConfig();
  return !!(c.siteUrl && c.username && c.appPassword);
}

async function saveWordPressConfig() {
  const siteInput = document.getElementById('wp-site-url-input');
  const userInput  = document.getElementById('wp-username-input');
  const pwInput    = document.getElementById('wp-app-password-input');
  const statusEl   = document.getElementById('wp-config-status');
  if (!siteInput || !userInput || !pwInput) return;

  let siteUrl = siteInput.value.trim().replace(/\/+$/, '');
  const username = userInput.value.trim();
  const appPassword = pwInput.value.trim();

  if (!siteUrl || !username || !appPassword) {
    if (statusEl) { statusEl.textContent = 'サイトURL・ユーザー名・アプリケーションパスワードをすべて入力してください。'; statusEl.style.color = 'var(--danger)'; }
    return;
  }
  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`;

  if (statusEl) { statusEl.textContent = '⏳ 接続テスト中…'; statusEl.style.color = 'var(--text-muted)'; }
  try {
    const auth = btoa(unescape(encodeURIComponent(`${username}:${appPassword}`)));
    const resp = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.message || `HTTP ${resp.status}`);
    }
    const me = await resp.json();
    localStorage.setItem(_WP_SITE_STORE, siteUrl);
    localStorage.setItem(_WP_USER_STORE, username);
    localStorage.setItem(_WP_APPPW_STORE, appPassword);
    pwInput.value = '';
    if (statusEl) {
      statusEl.textContent = `✅ 接続確認OK — ${me.name || username} としてログイン中`;
      statusEl.style.color = 'var(--success)';
    }
    if (state.activeTab === 'memo' || state.activeTab === 'ideas') renderIdeas();
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = `❌ 接続失敗: ${e.message || 'サイトURL・ユーザー名・アプリケーションパスワードを確認してください'}（CORSが原因の場合、WordPress側でREST APIへの外部アクセス許可が必要です）`;
      statusEl.style.color = 'var(--danger)';
    }
  }
}

function clearWordPressConfig() {
  localStorage.removeItem(_WP_SITE_STORE);
  localStorage.removeItem(_WP_USER_STORE);
  localStorage.removeItem(_WP_APPPW_STORE);
  const siteInput = document.getElementById('wp-site-url-input');
  const userInput  = document.getElementById('wp-username-input');
  const pwInput    = document.getElementById('wp-app-password-input');
  const statusEl   = document.getElementById('wp-config-status');
  if (siteInput) siteInput.value = '';
  if (userInput) userInput.value = '';
  if (pwInput) pwInput.value = '';
  if (statusEl) { statusEl.textContent = '削除しました。'; statusEl.style.color = 'var(--text-muted)'; }
  if (state.activeTab === 'memo' || state.activeTab === 'ideas') renderIdeas();
}

function loadWordPressConfigStatus() {
  const statusEl = document.getElementById('wp-config-status');
  const siteInput = document.getElementById('wp-site-url-input');
  const userInput = document.getElementById('wp-username-input');
  if (!statusEl) return;
  const c = getWordPressConfig();
  if (c.siteUrl && c.username && c.appPassword) {
    if (siteInput) siteInput.value = c.siteUrl;
    if (userInput) userInput.value = c.username;
    statusEl.textContent = `✅ 登録済み — ${c.siteUrl}`;
    statusEl.style.color = 'var(--success)';
  } else {
    statusEl.textContent = '未登録。登録すると「気づき」から下書き投稿できます。';
    statusEl.style.color = 'var(--text-muted)';
  }
}

// 気づきのブログ草稿をWordPressに下書き投稿（既存投稿があれば更新）
const _ideaPublishLoading = new Set();

async function publishIdeaToWordPress(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea || !idea.blogDraft || _ideaPublishLoading.has(id)) return;

  if (!isWordPressConfigured()) {
    const go = confirm('WordPress連携が未設定です。設定画面で登録しますか？');
    if (go) switchTab('settings');
    return;
  }

  const { siteUrl, username, appPassword } = getWordPressConfig();
  const titleEl = document.getElementById(`draft-title-${id}`);
  const bodyEl  = document.getElementById(`draft-body-${id}`);
  const title = (titleEl ? titleEl.value : idea.blogDraft.title) || '';
  const body  = (bodyEl ? bodyEl.value : idea.blogDraft.body) || '';

  _ideaPublishLoading.add(id);
  renderIdeas();
  try {
    const auth = btoa(unescape(encodeURIComponent(`${username}:${appPassword}`)));
    const existingId = idea.publishedPost?.id;
    const endpoint = existingId
      ? `${siteUrl}/wp-json/wp/v2/posts/${existingId}`
      : `${siteUrl}/wp-json/wp/v2/posts`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({ title, content: body, status: 'draft' })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.message || `HTTP ${resp.status}`);
    }
    const post = await resp.json();
    idea.publishedPost = {
      id: post.id,
      link: post.link || '',
      editLink: `${siteUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
      publishedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      status: 'draft'
    };
    saveIdeas();
    showTrayToast(existingId ? '🌐 WordPressの下書きを更新しました' : '🌐 WordPressに下書きとして投稿しました');
  } catch (e) {
    console.error('[WP Publish]', e);
    alert(`WordPressへの投稿に失敗しました: ${e.message || '不明なエラー'}`);
  } finally {
    _ideaPublishLoading.delete(id);
    renderIdeas();
  }
}

// ─── 名刺OCR ─────────────────────────────────────────────────────────
function scanBusinessCard() {
  const geminiKey = localStorage.getItem(_GEMINI_KEY_STORE);
  const claudeKey = localStorage.getItem(_CLAUDE_KEY_STORE);
  if (!geminiKey && !claudeKey) {
    const go = confirm('APIキーが未登録です。\n設定画面でGemini APIキー（無料）を登録すると名刺読み取りが使えます。\n設定画面へ移動しますか？');
    if (go) { closeContactModal(); switchTab('settings'); }
    return;
  }
  const inp = document.getElementById('business-card-input');
  if (inp) inp.click();
}

async function processBizCardImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const btn      = document.getElementById('btn-ocr');
  const statusEl = document.getElementById('ocr-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 読み取り中…'; }
  if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }

  try {
    // 画像を base64 に変換（メモリ内処理のみ・保存なし）
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const mediaType = (file.type && file.type.startsWith('image/')) ? file.type : 'image/jpeg';

    const ocrPrompt = `この名刺から情報を抽出し、JSONのみを返してください（前後の説明不要）。
フォーマット: {"name":"","company":"","role":"","email":"","phone":"","address":"","url":""}
不明な項目は空文字列にしてください。`;

    let rawText = '';

    const geminiKey = localStorage.getItem(_GEMINI_KEY_STORE);
    const claudeKey = localStorage.getItem(_CLAUDE_KEY_STORE);

    // ── Gemini（無料・優先） ────────────────────────────────────────────
    if (geminiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mediaType, data: base64 } },
              { text: ocrPrompt }
            ]
          }]
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const raw = err?.error?.message || '';
        if (resp.status === 400 && raw.includes('API_KEY')) throw new Error('GeminiのAPIキーが無効です。設定画面で確認してください。');
        if (resp.status === 429) throw new Error('Geminiの無料枠を超えました。しばらく待ってから再試行してください。');
        throw new Error(`Gemini APIエラー (${resp.status})`);
      }
      const data = await resp.json();
      rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ── Claude（有料・フォールバック） ────────────────────────────────
    } else if (claudeKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: ocrPrompt }
            ]
          }]
        })
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const raw = errBody?.error?.message || '';
        if (resp.status === 401) throw new Error('Claude APIキーが無効です。設定画面で再登録してください。');
        if (raw.toLowerCase().includes('credit') || raw.toLowerCase().includes('balance'))
          throw new Error('Claude APIクレジットが不足しています。Gemini APIキー（無料）の登録もご検討ください。');
        throw new Error(raw || `APIエラー (${resp.status})`);
      }
      const data = await resp.json();
      rawText = data.content?.[0]?.text || '';
    } else {
      throw new Error('APIキーが設定されていません。設定画面でGemini APIキー（無料）を登録してください。');
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('読み取り結果を解析できませんでした。画像をはっきり撮影してから再試行してください。');
    const info = JSON.parse(jsonMatch[0]);

    // フォームへ反映（既存値は上書きしない）
    const fill = (id, val) => { const el = document.getElementById(id); if (el && !el.value && val) el.value = val; };
    fill('contact-name',    info.name);
    fill('contact-company', info.company);
    fill('contact-email',   info.email);
    fill('contact-phone',   info.phone);

    // 役職・住所・URL はメモに追記
    const notesEl = document.getElementById('contact-notes');
    if (notesEl && !notesEl.value) {
      const extras = [];
      if (info.role)    extras.push(`役職: ${info.role}`);
      if (info.address) extras.push(`住所: ${info.address}`);
      if (info.url)     extras.push(`Web: ${info.url}`);
      if (extras.length) notesEl.value = extras.join('\n');
    }

    if (statusEl) {
      statusEl.textContent = '✅ 読み取り完了！内容を確認して保存してください。';
      statusEl.style.color = 'var(--success, #22c55e)';
      statusEl.style.display = 'block';
    }
  } catch (err) {
    console.error('[OCR]', err);
    if (statusEl) {
      let msg = err.message || '不明なエラー';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        msg = 'ネットワークエラー。インターネット接続を確認してください。';
      }
      statusEl.textContent = `❌ ${msg}`;
      statusEl.style.color = 'var(--danger, #ef4444)';
      statusEl.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📷 名刺を読み取る'; }
    event.target.value = '';
  }
}


// ============================================================
// 週次レポート
// ============================================================
function getWeekDays(offset) {
  const today = new Date();
  const dow = today.getDay();
  const mondayOffset = (dow + 6) % 7; // 月曜始まり
  const result = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - mondayOffset + i + offset * 7);
    result.push(toLocalDateStr(d));
  }
  return result;
}

function changeWeeklyOffset(delta) {
  const next = (state.weeklyOffset || 0) + delta;
  if (next > 0) return;   // 未来は不可
  if (next < -52) return; // 1年以上前は不可
  state.weeklyOffset = next;
  renderWeeklyReport();
}

function renderWeeklyReport() {
  const offset = state.weeklyOffset || 0;
  const weekDays = getWeekDays(offset);
  const tasks = state.tasks || [];

  // ── 範囲ラベル ──
  const rangeLabel = document.getElementById('weekly-range-label');
  if (rangeLabel) {
    const s = weekDays[0].slice(5).replace('-','/');
    const e = weekDays[6].slice(5).replace('-','/');
    rangeLabel.textContent = `${weekDays[0].slice(0,4)}年  ${s} 〜 ${e}`;
  }
  const nextBtn = document.getElementById('btn-weekly-next');
  if (nextBtn) nextBtn.disabled = (offset >= 0);

  // ── 集計 ──
  const dayData = weekDays.map(ds => {
    const tc = state.timecards.find(t => t.date === ds);
    const dayTasks = tasks.filter(t => t.dueDate === ds || t.completedAt === ds);
    const done = dayTasks.filter(t => t.status === 'completed').length;
    const hrs = tc?.totalHours || 0;
    const rev = tasks
      .filter(t => t.status === 'completed' && t.completedAt === ds)
      .reduce((s,t) => s + (t.amount||0), 0);
    const isHoliday = isHolidayDate(ds);
    return { ds, hrs, done, rev, isHoliday, tasks: dayTasks, clockIn: tc?.clockIn||'', clockOut: tc?.clockOut||'' };
  });

  const totalHrs  = dayData.reduce((s,d) => s + d.hrs, 0);
  const totalDone = dayData.reduce((s,d) => s + d.done, 0);
  const totalRev  = dayData.reduce((s,d) => s + d.rev, 0);
  const totalHolidays = dayData.filter(d => d.isHoliday).length;
  const workDays  = dayData.filter(d => d.hrs > 0).length;
  const fmt = v => new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(Math.round(v));

  // ── サマリー数値 ──
  const statRow = document.getElementById('weekly-stat-row');
  if (statRow) {
    const stats = [
      { label: '稼働時間',   val: `${totalHrs.toFixed(1)}h`,  color: 'var(--primary)' },
      { label: '稼働日数',   val: `${workDays}日`,             color: 'var(--secondary)' },
      { label: '完了タスク', val: `${totalDone}件`,            color: 'var(--success)' },
      { label: '週売上',     val: fmt(totalRev),               color: 'var(--primary)' },
      { label: '休日',       val: `${totalHolidays}日`,        color: '#f59e0b' },
    ];
    statRow.innerHTML = stats.map(s => `
      <div class="report-card" style="text-align:center;padding:1rem;">
        <div style="font-size:1.6rem;font-family:var(--font-vintage);color:${s.color};letter-spacing:0.05em;">${s.val}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">${s.label}</div>
      </div>`).join('');
  }

  // ── 日別バーチャート ──
  const maxHrs = Math.max(...dayData.map(d => d.hrs), 1);
  const dayNames = ['日','月','火','水','木','金','土'];
  const todayStr = getLocalDateStr();

  const chartEl = document.getElementById('weekly-day-chart');
  const labelEl = document.getElementById('weekly-day-labels');
  if (chartEl) {
    chartEl.innerHTML = dayData.map((d, i) => {
      const pct = Math.max((d.hrs / maxHrs) * 100, d.hrs > 0 ? 6 : 2);
      const isToday = d.ds === todayStr;
      const color = isToday ? 'var(--primary)' : (i===0||i===6 ? 'var(--danger)' : 'var(--text-muted)');
      return `<div onclick="goToJournalDate('${d.ds}')" title="${d.ds}の日誌を開く" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px;cursor:pointer;">
        <div style="font-size:0.65rem;color:${isToday?'var(--primary)':'var(--text-muted)'};">${d.hrs>0?d.hrs.toFixed(1):''}</div>
        <div style="width:100%;background:${color};border-radius:2px 2px 0 0;height:${pct}%;opacity:${isToday?1:0.65};transition:height 0.4s;"></div>
      </div>`;
    }).join('');
  }
  if (labelEl) {
    labelEl.innerHTML = dayData.map((d, i) => {
      const isToday = d.ds === todayStr;
      return `<div onclick="goToJournalDate('${d.ds}')" title="${d.ds}の日誌を開く" style="text-align:center;font-size:0.7rem;font-family:var(--font-vintage);color:${isToday?'var(--primary)':i===0||i===6?'var(--danger)':'var(--text-muted)'};cursor:pointer;">${dayNames[i]}</div>`;
    }).join('');
  }

  // ── 日別テーブル ──
  const table = document.getElementById('weekly-day-table');
  if (table) {
    const headers = ['日付','曜日','IN','OUT','稼働','完了','売上'];
    table.innerHTML = `
      <thead><tr>${headers.map(h=>`<th style="text-align:left;padding:0.5rem 0.75rem;border-bottom:2px solid var(--primary);font-family:var(--font-vintage);letter-spacing:0.05em;color:var(--text-secondary);font-size:0.82rem;">${h}</th>`).join('')}</tr></thead>
      <tbody>${dayData.map((d,i) => {
        const isToday = d.ds === todayStr;
        const bg = isToday ? 'background:rgba(200,169,110,0.08);' : '';
        return `<tr onclick="goToJournalDate('${d.ds}')" title="${d.ds}の日誌を開く" style="${bg}cursor:pointer;">
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-size:0.85rem;font-weight:${isToday?'700':'400'};">${d.ds.slice(5).replace('-','/')}</td>
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);color:${i===0||i===6?'var(--danger)':'var(--text-secondary)'};font-family:var(--font-vintage);">${dayNames[i]}</td>
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:var(--font-vintage);color:var(--text-muted);">${d.clockIn||'—'}</td>
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:var(--font-vintage);color:var(--text-muted);">${d.clockOut||'—'}</td>
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:var(--font-vintage);color:${d.hrs>0?'var(--primary)':'var(--text-muted)'};">${d.hrs>0?d.hrs.toFixed(1)+'h':'—'}</td>
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:var(--font-vintage);color:${d.done>0?'var(--success)':'var(--text-muted)'};">${d.done>0?d.done+'件':'—'}</td>
          <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:var(--font-vintage);color:${d.rev>0?'var(--primary)':'var(--text-muted)'};">${d.rev>0?fmt(d.rev):'—'}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr style="background:rgba(200,169,110,0.05);">
        <td colspan="4" style="padding:0.5rem 0.75rem;font-family:var(--font-vintage);letter-spacing:0.05em;">TOTAL</td>
        <td style="padding:0.5rem 0.75rem;font-family:var(--font-vintage);color:var(--primary);font-weight:700;">${totalHrs.toFixed(1)}h</td>
        <td style="padding:0.5rem 0.75rem;font-family:var(--font-vintage);color:var(--success);font-weight:700;">${totalDone}件</td>
        <td style="padding:0.5rem 0.75rem;font-family:var(--font-vintage);color:var(--primary);font-weight:700;">${fmt(totalRev)}</td>
      </tr></tfoot>`;
  }

  // ── タスクリスト（日別グループ） ──
  const listEl = document.getElementById('weekly-task-list');
  if (listEl) {
    const statusLabel = { 'not-started':'PENDING', 'in-progress':'IN PROGRESS', 'revision':'REVISION', 'completed':'DONE' };
    const statusColor = { 'not-started':'var(--text-muted)', 'in-progress':'var(--secondary)', 'revision':'var(--primary)', 'completed':'var(--success)' };

    const groups = dayData.filter(d => d.tasks.length > 0);
    if (groups.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">この週のタスクはありません</p>';
      return;
    }
    listEl.innerHTML = groups.map(d => `
      <div style="margin-bottom:1.5rem;">
        <div style="font-family:var(--font-vintage);letter-spacing:0.08em;font-size:1rem;color:var(--primary);border-bottom:1px solid var(--border-color);padding-bottom:0.3rem;margin-bottom:0.5rem;">
          ${d.ds.slice(5).replace('-','/')} ${dayNames[weekDays.indexOf(d.ds)]}曜日
        </div>
        ${d.tasks.map(t => {
          const spentH = t.spentSeconds ? (t.spentSeconds/3600).toFixed(1)+'h' : '—';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;border-radius:2px;margin-bottom:0.25rem;background:var(--bg-secondary);">
            <span style="font-size:0.88rem;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.name)}</span>
            <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;margin-left:0.5rem;">
              <span style="font-size:0.7rem;color:var(--text-muted);">${escapeHtml(t.client||'')}</span>
              <span style="font-size:0.68rem;font-family:var(--font-vintage);letter-spacing:0.04em;border:1px solid;border-radius:2px;padding:0.05em 0.4em;color:${statusColor[t.status]||'var(--text-muted)'};">${statusLabel[t.status]||t.status}</span>
              <span style="font-size:0.72rem;font-family:var(--font-vintage);color:var(--text-muted);">${spentH}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');
  }
}


// ============================================================
// AI QUICK PARSE — LINE/メールからタスク自動入力
// ============================================================

function toggleAiParseArea() {
  const area = document.getElementById('ai-parse-area');
  const chevron = document.getElementById('ai-parse-chevron');
  if (!area) return;
  const isOpen = area.style.display !== 'none';
  area.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen) {
    setTimeout(() => document.getElementById('ai-paste-text')?.focus(), 50);
  }
}

async function parseTaskFromText() {
  const textarea = document.getElementById('ai-paste-text');
  const statusEl = document.getElementById('ai-parse-status');
  const btn = document.getElementById('ai-parse-btn');
  const btnLabel = document.getElementById('ai-parse-btn-label');
  if (!textarea || !statusEl || !btn) return;

  const text = textarea.value.trim();
  if (!text) {
    statusEl.textContent = '文章を貼り付けてください';
    statusEl.style.color = 'var(--primary)';
    return;
  }

  // API key チェック
  const apiKey = localStorage.getItem(_CLAUDE_KEY_STORE);
  if (!apiKey) {
    statusEl.innerHTML = '⚠ <a href="#" onclick="switchTab(\'settings\');return false;" style="color:var(--primary);">設定画面</a>でClaude APIキーを登録してください';
    statusEl.style.color = 'var(--primary)';
    return;
  }

  // Loading状態
  btn.disabled = true;
  btnLabel.textContent = '解析中...';
  statusEl.textContent = '';
  statusEl.style.color = 'var(--text-muted)';

  // 今日の日付をコンテキストとして渡す
  const todayStr = getLocalDateStr();

  const prompt = `あなたはタスク管理AIです。以下のLINEやメールの文章から、タスク登録に必要な情報を抽出してください。
JSONのみを返してください（前後の説明や\`\`\`は不要）。

今日の日付: ${todayStr}

抽出フォーマット:
{
  "name": "タスク名（簡潔に20文字以内）",
  "client": "クライアント名・会社名・人名（不明なら空文字）",
  "dueDate": "YYYY-MM-DD形式（「今週中」「月末」等も今日の日付を基準に変換。不明なら空文字）",
  "amount": 金額の数値（税別。「3万円」→30000。不明なら0）,
  "estimatedHours": 作業時間の数値（不明なら0）,
  "priority": "high"（急ぎ・重要）か"medium"（通常）か"low"（余裕あり）,
  "workType": "業務内容カテゴリ（取材・執筆・撮影・デザイン・構成・編集・打ち合わせ等）",
  "memo": "その他の重要情報（要件・注意事項など、1-2文で）"
}

文章:
${text}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const raw = err?.error?.message || '';
      let msg;
      if (resp.status === 401) {
        msg = 'APIキーが無効です。設定画面で正しいキーを入力してください。';
      } else if (resp.status === 429 || raw.toLowerCase().includes('credit') || raw.toLowerCase().includes('balance')) {
        msg = 'APIクレジットが不足しています。console.anthropic.com › Plans & Billing でクレジットを追加してください。';
      } else if (resp.status === 529 || resp.status >= 500) {
        msg = 'Anthropic APIが一時的に混雑しています。しばらく待ってから再試行してください。';
      } else {
        msg = `APIエラー (${resp.status})${raw ? ': ' + raw : ''}`;
      }
      throw new Error(msg);
    }

    const data = await resp.json();
    const rawText = data.content?.[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('解析結果を読み取れませんでした');

    const info = JSON.parse(jsonMatch[0]);

    // フォームに反映（アニメーション付き）
    const fillField = (id, value) => {
      const el = document.getElementById(id);
      if (!el || !value) return false;
      el.value = value;
      el.classList.remove('field-filled');
      void el.offsetWidth;
      el.classList.add('field-filled');
      return true;
    };

    let filled = 0;
    if (fillField('task-name', info.name)) filled++;
    if (fillField('task-client', info.client)) filled++;
    if (fillField('task-due-date', info.dueDate)) filled++;
    if (info.amount > 0 && fillField('task-amount', info.amount)) filled++;
    if (info.estimatedHours > 0 && fillField('task-estimated-hours', info.estimatedHours)) filled++;
    if (fillField('task-work-type', info.workType)) filled++;

    // 優先度ラジオを設定
    if (info.priority) {
      const radioId = info.priority === 'high' ? 'priority-high' : info.priority === 'low' ? 'priority-low' : 'priority-medium';
      const radio = document.getElementById(radioId);
      if (radio) { radio.checked = true; filled++; }
    }

    // メモをタスク名の下の説明フィールドに追記（あれば）
    if (info.memo) {
      const nameEl = document.getElementById('task-name');
      if (nameEl && !nameEl.placeholder.includes(info.memo)) {
        // メモを一時的にstatusに表示（専用メモフィールドがなければ）
      }
    }

    // 結果表示
    statusEl.style.color = 'var(--success)';
    statusEl.textContent = `✓ ${filled}項目を自動入力しました${info.memo ? ' — ' + info.memo : ''}`;

    // 成功したらエリアを縮小（テキストエリアは残す）
    setTimeout(() => {
      textarea.style.height = '60px';
      textarea.style.overflow = 'hidden';
    }, 800);

  } catch (err) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '❌ ' + (err.message || '解析に失敗しました');
  } finally {
    btn.disabled = false;
    btnLabel.textContent = '✦ 再解析';
  }
}


// ─── タッチドラッグ（クイックバー → タイムラインスロット） ─────────────────
let _tlTouchTaskId = null;
let _tlTouchGhost  = null;
let _tlTouchTimer  = null;
let _tlDragging    = false;

function tlTouchDragStart(e, taskId) {
  _tlTouchTaskId = taskId;
  _tlDragging    = false;

  // 200ms長押しでドラッグモード開始
  _tlTouchTimer = setTimeout(() => {
    _tlDragging = true;
    const task = state.tasks.find(t => t.id === taskId);
    const ghost = document.createElement('div');
    ghost.id = 'tl-touch-ghost';
    ghost.textContent = (task?.name || '').slice(0, 16);
    ghost.style.cssText = [
      'position:fixed',
      'background:var(--primary)',
      'color:#fff',
      'padding:8px 14px',
      'border-radius:4px',
      'font-size:13px',
      'font-family:var(--font-vintage)',
      'letter-spacing:0.05em',
      'z-index:9999',
      'pointer-events:none',
      'opacity:0.92',
      'max-width:180px',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(ghost);
    _tlTouchGhost = ghost;

    const touch = e.touches[0];
    ghost.style.left = (touch.clientX - 90) + 'px';
    ghost.style.top  = (touch.clientY - 40) + 'px';

    // 触覚フィードバック（対応端末）
    if (navigator.vibrate) navigator.vibrate(30);
  }, 200);
}

function tlTouchDragMove(e) {
  if (!_tlDragging || !_tlTouchGhost) return;
  e.preventDefault();
  const touch = e.touches[0];

  _tlTouchGhost.style.left = (touch.clientX - 90) + 'px';
  _tlTouchGhost.style.top  = (touch.clientY - 40) + 'px';

  // ゴーストを一瞬非表示にして下の要素を取得
  _tlTouchGhost.style.visibility = 'hidden';
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  _tlTouchGhost.style.visibility = '';

  // 前のハイライト解除
  document.querySelectorAll('.tl-slot-touch-over').forEach(s => s.classList.remove('tl-slot-touch-over'));

  if (el) {
    const slot = el.closest('.tl-slot');
    if (slot) slot.classList.add('tl-slot-touch-over');
  }
}

function tlTouchDragEnd(e) {
  if (_tlTouchTimer) { clearTimeout(_tlTouchTimer); _tlTouchTimer = null; }

  // ゴースト削除
  if (_tlTouchGhost) { _tlTouchGhost.remove(); _tlTouchGhost = null; }
  document.querySelectorAll('.tl-slot-touch-over').forEach(s => s.classList.remove('tl-slot-touch-over'));

  if (!_tlDragging) {
    // 長押しなし→通常タップ→時間ピッカー
    _tlTouchTaskId = null;
    _tlDragging = false;
    return;
  }

  const touch = e.changedTouches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (el && _tlTouchTaskId) {
    const slot = el.closest('.tl-slot');
    if (slot) {
      const hour = slot.getAttribute('data-hour');
      if (hour) {
        assignTaskToTimeslot(_tlTouchTaskId, hour);
        // 成功フィードバック
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
      }
    } else {
      // スロット外にドロップ→ピッカーを開く
      showTimeslotPicker(_tlTouchTaskId);
    }
  }

  _tlTouchTaskId = null;
  _tlDragging = false;
}

// ─── シェイクでひらめきメモ ────────────────────────────────────────────────
(function() {
  let _lastX = 0, _lastY = 0, _lastZ = 0;
  let _shakeTs = 0;
  const THRESHOLD = 18;
  const COOLDOWN  = 1500;

  function onMotion(e) {
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc) return;
    const { x=0, y=0, z=0 } = acc;
    const delta = Math.abs(x - _lastX) + Math.abs(y - _lastY) + Math.abs(z - _lastZ);
    _lastX = x; _lastY = y; _lastZ = z;
    const now = Date.now();
    if (delta > THRESHOLD && now - _shakeTs > COOLDOWN) {
      _shakeTs = now;
      openShakeMemo();
    }
  }

  // iOS13+ requires permission
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    // 初回タップ時にパーミッション取得
    document.addEventListener('touchend', async function _once() {
      document.removeEventListener('touchend', _once);
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm === 'granted') window.addEventListener('devicemotion', onMotion);
      } catch(e) {}
    }, { once: false });
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    window.addEventListener('devicemotion', onMotion);
  }
})();

function openShakeMemo() {
  const overlay = document.getElementById('shake-memo-overlay');
  const text    = document.getElementById('shake-memo-text');
  if (!overlay) return;
  // すでに何かモーダルが開いていれば無視
  if (document.querySelector('.modal-overlay.active')) return;
  overlay.classList.add('active');
  setTimeout(() => text?.focus(), 300);
  if (navigator.vibrate) navigator.vibrate(30);
}

function closeShakeMemo() {
  const overlay = document.getElementById('shake-memo-overlay');
  if (overlay) overlay.classList.remove('active');
}

function saveShakeMemo() {
  const text = document.getElementById('shake-memo-text')?.value.trim();
  if (!text) { closeShakeMemo(); return; }
  // ひらめきメモに保存
  if (!state.ideas) state.ideas = [];
  state.ideas.unshift({
    id: 'idea_' + Date.now(),
    text,
    createdAt: getLocalDateStr(),
    tags: [],
  });
  localStorage.setItem('tinyperk_ideas', JSON.stringify(state.ideas));
  document.getElementById('shake-memo-text').value = '';
  closeShakeMemo();
  showToast('💡 メモを保存しました');
}

// ─── 貼り付けCTA ─────────────────────────────────────────────────────────
// ─── 貼り付け登録モーダル ─────────────────────────────────────────────────
// ダッシュボードの「LINEやメールをそのまま貼り付けて登録」ボタン用
// スマホではclipboard APIが使えないため、専用モーダルで手動ペースト

// モーダルの状態管理
let _pasteModalStep = 1;       // 1=入力, 2=確認
let _pasteModalParsed = null;  // AI解析結果（Step2で使用）

// ── 業務ジャンル履歴管理 ──────────────────────────────────────────────────
const _WORKTYPE_HISTORY_KEY = 'tinyperk_worktype_history';
const _WORKTYPE_DEFAULTS = ['取材','執筆・ライティング','撮影','動画編集','デザイン','構成・編集','Web制作','打ち合わせ','資料作成','その他'];

function _getWorktypeHistory() {
  try {
    return JSON.parse(localStorage.getItem(_WORKTYPE_HISTORY_KEY) || '[]');
  } catch { return []; }
}

function _saveWorktypeToHistory(wt) {
  if (!wt) return;
  let hist = _getWorktypeHistory().filter(v => v !== wt);
  hist.unshift(wt); // 最近使ったものを先頭に
  hist = hist.slice(0, 20); // 最大20件
  localStorage.setItem(_WORKTYPE_HISTORY_KEY, JSON.stringify(hist));
}

function _buildWorktypeOptions(selectedValue) {
  const sel = document.getElementById('paste-hint-worktype');
  if (!sel) return;

  const history = _getWorktypeHistory();
  // 履歴にないデフォルト項目
  const defaults = _WORKTYPE_DEFAULTS.filter(v => !history.includes(v));

  let html = '<option value="">自動判定</option>';

  if (history.length > 0) {
    html += '<optgroup label="最近使った業務">';
    history.forEach(v => {
      const sel_ = v === selectedValue ? ' selected' : '';
      html += `<option${sel_}>${v}</option>`;
    });
    html += '</optgroup>';
  }

  if (defaults.length > 0) {
    html += '<optgroup label="業務カテゴリ">';
    defaults.forEach(v => {
      const sel_ = v === selectedValue ? ' selected' : '';
      html += `<option${sel_}>${v}</option>`;
    });
    html += '</optgroup>';
  }

  sel.innerHTML = html;
}

function openPasteCTA() {
  _pasteModalStep = 1;
  _pasteModalParsed = null;

  // ヒント欄をリセット・業務ジャンル履歴を反映
  _buildWorktypeOptions('');
  const hintDuedate  = document.getElementById('paste-hint-duedate');
  const hintNote     = document.getElementById('paste-hint-note');
  if (hintDuedate)  hintDuedate.value  = '';
  if (hintNote)     hintNote.value     = '';

  const overlay = document.getElementById('paste-modal-overlay');
  if (!overlay) return;

  // UIリセット
  const step1 = document.getElementById('paste-step1');
  const step2 = document.getElementById('paste-step2');
  const ta    = document.getElementById('paste-modal-textarea');
  const st    = document.getElementById('paste-modal-status');
  const btn   = document.getElementById('paste-modal-action-btn');
  const lbl   = document.getElementById('paste-modal-btn-label');
  if (step1) step1.style.display = '';
  if (step2) step2.style.display = 'none';
  if (ta)    ta.value = '';
  if (st)    { st.textContent = ''; st.style.color = 'var(--text-muted)'; }
  if (btn)   btn.disabled = false;
  if (lbl)   lbl.textContent = '✦ AIで解析';

  // 背景スクロールロック（他モーダルと同じパターン）
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  overlay.classList.add('active');
  setTimeout(() => ta?.focus(), 120);
}

function closePasteModal() {
  const overlay = document.getElementById('paste-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  // スクロールロック解除
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, state._scrollY || 0);
}

async function handlePasteModalAction() {
  if (_pasteModalStep === 2) {
    // ─── Step2: 登録確定（編集フォームから値を読む） ──────────────────
    const name     = document.getElementById('pp-name')?.value.trim()       || '無題タスク';
    const client   = document.getElementById('pp-client')?.value.trim()     || '';
    const dueDate  = document.getElementById('pp-duedate')?.value           || '';
    const amount   = parseFloat(document.getElementById('pp-amount')?.value) || 0;
    const estHours = parseFloat(document.getElementById('pp-hours')?.value)  || 0;
    const workType = document.getElementById('pp-worktype')?.value.trim()   || '';
    const priority = document.getElementById('pp-priority')?.value          || 'medium';
    const memo     = document.getElementById('pp-memo')?.value.trim()       || '';

    const newTask = {
      id:             Date.now(),
      name,
      client,
      dueDate,
      amount,
      estimatedHours: estHours,
      workType,
      priority,
      memo,
      status:         'not-started',
      createdAt:      getLocalDateStr(),
      steps:          [],
    };
    if (workType) _saveWorktypeToHistory(workType);
    if (!Array.isArray(state.tasks)) state.tasks = [];
    state.tasks.unshift(newTask);
    saveTasksToStorage();
    renderApp();
    closePasteModal();
    showToast('✓ タスクを登録しました');
    return;
  }

  // ─── Step1: 解析 ──────────────────────────────────────────────
  const ta  = document.getElementById('paste-modal-textarea');
  const st  = document.getElementById('paste-modal-status');
  const btn = document.getElementById('paste-modal-action-btn');
  const lbl = document.getElementById('paste-modal-btn-label');
  if (!ta || !st || !btn || !lbl) return;

  const text = ta.value.trim();
  if (!text) {
    st.textContent = 'テキストを貼り付けてください';
    st.style.color = 'var(--danger)';
    return;
  }

  // ユーザー補足ヒントを収集
  const hints = {
    workType: (document.getElementById('paste-hint-worktype')?.value || '').trim(),
    dueDate:  (document.getElementById('paste-hint-duedate')?.value  || '').trim(),
    note:     (document.getElementById('paste-hint-note')?.value     || '').trim(),
  };

  btn.disabled = true;
  const hasGemini = !!localStorage.getItem(_GEMINI_KEY_STORE);
  const hasClaude = !!localStorage.getItem(_CLAUDE_KEY_STORE);
  lbl.textContent = (hasGemini || hasClaude) ? 'AI解析中...' : '解析中...';
  st.textContent = '';

  try {
    // AI → なければルールベース
    let parsed = await _callAIForTaskParse(text, hints);
    const usedAI = parsed !== null;
    if (!parsed) parsed = parseTaskRuleBased(text, hints);

    _pasteModalParsed = parsed;
    const p = _pasteModalParsed;

    // ステータスに使用モードを表示
    st.textContent = usedAI ? '✦ AIで解析しました' : '✦ 自動解析しました（APIキー不要）';
    st.style.color = 'var(--text-muted)';

    // ── Step2 編集フォーム表示 ──
    const step1   = document.getElementById('paste-step1');
    const step2   = document.getElementById('paste-step2');
    const preview = document.getElementById('paste-preview');
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = '';

    // 業務種別セレクトの options を生成
    const worktypeOpts = (() => {
      const hist = _getWorktypeHistory().filter(v => v !== p.workType);
      const defs = _WORKTYPE_DEFAULTS.filter(v => v !== p.workType && !hist.includes(v));
      const all  = p.workType ? [p.workType, ...hist, ...defs] : ['', ...hist, ...defs];
      return all.map((v, i) => {
        const sel = (i === 0 && p.workType) || (!p.workType && i === 0) ? ' selected' : '';
        return `<option value="${escapeHtml(v)}"${sel}>${v ? escapeHtml(v) : '（なし）'}</option>`;
      }).join('');
    })();

    const fRow = (label, input) =>
      `<div class="pp-row">
         <label class="pp-label">${label}</label>
         <div class="pp-input">${input}</div>
       </div>`;

    if (preview) {
      preview.innerHTML = [
        fRow('タスク名',    `<input id="pp-name"     type="text"   class="form-control pp-fc" value="${escapeHtml(p.name||'')}">` ),
        fRow('クライアント',`<input id="pp-client"   type="text"   class="form-control pp-fc" value="${escapeHtml(p.client||'')}">` ),
        fRow('納期',        `<input id="pp-duedate"  type="date"   class="form-control pp-fc" value="${escapeHtml(p.dueDate||'')}">` ),
        fRow('金額（税別）',`<input id="pp-amount"   type="number" class="form-control pp-fc" value="${p.amount||''}" min="0" placeholder="0">` ),
        fRow('作業時間(h)', `<input id="pp-hours"    type="number" class="form-control pp-fc" value="${p.estimatedHours||''}" min="0" step="0.5" placeholder="0">` ),
        fRow('業務種別',    `<select id="pp-worktype" class="form-control pp-fc">${worktypeOpts}</select>` ),
        fRow('優先度',      `<select id="pp-priority" class="form-control pp-fc">
                               <option value="high"   ${p.priority==='high'  ?'selected':''}>🔴 高</option>
                               <option value="medium" ${p.priority==='medium'?'selected':''}>🟡 中</option>
                               <option value="low"    ${p.priority==='low'   ?'selected':''}>🟢 低</option>
                             </select>` ),
        fRow('メモ',        `<textarea id="pp-memo" class="form-control pp-fc" rows="3" style="resize:none;">${escapeHtml(p.memo||'')}</textarea>` ),
      ].join('');
    }

    _pasteModalStep = 2;
    lbl.textContent = '✓ タスクを登録';
    btn.disabled = false;

  } catch (err) {
    st.style.color = 'var(--danger)';
    st.textContent = '❌ ' + (err.message || '解析に失敗しました');
    btn.disabled = false;
    lbl.textContent = '✦ 再解析';
  }
}

// ─── 月末請求リマインダー ─────────────────────────────────────────────────
function checkInvoiceReminder() {
  const banner = document.getElementById('invoice-reminder-banner');
  if (!banner) return;
  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  // 月末5日以内 かつ 完了済み未請求タスクがある場合
  if (daysLeft <= 5) {
    const thisMonth = getLocalDateStr().slice(0,7);
    const unpaid = state.tasks.filter(t =>
      t.status === 'completed' &&
      t.amount > 0 &&
      t.completedAt?.startsWith(thisMonth)
    );
    if (unpaid.length > 0) {
      const total = unpaid.reduce((s,t) => s+(t.amount||0), 0);
      const sub = document.getElementById('invoice-reminder-sub');
      if (sub) sub.textContent = `${unpaid.length}件 ¥${total.toLocaleString()} — 月末まであと${daysLeft}日`;
      banner.classList.add('visible');
      return;
    }
  }
  banner.classList.remove('visible');
}

// ─── 感情コピー：稼働時間 ────────────────────────────────────────────────
function getEmotionalHoursCopy(hours, monthHours) {
  if (!hours && !monthHours) return '';
  const h = monthHours || hours;
  const perDay = (h / new Date().getDate()).toFixed(1);
  if (h < 20) return `まだ余裕がありそうです。無理せず進めましょう。`;
  if (h < 50) return `いいペースです。1日平均 ${perDay}h 。`;
  if (h < 80) return `よく働いています。休憩も仕事のうちです。`;
  return `今月 ${h.toFixed(1)}h — 少しペースを落とせますか？`;
}

// ─── 前回と同じ金額 ─────────────────────────────────────────────────────
function fillSamePrice(clientName) {
  const client = clientName || document.getElementById('task-client')?.value.trim();
  if (!client) return;
  const prev = state.tasks
    .filter(t => t.client === client && t.amount > 0)
    .sort((a,b) => (b.id||'').localeCompare(a.id||''))[0];
  if (!prev) { showToast('前回の金額が見つかりません'); return; }
  const inp = document.getElementById('task-amount');
  if (inp) {
    inp.value = prev.amount;
    inp.classList.add('field-highlight');
    setTimeout(() => inp.classList.remove('field-highlight'), 800);
  }
}

function updateSamePriceHint() {
  const hint = document.getElementById('same-price-hint');
  if (!hint) return;
  const client = document.getElementById('task-client')?.value.trim();
  if (!client) { hint.style.display = 'none'; return; }
  const prev = state.tasks
    .filter(t => t.client === client && t.amount > 0)
    .sort((a,b) => (b.id||'').localeCompare(a.id||''))[0];
  if (prev) {
    hint.style.display = 'inline-flex';
    hint.textContent = `前回と同じ ¥${prev.amount.toLocaleString()}`;
    hint.onclick = () => fillSamePrice(client);
  } else {
    hint.style.display = 'none';
  }
}

// ─── クライアント関係スコア ──────────────────────────────────────────────
function getClientRelationBadge(clientName) {
  if (!clientName) return '';
  const tasks = state.tasks.filter(t => t.client === clientName);
  if (tasks.length === 0) return '';
  const lastTask = tasks.sort((a,b) => (b.completedAt||b.dueDate||'').localeCompare(a.completedAt||a.dueDate||''))[0];
  const lastDate = lastTask.completedAt || lastTask.dueDate || '';
  if (!lastDate) return '';
  const daysDiff = Math.floor((Date.now() - new Date(lastDate)) / 86400000);
  if (daysDiff <= 30) return `<span class="client-relation-badge client-relation-hot">🔥 ${daysDiff}日前</span>`;
  if (daysDiff <= 90) return `<span class="client-relation-badge client-relation-warm">📅 ${daysDiff}日前</span>`;
  return `<span class="client-relation-badge client-relation-cold">💤 ${daysDiff}日前</span>`;
}

// ─── 今日の最優先3件 ───────────────────────────────────────────────────────
function renderTop3Tasks(todayStr) {
  const el = document.getElementById('dash-top3-list');
  if (!el) return;

  const priorityOrder = { 'high': 0, 'medium': 1, 'low': 2, '': 3 };
  const statusOrder = { 'in-progress': 0, 'revision': 1, 'not-started': 2 };

  const candidates = state.tasks
    .filter(t => t.status !== 'completed')
    .sort((a, b) => {
      // 1. 期日が今日のものを優先
      const aDue = a.dueDate === todayStr ? 0 : 1;
      const bDue = b.dueDate === todayStr ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      // 2. ステータス順
      const aSt = statusOrder[a.status] ?? 9;
      const bSt = statusOrder[b.status] ?? 9;
      if (aSt !== bSt) return aSt - bSt;
      // 3. 優先度順
      return (priorityOrder[a.priority||''] ?? 3) - (priorityOrder[b.priority||''] ?? 3);
    })
    .slice(0, 3);

  if (candidates.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0;">🎉 未完了タスクはありません</div>';
    return;
  }

  const statusLabel = { 'not-started': 'PENDING', 'in-progress': 'IN PROGRESS', 'revision': 'REVISION' };
  const ranks = ['Ⅰ', 'Ⅱ', 'Ⅲ'];
  el.innerHTML = candidates.map((t, i) => `
    <div class="top3-card" onclick="openEditTaskModal('${t.id}')">
      <span class="top3-rank">${ranks[i]}</span>
      <div class="top3-body">
        <div class="top3-name">${escapeHtml(t.name)}</div>
        <div class="top3-meta">
          ${t.client ? `👤 ${escapeHtml(t.client)} &nbsp;` : ''}
          ${t.dueDate ? `📅 ${t.dueDate}` : '日程未定'}
          &nbsp;
          <span style="color:var(--primary);font-size:0.7rem;">${statusLabel[t.status]||t.status}</span>
        </div>
      </div>
      ${t.amount ? `<span style="font-family:var(--font-vintage);color:var(--success);font-size:0.85rem;">¥${t.amount.toLocaleString()}</span>` : ''}
    </div>`).join('');
}

// ─── サイドバー「その他」トグル ──────────────────────────────────────────
function toggleSidebarMore() {
  const more = document.getElementById('sidebar-more-section');
  const btn  = document.getElementById('sidebar-more-btn');
  if (!more) return;
  const open = more.style.display !== 'none';
  more.style.display = open ? 'none' : 'block';
  if (btn) btn.setAttribute('aria-expanded', String(!open));
}

// ═══════════════════════════════════════════════════════════
//  CHRONO TRIGGER × TINYPERK  — 時の旅人 UI  v77
// ═══════════════════════════════════════════════════════════

// ─── 1. オープニングアニメーション ────────────────────────────────────────
function initOpeningAnimation() {
  const overlay = document.getElementById('opening-overlay');
  if (!overlay) return;

  // ── 星背景 ──
  const starCanvas = document.getElementById('opening-stars');
  if (starCanvas) {
    starCanvas.width  = window.innerWidth;
    starCanvas.height = window.innerHeight;
    const sc = starCanvas.getContext('2d');
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * starCanvas.width;
      const y = Math.random() * starCanvas.height;
      const r = Math.random() * 1.6 + 0.2;
      const a = Math.random() * 0.7 + 0.15;
      sc.beginPath(); sc.arc(x, y, r, 0, Math.PI * 2);
      sc.fillStyle = i % 7 === 0
        ? `rgba(74,158,255,${a})`
        : `rgba(200,169,110,${a * 0.8})`;
      sc.fill();
    }
  }

  // ── 時計キャンバス描画（requestAnimationFrame） ──
  const clkCanvas = document.getElementById('opening-clock-canvas');
  if (!clkCanvas) { setTimeout(() => overlay.classList.add('hidden'), 10600); return; }

  // ── キャンバスをフルスクリーンに ──
  const CW   = window.innerWidth;
  const CH   = window.innerHeight;
  const SIZE = CW * 1.72;   // 画面幅より大きく → 左右にはみ出す
  clkCanvas.width  = CW;
  clkCanvas.height = CH;
  clkCanvas.style.width  = CW + 'px';
  clkCanvas.style.height = CH + 'px';

  const cx      = CW / 2;
  const PIVOT_Y = CH * 0.02;   // チェーン固定点（最上端）
  const cy      = CH * 0.50;   // 時計の中心（画面中央）
  const R       = SIZE * 0.44; // 外径（画面より大きい）

  let startTime = null;
  let rafId;

  function drawClock(ts) {
    if (!startTime) startTime = ts;
    const elapsed = (ts - startTime) / 1000; // 秒

    if (elapsed > 13.2) { cancelAnimationFrame(rafId); return; }

    const ctx = clkCanvas.getContext('2d');
    ctx.clearRect(0, 0, CW, CH);
    ctx.save();

    // ── 振り子（物理的な振り子運動：最大振れ角から自然に振り始め減衰） ──
    // sin は中心スタートで不自然。cos は最大振れ角スタート → 本物の振り子
    const SWING_AMP = 28 * Math.PI / 180; // 振れ角（やや控えめで優雅に）
    const SWING_T   = 3.4; // 周期(秒) — 重い振り子は少しゆっくり
    const swayAngle = SWING_AMP
      * Math.cos(2 * Math.PI * elapsed / SWING_T)
      * Math.exp(-elapsed * 0.038); // 緩やかな減衰

    // チェーン固定点（PIVOT_Y）を軸に回転 → 本物の振り子動作
    ctx.translate(cx, PIVOT_Y);
    ctx.rotate(swayAngle);
    ctx.translate(-cx, -PIVOT_Y);

    // ── チェーン（固定点から時計上端まで・金属質感のリアルなリンク） ──
    const chainBotY = cy - R * 0.97;
    const linkCount = 15;
    const linkW = SIZE * 0.017; // リンク楕円の半径(横)
    const linkH = SIZE * 0.030; // リンク楕円の半径(縦) — 連結部で重なるよう少し大きめ
    const linkGap = (chainBotY - PIVOT_Y) / linkCount;
    for (let i = 0; i <= linkCount; i++) {
      const ly = PIVOT_Y + linkGap * i;
      const t = i / linkCount;
      const fade = 0.5 + 0.4 * (1 - t); // 上ほどわずかに薄く・奥行き感
      const vertical = i % 2 === 0;
      ctx.save();
      ctx.translate(cx, ly);
      ctx.rotate(vertical ? 0 : Math.PI / 2);

      // 落ち影（厚み・奥行きの表現）
      ctx.save();
      ctx.translate(SIZE * 0.0035, SIZE * 0.005);
      ctx.beginPath();
      ctx.ellipse(0, 0, linkW, linkH, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,0,0,${0.4 * fade})`;
      ctx.lineWidth = SIZE * 0.013;
      ctx.stroke();
      ctx.restore();

      // 金属本体（左上ハイライト→右下シャドウのグラデーション）
      const grad = ctx.createLinearGradient(-linkW, -linkH, linkW, linkH);
      grad.addColorStop(0,    `rgba(255,240,200,${0.95 * fade})`);
      grad.addColorStop(0.32, `rgba(218,182,114,${0.88 * fade})`);
      grad.addColorStop(0.62, `rgba(146,104,50,${0.86 * fade})`);
      grad.addColorStop(1,    `rgba(64,42,16,${0.92 * fade})`);
      ctx.beginPath();
      ctx.ellipse(0, 0, linkW, linkH, 0, 0, Math.PI * 2);
      ctx.strokeStyle = grad;
      ctx.lineWidth = SIZE * 0.0105;
      ctx.stroke();

      // 表面の光沢ライン（磨かれた金属のハイライト）
      ctx.beginPath();
      ctx.ellipse(0, 0, linkW * 0.78, linkH * 0.78, 0, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.strokeStyle = `rgba(255,248,225,${0.55 * fade})`;
      ctx.lineWidth = SIZE * 0.0032;
      ctx.stroke();

      ctx.restore();
    }

    // 固定金具（上端の金具）
    const pinTop = ctx.createRadialGradient(cx, PIVOT_Y, 0, cx, PIVOT_Y, SIZE * 0.022);
    pinTop.addColorStop(0, '#ffe09a');
    pinTop.addColorStop(1, '#8a6028');
    ctx.beginPath();
    ctx.arc(cx, PIVOT_Y, SIZE * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = pinTop;
    ctx.fill();

    // ── 外縁グロー ──
    const glow = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.4);
    glow.addColorStop(0,   'rgba(200,169,110,0.13)');
    glow.addColorStop(0.5, 'rgba(80,50,20,0.06)');
    glow.addColorStop(1,   'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.4, 0, Math.PI * 2); ctx.fill();

    // ── 外リング（3重） ──
    [0, 0.012, 0.028].forEach((off, i) => {
      const alpha = [0.55, 0.35, 0.18][i];
      ctx.beginPath();
      ctx.arc(cx, cy, R + off * SIZE, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,169,110,${alpha})`;
      ctx.lineWidth = [3.5, 2, 1][i];
      ctx.stroke();
    });

    // ── 文字盤背景（油絵風グラデ） ──
    const face = ctx.createRadialGradient(cx - R*0.12, cy - R*0.18, 0, cx, cy, R);
    face.addColorStop(0,   '#2e1e06');
    face.addColorStop(0.45,'#170f02');
    face.addColorStop(0.78,'#0d0903');
    face.addColorStop(1,   '#070508');
    ctx.beginPath(); ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
    ctx.fillStyle = face; ctx.fill();

    // ── 光沢ハイライト（右上） ──
    const sheen = ctx.createRadialGradient(cx + R*0.2, cy - R*0.35, 0, cx, cy, R);
    sheen.addColorStop(0,   'rgba(230,210,155,0.11)');
    sheen.addColorStop(0.4, 'rgba(200,169,110,0.04)');
    sheen.addColorStop(1,   'transparent');
    ctx.beginPath(); ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
    ctx.fillStyle = sheen; ctx.fill();

    // ── ギョーシェ模様（細い同心円） ──
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
    ctx.clip();
    for (let rr = R * 0.18; rr < R - 4; rr += R * 0.065) {
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200,169,110,0.055)';
      ctx.lineWidth = 0.6; ctx.stroke();
    }
    // 放射線
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4));
      ctx.strokeStyle = 'rgba(200,169,110,0.03)';
      ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.restore();

    // ── 時字（ローマ数字 + 4/8/12に大きめ目盛） ──
    const NUMS = ['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const nr  = R * 0.74;
      const tx  = cx + Math.cos(ang) * nr;
      const ty  = cy + Math.sin(ang) * nr;
      const isMain = i % 3 === 0;
      ctx.font = isMain
        ? `bold ${SIZE * 0.052}px Georgia,serif`
        : `${SIZE * 0.036}px Georgia,serif`;
      ctx.fillStyle = isMain
        ? 'rgba(220,190,120,0.90)'
        : 'rgba(200,169,110,0.62)';
      ctx.fillText(NUMS[i], tx, ty);
    }
    ctx.restore();

    // ── 目盛り（60個 + 12個大） ──
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const isMaj = i % 5 === 0;
      const r1 = R * (isMaj ? 0.84 : 0.88);
      const r2 = R * 0.93;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.strokeStyle = isMaj ? 'rgba(220,190,120,0.75)' : 'rgba(200,169,110,0.3)';
      ctx.lineWidth = isMaj ? 2 : 0.8;
      ctx.stroke();
    }

    // ── 小秒針サブダイアル（6時位置） ──
    const subR = R * 0.16;
    const subCx = cx;
    const subCy = cy + R * 0.46;
    ctx.beginPath(); ctx.arc(subCx, subCy, subR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,169,110,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(subCx, subCy, subR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,6,2,0.7)'; ctx.fill();
    // 小秒針の目盛
    for (let i = 0; i < 12; i++) {
      const a = (i/12)*Math.PI*2 - Math.PI/2;
      ctx.beginPath();
      ctx.moveTo(subCx + Math.cos(a)*subR*0.72, subCy + Math.sin(a)*subR*0.72);
      ctx.lineTo(subCx + Math.cos(a)*subR*0.92, subCy + Math.sin(a)*subR*0.92);
      ctx.strokeStyle = 'rgba(200,169,110,0.4)'; ctx.lineWidth = 0.7; ctx.stroke();
    }

    // ── 時計針（現在時刻） ──
    const now = new Date();
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    const ms = now.getMilliseconds();
    const secFrac = s + ms / 1000;

    const hourAng   = ((h + m/60 + s/3600) / 12) * Math.PI * 2 - Math.PI / 2;
    const minAng    = ((m + s/60)           / 60) * Math.PI * 2 - Math.PI / 2;
    const secAng    = (secFrac              / 60) * Math.PI * 2 - Math.PI / 2;
    const smallSecAng = secAng; // 小秒針は通常の秒針と同じ

    // 影付き針を描く関数
    function drawHand(angle, length, width, color, shadow) {
      ctx.save();
      if (shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur  = 8;
        ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
      }
      ctx.beginPath();
      ctx.moveTo(
        cx - Math.cos(angle) * length * 0.18,
        cy - Math.sin(angle) * length * 0.18
      );
      ctx.lineTo(
        cx + Math.cos(angle) * length,
        cy + Math.sin(angle) * length
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 時針 (グローエフェクト付き)
    ctx.save();
    ctx.shadowColor = 'rgba(220,190,120,0.35)'; ctx.shadowBlur = 10;
    drawHand(hourAng, R * 0.50, SIZE * 0.028, '#e0c878', true);
    ctx.restore();
    drawHand(minAng,  R * 0.70, SIZE * 0.018, '#d4b86a', true);
    // 秒針（細い・赤みがかった金）
    ctx.save();
    ctx.shadowColor = 'rgba(255,80,30,0.3)'; ctx.shadowBlur = 6;
    drawHand(secAng,  R * 0.80, SIZE * 0.008, '#c87840', false);
    ctx.restore();

    // 小秒針
    ctx.save();
    ctx.translate(subCx, subCy);
    ctx.beginPath();
    ctx.moveTo(-Math.cos(smallSecAng)*subR*0.3, -Math.sin(smallSecAng)*subR*0.3);
    ctx.lineTo(Math.cos(smallSecAng)*subR*0.75, Math.sin(smallSecAng)*subR*0.75);
    ctx.strokeStyle = 'rgba(200,130,60,0.8)';
    ctx.lineWidth = SIZE * 0.006; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();

    // 中心ピン
    const pinG = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE*0.025);
    pinG.addColorStop(0,   '#ffe09a');
    pinG.addColorStop(0.4, '#c8a96e');
    pinG.addColorStop(1,   '#7a5c28');
    ctx.beginPath(); ctx.arc(cx, cy, SIZE * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = pinG; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, SIZE * 0.006, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe0a0'; ctx.fill();

    // 小秒針中心
    ctx.beginPath(); ctx.arc(subCx, subCy, SIZE*0.012, 0, Math.PI*2);
    ctx.fillStyle = '#c8a96e'; ctx.fill();

    ctx.restore();
    rafId = requestAnimationFrame(drawClock);
  }

  rafId = requestAnimationFrame(drawClock);

  // animationend + setTimeout の二重保険で確実にdisplay:none
  const hideOverlay = () => {
    cancelAnimationFrame(rafId);
    overlay.classList.add('hidden');
  };
  overlay.addEventListener('animationend', hideOverlay, { once: true });
  setTimeout(hideOverlay, 14000); // 最終フォールバック

  // iOS Safari では CSS animation の pointer-events が信頼できないため JS で明示的に制御
  // フェード開始と同時にpointer-eventsを切る（フェード開始前まではタップでスキップ可能にする）
  setTimeout(() => { overlay.style.pointerEvents = 'none'; }, 11000);

  // タップ/クリックでオープニングをスキップできるように
  const skipOpening = () => hideOverlay();
  overlay.addEventListener('click', skipOpening, { once: true, passive: true });
  overlay.addEventListener('touchend', skipOpening, { once: true, passive: true });
}

// ─── 2. 時間帯テーマ（ダッシュボード背景グラデ） ─────────────────────────
const TIME_THEMES = [
  // [開始時, 背景色, グラデ終端色, アクセント名]
  { h:  0, bg: '#060610', c1: '#0f0a2a', label: '時の最果て' },
  { h:  5, bg: '#0a0820', c1: '#1a0a3e', label: '夜明け前' },
  { h:  7, bg: '#0f1a08', c1: '#1a3010', label: '太陽の石' },
  { h: 12, bg: '#1a1005', c1: '#2e1e08', label: '午後の光' },
  { h: 17, bg: '#200a04', c1: '#3a1208', label: 'ガルディア城の夕焼け' },
  { h: 19, bg: '#060a14', c1: '#0a1428', label: '約束の地・静寂' },
];

function updateTimeBasedTheme() {
  const h = new Date().getHours();
  const theme = [...TIME_THEMES].reverse().find(t => h >= t.h) || TIME_THEMES[0];
  const root = document.documentElement;
  root.style.setProperty('--time-hour-bg', theme.bg);
  root.style.setProperty('--time-hour-c1', theme.c1);
}

// ─── 3. 星フィールド（稼働時間に連動） ───────────────────────────────────
function renderStarfield() {
  const canvas = document.getElementById('starfield-canvas');
  if (!canvas) return;

  // 今日の稼働時間（分）を算出
  const today = getLocalDateStr();
  const log = (state.workLogs || []).find(l => l.date === today);
  let minutesWorked = 0;
  if (log && log.clockIn) {
    const inMs  = new Date(`${today}T${log.clockIn}`).getTime();
    const outMs = log.clockOut ? new Date(`${today}T${log.clockOut}`).getTime() : Date.now();
    minutesWorked = Math.max(0, (outMs - inMs) / 60000);
  }

  // 8時間（480分）で満天：最大220個
  const maxStars = 220;
  const starCount = Math.min(maxStars, Math.floor((minutesWorked / 480) * maxStars));

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < starCount; i++) {
    const x  = Math.random() * canvas.width;
    const y  = Math.random() * canvas.height;
    const sz = Math.random() < 0.1 ? 2 : 1; // 10%は大きめ
    const a  = Math.random() * 0.5 + 0.1;
    // 正方形ドット（16bit風）
    ctx.fillStyle = i % 7 === 0
      ? `rgba(74,158,255,${a})`     // たまに青
      : `rgba(200,169,110,${a})`;   // 基本ゴールド
    ctx.fillRect(x, y, sz, sz);
  }

  // ダッシュボード画面のときだけ表示
  if (state.activeTab === 'dashboard') {
    canvas.classList.add('visible');
    canvas.style.display = 'block';
  } else {
    canvas.classList.remove('visible');
  }
}

// ─── 4. タイムゲートトランジション ───────────────────────────────────────
function triggerTimeGate(callback) {
  const el = document.getElementById('timegate-overlay');
  if (!el) { if (callback) callback(); return; }
  el.classList.remove('active');
  void el.offsetWidth; // reflow
  el.classList.add('active');
  // 中間点でコンテンツ切替
  setTimeout(() => { if (callback) callback(); }, 110);
  setTimeout(() => el.classList.remove('active'), 350);
}

// ─── 5. 正方形ピクセルパーティクル ───────────────────────────────────────
function spawnPixelParticles(x, y) {
  const canvas = document.getElementById('pixel-particle-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const COLORS = ['#c8a96e','#f0c060','#4a9eff','#a0d080','#f08040','#e8e0d0'];
  const particles = Array.from({length: 24}, () => ({
    x, y,
    vx: (Math.random() - 0.5) * 9,
    vy: (Math.random() - 0.5) * 9 - 2,
    size: Math.floor(Math.random() * 5) + 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    life: 1,
    decay: Math.random() * 0.04 + 0.025,
    gravity: 0.18,
  }));

  let raf;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += p.gravity;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size/2), Math.round(p.y - p.size/2), p.size, p.size);
    });
    ctx.globalAlpha = 1;
    if (alive) raf = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (raf) cancelAnimationFrame(raf);
  draw();
}

// ─── 6. PUNCH リプルエフェクト ────────────────────────────────────────────
function triggerPunchRipple(btn) {
  if (!btn) return;
  const ripple = document.createElement('span');
  ripple.className = 'punch-ripple';
  const h = new Date().getHours();
  // 時間帯でリプル色変化
  const color = h >= 5 && h < 19
    ? 'rgba(200,169,110,0.55)'   // 昼：ゴールド
    : 'rgba(74,158,255,0.55)';   // 夜：タイムブルー
  ripple.style.setProperty('--ripple-color', color);
  ripple.style.left = '50%';
  ripple.style.top  = '50%';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 800);
}

// ─── 7. switchTab に タイムゲート + 星フィールド連携 ─────────────────────
// 既存switchTabをラップ（タイムゲートエフェクト付き）
(function() {
  const _origFn = switchTab; // スコープ内で直接参照
  switchTab = function(tab) {
    triggerTimeGate(() => _origFn.call(this, tab));
    // 星フィールド表示切替
    setTimeout(() => {
      const sf = document.getElementById('starfield-canvas');
      if (sf) {
        if (tab === 'dashboard') {
          sf.style.display = 'block';
          renderStarfield();
          setTimeout(() => sf.classList.add('visible'), 80);
        } else {
          sf.classList.remove('visible');
          setTimeout(() => { sf.style.display = 'none'; }, 1500);
        }
      }
    }, 140);
  };
  window.switchTab = switchTab;
})();

// ─── 8. PUNCH IN/OUT にリプル + 時間帯テーマ更新 ─────────────────────────
const _origClockIn  = window.clockIn;
const _origClockOut = window.clockOut;
if (typeof clockIn === 'function') {
  const _ci = clockIn;
  window.clockIn = function() {
    navigator.vibrate?.([12]);                          // 触覚フィードバック IN
    triggerPunchRipple(document.getElementById('btn-clock-in'));
    updateTimeBasedTheme();
    _ci();
    setTimeout(renderStarfield, 300);
  };
}
if (typeof clockOut === 'function') {
  const _co = clockOut;
  window.clockOut = function() {
    navigator.vibrate?.([10, 40, 20]);                  // 触覚フィードバック OUT（2段階）
    triggerPunchRipple(document.getElementById('btn-clock-out'));
    updateTimeBasedTheme();
    _co();
    setTimeout(renderStarfield, 300);
  };
}

// ─── 9. タスク完了時にピクセルパーティクル ───────────────────────────────
const _origSaveTaskEdit = window.saveTaskEdit;
if (typeof saveTaskEdit === 'function') {
  const _ste = saveTaskEdit;
  window.saveTaskEdit = function() {
    const beforeStatus = (state.tasks.find(t => t.id === state.editingTaskId) || {}).status;
    _ste();
    const afterTask = state.tasks.find(t => t.id === state.editingTaskId);
    if (afterTask && afterTask.status === 'completed' && beforeStatus !== 'completed') {
      // 画面中央付近にパーティクル
      const cx = window.innerWidth  / 2 + (Math.random() - 0.5) * 80;
      const cy = window.innerHeight / 2 + (Math.random() - 0.5) * 60;
      setTimeout(() => spawnPixelParticles(cx, cy), 200);
    }
  };
}

// ─── 10. 初期化 — DOMContentLoaded ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initOpeningAnimation();
  updateTimeBasedTheme();
  // 1分ごとに時間帯テーマを更新（IDを保持してdouble-init防止）
  if (!window._timeThemeInterval) {
    window._timeThemeInterval = setInterval(updateTimeBasedTheme, 60000);
  }
  // ダッシュボード初期表示の星
  setTimeout(renderStarfield, 400);
});// Undo バナー（3秒で消える）
function showUndoBanner(message, onUndo) {
  let banner = document.getElementById('undo-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'undo-banner';
    document.body.appendChild(banner);
  }
  clearTimeout(banner._timer);
  banner.innerHTML = `<span>${message}</span><button onclick="this.closest('#undo-banner')._undo?.()">元に戻す</button>`;
  banner._undo = onUndo;
  banner.classList.add('visible');
  banner._timer = setTimeout(() => banner.classList.remove('visible'), 3200);
}

// ============================================================
// 返信文作成モーダル
// ============================================================
function openReplyModal() {
  state._scrollY = window.scrollY;
  document.body.style.top = `-${state._scrollY}px`;
  document.body.classList.add('modal-open');
  const overlay = document.getElementById('reply-modal-overlay');
  overlay.classList.add('active');
  resetReplyModal();
  setTimeout(() => document.getElementById('reply-input-textarea')?.focus(), 120);
}

function closeReplyModal() {
  const overlay = document.getElementById('reply-modal-overlay');
  overlay.classList.remove('active');
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, state._scrollY || 0);
}

function resetReplyModal() {
  document.getElementById('reply-step1').style.display = '';
  document.getElementById('reply-step2').style.display = 'none';
  document.getElementById('reply-input-textarea').value = '';
  document.getElementById('reply-scene-select').value = 'auto';
  document.getElementById('reply-status').textContent = '';
  document.getElementById('reply-action-btn').style.display = '';
  document.getElementById('reply-action-label').textContent = '✦ 返信文を生成';
}

async function handleReplyGenerate() {
  const text = document.getElementById('reply-input-textarea').value.trim();
  if (!text) { showTrayToast('会話文を貼り付けてください'); return; }

  const btn = document.getElementById('reply-action-btn');
  const lbl = document.getElementById('reply-action-label');
  const statusEl = document.getElementById('reply-status');
  btn.disabled = true;
  lbl.textContent = '✦ 生成中…';
  statusEl.textContent = '';

  const scene = document.getElementById('reply-scene-select').value;

  let reply = null;
  const geminiKey = localStorage.getItem(_GEMINI_KEY_STORE);
  const claudeKey = localStorage.getItem(_CLAUDE_KEY_STORE);

  if (geminiKey) {
    reply = await _callGeminiForReply(text, scene, geminiKey);
  } else if (claudeKey) {
    reply = await _callClaudeForReply(text, scene, claudeKey);
  }

  if (!reply) {
    reply = _generateRuleBasedReply(text, scene);
    statusEl.textContent = '✦ テンプレートで生成しました（Gemini APIキー登録で精度UP）';
    statusEl.style.color = 'var(--text-muted)';
  } else {
    statusEl.textContent = '';
  }

  btn.disabled = false;
  lbl.textContent = '✦ 返信文を生成';

  // Step2へ
  const detectedScene = _detectReplyScene(text, scene);
  const sceneLabels = { accept: '✅ 依頼受諾・納期確認', revision: '🔄 修正対応・差し戻し', delivery: '📦 納品報告・完了連絡', auto: '' };
  document.getElementById('reply-scene-label').textContent = sceneLabels[detectedScene] || '';
  document.getElementById('reply-output-textarea').value = reply;
  document.getElementById('reply-step1').style.display = 'none';
  document.getElementById('reply-step2').style.display = '';
  document.getElementById('reply-action-btn').style.display = 'none';
}

function _detectReplyScene(text, selectedScene) {
  if (selectedScene !== 'auto') return selectedScene;
  if (/修正|差し戻し|変更|直し|やり直し|フィードバック/i.test(text)) return 'revision';
  if (/納品|完成|送り?ます|アップ|提出|完了|仕上がり/i.test(text)) return 'delivery';
  return 'accept';
}

async function _callGeminiForReply(text, scene, key) {
  const sceneGuide = scene === 'accept'   ? '依頼受諾・納期確認の返信' :
                     scene === 'revision' ? '修正対応・差し戻しへの返信' :
                     scene === 'delivery' ? '納品報告・完了連絡の返信' :
                                           '状況に応じた最適な返信';
  const prompt = `あなたはフリーランサーのアシスタントです。\n以下の会話に対して「${sceneGuide}」として適切な返信文を日本語で生成してください。\n\n条件:\n- 相手のトーン（ビジネス丁寧体 or カジュアル）に合わせる\n- 簡潔で誠実な文体\n- 署名・宛名は不要\n- 返信文のみを出力（前置きや説明は不要）\n\n会話内容:\n${text}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}

async function _callClaudeForReply(text, scene, key) {
  const sceneGuide = scene === 'accept'   ? '依頼受諾・納期確認の返信' :
                     scene === 'revision' ? '修正対応・差し戻しへの返信' :
                     scene === 'delivery' ? '納品報告・完了連絡の返信' :
                                           '状況に応じた最適な返信';
  const prompt = `あなたはフリーランサーのアシスタントです。以下の会話に対して「${sceneGuide}」として適切な返信文を生成してください。署名・宛名不要。返信文のみ出力。\n\n会話:\n${text}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() || null;
  } catch { return null; }
}

function _generateRuleBasedReply(text, scene) {
  const detected = _detectReplyScene(text, scene);
  // 納期を抽出（あれば）
  const dateMatch = text.match(/(\d{1,2})[\/月](\d{1,2})日?|来週|今月末|月末/);
  const dateHint = dateMatch ? `（${dateMatch[0]}）` : '';
  const biz = /お世話|よろしく|ご連絡|拝啓|誠に|ご確認|ご依頼/.test(text);
  const salutation = biz ? 'お世話になっております。' : '';

  if (detected === 'revision') {
    return biz
      ? `${salutation}ご指摘ありがとうございます。\n修正内容を確認いたしました。対応いたしますので、少々お時間をいただけますでしょうか。\n修正が完了次第、ご連絡いたします。\nどうぞよろしくお願いいたします。`
      : `ご連絡ありがとうございます！\n修正内容、確認しました。対応しますのでしばらくお待ちください。\n完了したらまたご連絡します。よろしくお願いします。`;
  }
  if (detected === 'delivery') {
    return biz
      ? `${salutation}お世話になっております。\n先ほど、作業が完了いたしましたのでご報告申し上げます。\nご確認のほど、よろしくお願いいたします。\n何かございましたらお気軽にお申し付けください。`
      : `お疲れ様です！\n作業が完了しましたのでご確認ください。\nご不明な点があればお気軽にどうぞ。`;
  }
  // accept (default)
  return biz
    ? `${salutation}ご依頼ありがとうございます。\n内容を確認いたしました。承りましたので、進めてまいります${dateHint}。\nどうぞよろしくお願いいたします。`
    : `ありがとうございます！\n了解しました、進めます${dateHint}。\nよろしくお願いします！`;
}

async function copyReplyText() {
  const text = document.getElementById('reply-output-textarea').value;
  try {
    await navigator.clipboard.writeText(text);
    showTrayToast('📋 返信文をコピーしました');
  } catch {
    document.getElementById('reply-output-textarea').select();
    document.execCommand('copy');
    showTrayToast('📋 返信文をコピーしました');
  }
}


