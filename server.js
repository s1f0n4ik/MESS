const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dgram = require('dgram');
const { execFile, execFileSync, spawn } = require('child_process');
const WebSocket = require('ws');

const APP_PORT = Number(process.env.APP_PORT || 8787);
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 8788);
const CLICK_THRESHOLD = 17;
const ROLES = ['pc1', 'pc2', 'pc3', 'pc4'];
const LOCAL_SETTINGS_FILE = path.join(__dirname, 'local-settings.json');
const PDF_WINDOW_MARKER = 'postcards-pdf-window';
const PDF_WINDOW_PROFILE_DIR = path.join(__dirname, '.pdf-window-profile');
const PDF_WINDOW_CONTROL_SOURCE = path.join(__dirname, 'pdf-window-control.cs');
const PDF_WINDOW_CONTROL_EXE = path.join(__dirname, 'pdf-window-control.exe');
const PDF_WINDOW_CACHE_PATHS = [
  'BrowserMetrics',
  'component_crx_cache',
  'Crashpad',
  'GraphiteDawnCache',
  'GrShaderCache',
  'ProvenanceData',
  'ShaderCache',
  'Subresource Filter',
  path.join('Default', 'Cache'),
  path.join('Default', 'Code Cache'),
  path.join('Default', 'DawnGraphiteCache'),
  path.join('Default', 'DawnWebGPUCache'),
  path.join('Default', 'GPUCache'),
  path.join('Default', 'Media Cache'),
  path.join('Default', 'Service Worker', 'CacheStorage'),
];
const DISCOVERY_MAGIC = 'postcards-coordinator-v1';
const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
let nextClientId = 1;
const browserClients = new Set();
const pdfStateClients = new Set();
const localPdfWindow = {
  pid: null,
  token: null,
  pdfFile: '',
  role: 'pc1',
  processRole: null,
  visible: false,
  stateVersion: 0,
  launchedAt: null,
};
const discoverySocket = dgram.createSocket('udp4');

const localIps = getLocalIps();
const state = createInitialState();
const persistedLocalSettings = loadPersistedLocalSettings();
applyPersistedStateSettings(persistedLocalSettings.settings);

function createInitialState() {
  return {
    clickThreshold: CLICK_THRESHOLD,
    clicksByRole: { pc1: 0, pc2: 0, pc3: 0, pc4: 0 },
    clickScenarioLockedByRole: { pc1: false, pc2: false, pc3: false, pc4: false },
    flippedCardsByRole: { pc1: {}, pc2: {}, pc3: {}, pc4: {} },
    scenario: {
      active: false,
      trigger: null,
      phase: 'idle',
      currentRole: null,
      openRoles: { pc1: false, pc2: false, pc3: false, pc4: false },
      popupEpoch: 0,
      popupPage: 0,
      startedAt: null,
      forceOpenAll: false,
      restoreAfterForce: null,
    },
    midi: {
      midiChannel: 2,
      launchNote: 60,
      openNotesByRole: {
        pc1: 61,
        pc2: 62,
        pc3: 63,
        pc4: 64,
      },
      closeNotesByRole: {
        pc1: 65,
        pc2: 66,
        pc3: 67,
        pc4: 68,
      },
      minimizeAllNote: 69,
      outputNote: 72,
      velocity: 100,
      duration: 180,
      lastMessage: null,
    },
    pdfsByRole: { pc1: 'pc1.pdf', pc2: 'pc2.pdf', pc3: 'pc3.pdf', pc4: 'pc4.pdf' },
    network: {
      serverEnabled: false,
      coordinator: null,
    },
    lastEvent: null,
    lastUpdatedAt: Date.now(),
  };
}

function loadPersistedLocalSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCAL_SETTINGS_FILE, 'utf8'));
    return {
      settings: raw && typeof raw.settings === 'object' ? raw.settings : {},
      popupTexts: raw && typeof raw.popupTexts === 'object' ? raw.popupTexts : {},
      savedAt: raw && raw.savedAt ? raw.savedAt : null,
    };
  } catch (_err) {
    return { settings: {}, popupTexts: {}, savedAt: null };
  }
}

function persistLocalSettings(payload = {}) {
  const data = {
    settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {},
    popupTexts: payload.popupTexts && typeof payload.popupTexts === 'object' ? payload.popupTexts : {},
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LOCAL_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
  persistedLocalSettings.settings = data.settings;
  persistedLocalSettings.popupTexts = data.popupTexts;
  persistedLocalSettings.savedAt = data.savedAt;
  return data;
}

function clearPersistedLocalSettings() {
  try {
    if (fs.existsSync(LOCAL_SETTINGS_FILE)) fs.unlinkSync(LOCAL_SETTINGS_FILE);
  } catch (_err) {}
  persistedLocalSettings.settings = {};
  persistedLocalSettings.popupTexts = {};
  persistedLocalSettings.savedAt = null;
}

function getLocalIps() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out.length ? out : ['127.0.0.1'];
}

function ipv4ToInt(ip) {
  return String(ip || '').split('.').reduce((acc, part) => ((acc << 8) >>> 0) + (Number(part) & 255), 0) >>> 0;
}

function intToIpv4(intValue) {
  return [
    (intValue >>> 24) & 255,
    (intValue >>> 16) & 255,
    (intValue >>> 8) & 255,
    intValue & 255,
  ].join('.');
}

function getBroadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!net || net.family !== 'IPv4' || net.internal || !net.netmask) continue;
      const ipInt = ipv4ToInt(net.address);
      const maskInt = ipv4ToInt(net.netmask);
      const broadcastInt = (ipInt | (~maskInt >>> 0)) >>> 0;
      out.add(intToIpv4(broadcastInt));
    }
  }
  return [...out];
}

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

function sanitizeRole(role) {
  return ROLES.includes(role) ? role : 'pc1';
}

