const SETTINGS_KEY = 'postcards_strict_settings_v8';
const PDF_VIEWPORT_WIDTH = 1968;
const PDF_VIEWPORT_HEIGHT = 1392;
const KEEP_ALIVE_AUDIO_SRC = `/assets/audio/pc1/${encodeURIComponent('cliks1st type 1.wav')}`;
const KEEP_ALIVE_AUDIO_VOLUME = 0.01;
const KEEP_ALIVE_INTERVAL_MS = 2 * 60 * 1000;
const CARD_POSITIONS = [
  { left: 334,  top: 210 },
  { left: 1042, top: 210 },
  { left: 1750, top: 210 },
  { left: 2458, top: 210 },
  { left: 334,  top: 798 },
  { left: 1042, top: 798 },
  { left: 1750, top: 798 },
  { left: 2458, top: 798 },
];
const ROLES = ['pc1', 'pc2', 'pc3', 'pc4'];

const defaultSettings = {
  role: 'pc1',
  wantsServer: false,
  serverHost: '',
  audioEnabled: true,
  midiInputId: '',
  midiOutputId: '',
  midiChannel: 2,
  launchNote: 60,
  openNotesByRole: { pc1: 61, pc2: 62, pc3: 63, pc4: 64 },
  closeNotesByRole: { pc1: 65, pc2: 66, pc3: 67, pc4: 68 },
  minimizeAllNote: 69,
  outputNote: 72,
  velocity: 100,
  duration: 180,
  pdfsByRole: { pc1: 'pc1.pdf', pc2: 'pc2.pdf', pc3: 'pc3.pdf', pc4: 'pc4.pdf' },
};

const store = {
  settings: loadSettings(),
  appStartedAt: Date.now(),
  socket: null,
  connected: false,
  clientId: null,
  agentInfo: null,
  discoveredCoordinator: null,
  discoveryTimer: null,
  discoveryInFlight: false,
  sceneState: null,
  popupTokenActive: null,
  popupTokenOpened: null,
  popupFileOpened: '',
  popupEventBaselineAt: 0,
  lastPdfWindowSyncKey: '',
  currentAudio: null,
  keepAliveAudio: null,
  keepAliveTimer: null,
  keepAliveArmed: false,
  midiAccess: null,
  midiInput: null,
  midiOutput: null,
  lastMidiOutAt: 0,
  lastMinimizeAllEventAt: 0,
  availablePdfFiles: [],
};

const scene = document.getElementById('scene');
const menu = document.getElementById('menu');
const roleSelect = document.getElementById('roleSelect');
const serverToggle = document.getElementById('serverToggle');
const audioEnabledCheckbox = document.getElementById('audioEnabledCheckbox');
const serverHostInput = document.getElementById('serverHostInput');
const fullscreenButton = document.getElementById('fullscreenButton');
const resetClicksButton = document.getElementById('resetClicksButton');
const resetScenarioButton = document.getElementById('resetScenarioButton');
const forceOpenAllButton = document.getElementById('forceOpenAllButton');
const minimizeAllWindowsButton = document.getElementById('minimizeAllWindowsButton');
const saveSettingsButton = document.getElementById('saveSettingsButton');
const resetSettingsButton = document.getElementById('resetSettingsButton');
const midiInputSelect = document.getElementById('midiInputSelect');
const midiOutputSelect = document.getElementById('midiOutputSelect');
const midiChannelSelect = document.getElementById('midiChannelSelect');
const midiLaunchInput = document.getElementById('midiLaunchInput');
const midiOpenPc1Input = document.getElementById('midiOpenPc1Input');
const midiOpenPc2Input = document.getElementById('midiOpenPc2Input');
const midiOpenPc3Input = document.getElementById('midiOpenPc3Input');
const midiOpenPc4Input = document.getElementById('midiOpenPc4Input');
const midiClosePc1Input = document.getElementById('midiClosePc1Input');
const midiClosePc2Input = document.getElementById('midiClosePc2Input');
const midiClosePc3Input = document.getElementById('midiClosePc3Input');
const midiClosePc4Input = document.getElementById('midiClosePc4Input');
const midiMinimizeAllInput = document.getElementById('midiMinimizeAllInput');
const midiOutputNoteInput = document.getElementById('midiOutputNoteInput');
const midiVelocityInput = document.getElementById('midiVelocityInput');
const midiDurationInput = document.getElementById('midiDurationInput');
const saveMidiButton = document.getElementById('saveMidiButton');
const testMidiButton = document.getElementById('testMidiButton');
const pdfPc1Select = document.getElementById('pdfPc1Select');
const pdfPc2Select = document.getElementById('pdfPc2Select');
const pdfPc3Select = document.getElementById('pdfPc3Select');
const pdfPc4Select = document.getElementById('pdfPc4Select');
const savePdfButton = document.getElementById('savePdfButton');
const clearPdfCacheButton = document.getElementById('clearPdfCacheButton');
const midiLaunchLabel = document.getElementById('midiLaunchLabel');
const midiOpenPc1Label = document.getElementById('midiOpenPc1Label');
const midiOpenPc2Label = document.getElementById('midiOpenPc2Label');
const midiOpenPc3Label = document.getElementById('midiOpenPc3Label');
const midiOpenPc4Label = document.getElementById('midiOpenPc4Label');
const midiClosePc1Label = document.getElementById('midiClosePc1Label');
const midiClosePc2Label = document.getElementById('midiClosePc2Label');
const midiClosePc3Label = document.getElementById('midiClosePc3Label');
const midiClosePc4Label = document.getElementById('midiClosePc4Label');
const midiMinimizeAllLabel = document.getElementById('midiMinimizeAllLabel');
const midiOutputNoteLabel = document.getElementById('midiOutputNoteLabel');
const connectionStatus = document.getElementById('connectionStatus');
const networkStatus = document.getElementById('networkStatus');
const clickStatus = document.getElementById('clickStatus');
const scenarioStatus = document.getElementById('scenarioStatus');
const midiStatus = document.getElementById('midiStatus');
const ipStatus = document.getElementById('ipStatus');
const devicesStatus = document.getElementById('devicesStatus');
let clearPdfCacheResetTimer = null;

function collectPopupTexts() {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('popup_text_')) continue;
    out[key] = localStorage.getItem(key) || '';
  }
  return out;
}

function restorePopupTexts(popupTexts = {}) {
  Object.entries(popupTexts || {}).forEach(([key, value]) => {
    if (!String(key).startsWith('popup_text_')) return;
    localStorage.setItem(key, String(value || ''));
  });
}

