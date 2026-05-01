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

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'e' || key === 'у') {
    event.preventDefault();
    toggleEditing();
  }
  if (!editing && event.key === 'ArrowLeft') pushPage(popupState.page - 1);
  if (!editing && event.key === 'ArrowRight') pushPage(popupState.page + 1);
});

window.addEventListener('beforeunload', () => {
  persistCurrentText();
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'popup_closed', payload: { token: popupState.token } }, location.origin);
    }
  } catch (_) {}
});

render();