function sanitizeLocalClientSettings(raw = {}) {
  const openNotesByRole = raw.openNotesByRole || {};
  const closeNotesByRole = raw.closeNotesByRole || {};
  const pdfsByRole = raw.pdfsByRole || {};
  return {
    role: sanitizeRole(raw.role),
    wantsServer: Boolean(raw.wantsServer),
    serverHost: String(raw.serverHost || '').trim(),
    audioEnabled: raw.audioEnabled !== false,
    midiInputId: String(raw.midiInputId || ''),
    midiOutputId: String(raw.midiOutputId || ''),
    midiChannel: clampChannel(raw.midiChannel, 2),
    launchNote: clampMidi(raw.launchNote, 60),
    openNotesByRole: {
      pc1: clampMidi(openNotesByRole.pc1, 61),
      pc2: clampMidi(openNotesByRole.pc2, 62),
      pc3: clampMidi(openNotesByRole.pc3, 63),
      pc4: clampMidi(openNotesByRole.pc4, 64),
    },
    closeNotesByRole: {
      pc1: clampMidi(closeNotesByRole.pc1, 65),
      pc2: clampMidi(closeNotesByRole.pc2, 66),
      pc3: clampMidi(closeNotesByRole.pc3, 67),
      pc4: clampMidi(closeNotesByRole.pc4, 68),
    },
    minimizeAllNote: clampMidi(raw.minimizeAllNote, 69),
    outputNote: clampMidi(raw.outputNote, 72),
    velocity: clampMidi(raw.velocity, 100),
    duration: Math.max(1, Number(raw.duration || 180) || 180),
    pdfsByRole: {
      pc1: sanitizePdfFile(pdfsByRole.pc1, 'pc1.pdf'),
      pc2: sanitizePdfFile(pdfsByRole.pc2, 'pc2.pdf'),
      pc3: sanitizePdfFile(pdfsByRole.pc3, 'pc3.pdf'),
      pc4: sanitizePdfFile(pdfsByRole.pc4, 'pc4.pdf'),
    },
  };
}

function applyPersistedStateSettings(raw = {}) {
  const settings = sanitizeLocalClientSettings(raw);
  state.midi.midiChannel = settings.midiChannel;
  state.midi.launchNote = settings.launchNote;
  state.midi.openNotesByRole = { ...settings.openNotesByRole };
  state.midi.closeNotesByRole = { ...settings.closeNotesByRole };
  state.midi.minimizeAllNote = settings.minimizeAllNote;
  state.midi.outputNote = settings.outputNote;
  state.midi.velocity = settings.velocity;
  state.midi.duration = settings.duration;
  state.pdfsByRole = { ...settings.pdfsByRole };
  localPdfWindow.role = settings.role;
  localPdfWindow.pdfFile = sanitizePdfFile(settings.pdfsByRole?.[settings.role], state.pdfsByRole[settings.role] || 'pc1.pdf');
}

function clampMidi(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(127, Math.round(n)));
}

function clampChannel(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(16, Math.round(n)));
}

function noteName(num) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = clampMidi(num, 0);
  return `${names[n % 12]}${Math.floor(n / 12) - 1}`;
}

function getLocalPdfWindowState() {
  return {
    pdfFile: localPdfWindow.pdfFile || '',
    role: localPdfWindow.role || 'pc1',
    visible: Boolean(localPdfWindow.visible),
    token: localPdfWindow.token || '',
    stateVersion: localPdfWindow.stateVersion || 0,
  };
}

function broadcastPdfWindowState(reason = 'state') {
  const payload = `event: state\ndata:${JSON.stringify({ ok: true, reason, state: getLocalPdfWindowState() })}\n\n`;
  for (const res of [...pdfStateClients]) {
    try {
      res.write(payload);
    } catch (_err) {
      pdfStateClients.delete(res);
    }
  }
}

function setLastEvent(type, details = {}) {
  state.lastEvent = { type, details, at: Date.now() };
  state.lastUpdatedAt = Date.now();
}

function getPdfFiles() {
  const pdfDir = path.join(__dirname, 'public', 'pdfs');
  try {
    return fs.readdirSync(pdfDir).filter((name) => /\.pdf$/i.test(name)).sort((a, b) => a.localeCompare(b, 'ru'));
  } catch (_err) {
    return [];
  }
}

function sanitizePdfFile(name, fallback = '') {
  const safe = String(name || '').trim().replace(/\\/g, '/').split('/').pop();
  const pdfFiles = getPdfFiles();
  if (safe && pdfFiles.includes(safe)) return safe;
  return fallback && pdfFiles.includes(fallback) ? fallback : (pdfFiles[0] || '');
}

function getDirectorySizeBytes(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  const stack = [dirPath];
  let total = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_err) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      try {
        total += fs.statSync(fullPath).size;
      } catch (_err) {}
    }
  }
  return total;
}

function clearPdfWindowCache(callback = () => {}) {
  const restoreState = {
    role: sanitizeRole(localPdfWindow.role || 'pc1'),
    pdfFile: sanitizePdfFile(localPdfWindow.pdfFile, state.pdfsByRole?.[sanitizeRole(localPdfWindow.role || 'pc1')] || 'pc1.pdf'),
    token: String(localPdfWindow.token || ''),
    visible: Boolean(localPdfWindow.visible),
  };
  closeAllPdfWindowsLocally(() => {
    setTimeout(() => {
      try { fs.mkdirSync(PDF_WINDOW_PROFILE_DIR, { recursive: true }); } catch (_err) {}
      const beforeBytes = getDirectorySizeBytes(PDF_WINDOW_PROFILE_DIR);
      const clearedPaths = [];
      const failedPaths = [];
      for (const relativePath of PDF_WINDOW_CACHE_PATHS) {
        const targetPath = path.join(PDF_WINDOW_PROFILE_DIR, relativePath);
        if (!fs.existsSync(targetPath)) continue;
        try {
          fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
          clearedPaths.push(relativePath);
        } catch (error) {
          failedPaths.push({ path: relativePath, error: error.message });
        }
      }
      const finish = (restoreError = null, restoreResult = null) => {
        callback(null, {
          ok: failedPaths.length === 0 && !restoreError,
          beforeBytes,
          afterBytes: getDirectorySizeBytes(PDF_WINDOW_PROFILE_DIR),
          clearedPaths,
          failedPaths,
          restoredVisibleWindow: Boolean(restoreResult?.ok),
          restoreError: restoreError ? restoreError.message : null,
        });
      };
      if (!restoreState.pdfFile) {
        finish();
        return;
      }
      syncPdfWindowStateLocally({
        role: restoreState.role,
        pdfFile: restoreState.pdfFile,
        token: restoreState.token,
        visible: restoreState.visible,
      }, (restoreError, restoreResult) => finish(restoreError || null, restoreResult || null));
    }, 180);
  });
}