function captureFormSettings() {
  store.settings.role = roleSelect.value;
  store.settings.wantsServer = serverToggle.checked;
  store.settings.serverHost = serverHostInput.value.trim();
  store.settings.audioEnabled = audioEnabledCheckbox.checked;
  store.settings.midiChannel = Math.max(1, Math.min(16, Number(midiChannelSelect.value) || 1));
  store.settings.launchNote = Math.max(0, Math.min(127, Number(midiLaunchInput.value) || 0));
  store.settings.openNotesByRole = {
    pc1: Math.max(0, Math.min(127, Number(midiOpenPc1Input.value) || 0)),
    pc2: Math.max(0, Math.min(127, Number(midiOpenPc2Input.value) || 0)),
    pc3: Math.max(0, Math.min(127, Number(midiOpenPc3Input.value) || 0)),
    pc4: Math.max(0, Math.min(127, Number(midiOpenPc4Input.value) || 0)),
  };
  store.settings.closeNotesByRole = {
    pc1: Math.max(0, Math.min(127, Number(midiClosePc1Input.value) || 0)),
    pc2: Math.max(0, Math.min(127, Number(midiClosePc2Input.value) || 0)),
    pc3: Math.max(0, Math.min(127, Number(midiClosePc3Input.value) || 0)),
    pc4: Math.max(0, Math.min(127, Number(midiClosePc4Input.value) || 0)),
  };
  store.settings.minimizeAllNote = Math.max(0, Math.min(127, Number(midiMinimizeAllInput.value) || 0));
  store.settings.outputNote = Math.max(0, Math.min(127, Number(midiOutputNoteInput.value) || 0));
  store.settings.velocity = Math.max(0, Math.min(127, Number(midiVelocityInput.value) || 0));
  store.settings.duration = Math.max(1, Number(midiDurationInput.value) || 1);
  store.settings.pdfsByRole = {
    pc1: pdfPc1Select.value || '',
    pc2: pdfPc2Select.value || '',
    pc3: pdfPc3Select.value || '',
    pc4: pdfPc4Select.value || '',
  };
}

async function loadLocalSettingsFromDisk() {
  try {
    const res = await fetch('/api/local-settings', { cache: 'no-store' });
    const json = await res.json();
    if (!json?.ok) return;
    const loaded = json.settings || {};
    store.settings = {
      ...store.settings,
      ...loaded,
      openNotesByRole: { ...store.settings.openNotesByRole, ...(loaded.openNotesByRole || {}) },
      closeNotesByRole: { ...store.settings.closeNotesByRole, ...(loaded.closeNotesByRole || {}) },
      pdfsByRole: { ...store.settings.pdfsByRole, ...(loaded.pdfsByRole || {}) },
    };
    restorePopupTexts(json.popupTexts || {});
    saveSettings();
  } catch (_err) {}
}

async function saveAllSettingsToDisk() {
  captureFormSettings();
  saveSettings();
  if (store.settings.wantsServer) {
    pushMidiConfig();
    pushPdfConfig();
  }
  try {
    const res = await fetch('/api/local-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: store.settings,
        popupTexts: collectPopupTexts(),
      }),
    });
    const json = await res.json();
    if (json?.ok) {
      updateStatus();
    }
  } catch (_err) {}
}

async function resetSavedSettingsOnDisk() {
  try {
    await fetch('/api/local-settings', {
      method: 'DELETE',
    });
  } catch (_err) {}
}

async function loadAgentInfo() {
  try {
    const res = await fetch('/api/agent', { cache: 'no-store' });
    const json = await res.json();
    if (json?.ok) {
      store.agentInfo = json;
    }
  } catch (_err) {
    store.agentInfo = null;
  }
}

async function discoverCoordinator() {
  if (store.discoveryInFlight || store.settings.wantsServer || String(store.settings.serverHost || '').trim()) return store.discoveredCoordinator;
  store.discoveryInFlight = true;
  try {
    const res = await fetch('/api/discover', { cache: 'no-store' });
    const json = await res.json();
    const coordinator = json?.ok ? (json.coordinator || null) : null;
    store.discoveredCoordinator = coordinator;
    return coordinator;
  } catch (_err) {
    return store.discoveredCoordinator;
  } finally {
    store.discoveryInFlight = false;
  }
}

function stopDiscoveryLoop() {
  if (store.discoveryTimer) {
    clearInterval(store.discoveryTimer);
    store.discoveryTimer = null;
  }
}

function shouldUseDiscovery() {
  return !store.settings.wantsServer && !String(store.settings.serverHost || '').trim();
}

function manageDiscoveryLoop() {
  stopDiscoveryLoop();
  if (!shouldUseDiscovery()) return;
  store.discoveryTimer = setInterval(async () => {
    const before = store.discoveredCoordinator?.ip || '';
    const coordinator = await discoverCoordinator();
    const after = coordinator?.ip || '';
    if (after && after !== before) {
      reconnectSocket();
      return;
    }
    updateStatus();
  }, 2000);
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      ...defaultSettings,
      ...parsed,
      openNotesByRole: { ...defaultSettings.openNotesByRole, ...(parsed.openNotesByRole || {}) },
      closeNotesByRole: { ...defaultSettings.closeNotesByRole, ...(parsed.closeNotesByRole || {}) },
      pdfsByRole: { ...defaultSettings.pdfsByRole, ...(parsed.pdfsByRole || {}) },
    };
  } catch (_err) {
    return { ...defaultSettings, openNotesByRole: { ...defaultSettings.openNotesByRole }, closeNotesByRole: { ...defaultSettings.closeNotesByRole }, pdfsByRole: { ...defaultSettings.pdfsByRole } };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(store.settings));
}

function midiNumberToName(num) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = Math.max(0, Math.min(127, Number(num) || 0));
  return `${names[n % 12]}${Math.floor(n / 12) - 1}`;
}

