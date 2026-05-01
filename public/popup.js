const frontImage = document.getElementById('frontImage');
const backImage = document.getElementById('backImage');
const pageTitle = document.getElementById('pageTitle');
const pageCounter = document.getElementById('pageCounter');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const popupShell = document.getElementById('popupShell');
const leftSideText = document.getElementById('leftSideText');
const leftBottomText = document.getElementById('leftBottomText');
const rightSideText = document.getElementById('rightSideText');
const rightBottomText = document.getElementById('rightBottomText');

let popupState = { role: 'pc1', page: 0, visible: false, popupEpoch: 0, token: null };
let editing = false;

function textKey(role, page, box) {
  return `popup_text_v5_${role}_${page}_${box}`;
}

function getText(role, page, box) {
  return localStorage.getItem(textKey(role, page, box)) || '';
}

function setText(role, page, box, value) {
  localStorage.setItem(textKey(role, page, box), value);
}

function syncEditableState() {
  [leftSideText, leftBottomText, rightSideText, rightBottomText].forEach((el) => {
    el.contentEditable = editing ? 'true' : 'false';
  });
  document.body.classList.toggle('editing', editing);
}

function fallbackText(page) {
  return localStorage.getItem(`popup_text_v4_pc1_${page}_left`) || '';
}

function render() {
  const page = Math.max(0, Math.min(7, Number(popupState.page) || 0));
  pageTitle.textContent = `Разворот ${page + 1}`;
  pageCounter.textContent = `${page + 1} / 8`;
  frontImage.src = `/assets/images/front/${page + 1}.png`;
  backImage.src = `/assets/images/back/${page + 1}.png`;
  leftSideText.textContent = getText(popupState.role, page, 'left_side') || fallbackText(page);
  leftBottomText.textContent = getText(popupState.role, page, 'left_bottom');
  rightSideText.textContent = getText(popupState.role, page, 'right_side') || getText(popupState.role, page, 'right');
  rightBottomText.textContent = getText(popupState.role, page, 'right_bottom');
  syncEditableState();
}

function persistCurrentText() {
  setText(popupState.role, popupState.page, 'left_side', leftSideText.textContent || '');
  setText(popupState.role, popupState.page, 'left_bottom', leftBottomText.textContent || '');
  setText(popupState.role, popupState.page, 'right_side', rightSideText.textContent || '');
  setText(popupState.role, popupState.page, 'right_bottom', rightBottomText.textContent || '');
}

function pushPage(page) {
  persistCurrentText();
  popupState.page = Math.max(0, Math.min(7, Number(page) || 0));
  render();
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'set_popup_page_from_popup', payload: { page: popupState.page } }, location.origin);
  }
}

function toggleEditing() {
  editing = !editing;
  syncEditableState();
  if (editing) {
    leftSideText.focus();
  } else {
    persistCurrentText();
  }
}

[leftSideText, leftBottomText, rightSideText, rightBottomText].forEach((el) => {
  el.addEventListener('input', persistCurrentText);
  el.addEventListener('blur', persistCurrentText);
});

prevPageBtn.addEventListener('click', () => pushPage(popupState.page - 1));
nextPageBtn.addEventListener('click', () => pushPage(popupState.page + 1));

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const msg = event.data;
  if (msg.type === 'popup_state') {
    persistCurrentText();
    popupState = { ...popupState, ...msg.payload };
    popupShell.classList.remove('closing');
    render();
  }
  if (msg.type === 'close_popup') {
    persistCurrentText();
    popupShell.classList.add('closing');
    setTimeout(() => {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'popup_closed', payload: { token: popupState.token } }, location.origin);
        }
      } catch (_) {}
      window.close();
    }, 220);
  }
});

function isServerPc() {
  try {
    const raw = JSON.parse(localStorage.getItem('postcards_strict_settings_v8') || '{}');
    return Boolean(raw.wantsServer);
  } catch (_err) { return false; }
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const serverPc = isServerPc();

  // Редактирование — только на сервере
  if ((key === 'e' || key === 'у') && serverPc) {
    event.preventDefault();
    toggleEditing();
    return;
  }
  // Стрелки — только на сервере (на клиенте пусть посетитель не листает)
  if (!editing && serverPc && event.key === 'ArrowLeft') pushPage(popupState.page - 1);
  if (!editing && serverPc && event.key === 'ArrowRight') pushPage(popupState.page + 1);

  // Блок вредных клавиш на всех ПК
  if (event.key === 'F5' || event.key === 'F11' || event.key === 'F12') { event.preventDefault(); return; }
  if (event.ctrlKey && event.shiftKey && (key === 'i' || key === 'j' || key === 'c')) { event.preventDefault(); return; }
  if (event.ctrlKey && (key === 'u' || key === 'p' || key === 's' || key === 'w' || key === 'r')) { event.preventDefault(); return; }
  if (event.key === 'Backspace') {
    const t = event.target;
    const isEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!isEditable) event.preventDefault();
  }
});

// Глобальные блокировки в попапе
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());
window.addEventListener('selectstart', (e) => {
  if (document.body.classList.contains('editing')) return;
  e.preventDefault();
});
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
window.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('gesturechange', (e) => e.preventDefault());

window.addEventListener('beforeunload', () => {
  persistCurrentText();
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'popup_closed', payload: { token: popupState.token } }, location.origin);
    }
  } catch (_) {}
});

render();