function listConnectedDevices() {
  return [...browserClients]
    .filter((ws) => ws.readyState === WebSocket.OPEN)
    .map((ws) => ({
      clientId: ws.clientId,
      role: sanitizeRole(ws.clientInfo?.role),
      wantsServer: Boolean(ws.clientInfo?.wantsServer),
      hostName: String(ws.clientInfo?.hostName || ''),
      ip: normalizeIp(ws.clientInfo?.ip || ws.remoteAddress || ''),
      localIps: Array.isArray(ws.clientInfo?.localIps) ? ws.clientInfo.localIps : [],
      connectedAt: Number(ws.clientInfo?.connectedAt || ws.connectedAt || Date.now()),
      lastSeenAt: Number(ws.clientInfo?.lastSeenAt || Date.now()),
      isCoordinatorClient: Boolean(ws.clientInfo?.wantsServer),
    }))
    .sort((a, b) => a.role.localeCompare(b.role, 'ru') || a.hostName.localeCompare(b.hostName, 'ru') || a.connectedAt - b.connectedAt);
}

function buildCoordinatorInfo(role = 'pc1') {
  return {
    label: `${os.hostname()} (${sanitizeRole(role).toUpperCase()})`,
    hostName: os.hostname(),
    role: sanitizeRole(role),
    ip: localIps[0],
    ips: localIps,
    port: APP_PORT,
    discoveryPort: DISCOVERY_PORT,
  };
}

function getPublicState() {
  return {
    ...state,
    availablePdfFiles: getPdfFiles(),
    midi: {
      ...state.midi,
      launchNoteName: noteName(state.midi.launchNote),
      minimizeAllNoteName: noteName(state.midi.minimizeAllNote),
      outputNoteName: noteName(state.midi.outputNote),
      openNoteNamesByRole: Object.fromEntries(ROLES.map((role) => [role, noteName(state.midi.openNotesByRole[role])])),
      closeNoteNamesByRole: Object.fromEntries(ROLES.map((role) => [role, noteName(state.midi.closeNotesByRole[role])])),
    },
    network: {
      ...state.network,
      localIps,
      appPort: APP_PORT,
      discoveryPort: DISCOVERY_PORT,
      isCoordinator: state.network.serverEnabled,
      coordinatorLocked: state.network.serverEnabled,
      connectedDevices: listConnectedDevices(),
    },
    serverTime: Date.now(),
  };
}