function buildMidiChannelSelect() {
  midiChannelSelect.innerHTML = '';
  for (let i = 1; i <= 16; i += 1) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Канал ${i}`;
    midiChannelSelect.appendChild(option);
  }
}

function updateMidiLabels() {
  midiLaunchLabel.textContent = midiNumberToName(midiLaunchInput.value);
  midiOpenPc1Label.textContent = midiNumberToName(midiOpenPc1Input.value);
  midiOpenPc2Label.textContent = midiNumberToName(midiOpenPc2Input.value);
  midiOpenPc3Label.textContent = midiNumberToName(midiOpenPc3Input.value);
  midiOpenPc4Label.textContent = midiNumberToName(midiOpenPc4Input.value);
  midiClosePc1Label.textContent = midiNumberToName(midiClosePc1Input.value);
  midiClosePc2Label.textContent = midiNumberToName(midiClosePc2Input.value);
  midiClosePc3Label.textContent = midiNumberToName(midiClosePc3Input.value);
  midiClosePc4Label.textContent = midiNumberToName(midiClosePc4Input.value);
  midiMinimizeAllLabel.textContent = midiNumberToName(midiMinimizeAllInput.value);
  midiOutputNoteLabel.textContent = midiNumberToName(midiOutputNoteInput.value);
}

function syncForm() {
  roleSelect.value = store.settings.role;
  serverToggle.checked = store.settings.wantsServer;
  serverHostInput.value = store.settings.serverHost || '';
  audioEnabledCheckbox.checked = store.settings.audioEnabled;
  midiChannelSelect.value = String(store.settings.midiChannel);
  midiLaunchInput.value = store.settings.launchNote;
  midiOpenPc1Input.value = store.settings.openNotesByRole.pc1;
  midiOpenPc2Input.value = store.settings.openNotesByRole.pc2;
  midiOpenPc3Input.value = store.settings.openNotesByRole.pc3;
  midiOpenPc4Input.value = store.settings.openNotesByRole.pc4;
  midiClosePc1Input.value = store.settings.closeNotesByRole.pc1;
  midiClosePc2Input.value = store.settings.closeNotesByRole.pc2;
  midiClosePc3Input.value = store.settings.closeNotesByRole.pc3;
  midiClosePc4Input.value = store.settings.closeNotesByRole.pc4;
  midiMinimizeAllInput.value = store.settings.minimizeAllNote;
  midiOutputNoteInput.value = store.settings.outputNote;
  midiVelocityInput.value = store.settings.velocity;
  midiDurationInput.value = store.settings.duration;
  updateMidiLabels();
  syncPdfSelectors();
}

function syncMidiSettingsFromPublicState() {
  const midi = store.sceneState?.midi;
  if (!midi) return;
  store.settings.midiChannel = Number(midi.midiChannel || store.settings.midiChannel);
  store.settings.launchNote = Number(midi.launchNote || store.settings.launchNote);
  store.settings.minimizeAllNote = Number(midi.minimizeAllNote ?? store.settings.minimizeAllNote);
  store.settings.outputNote = Number(midi.outputNote || store.settings.outputNote);
  store.settings.velocity = Number(midi.velocity || store.settings.velocity);
  store.settings.duration = Number(midi.duration || store.settings.duration);
  store.settings.openNotesByRole = {
    pc1: Number(midi.openNotesByRole?.pc1 ?? store.settings.openNotesByRole.pc1),
    pc2: Number(midi.openNotesByRole?.pc2 ?? store.settings.openNotesByRole.pc2),
    pc3: Number(midi.openNotesByRole?.pc3 ?? store.settings.openNotesByRole.pc3),
    pc4: Number(midi.openNotesByRole?.pc4 ?? store.settings.openNotesByRole.pc4),
  };
  store.settings.closeNotesByRole = {
    pc1: Number(midi.closeNotesByRole?.pc1 ?? store.settings.closeNotesByRole.pc1),
    pc2: Number(midi.closeNotesByRole?.pc2 ?? store.settings.closeNotesByRole.pc2),
    pc3: Number(midi.closeNotesByRole?.pc3 ?? store.settings.closeNotesByRole.pc3),
    pc4: Number(midi.closeNotesByRole?.pc4 ?? store.settings.closeNotesByRole.pc4),
  };
  syncForm();
}

function syncPdfSettingsFromPublicState() {
  const pdfsByRole = store.sceneState?.pdfsByRole;
  if (!pdfsByRole) return;
  store.settings.pdfsByRole = {
    pc1: String(pdfsByRole.pc1 || store.settings.pdfsByRole.pc1 || ''),
    pc2: String(pdfsByRole.pc2 || store.settings.pdfsByRole.pc2 || ''),
    pc3: String(pdfsByRole.pc3 || store.settings.pdfsByRole.pc3 || ''),
    pc4: String(pdfsByRole.pc4 || store.settings.pdfsByRole.pc4 || ''),
  };
  saveSettings();
  syncPdfSelectors();
}

function syncPdfSelectors() {
  const selects = [pdfPc1Select, pdfPc2Select, pdfPc3Select, pdfPc4Select];
  const map = { pc1: pdfPc1Select, pc2: pdfPc2Select, pc3: pdfPc3Select, pc4: pdfPc4Select };
  for (const select of selects) {
    const previous = select.value;
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = store.availablePdfFiles.length ? 'Не выбран' : 'PDF не найдены';
    select.appendChild(opt);
    for (const file of store.availablePdfFiles) {
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      select.appendChild(option);
    }
  }
  map.pc1.value = store.settings.pdfsByRole.pc1 || '';
  map.pc2.value = store.settings.pdfsByRole.pc2 || '';
  map.pc3.value = store.settings.pdfsByRole.pc3 || '';
  map.pc4.value = store.settings.pdfsByRole.pc4 || '';
}

async function loadPdfFiles() {
  try {
    const res = await fetch('/api/pdfs', { cache: 'no-store' });
    const json = await res.json();
    store.availablePdfFiles = Array.isArray(json.files) ? json.files : [];
  } catch (_err) {
    store.availablePdfFiles = [];
  }
  syncPdfSelectors();
}


function buildScene() {
  scene.innerHTML = '';
  for (let i = 0; i < 8; i += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.style.left = `${CARD_POSITIONS[i].left}px`;
    button.style.top = `${CARD_POSITIONS[i].top}px`;
    button.innerHTML = '<img alt="Открытка">';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendAction('card_click', { role: store.settings.role, cardIndex: i });
    });
    scene.appendChild(button);
  }
  renderCards();
}

function renderCards() {
  const flips = store.sceneState?.flippedCardsByRole?.[store.settings.role] || {};
  document.querySelectorAll('.card').forEach((button, idx) => {
    const img = button.querySelector('img');
    img.src = flips[idx] ? `/assets/images/back/${idx + 1}.png` : `/assets/images/front/${idx + 1}.png`;
  });
}

function soundFilePath(role, clickNumber) {
  const number = Math.max(1, Math.min(16, clickNumber));
  return `/assets/audio/${role}/${encodeURIComponent({
    pc1: `cliks1st type ${number}.wav`,
    pc2: `cliks2 type ${number}.wav`,
    pc3: `cliks3 type ${number}.wav`,
    pc4: `cliks4 type ${number}.wav`,
  }[role])}`;
}

function playRoleSound(clickNumber) {
  if (!store.settings.audioEnabled) return;
  if (store.currentAudio) {
    store.currentAudio.pause();
    store.currentAudio.currentTime = 0;
  }
  const audio = new Audio(soundFilePath(store.settings.role, clickNumber));
  store.currentAudio = audio;
  audio.play().catch(() => {});
}

function ensureKeepAliveAudio() {
  if (store.keepAliveAudio) return store.keepAliveAudio;
  const audio = new Audio(KEEP_ALIVE_AUDIO_SRC);
  audio.preload = 'auto';
  audio.volume = KEEP_ALIVE_AUDIO_VOLUME;
  store.keepAliveAudio = audio;
  try { audio.load(); } catch (_err) {}
  return audio;
}

function unlockKeepAliveAudio() {
  if (store.keepAliveArmed) return;
  const audio = ensureKeepAliveAudio();
  audio.muted = true;
  const finalize = () => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_err) {}
    audio.muted = false;
    audio.volume = KEEP_ALIVE_AUDIO_VOLUME;
  };
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.then(() => {
      store.keepAliveArmed = true;
      finalize();
    }).catch(() => {
      finalize();
    });
    return;
  }
  store.keepAliveArmed = true;
  finalize();
}

function playKeepAliveAudio() {
  const audio = ensureKeepAliveAudio();
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (_err) {}
  audio.muted = false;
  audio.volume = KEEP_ALIVE_AUDIO_VOLUME;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.then(() => {
      store.keepAliveArmed = true;
    }).catch(() => {});
  } else {
    store.keepAliveArmed = true;
  }
}

function bindKeepAliveUnlock() {
  const tryUnlock = () => {
    unlockKeepAliveAudio();
  };
  window.addEventListener('pointerdown', tryUnlock, { passive: true });
  window.addEventListener('keydown', tryUnlock);
}

function startKeepAliveLoop() {
  if (store.keepAliveTimer) clearInterval(store.keepAliveTimer);
  ensureKeepAliveAudio();
  store.keepAliveTimer = setInterval(() => {
    playKeepAliveAudio();
  }, KEEP_ALIVE_INTERVAL_MS);
}

function stopKeepAliveLoop() {
  if (store.keepAliveTimer) {
    clearInterval(store.keepAliveTimer);
    store.keepAliveTimer = null;
  }
  if (store.keepAliveAudio) {
    try {
      store.keepAliveAudio.pause();
      store.keepAliveAudio.currentTime = 0;
    } catch (_err) {}
  }
}

function sendAction(type, payload = {}) {
  if (!store.socket || store.socket.readyState !== WebSocket.OPEN) return;
  store.socket.send(JSON.stringify({ type: 'action', payload: { type, payload } }));
}

function getSocketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const manualHost = String(store.settings.serverHost || '').trim();
  if (store.settings.wantsServer) return `${protocol}://${location.host}/ws`;
  const discoveredHost = store.discoveredCoordinator?.ip ? String(store.discoveredCoordinator.ip).trim() : '';
  const host = manualHost || discoveredHost;
  if (!host) return `${protocol}://${location.host}/ws`;
  const hasPort = host.includes(':');
  return `${protocol}://${hasPort ? host : `${host}:8787`}/ws`;
}