function sendJson(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function findLocalBrowserExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function findCscExecutable() {
  return CSC_CANDIDATES.find((file) => fs.existsSync(file)) || '';
}

function ensurePdfWindowControllerExecutable() {
  try {
    if (!fs.existsSync(PDF_WINDOW_CONTROL_SOURCE)) return '';
    if (fs.existsSync(PDF_WINDOW_CONTROL_EXE)) {
      const exeStat = fs.statSync(PDF_WINDOW_CONTROL_EXE);
      const srcStat = fs.statSync(PDF_WINDOW_CONTROL_SOURCE);
      if (exeStat.mtimeMs >= srcStat.mtimeMs) return PDF_WINDOW_CONTROL_EXE;
    }
    const cscPath = findCscExecutable();
    if (!cscPath) return '';
    execFileSync(cscPath, [
      '/nologo',
      '/target:exe',
      `/out:${PDF_WINDOW_CONTROL_EXE}`,
      PDF_WINDOW_CONTROL_SOURCE,
    ], {
      windowsHide: true,
      timeout: 20000,
    });
    return fs.existsSync(PDF_WINDOW_CONTROL_EXE) ? PDF_WINDOW_CONTROL_EXE : '';
  } catch (_err) {
    return '';
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
}

function clearPdfWindowState() {
  localPdfWindow.pid = null;
  localPdfWindow.processRole = null;
  localPdfWindow.launchedAt = null;
}

function fitPdfWindowBoundsLocally(screenInfo = {}, options = {}, callback = () => {}) {
  if (process.platform !== 'win32') {
    callback(null, { ok: true, skipped: true, reason: 'unsupported_platform' });
    return;
  }
  const width = Math.max(400, Number(screenInfo.width) || 1968);
  const height = Math.max(300, Number(screenInfo.height) || 1392);
  const availWidth = Math.max(width, Number(screenInfo.availWidth) || width);
  const availHeight = Math.max(height, Number(screenInfo.availHeight) || height);
  const left = Math.max(0, Math.round((availWidth - width) / 2));
  const top = Math.max(0, Math.round((availHeight - height) / 2));
  const profileDir = PDF_WINDOW_PROFILE_DIR.replace(/'/g, "''");
  const focus = options.focus !== false;
  const processId = Math.max(0, Number(options.processId || localPdfWindow.pid || 0));
  const winApiType = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class WinApi {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);',
    '}',
  ].join(' ').replace(/'/g, "''");
  const command =
    "$profileDir = '" + profileDir + "'; " +
    `$left = ${left}; $top = ${top}; $width = ${width}; $height = ${height}; ` +
    `$targetPid = ${processId}; ` +
    "$focus = " + (focus ? '$true' : '$false') + "; " +
    "$typeDef = '" + winApiType + "'; " +
    "Add-Type -TypeDefinition $typeDef -ErrorAction SilentlyContinue | Out-Null; " +
    "$proc = $null; " +
    "for ($i = 0; $i -lt 18 -and -not $proc; $i++) { " +
    "  if ($targetPid -gt 0) { $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 } " +
    "  if (-not $proc) { " +
    "    $proc = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome)\\.exe$' -and $_.CommandLine -like ('*' + $profileDir + '*') } | " +
    "      ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | " +
    "      Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; " +
    "  } " +
    "  if (-not $proc) { Start-Sleep -Milliseconds 50 } " +
    "} " +
    "if ($proc) { " +
    "  [WinApi]::ShowWindowAsync($proc.MainWindowHandle, 9) | Out-Null; " +
    "  Start-Sleep -Milliseconds 20; " +
    "  [WinApi]::MoveWindow($proc.MainWindowHandle, $left, $top, $width, $height, $true) | Out-Null; " +
    "  if ($focus) { [WinApi]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null } " +
    "} else { exit 1 }";

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { windowsHide: true, timeout: 12000 },
    (error, stdout, stderr) => {
      callback(error || null, {
        ok: !error,
        left,
        top,
        width,
        height,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
      });
    }
  );
}

function closeAllPdfWindowsLocally(callback = () => {}) {
  if (process.platform !== 'win32') {
    clearPdfWindowState();
    callback(null, { ok: true, skipped: true, reason: 'unsupported_platform' });
    return;
  }
  const profileDir = PDF_WINDOW_PROFILE_DIR.replace(/'/g, "''");
  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "$profileDir = '" + profileDir + "'; " +
      "$procs = Get-CimInstance Win32_Process | Where-Object { " +
      "$_.Name -match '^(msedge|chrome)\\.exe$' -and $_.CommandLine -like ('*' + $profileDir + '*')" +
      " }; " +
      "foreach ($proc in $procs) { try { taskkill /PID $proc.ProcessId /T /F | Out-Null } catch {} }",
    ],
    { windowsHide: true, timeout: 10000 },
    (_error, stdout, stderr) => {
      clearPdfWindowState();
      callback(null, { ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    }
  );
}

function closePdfWindowLocally(callback = () => {}) {
  if (process.platform !== 'win32') {
    clearPdfWindowState();
    callback(null, { ok: true, alreadyClosed: true });
    return;
  }
  if (localPdfWindow.pid && isProcessAlive(localPdfWindow.pid)) {
    const pid = localPdfWindow.pid;
    clearPdfWindowState();
    execFile(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout, stderr) => {
        if (error) {
          closeAllPdfWindowsLocally(callback);
          return;
        }
        callback(null, { ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
      }
    );
    return;
  }
  closeAllPdfWindowsLocally(callback);
}

function openPdfWindowLocally(options = {}, callback = () => {}) {
  const pdfFile = sanitizePdfFile(options.pdfFile, localPdfWindow.pdfFile || 'pc1.pdf');
  const desiredRole = sanitizeRole(options.role || localPdfWindow.role || 'pc1');
  const screenInfo = options.screen || {};
  if (!pdfFile) {
    callback(new Error('PDF file not selected'));
    return;
  }
  if (process.platform !== 'win32') {
    callback(new Error('PDF window launch is supported only on Windows'));
    return;
  }

  const browserPath = findLocalBrowserExecutable();
  if (!browserPath) {
    callback(new Error('Supported browser not found'));
    return;
  }
  try { fs.mkdirSync(PDF_WINDOW_PROFILE_DIR, { recursive: true }); } catch (_err) {}

  if (localPdfWindow.pid && isProcessAlive(localPdfWindow.pid)) {
    const pid = localPdfWindow.pid;
    callback(null, { ok: true, reused: true, pid, role: localPdfWindow.role, pdfFile: localPdfWindow.pdfFile });
    return;
  }

  const width = Math.max(400, Number(screenInfo.width) || 1968);
  const height = Math.max(300, Number(screenInfo.height) || 1392);
  const availWidth = Math.max(width, Number(screenInfo.availWidth) || width);
  const availHeight = Math.max(height, Number(screenInfo.availHeight) || height);
  const left = Math.max(0, Math.round((availWidth - width) / 2));
  const top = Math.max(0, Math.round((availHeight - height) / 2));
  const url = `http://127.0.0.1:${APP_PORT}/pdf.html?mode=${encodeURIComponent(PDF_WINDOW_MARKER)}`;
  const args = [
    '--new-window',
    `--app=${url}`,
    `--user-data-dir=${PDF_WINDOW_PROFILE_DIR}`,
    `--window-size=${width},${height}`,
    `--window-position=${left},${top}`,
    '--start-minimized',
  ];

  try {
    const child = spawn(browserPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    localPdfWindow.pid = child.pid;
    localPdfWindow.role = desiredRole;
    localPdfWindow.processRole = desiredRole;
    localPdfWindow.pdfFile = pdfFile;
    localPdfWindow.visible = false;
    localPdfWindow.launchedAt = Date.now();
    callback(null, { ok: true, launched: true, pid: child.pid, left, top, width, height, role: desiredRole, pdfFile });
  } catch (error) {
    clearPdfWindowState();
    callback(error);
  }
}

function setPdfWindowVisibilityLocally(visible, options = {}, callback = () => {}) {
  if (process.platform !== 'win32') {
    callback(null, { ok: true, skipped: true, reason: 'unsupported_platform' });
    return;
  }
  const focus = visible && options.focus !== false;
  const processId = Math.max(0, Number(options.processId || localPdfWindow.pid || 0));
  const helperExe = processId > 0 ? ensurePdfWindowControllerExecutable() : '';
  if (helperExe) {
    execFile(
      helperExe,
      [visible ? 'show' : 'hide', String(processId), focus ? '1' : '0'],
      { windowsHide: true, timeout: 3000 },
      (error, stdout, stderr) => {
        callback(error || null, { ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), helper: 'exe' });
      }
    );
    return;
  }
  const profileDir = PDF_WINDOW_PROFILE_DIR.replace(/'/g, "''");
  const showType = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class WinApi {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '}',
  ].join(' ');
  const command =
    "$profileDir = '" + profileDir + "'; " +
    `$targetPid = ${processId}; ` +
    "$focus = " + (focus ? '$true' : '$false') + "; " +
    "$typeDef = '" + showType.replace(/'/g, "''") + "'; " +
    "Add-Type -TypeDefinition $typeDef -ErrorAction SilentlyContinue | Out-Null; " +
    "$proc = $null; " +
    "for ($i = 0; $i -lt 12 -and -not $proc; $i++) { " +
    "  if ($targetPid -gt 0) { $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 } " +
    "  if (-not $proc) { " +
    "    $proc = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome)\\.exe$' -and $_.CommandLine -like ('*' + $profileDir + '*') } | " +
    "      ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | " +
    "      Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; " +
    "  } " +
    "  if (-not $proc) { Start-Sleep -Milliseconds 40 } " +
    "} " +
    "if ($proc) { " +
    (visible
      ? "[WinApi]::ShowWindowAsync($proc.MainWindowHandle, 9) | Out-Null; if ($focus) { [WinApi]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null } "
      : "[WinApi]::ShowWindowAsync($proc.MainWindowHandle, 6) | Out-Null; ") +
    "} else { exit 1 }";

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { windowsHide: true, timeout: 10000 },
    (error, stdout, stderr) => {
      callback(error || null, { ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    }
  );
}

function ensurePdfWindowProcess(options = {}, callback = () => {}) {
  if (process.platform !== 'win32') {
    callback(new Error('PDF window launch is supported only on Windows'));
    return;
  }
  const desiredRole = sanitizeRole(options.role || localPdfWindow.role || 'pc1');
  localPdfWindow.role = desiredRole;
  if (Object.prototype.hasOwnProperty.call(options, 'pdfFile')) {
    localPdfWindow.pdfFile = sanitizePdfFile(options.pdfFile, localPdfWindow.pdfFile || '');
  }
  if (localPdfWindow.pid && isProcessAlive(localPdfWindow.pid)) {
    callback(null, { ok: true, reused: true, pid: localPdfWindow.pid, role: localPdfWindow.role, pdfFile: localPdfWindow.pdfFile });
    return;
  }
  openPdfWindowLocally({
    role: desiredRole,
    pdfFile: localPdfWindow.pdfFile,
    screen: options.screen || {},
  }, callback);
}

function syncPdfWindowStateLocally(options = {}, callback = () => {}) {
  const nextRole = sanitizeRole(options.role || localPdfWindow.role || 'pc1');
  const nextPdfFile = sanitizePdfFile(options.pdfFile, localPdfWindow.pdfFile || state.pdfsByRole[nextRole] || 'pc1.pdf');
  const nextVisible = Boolean(options.visible);
  const nextToken = String(options.token || '');
  const screenInfo = options.screen || {};
  const changed =
    localPdfWindow.role !== nextRole ||
    localPdfWindow.pdfFile !== nextPdfFile ||
    localPdfWindow.visible !== nextVisible ||
    localPdfWindow.token !== nextToken;

  localPdfWindow.role = nextRole;
  localPdfWindow.pdfFile = nextPdfFile;
  localPdfWindow.visible = nextVisible;
  localPdfWindow.token = nextToken;
  if (changed) {
    localPdfWindow.stateVersion += 1;
    broadcastPdfWindowState('pdf_window_state');
  }

  ensurePdfWindowProcess({
    role: localPdfWindow.role,
    pdfFile: localPdfWindow.pdfFile,
    screen: screenInfo,
  }, (error, ensureResult) => {
    if (error) {
      callback(error);
      return;
    }
    const finalizePosition = (visibilityResult) => {
      if (!localPdfWindow.visible) {
        callback(null, {
          ok: true,
          ensured: ensureResult,
          visibility: visibilityResult,
          stateVersion: localPdfWindow.stateVersion,
        });
        return;
      }

      fitPdfWindowBoundsLocally(screenInfo, {
        processId: localPdfWindow.pid,
        focus: true,
      }, (fitError, fitResult) => {
        if (fitError) {
          callback(fitError);
          return;
        }
        callback(null, {
          ok: true,
          ensured: ensureResult,
          visibility: visibilityResult,
          fit: fitResult,
          stateVersion: localPdfWindow.stateVersion,
        });
      });
    };

    const runVisibilityChange = () => {
      setPdfWindowVisibilityLocally(localPdfWindow.visible, {
        processId: localPdfWindow.pid,
        focus: localPdfWindow.visible,
      }, (visibilityError, visibilityResult) => {
        if (visibilityError) {
          callback(visibilityError);
          return;
        }
        finalizePosition(visibilityResult);
      });
    };

    if (ensureResult?.launched) {
      setTimeout(runVisibilityChange, localPdfWindow.visible ? 120 : 80);
      return;
    }

    runVisibilityChange();
  });
}

function minimizeAllWindowsLocally(callback = () => {}) {
  if (process.platform !== 'win32') {
    callback(null, { ok: false, skipped: true, reason: 'unsupported_platform' });
    return;
  }
  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '(New-Object -ComObject Shell.Application).MinimizeAll()',
    ],
    { windowsHide: true, timeout: 5000 },
    (error, stdout, stderr) => {
      if (error) {
        callback(error, { ok: false, stderr: String(stderr || '').trim() });
        return;
      }
      callback(null, { ok: true, stdout: String(stdout || '').trim() });
    }
  );
}

function broadcastState(reason = 'state') {
  const publicState = getPublicState();
  for (const ws of browserClients) {
    sendJson(ws, 'state', { reason, state: publicState });
  }
}

function setCoordinator(role = 'pc1') {
  state.network.serverEnabled = true;
  state.network.coordinator = buildCoordinatorInfo(role);
}

function resetOpenRoles() {
  state.scenario.openRoles = { pc1: false, pc2: false, pc3: false, pc4: false };
}

function getLastOpenRole() {
  const openRoles = state.scenario.openRoles || {};
  const opened = ROLES.filter((role) => openRoles[role]);
  return opened.length ? opened[opened.length - 1] : null;
}

function startScenario(trigger, role = 'pc1') {
  const openRole = sanitizeRole(role);
  if (trigger?.type === 'click_threshold' && trigger?.role) {
    state.clickScenarioLockedByRole[sanitizeRole(trigger.role)] = true;
  }
  state.scenario.active = true;
  state.scenario.trigger = trigger;
  state.scenario.phase = 'manual_midi';
  state.scenario.currentRole = openRole;
  resetOpenRoles();
  state.scenario.openRoles[openRole] = true;
  state.scenario.popupEpoch += 1;
  state.scenario.popupPage = 0;
  state.scenario.startedAt = Date.now();
  state.scenario.forceOpenAll = false;
  state.scenario.restoreAfterForce = null;
  state.midi.lastMessage = { type: 'launch', at: Date.now(), trigger };
  setLastEvent('scenario_started', { trigger, role: openRole });
  broadcastState('scenario_started');
}

function setCurrentRole(role, source = {}) {
  const targetRole = sanitizeRole(role);
  state.scenario.active = true;
  state.scenario.phase = 'manual_midi';
  state.scenario.currentRole = targetRole;
  state.scenario.forceOpenAll = false;
  state.scenario.restoreAfterForce = null;
  state.scenario.startedAt = state.scenario.startedAt || Date.now();
  state.scenario.trigger = state.scenario.trigger || source;
  state.scenario.openRoles[targetRole] = true;
  setLastEvent('scenario_role_changed', { role: state.scenario.currentRole, source });
  broadcastState('scenario_role_changed');
}

function openRolePopup(role, source = {}) {
  const targetRole = sanitizeRole(role);
  if (!state.scenario.active) {
    startScenario({ type: 'midi_open', role: targetRole, source }, targetRole);
    return;
  }
  if (!state.scenario.forceOpenAll && state.scenario.currentRole === targetRole && state.scenario.openRoles[targetRole]) {
    setLastEvent('scenario_role_open_ignored', { role: targetRole, source, reason: 'already_open' });
    broadcastState('scenario_role_open_ignored');
    return;
  }
  if (state.scenario.forceOpenAll) {
    state.scenario.forceOpenAll = false;
    state.scenario.restoreAfterForce = null;
  }
  state.scenario.active = true;
  state.scenario.phase = 'manual_midi';
  state.scenario.currentRole = targetRole;
  state.scenario.startedAt = state.scenario.startedAt || Date.now();
  state.scenario.trigger = state.scenario.trigger || source;
  state.scenario.openRoles[targetRole] = true;
  setLastEvent('scenario_role_changed', { role: state.scenario.currentRole, source });
  broadcastState('scenario_role_changed');
}

function closeRolePopup(role, source = {}) {
  const targetRole = sanitizeRole(role);
  if (!state.scenario.active) {
    setLastEvent('scenario_role_close_ignored', { role: targetRole, source, reason: 'inactive' });
    broadcastState('scenario_role_close_ignored');
    return;
  }
  if (state.scenario.forceOpenAll) {
    state.scenario.forceOpenAll = false;
    state.scenario.restoreAfterForce = null;
  }
  if (state.scenario.openRoles[targetRole]) {
    state.scenario.openRoles[targetRole] = false;
    if (state.scenario.currentRole === targetRole) state.scenario.currentRole = getLastOpenRole();
    state.scenario.phase = 'manual_midi';
    setLastEvent('scenario_role_closed', { role: targetRole, source });
    broadcastState('scenario_role_closed');
    return;
  }
  setLastEvent('scenario_role_close_ignored', { role: targetRole, source, reason: 'not_open', openRoles: state.scenario.openRoles });
  broadcastState('scenario_role_close_ignored');
}

function toggleForceOpenAll(source = {}) {
  if (!state.scenario.forceOpenAll) {
    state.scenario.restoreAfterForce = {
      active: state.scenario.active,
      currentRole: state.scenario.currentRole,
      openRoles: { ...state.scenario.openRoles },
      phase: state.scenario.phase,
      trigger: state.scenario.trigger,
      startedAt: state.scenario.startedAt,
    };
    state.scenario.forceOpenAll = true;
    state.scenario.active = true;
    state.scenario.phase = 'force_open_all';
    state.scenario.currentRole = 'all';
    state.scenario.openRoles = { pc1: true, pc2: true, pc3: true, pc4: true };
    state.scenario.popupEpoch += 1;
    setLastEvent('force_open_all_enabled', source);
    broadcastState('force_open_all_enabled');
    return;
  }
  const restore = state.scenario.restoreAfterForce;
  state.scenario.forceOpenAll = false;
  state.scenario.restoreAfterForce = null;
  if (restore && restore.active) {
    state.scenario.active = true;
    state.scenario.currentRole = restore.currentRole;
    state.scenario.openRoles = restore.openRoles || { pc1: false, pc2: false, pc3: false, pc4: false };
    state.scenario.phase = restore.phase || 'manual_midi';
    state.scenario.trigger = restore.trigger || null;
    state.scenario.startedAt = restore.startedAt || Date.now();
    setLastEvent('force_open_all_disabled', { ...source, restoredRole: restore.currentRole });
    broadcastState('force_open_all_disabled');
    return;
  }
  closeScenario({ ...source, reason: 'force_open_all_disabled_without_restore' });
}

function closeScenario(source = {}, options = {}) {
  const preserveClicks = options.preserveClicks !== false;
  const preserveClickLocks = options.preserveClickLocks !== false;
  const preserveFlips = options.preserveFlips !== false;
  const midi = { ...state.midi, openNotesByRole: { ...state.midi.openNotesByRole }, closeNotesByRole: { ...state.midi.closeNotesByRole } };
  const pdfsByRole = { ...state.pdfsByRole };
  const network = { ...state.network };
  const clicksByRole = preserveClicks ? { ...state.clicksByRole } : null;
  const clickScenarioLockedByRole = preserveClickLocks ? { ...state.clickScenarioLockedByRole } : null;
  const flippedCardsByRole = preserveFlips ? {
    pc1: { ...state.flippedCardsByRole.pc1 },
    pc2: { ...state.flippedCardsByRole.pc2 },
    pc3: { ...state.flippedCardsByRole.pc3 },
    pc4: { ...state.flippedCardsByRole.pc4 },
  } : null;
  const popupEpoch = state.scenario.popupEpoch + 1;
  Object.assign(state, createInitialState());
  state.midi = midi;
  state.pdfsByRole = pdfsByRole;
  state.network = network;
  if (clicksByRole) state.clicksByRole = clicksByRole;
  if (clickScenarioLockedByRole) state.clickScenarioLockedByRole = clickScenarioLockedByRole;
  if (flippedCardsByRole) state.flippedCardsByRole = flippedCardsByRole;
  state.scenario.popupEpoch = popupEpoch;
  state.midi.lastMessage = { type: 'close', at: Date.now(), source };
  setLastEvent('scenario_closed', source);
  broadcastState('scenario_closed');
}

function hardReset(source = {}) {
  closeScenario(
    { ...source, type: 'hard_reset' },
    { preserveClicks: false, preserveClickLocks: false, preserveFlips: false }
  );
}

function updateMidiConfig(payload = {}) {
  state.midi.midiChannel = clampChannel(payload.midiChannel, state.midi.midiChannel);
  state.midi.launchNote = clampMidi(payload.launchNote, state.midi.launchNote);
  state.midi.minimizeAllNote = clampMidi(payload.minimizeAllNote, state.midi.minimizeAllNote);
  state.midi.outputNote = clampMidi(payload.outputNote, state.midi.outputNote);
  state.midi.velocity = clampMidi(payload.velocity, state.midi.velocity);
  state.midi.duration = Math.max(1, Number(payload.duration || state.midi.duration) || state.midi.duration);
  const nextOpen = payload.openNotesByRole || {};
  const nextClose = payload.closeNotesByRole || {};
  for (const role of ROLES) {
    state.midi.openNotesByRole[role] = clampMidi(nextOpen[role], state.midi.openNotesByRole[role]);
    state.midi.closeNotesByRole[role] = clampMidi(nextClose[role], state.midi.closeNotesByRole[role]);
  }
  setLastEvent('midi_config_updated', { midi: state.midi });
  broadcastState('midi_config_updated');
}

function triggerMinimizeAllWindows(source = {}) {
  setLastEvent('windows_minimized', source);
  broadcastState('windows_minimized');
  minimizeAllWindowsLocally((error) => {
    if (error) {
      console.error('Failed to minimize windows locally:', error.message);
      return;
    }
  });
}

function applyAction(action = {}, meta = {}) {
  const type = action.type;
  const payload = action.payload || {};

  if (type === 'register') {
    if (meta.ws) {
      meta.ws.clientInfo = {
        ...(meta.ws.clientInfo || {}),
        role: sanitizeRole(payload.role),
        wantsServer: Boolean(payload.wantsServer),
        hostName: String(payload.hostName || ''),
        localIps: Array.isArray(payload.localIps) ? payload.localIps.filter(Boolean).map(String) : [],
        ip: normalizeIp(meta.remoteAddress || meta.ws.remoteAddress || ''),
        connectedAt: meta.ws.clientInfo?.connectedAt || meta.ws.connectedAt || Date.now(),
        lastSeenAt: Date.now(),
      };
    }
    if (payload.wantsServer) setCoordinator(payload.role);
    broadcastState('register');
    return;
  }

  if (type === 'request_become_server') {
    if (meta.ws) {
      meta.ws.clientInfo = {
        ...(meta.ws.clientInfo || {}),
        role: sanitizeRole(payload.role),
        wantsServer: true,
        lastSeenAt: Date.now(),
      };
    }
    setCoordinator(payload.role);
    setLastEvent('coordinator_changed', { role: sanitizeRole(payload.role) });
    broadcastState('coordinator_changed');
    return;
  }

  if (type === 'card_click') {
    const role = sanitizeRole(payload.role);
    const cardIndex = Math.max(0, Math.min(7, Number(payload.cardIndex || 0)));
    state.clicksByRole[role] += 1;
    state.flippedCardsByRole[role][cardIndex] = !state.flippedCardsByRole[role][cardIndex];
    setLastEvent('card_click', { role, cardIndex, clicks: state.clicksByRole[role] });
    if (!state.scenario.active && !state.clickScenarioLockedByRole[role] && state.clicksByRole[role] === CLICK_THRESHOLD) {
      startScenario({ type: 'click_threshold', role, clicks: state.clicksByRole[role] }, 'pc1');
      return;
    }
    broadcastState('card_click');
    return;
  }

  if (type === 'set_popup_page') {
    state.scenario.popupPage = Math.max(0, Math.min(7, Number(payload.page || 0)));
    setLastEvent('popup_page', { page: state.scenario.popupPage, role: sanitizeRole(payload.role) });
    broadcastState('popup_page');
    return;
  }

  if (type === 'reset_clicks') {
    const role = sanitizeRole(payload.role);
    state.clicksByRole[role] = 0;
    state.clickScenarioLockedByRole[role] = false;
    state.flippedCardsByRole[role] = {};
    setLastEvent('reset_clicks', { role });
    broadcastState('reset_clicks');
    return;
  }

  if (type === 'reset_scenario') {
    closeScenario({ type: 'manual_reset', role: sanitizeRole(payload.role) });
    return;
  }

  if (type === 'hard_reset') {
    hardReset({ type: 'manual_hard_reset', role: sanitizeRole(payload.role) });
    return;
  }

  if (type === 'toggle_force_open_all') {
    toggleForceOpenAll({ type: 'toggle_force_open_all', role: sanitizeRole(payload.role) });
    return;
  }

  if (type === 'midi_config') {
    updateMidiConfig(payload);
    return;
  }

  if (type === 'minimize_all_windows') {
    triggerMinimizeAllWindows({ type: 'manual_minimize_all_windows', role: sanitizeRole(payload.role) });
    return;
  }

  if (type === 'pdf_config') {
    for (const role of ROLES) {
      state.pdfsByRole[role] = sanitizePdfFile(payload.pdfsByRole?.[role], state.pdfsByRole[role]);
    }
    setLastEvent('pdf_config_updated', { pdfsByRole: state.pdfsByRole });
    broadcastState('pdf_config_updated');
    return;
  }

  if (type === 'midi_event') {
    const note = clampMidi(payload.note, -1);
    const channel = clampChannel(payload.channel, state.midi.midiChannel);
    const clickTriggeredScenario = state.scenario.trigger?.type === 'click_threshold';
    state.midi.lastMessage = { type: 'input_note', at: Date.now(), note, channel, source: payload.source || meta.source || 'browser' };
    if (channel !== state.midi.midiChannel) {
      broadcastState('midi_input_ignored_channel');
      return;
    }
    if (note === state.midi.launchNote) {
      if (state.scenario.active && clickTriggeredScenario && state.scenario.currentRole === 'pc4' && !state.scenario.forceOpenAll) {
        closeScenario({ type: 'midi_launch_close', note, channel });
        return;
      }
      broadcastState('midi_input');
      return;
    }
    if (note === state.midi.minimizeAllNote) {
      triggerMinimizeAllWindows({ type: 'midi_minimize_all_windows', note, channel });
      return;
    }
    for (const role of ROLES) {
      if (note === state.midi.openNotesByRole[role]) {
        openRolePopup(role, { type: 'midi_open', note, channel });
        return;
      }
      if (note === state.midi.closeNotesByRole[role]) {
        closeRolePopup(role, { type: 'midi_close', note, channel });
        return;
      }
    }
    broadcastState('midi_input');
    return;
  }
}

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return;
  }
  socket.destroy();
});

wss.on('connection', (ws, req) => {
  ws.clientId = `browser-${nextClientId++}`;
  ws.connectedAt = Date.now();
  ws.remoteAddress = normalizeIp(req?.socket?.remoteAddress || '');
  ws.clientInfo = {
    role: 'pc1',
    wantsServer: false,
    hostName: '',
    localIps: [],
    ip: ws.remoteAddress,
    connectedAt: ws.connectedAt,
    lastSeenAt: ws.connectedAt,
  };
  browserClients.add(ws);
  sendJson(ws, 'welcome', { clientId: ws.clientId, state: getPublicState() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_err) {
      return;
    }
    ws.clientInfo.lastSeenAt = Date.now();
    if (msg.type !== 'action') return;
    applyAction(msg.payload || {}, { source: 'browser', clientId: ws.clientId, ws, remoteAddress: ws.remoteAddress });
  });

  ws.on('close', () => {
    browserClients.delete(ws);
    broadcastState('client_disconnected');
  });
});

function prewarmPdfWindowLocally() {
  const role = sanitizeRole(localPdfWindow.role || persistedLocalSettings.settings?.role || 'pc1');
  const pdfFile = sanitizePdfFile(localPdfWindow.pdfFile, state.pdfsByRole[role] || 'pc1.pdf');
  syncPdfWindowStateLocally({
    role,
    pdfFile,
    visible: false,
  }, () => {});
}

discoverySocket.on('message', (msg, rinfo) => {
  let parsed;
  try {
    parsed = JSON.parse(msg.toString('utf8'));
  } catch (_err) {
    return;
  }
  if (!parsed || parsed.magic !== DISCOVERY_MAGIC || parsed.type !== 'discover_request') return;
  if (!state.network.serverEnabled || !state.network.coordinator) return;

  const response = Buffer.from(JSON.stringify({
    magic: DISCOVERY_MAGIC,
    type: 'discover_response',
    coordinator: state.network.coordinator,
  }));
  try {
    discoverySocket.send(response, rinfo.port, rinfo.address);
  } catch (_err) {}
});

discoverySocket.on('error', () => {});

try {
  discoverySocket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    try { discoverySocket.setBroadcast(true); } catch (_err) {}
  });
} catch (_err) {}

app.get('/api/agent', (_req, res) => {
  res.json({ ok: true, localIps, appPort: APP_PORT, discoveryPort: DISCOVERY_PORT, hostName: os.hostname() });
});

app.get('/api/pdfs', (_req, res) => {
  res.json({ ok: true, files: getPdfFiles() });
});

app.get('/api/discover', (_req, res) => {
  const requestSocket = dgram.createSocket('udp4');
  const responses = [];
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    try { requestSocket.close(); } catch (_err) {}
    const first = responses[0]?.coordinator || null;
    res.json({ ok: true, coordinator: first, responses: responses.map((item) => item.coordinator) });
  };

  requestSocket.on('message', (msg) => {
    let parsed;
    try {
      parsed = JSON.parse(msg.toString('utf8'));
    } catch (_err) {
      return;
    }
    if (!parsed || parsed.magic !== DISCOVERY_MAGIC || parsed.type !== 'discover_response' || !parsed.coordinator) return;
    if (responses.some((item) => item.coordinator?.ip === parsed.coordinator.ip && item.coordinator?.port === parsed.coordinator.port)) return;
    responses.push(parsed);
  });

  requestSocket.on('error', () => finish());

  requestSocket.bind(0, '0.0.0.0', () => {
    try { requestSocket.setBroadcast(true); } catch (_err) {}
    const payload = Buffer.from(JSON.stringify({
      magic: DISCOVERY_MAGIC,
      type: 'discover_request',
      requestId,
      from: { hostName: os.hostname(), appPort: APP_PORT },
    }));
    for (const address of getBroadcastAddresses()) {
      try {
        requestSocket.send(payload, DISCOVERY_PORT, address);
      } catch (_err) {}
    }
    setTimeout(finish, 900);
  });
});