async function resolveSocketUrl() {
  if (shouldUseDiscovery()) {
    await discoverCoordinator();
  }
  return getSocketUrl();
}

function reconnectSocket() {
  if (store.socket) {
    store.socket.onclose = null;
    try { store.socket.close(); } catch (_err) {}
  }
  store.connected = false;
  updateStatus();
  connect();
}

async function connect() {
  const socketUrl = await resolveSocketUrl();
  const ws = new WebSocket(socketUrl);
  store.socket = ws;
  ws.addEventListener('open', () => {
    store.connected = true;
    sendAction('register', {
      role: store.settings.role,
      wantsServer: store.settings.wantsServer,
      serverHost: store.settings.serverHost || '',
      hostName: store.agentInfo?.hostName || '',
      localIps: Array.isArray(store.agentInfo?.localIps) ? store.agentInfo.localIps : [],
    });
    if (store.settings.wantsServer) sendAction('request_become_server', { role: store.settings.role });
    if (store.settings.wantsServer) { pushMidiConfig(); pushPdfConfig(); }
    updateStatus();
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'welcome') {
      store.clientId = msg.payload.clientId;
      applyPublicState(msg.payload.state, 'welcome');
      return;
    }
    if (msg.type === 'state') applyPublicState(msg.payload.state, msg.payload.reason);
  });
  ws.addEventListener('close', () => {
    store.connected = false;
    updateStatus();
    setTimeout(() => { if (store.socket === ws) connect(); }, 1000);
  });
}

function applyPublicState(publicState, reason) {
  const prevClicks = store.sceneState?.clicksByRole?.[store.settings.role] || 0;
  const prevEventAt = store.sceneState?.lastEvent?.at || 0;
  const prevPopupEpoch = store.sceneState?.scenario?.popupEpoch || 0;
  store.sceneState = publicState;
  syncMidiSettingsFromPublicState();
  if (Array.isArray(publicState?.availablePdfFiles)) { store.availablePdfFiles = publicState.availablePdfFiles; }
  syncPdfSettingsFromPublicState();
  renderCards();
  updateStatus();
  updateControlLocks();
  if ((publicState?.scenario?.popupEpoch || 0) !== prevPopupEpoch && !publicState?.scenario?.active) {
    store.popupTokenOpened = null;
    store.popupTokenActive = null;
    store.popupFileOpened = '';
  }
  if (reason === 'welcome') {
    store.popupEventBaselineAt = Math.max(Number(publicState?.lastEvent?.at || 0), store.appStartedAt);
    closePdfWindowLocally({
      role: store.settings.role,
      pdfFile: store.sceneState?.pdfsByRole?.[store.settings.role] || store.settings.pdfsByRole?.[store.settings.role] || '',
      token: '',
    });
  } else if (shouldSyncPopupWithEvent(publicState?.lastEvent) || (reason === 'pdf_config_updated' && currentPopupPayload()?.visible)) {
    ensurePopupWindow();
  }
  const nextClicks = publicState?.clicksByRole?.[store.settings.role] || 0;
  if (reason === 'card_click' && nextClicks > prevClicks) playRoleSound(nextClicks);
  if ((publicState?.lastEvent?.at || 0) > prevEventAt) maybeSendMidiOut(publicState.lastEvent);
  if (reason === 'windows_minimized' && publicState?.lastEvent?.type === 'windows_minimized') {
    minimizeAllWindowsLocally('state_broadcast', publicState.lastEvent.at);
  }
}

function sendMidiNow(note, velocity, duration) {
  if (!store.midiOutput) {
    midiStatus.textContent = 'MIDI: выход не выбран';
    return;
  }
  const channel = Math.max(1, Math.min(16, Number(store.settings.midiChannel) || 1)) - 1;
  try {
    store.midiOutput.send([0x90 + channel, note, velocity]);
    setTimeout(() => {
      try { store.midiOutput && store.midiOutput.send([0x80 + channel, note, 0]); } catch (_err) {}
    }, duration);
    midiStatus.textContent = `MIDI: отправлена ${midiNumberToName(note)} · канал ${channel + 1}`;
  } catch (_err) {
    midiStatus.textContent = 'MIDI: ошибка отправки';
  }
}

function maybeSendMidiOut(lastEvent) {
  if (!store.midiOutput || !store.settings.wantsServer || !lastEvent) return;
  if (lastEvent.at <= store.lastMidiOutAt) return;

  const triggerType = lastEvent?.details?.trigger?.type;
  const shouldSend = lastEvent.type === 'scenario_started' && triggerType === 'click_threshold';

  if (!shouldSend) return;

  store.lastMidiOutAt = lastEvent.at;
  sendMidiNow(
    Number(store.settings.outputNote),
    Number(store.settings.velocity),
    Number(store.settings.duration)
  );
}

async function minimizeAllWindowsLocally(source = 'manual', eventAt = 0) {
  if (eventAt && eventAt <= store.lastMinimizeAllEventAt) return;
  if (eventAt) store.lastMinimizeAllEventAt = eventAt;
  try {
    await fetch('/api/windows/minimize-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: store.settings.role,
        source,
        eventAt,
      }),
    });
  } catch (_err) {}
}

async function openPdfWindowLocally(payload) {
  const nextPayload = payload || {};
  try {
    await fetch('/api/pdf-window/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: nextPayload.role || store.settings.role,
        pdfFile: nextPayload.pdfFile || store.settings.pdfsByRole?.[nextPayload.role || store.settings.role] || '',
        visible: Boolean(nextPayload.visible),
        screen: {
          width: PDF_VIEWPORT_WIDTH,
          height: PDF_VIEWPORT_HEIGHT,
          availWidth: window.screen?.availWidth || screen.width,
          availHeight: window.screen?.availHeight || screen.height,
        },
      }),
    });
  } catch (_err) {}
}

async function closePdfWindowLocally(payload = {}) {
  try {
    await fetch('/api/pdf-window/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: payload.role || store.settings.role,
        pdfFile: payload.pdfFile || store.settings.pdfsByRole?.[payload.role || store.settings.role] || '',
        token: payload.token || '',
        screen: {
          width: PDF_VIEWPORT_WIDTH,
          height: PDF_VIEWPORT_HEIGHT,
          availWidth: window.screen?.availWidth || screen.width,
          availHeight: window.screen?.availHeight || screen.height,
        },
      }),
    });
  } catch (_err) {}
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function setClearPdfCacheButtonState(label, disabled = false, restoreDelay = 0) {
  clearPdfCacheButton.textContent = label;
  clearPdfCacheButton.disabled = disabled;
  if (clearPdfCacheResetTimer) {
    clearTimeout(clearPdfCacheResetTimer);
    clearPdfCacheResetTimer = null;
  }
  if (restoreDelay > 0) {
    clearPdfCacheResetTimer = setTimeout(() => {
      clearPdfCacheButton.textContent = 'Очистить кэш PDF-окна';
      clearPdfCacheButton.disabled = false;
      clearPdfCacheResetTimer = null;
    }, restoreDelay);
  }
}

function currentPopupPayload() {
  const scenario = store.sceneState?.scenario;
  if (!scenario) return null;
  const visible = Boolean(scenario.forceOpenAll || scenario.openRoles?.[store.settings.role]);
  const token = visible
    ? `${scenario.popupEpoch}:${scenario.phase}:${scenario.currentRole}:${scenario.forceOpenAll ? 'all' : 'single'}`
    : null;
  return {
    role: store.settings.role,
    page: scenario.popupPage || 0,
    popupEpoch: scenario.popupEpoch || 0,
    visible,
    token,
    pdfFile: store.sceneState?.pdfsByRole?.[store.settings.role] || store.settings.pdfsByRole?.[store.settings.role] || '',
    scenario,
  };
}

function shouldSyncPopupWithEvent(lastEvent) {
  if (!lastEvent || Number(lastEvent.at || 0) <= store.popupEventBaselineAt) return false;
  return [
    'scenario_started',
    'scenario_role_changed',
    'scenario_role_closed',
    'force_open_all_enabled',
    'force_open_all_disabled',
    'scenario_closed',
  ].includes(String(lastEvent.type || ''));
}

function ensurePopupWindow() {
  const payload = currentPopupPayload() || {
    role: store.settings.role,
    visible: false,
    token: '',
    pdfFile: store.settings.pdfsByRole?.[store.settings.role] || '',
  };
  store.popupTokenActive = payload.token || null;
  const nextKey = [
    payload.role || '',
    payload.pdfFile || '',
    payload.visible ? '1' : '0',
  ].join('|');
  if (store.lastPdfWindowSyncKey === nextKey) return;
  store.lastPdfWindowSyncKey = nextKey;
  if (payload.visible) {
    store.popupTokenOpened = payload.token || null;
    store.popupFileOpened = payload.pdfFile || '';
    openPdfWindowLocally(payload);
    return;
  }
  store.popupTokenOpened = null;
  store.popupFileOpened = '';
  closePdfWindowLocally(payload);
}