app.get('/api/local-settings', (_req, res) => {
  res.json({
    ok: true,
    settings: persistedLocalSettings.settings || {},
    popupTexts: persistedLocalSettings.popupTexts || {},
    savedAt: persistedLocalSettings.savedAt || null,
  });
});

app.post('/api/local-settings', (req, res) => {
  try {
    const sanitizedSettings = sanitizeLocalClientSettings(req.body?.settings || {});
    const popupTexts = req.body?.popupTexts && typeof req.body.popupTexts === 'object' ? req.body.popupTexts : {};
    const saved = persistLocalSettings({
      settings: sanitizedSettings,
      popupTexts,
    });
    applyPersistedStateSettings(sanitizedSettings);
    broadcastState('local_settings_saved');
    res.json({ ok: true, savedAt: saved.savedAt });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/api/local-settings', (_req, res) => {
  try {
    clearPersistedLocalSettings();
    applyPersistedStateSettings({});
    broadcastState('local_settings_reset');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/windows/minimize-all', (_req, res) => {
  minimizeAllWindowsLocally((error, result) => {
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }
    res.json({ ok: true, result });
  });
});

app.get('/api/pdf-window/state', (_req, res) => {
  res.json({
    ok: true,
    state: getLocalPdfWindowState(),
  });
});

app.get('/api/pdf-window/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(`event: state\ndata:${JSON.stringify({ ok: true, reason: 'init', state: getLocalPdfWindowState() })}\n\n`);
  pdfStateClients.add(res);
  req.on('close', () => {
    pdfStateClients.delete(res);
    try { res.end(); } catch (_err) {}
  });
});