function renderConnectedDevices() {
  const isServerView = Boolean(store.settings.wantsServer);
  const devices = Array.isArray(store.sceneState?.network?.connectedDevices) ? store.sceneState.network.connectedDevices : [];
  if (!isServerView) {
    devicesStatus.innerHTML = '<div class="device-list__empty">Список доступен только на серверном ПК.</div>';
    return;
  }
  if (!devices.length) {
    devicesStatus.innerHTML = '<div class="device-list__empty">Подключенных устройств пока нет.</div>';
    return;
  }
  devicesStatus.innerHTML = devices.map((device) => {
    const host = device.hostName || 'Неизвестный ПК';
    const role = String(device.role || 'pc1').toUpperCase();
    const ip = device.ip || 'IP неизвестен';
    const serverMark = device.wantsServer ? ' · сервер' : '';
    return `<div class="device-list__item">${host} · ${role} · ${ip}${serverMark}</div>`;
  }).join('');
}

function updateStatus() {
  connectionStatus.textContent = `Подключение: ${store.connected ? 'online' : 'offline'} · ${getSocketUrl()}`;
  const network = store.sceneState?.network;
  const coordinator = network?.coordinator;
  networkStatus.textContent = coordinator
    ? `Координатор: ${coordinator.label} (${coordinator.ip})${store.settings.wantsServer ? ' · этот ПК' : ''}`
    : 'Координатор: не выбран';
  clickStatus.textContent = `Клики ${store.settings.role.toUpperCase()}: ${store.sceneState?.clicksByRole?.[store.settings.role] || 0} / ${store.sceneState?.clickThreshold || 17}`;
  const scenario = store.sceneState?.scenario;
  scenarioStatus.textContent = scenario?.forceOpenAll
    ? 'Сценарий: окна открыты на всех ПК'
    : (scenario?.active ? `Сценарий: активен · окно ${String(scenario.currentRole || 'закрыто').toUpperCase()}` : 'Сценарий: ожидание');
  midiStatus.textContent = `MIDI: ${store.midiAccess ? 'доступ выдан' : 'не инициализирован'} · канал ${store.settings.midiChannel} · launch ${midiNumberToName(store.settings.launchNote)} · Откр: ПК1 ${midiNumberToName(store.settings.openNotesByRole.pc1)} · ПК2 ${midiNumberToName(store.settings.openNotesByRole.pc2)} · ПК3 ${midiNumberToName(store.settings.openNotesByRole.pc3)} · ПК4 ${midiNumberToName(store.settings.openNotesByRole.pc4)} · Закр: ПК1 ${midiNumberToName(store.settings.closeNotesByRole.pc1)} · ПК2 ${midiNumberToName(store.settings.closeNotesByRole.pc2)} · ПК3 ${midiNumberToName(store.settings.closeNotesByRole.pc3)} · ПК4 ${midiNumberToName(store.settings.closeNotesByRole.pc4)}`;
  const pdfMap = store.sceneState?.pdfsByRole || store.settings.pdfsByRole;
  ipStatus.textContent = `Локальный запуск: ${location.host} · сервер синхронизации: ${store.settings.wantsServer ? location.host : (store.settings.serverHost || 'не указан')} · PDF: ПК1 ${pdfMap.pc1 || '—'}, ПК2 ${pdfMap.pc2 || '—'}, ПК3 ${pdfMap.pc3 || '—'}, ПК4 ${pdfMap.pc4 || '—'}`;
  forceOpenAllButton.textContent = scenario?.forceOpenAll ? 'Закрыть окна на всех ПК' : 'Окна на всех ПК';
}

function updateControlLocks() {
  const isServer = Boolean(store.settings.wantsServer);
  [midiInputSelect, midiChannelSelect, midiLaunchInput, midiOpenPc1Input, midiOpenPc2Input, midiOpenPc3Input, midiOpenPc4Input, midiClosePc1Input, midiClosePc2Input, midiClosePc3Input, midiClosePc4Input, midiMinimizeAllInput, saveMidiButton, pdfPc1Select, pdfPc2Select, pdfPc3Select, pdfPc4Select, savePdfButton].forEach((el) => {
    el.disabled = !isServer;
  });
}

function pushMidiConfig() {
  sendAction('midi_config', {
    midiChannel: store.settings.midiChannel,
    launchNote: store.settings.launchNote,
    openNotesByRole: store.settings.openNotesByRole,
    closeNotesByRole: store.settings.closeNotesByRole,
    minimizeAllNote: store.settings.minimizeAllNote,
    outputNote: store.settings.outputNote,
    velocity: store.settings.velocity,
    duration: store.settings.duration,
  });
}

function populateMidiSelect(selectEl, items, selectedId) {
  selectEl.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = items.length ? 'Не выбран' : 'Порты не найдены';
  selectEl.appendChild(empty);
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    if (item.id === selectedId) option.selected = true;
    selectEl.appendChild(option);
  });
}

function scorePreferredMidiPort(port = {}) {
  const name = String(port.name || '').toLowerCase();
  let score = 0;
  if (name.includes('rtpmidi') || name.includes('applemidi')) score += 100;
  if (name.includes('session') || name.includes('network')) score += 80;
  if (name.includes('pc-10')) score += 60;
  if (/\[\d+\]/.test(name)) score += 20;
  return score;
}

function pickPreferredMidiPort(items, selectedId) {
  if (!Array.isArray(items) || !items.length) return '';
  if (selectedId && items.some((item) => item.id === selectedId)) return selectedId;
  const ranked = [...items]
    .map((item) => ({ ...item, score: scorePreferredMidiPort(item) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score <= 0) return '';
  return ranked[0].id;
}

async function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    store.midiAccess = await navigator.requestMIDIAccess();
    refreshMidiPorts();
    store.midiAccess.onstatechange = refreshMidiPorts;
  } catch (_err) {}
  updateStatus();
}

function pushPdfConfig() {
  sendAction('pdf_config', { pdfsByRole: store.settings.pdfsByRole });
}

function refreshMidiPorts() {
  if (!store.midiAccess) return;
  const inputs = [...store.midiAccess.inputs.values()].map((port) => ({ id: port.id, name: port.name }));
  const outputs = [...store.midiAccess.outputs.values()].map((port) => ({ id: port.id, name: port.name }));
  const preferredOutputId = pickPreferredMidiPort(outputs, store.settings.midiOutputId);
  if (preferredOutputId && preferredOutputId !== store.settings.midiOutputId) {
    store.settings.midiOutputId = preferredOutputId;
    saveSettings();
  }
  populateMidiSelect(midiInputSelect, inputs, store.settings.midiInputId);
  populateMidiSelect(midiOutputSelect, outputs, store.settings.midiOutputId);
  attachMidiInput();
  attachMidiOutput();
  updateStatus();
}