app.post('/api/pdf-window/ensure', (req, res) => {
  ensurePdfWindowProcess(req.body || {}, (error, result) => {
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }
    res.json({ ok: true, result });
  });
});

app.post('/api/pdf-window/sync', (req, res) => {
  syncPdfWindowStateLocally(req.body || {}, (error, result) => {
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }
    res.json({ ok: true, result });
  });
});

app.post('/api/pdf-window/open', (req, res) => {
  syncPdfWindowStateLocally({ ...(req.body || {}), visible: true }, (error, result) => {
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }
    res.json({ ok: true, result });
  });
});

app.post('/api/pdf-window/close', (req, res) => {
  syncPdfWindowStateLocally({ ...(req.body || {}), visible: false }, (_error, result) => {
    res.json({ ok: true, result });
  });
});

app.post('/api/pdf-window/cache/clear', (_req, res) => {
  clearPdfWindowCache((error, result) => {
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }
    res.json({ ok: true, result });
  });
});

server.listen(APP_PORT, '0.0.0.0', () => {
  console.log(`Postcards app running on http://127.0.0.1:${APP_PORT}`);
  console.log(`Local IPs: ${localIps.join(', ')}`);
  ensurePdfWindowControllerExecutable();
  closeAllPdfWindowsLocally(() => setTimeout(prewarmPdfWindowLocally, 120));
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  try { closePdfWindowLocally(() => {}); } catch (_err) {}
  try { discoverySocket.close(); } catch (_err) {}
  try { server.close(); } catch (_err) {}
  process.exit(0);
}