function attachMidiInput() {
  if (!store.midiAccess) return;
  if (store.midiInput) store.midiInput.onmidimessage = null;
  if (!store.settings.wantsServer) {
    store.midiInput = null;
    return;
  }
  store.midiInput = store.midiAccess.inputs.get(store.settings.midiInputId) || null;
  if (store.midiInput) {
    store.midiInput.onmidimessage = (event) => {
      const [status, note, velocity] = event.data;
      const command = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      if (command === 0x90 && velocity > 0) {
        sendAction('midi_event', { note, velocity, channel, source: 'browser_input' });
      }
    };
  }
}

function attachMidiOutput() {
  if (!store.midiAccess) return;
  store.midiOutput = store.midiAccess.outputs.get(store.settings.midiOutputId) || null;
}

roleSelect.addEventListener('change', () => {
  store.settings.role = roleSelect.value;
  saveSettings();
  renderCards();
  sendAction('register', {
    role: store.settings.role,
    wantsServer: store.settings.wantsServer,
    serverHost: store.settings.serverHost || '',
    hostName: store.agentInfo?.hostName || '',
    localIps: Array.isArray(store.agentInfo?.localIps) ? store.agentInfo.localIps : [],
  });
  updateStatus();
  ensurePopupWindow();
});

serverToggle.addEventListener('change', () => {
  store.settings.wantsServer = serverToggle.checked;
  saveSettings();
  attachMidiInput();
  manageDiscoveryLoop();
  reconnectSocket();
});

serverHostInput.addEventListener('change', () => {
  store.settings.serverHost = serverHostInput.value.trim();
  saveSettings();
  manageDiscoveryLoop();
  if (!store.settings.wantsServer) reconnectSocket();
});

audioEnabledCheckbox.addEventListener('change', () => {
  store.settings.audioEnabled = audioEnabledCheckbox.checked;
  saveSettings();
});

fullscreenButton.addEventListener('click', async () => {
  if (!document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen(); } catch (_err) {}
  } else {
    try { await document.exitFullscreen(); } catch (_err) {}
  }
});

resetClicksButton.addEventListener('click', () => sendAction('reset_clicks', { role: store.settings.role }));
resetScenarioButton.addEventListener('click', () => sendAction('hard_reset', { role: store.settings.role }));
forceOpenAllButton.addEventListener('click', () => sendAction('toggle_force_open_all', { role: store.settings.role }));
minimizeAllWindowsButton.addEventListener('click', () => sendAction('minimize_all_windows', { role: store.settings.role }));
saveSettingsButton.addEventListener('click', async () => {
  await saveAllSettingsToDisk();
});
resetSettingsButton.addEventListener('click', async () => {
  localStorage.removeItem(SETTINGS_KEY);
  Object.keys(collectPopupTexts()).forEach((key) => localStorage.removeItem(key));
  await resetSavedSettingsOnDisk();
  store.settings = loadSettings();
  syncForm();
  attachMidiInput();
  attachMidiOutput();
  reconnectSocket();
  updateStatus();
});

midiInputSelect.addEventListener('change', () => {
  store.settings.midiInputId = midiInputSelect.value;
  saveSettings();
  attachMidiInput();
});

midiOutputSelect.addEventListener('change', () => {
  store.settings.midiOutputId = midiOutputSelect.value;
  saveSettings();
  attachMidiOutput();
});

midiChannelSelect.addEventListener('change', () => {
  store.settings.midiChannel = Math.max(1, Math.min(16, Number(midiChannelSelect.value) || 1));
  saveSettings();
  attachMidiInput();
  updateStatus();
});

[midiLaunchInput, midiOpenPc1Input, midiOpenPc2Input, midiOpenPc3Input, midiOpenPc4Input, midiClosePc1Input, midiClosePc2Input, midiClosePc3Input, midiClosePc4Input, midiMinimizeAllInput, midiOutputNoteInput].forEach((input) => {
  input.addEventListener('input', updateMidiLabels);
});

saveMidiButton.addEventListener('click', () => {
  if (!store.settings.wantsServer) return;
  captureFormSettings();
  saveSettings();
  updateMidiLabels();
  pushMidiConfig();
  updateStatus();
});

savePdfButton.addEventListener('click', () => {
  captureFormSettings();
  saveSettings();
  pushPdfConfig();
  updateStatus();
  ensurePopupWindow();
});

clearPdfCacheButton.addEventListener('click', async () => {
  setClearPdfCacheButtonState('Очищаем кэш PDF-окна...', true);
  try {
    const res = await fetch('/api/pdf-window/cache/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (!res.ok || !json?.ok || json?.result?.ok === false) {
      throw new Error(json?.error || json?.result?.restoreError || 'Не удалось очистить кэш PDF-окна');
    }
    const before = formatBytes(json.result?.beforeBytes);
    const after = formatBytes(json.result?.afterBytes);
    setClearPdfCacheButtonState(`Кэш очищен: ${before} -> ${after}`, true, 4200);
    updateStatus();
    ensurePopupWindow();
  } catch (_err) {
    setClearPdfCacheButtonState('Ошибка очистки кэша PDF-окна', true, 4200);
  }
});

[pdfPc1Select, pdfPc2Select, pdfPc3Select, pdfPc4Select].forEach((select) => {
  select.addEventListener('change', () => {
    store.settings.pdfsByRole = {
      pc1: pdfPc1Select.value || '',
      pc2: pdfPc2Select.value || '',
      pc3: pdfPc3Select.value || '',
      pc4: pdfPc4Select.value || '',
    };
    saveSettings();
    updateStatus();
  });
});

testMidiButton.addEventListener('click', () => {
  const note = Math.max(0, Math.min(127, Number(midiOutputNoteInput.value) || 0));
  const velocity = Math.max(0, Math.min(127, Number(midiVelocityInput.value) || 0));
  const duration = Math.max(1, Number(midiDurationInput.value) || 1);
  store.settings.outputNote = note;
  store.settings.velocity = velocity;
  store.settings.duration = duration;
  saveSettings();
  attachMidiOutput();
  sendMidiNow(note, velocity, duration);
});

window.addEventListener('keydown', async (event) => {
  const key = event.key.toLowerCase();
  const isServer = Boolean(store.settings.wantsServer);
  const t = event.target;
  const inEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');

  // --- Сначала АНТИВАНДАЛ (работает на всех ПК) ---
  if (event.key === 'F5' || event.key === 'F11' || event.key === 'F12') {
    event.preventDefault();
    return;
  }
  if (event.ctrlKey && event.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
    event.preventDefault();
    return;
  }
  if (event.ctrlKey && !event.shiftKey && (key === 'u' || key === 'p' || key === 's')) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Backspace' && !inEditable) {
    event.preventDefault();
  }

  // --- Секретный вход в меню: Ctrl+Alt+Shift+M — для первой настройки клиента ---
  if (event.ctrlKey && event.altKey && event.shiftKey && (key === 'm' || key === 'ь')) {
  event.preventDefault();
  const isAdmin = new URLSearchParams(location.search).get('admin') === '1';
  if (isAdmin) {
    menu.classList.toggle('hidden');
  }
  return;
}

  // --- Сброс настроек: Ctrl+Shift+R, только на сервере ---
  if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'r' && isServer) {
    event.preventDefault();
    resetSettingsButton.click();
    return;
  }

  if ((key === 'm' || key === 'ь') && !event.ctrlKey && !event.altKey && !event.shiftKey && !inEditable) {
  const isAdmin = new URLSearchParams(location.search).get('admin') === '1';
  if (isAdmin) {
    menu.classList.toggle('hidden');
  }
  event.preventDefault();
  return;
}

  // --- Fullscreen по F — на всех ПК, без модификаторов ---
  if (key === 'f' && !event.ctrlKey && !event.altKey && !event.shiftKey && !inEditable) {
    if (!document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen(); } catch (_err) {}
    } else {
      try { await document.exitFullscreen(); } catch (_err) {}
    }
    return;
  }
});

window.addEventListener('beforeunload', () => {
  stopKeepAliveLoop();
});

function updateStatus() {
  connectionStatus.textContent = `Подключение: ${store.connected ? 'online' : 'offline'} · ${getSocketUrl()}`;
  const network = store.sceneState?.network;
  const coordinator = network?.coordinator;
  networkStatus.textContent = coordinator
    ? `Координатор: ${coordinator.label} (${coordinator.ip})${store.settings.wantsServer ? ' · этот ПК' : ''}`
    : 'Координатор: не выбран';
  clickStatus.textContent = `Клики ${store.settings.role.toUpperCase()}: ${store.sceneState?.clicksByRole?.[store.settings.role] || 0} / ${store.sceneState?.clickThreshold || 17}`;
  const scenario = store.sceneState?.scenario;
  scenarioStatus.textContent = scenario?.forceOpenAll
    ? 'Сценарий: окна открыты на всех ПК'
    : (scenario?.active ? `Сценарий: активен · окно ${String(scenario.currentRole || 'закрыто').toUpperCase()}` : 'Сценарий: ожидание');
  midiStatus.textContent = `MIDI: ${store.midiAccess ? 'доступ выдан' : 'не инициализирован'} · канал ${store.settings.midiChannel} · launch ${midiNumberToName(store.settings.launchNote)} · Откр: ПК1 ${midiNumberToName(store.settings.openNotesByRole.pc1)} · ПК2 ${midiNumberToName(store.settings.openNotesByRole.pc2)} · ПК3 ${midiNumberToName(store.settings.openNotesByRole.pc3)} · ПК4 ${midiNumberToName(store.settings.openNotesByRole.pc4)} · Закр: ПК1 ${midiNumberToName(store.settings.closeNotesByRole.pc1)} · ПК2 ${midiNumberToName(store.settings.closeNotesByRole.pc2)} · ПК3 ${midiNumberToName(store.settings.closeNotesByRole.pc3)} · ПК4 ${midiNumberToName(store.settings.closeNotesByRole.pc4)}`;
  const pdfMap = store.sceneState?.pdfsByRole || store.settings.pdfsByRole;
  const coordinatorHost = store.settings.wantsServer ? location.host : (store.settings.serverHost || store.discoveredCoordinator?.ip || 'не найден');
  ipStatus.textContent = `Локальный запуск: ${location.host} · сервер синхронизации: ${coordinatorHost} · PDF: ПК1 ${pdfMap.pc1 || '—'}, ПК2 ${pdfMap.pc2 || '—'}, ПК3 ${pdfMap.pc3 || '—'}, ПК4 ${pdfMap.pc4 || '—'}`;
  forceOpenAllButton.textContent = scenario?.forceOpenAll ? 'Закрыть окна на всех ПК' : 'Окна на всех ПК';
  renderConnectedDevices();
}

async function bootstrap() {
  buildMidiChannelSelect();
  bindKeepAliveUnlock();
  startKeepAliveLoop();
  await loadAgentInfo();
  await loadLocalSettingsFromDisk();
  await discoverCoordinator();
  syncForm();
  buildScene();
  await loadPdfFiles();
  await closePdfWindowLocally({
    role: store.settings.role,
    pdfFile: store.settings.pdfsByRole?.[store.settings.role] || '',
    token: '',
  });
  updateStatus();
  manageDiscoveryLoop();
  connect();
  initMidi();
}

bootstrap();

// ===== Мягкий антивандал: отключаем контекст, перетаскивания, выделения, масштаб =====
window.addEventListener('contextmenu', (e) => {
  // В админ-меню контекстное меню разрешаем (чтобы можно было скопировать IP)
  if (e.target && e.target.closest && e.target.closest('#menu')) return;
  e.preventDefault();
});
window.addEventListener('dragstart', (e) => e.preventDefault());
window.addEventListener('selectstart', (e) => {
  if (e.target && e.target.closest && e.target.closest('#menu')) return;
  e.preventDefault();
});
// Ctrl + колесо = масштаб страницы — блокируем
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });
// Pinch-жесты (тачпад/тачскрин)
window.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('gesturechange', (e) => e.preventDefault());
// Средняя кнопка мыши — открытие ссылки в новой вкладке и пр.
window.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// ===== Меню показывается ТОЛЬКО при ?admin=1 в URL =====
(function setupAdminMenuAccess() {
  const params = new URLSearchParams(location.search);
  const isAdmin = params.get('admin') === '1';

  if (!isAdmin) {
    // Клиентский режим — прячем меню намертво и не даём открыть
    menu.classList.add('hidden');
    // Раз в секунду форсим скрытие на случай, если что-то снимет класс
    setInterval(() => {
      if (!menu.classList.contains('hidden')) menu.classList.add('hidden');
    }, 500);
  }
  // Если ?admin=1 — меню управляется как обычно (клавиша M и т.д.)
})();

