/**
 * ui.js — 通用 UI 元件
 *
 * 包含：
 *  - showToast / showError
 *  - showLoading / hideLoading
 *  - renderTracker（四階段審核進度條）
 *  - openLightbox（圖片燈箱）
 *  - formatDate / formatDateTime
 *
 * 使用方式：
 *   import * as UI from '../shared/ui.js';
 *   UI.showToast('送出成功！');
 *   UI.renderTracker('tracker', item.fields.ReviewStage, item.fields.ReviewStatus);
 */

import { SOCIAL } from './config.js';

// ─── Toast ────────────────────────────────────────────────────────────────────

/**
 * 顯示右下角 Toast 訊息
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} [type]
 * @param {number} [duration]  毫秒，預設 3500
 */
export function showToast(message, type = 'success', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9999;
      display:flex;flex-direction:column;gap:10px;pointer-events:none;`;
    document.body.appendChild(container);
  }

  const colors = {
    success: { bg: '#38a169', icon: '✓' },
    error:   { bg: '#e53e3e', icon: '✕' },
    info:    { bg: '#3182ce', icon: 'ℹ' },
    warning: { bg: '#d69e2e', icon: '⚠' },
  };
  const c = colors[type] ?? colors.info;

  const toast = document.createElement('div');
  toast.style.cssText = `
    display:flex;align-items:center;gap:10px;
    background:${c.bg};color:#fff;
    padding:12px 18px;border-radius:10px;
    font-size:14px;font-family:'Microsoft JhengHei',sans-serif;
    box-shadow:0 4px 16px rgba(0,0,0,.22);
    pointer-events:auto;
    opacity:0;transform:translateY(12px);
    transition:opacity .25s,transform .25s;`;
  toast.innerHTML = `<span style="font-size:16px">${c.icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  // 動畫進入
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // 動畫離開 + 移除
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function showError(message) {
  showToast(message, 'error', 5000);
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

let _loadingEl = null;

export function showLoading(text = '載入中…') {
  if (!_loadingEl) {
    _loadingEl = document.createElement('div');
    _loadingEl.id = 'loading-overlay';
    _loadingEl.style.cssText = `
      position:fixed;inset:0;background:rgba(255,255,255,.75);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      z-index:10000;font-family:'Microsoft JhengHei',sans-serif;`;
    _loadingEl.innerHTML = `
      <div class="spinner" style="
        width:44px;height:44px;border:4px solid #e2e8f0;
        border-top-color:#3182ce;border-radius:50%;
        animation:spin .8s linear infinite;"></div>
      <p id="loading-text" style="margin-top:14px;color:#4a5568;font-size:15px"></p>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(_loadingEl);
  }
  _loadingEl.querySelector('#loading-text').textContent = text;
  _loadingEl.style.display = 'flex';
}

export function hideLoading() {
  if (_loadingEl) _loadingEl.style.display = 'none';
}

// ─── 四階段審核進度條 ─────────────────────────────────────────────────────────

/**
 * 四個步驟定義
 */
const TRACKER_STEPS = [
  { key: 'submit',   label: '申請人送出' },
  { key: 'stage2',   label: '所長審核'   },
  { key: 'stage3',   label: '行銷審核'   },
  { key: 'stage4',   label: '部長審核'   },
];

/**
 * 根據 reviewStage / reviewStatus 計算目前所在步驟 index（0-based）
 */
function calcActiveStep(stage, status) {
  if (status === SOCIAL.STAGE.APPROVED) return 4;   // 全部完成
  if (status === SOCIAL.STAGE.REJECTED) {
    // 退回時停在哪一關
    const map = {
      [SOCIAL.STAGE.STAGE2]: 1,
      [SOCIAL.STAGE.STAGE3]: 2,
      [SOCIAL.STAGE.STAGE4]: 3,
    };
    return map[stage] ?? 1;
  }
  const map = {
    [SOCIAL.STAGE.PENDING]:  0,  // 剛送出，等所長
    [SOCIAL.STAGE.STAGE2]:   1,
    [SOCIAL.STAGE.STAGE3]:   2,
    [SOCIAL.STAGE.STAGE4]:   3,
  };
  return map[stage] ?? 0;
}

/**
 * 渲染進度條到指定容器
 * @param {string|HTMLElement} containerOrId  容器 id 或元素
 * @param {string} stage   fields.ReviewStage
 * @param {string} status  fields.ReviewStatus
 * @param {object} [timestamps]  各關完成時間 { submit, stage2, stage3, stage4, approved }
 *   每個值為 ISO 字串，有值才顯示，沒有值就不顯示
 */
export function renderTracker(containerOrId, stage, status, timestamps = {}, names = {}) {
  const container = typeof containerOrId === 'string'
    ? document.getElementById(containerOrId)
    : containerOrId;
  if (!container) return;

  const activeStep = calcActiveStep(stage, status);
  const rejected   = status === SOCIAL.STAGE.REJECTED;
  const approved   = status === SOCIAL.STAGE.APPROVED;

  // timestamps 對應各步驟
  const stepTimestamps = [
    timestamps.submit,
    timestamps.stage2,
    timestamps.stage3,
    timestamps.stage4 || timestamps.approved,
  ];

  container.innerHTML = '';
  container.style.cssText = `
    display:flex;align-items:flex-start;justify-content:center;
    gap:0;padding:20px 0 12px;`;

  TRACKER_STEPS.forEach((step, idx) => {
    const isDone    = activeStep > idx || approved;
    const isActive  = activeStep === idx && !approved;
    const isReject  = rejected && activeStep === idx;
    const ts        = stepTimestamps[idx];

    // 節點外層
    const nodeWrap = document.createElement('div');
    nodeWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;flex:1;min-width:76px;';

    const circle = document.createElement('div');
    let circleStyle = `
      width:38px;height:38px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:18px;font-weight:700;transition:all .3s;
      border:3px solid `;

    if (isReject) {
      circle.style.cssText = circleStyle + `#e53e3e;background:#e53e3e;color:#fff;`;
      circle.textContent = '✕';
    } else if (isDone) {
      circle.style.cssText = circleStyle + `#38a169;background:#38a169;color:#fff;`;
      circle.textContent = '✓';
    } else if (isActive) {
      circle.style.cssText = circleStyle + `#3182ce;background:#ebf8ff;color:#3182ce;`;
      circle.textContent = String(idx + 1);
      circle.style.animation = 'trackerPulse 1.5s ease-in-out infinite';
    } else {
      circle.style.cssText = circleStyle + `#cbd5e0;background:#f7fafc;color:#a0aec0;`;
      circle.textContent = String(idx + 1);
    }

    // 步驟標籤
    const label = document.createElement('div');
    label.style.cssText = `
      margin-top:8px;font-size:12px;text-align:center;
      color:${isReject ? '#e53e3e' : isActive ? '#3182ce' : isDone ? '#2d3748' : '#a0aec0'};
      font-weight:${isActive || isDone || isReject ? '600' : '400'};
      font-family:'Microsoft JhengHei',sans-serif;`;
    label.textContent = step.label;

    // 審核人姓名
    const nameKeys = ['applicant', 'reviewer2', 'reviewer3', 'reviewer4'];
    const nameText = document.createElement('div');
    const personName = names[nameKeys[idx]] ?? '';
    if (personName) {
      nameText.style.cssText = 'margin-top:2px;font-size:11px;color:#4a5568;text-align:center;font-weight:500;';
      nameText.textContent = personName;
    }

    // 狀態文字（審核中 / 退回）
    const statusText = document.createElement('div');
    statusText.style.cssText = 'margin-top:3px;font-size:11px;font-weight:600;text-align:center;';
    if (isReject) {
      statusText.style.color = '#e53e3e';
      statusText.textContent = '退回';
    } else if (isActive) {
      statusText.style.color = '#3182ce';
      statusText.textContent = '審核中';
    }

    // 日期時間（已完成的步驟才顯示）
    const timeText = document.createElement('div');
    timeText.style.cssText = `
      margin-top:4px;font-size:10.5px;color:#a0aec0;text-align:center;
      white-space:nowrap;line-height:1.4;`;
    if (ts && (isDone || isReject)) {
      const d = new Date(ts);
      if (!isNaN(d)) {
        const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        timeText.innerHTML = `${dateStr}<br>${timeStr}`;
      }
    }

    nodeWrap.appendChild(circle);
    nodeWrap.appendChild(label);
    if (personName) nodeWrap.appendChild(nameText);
    if (isReject || isActive) nodeWrap.appendChild(statusText);
    nodeWrap.appendChild(timeText);

    container.appendChild(nodeWrap);

    // 連接線（最後一個節點不加）
    if (idx < TRACKER_STEPS.length - 1) {
      const line = document.createElement('div');
      line.style.cssText = `
        flex:1;height:3px;margin-top:19px;max-width:80px;
        background:${isDone ? '#38a169' : '#e2e8f0'};
        transition:background .3s;`;
      container.appendChild(line);
    }
  });

  // 完成提示
  const oldNote = container.parentElement?.querySelector('.tracker-done-note');
  oldNote?.remove();
  if (approved) {
    const doneNote = document.createElement('p');
    doneNote.className = 'tracker-done-note';
    doneNote.style.cssText = `
      text-align:center;color:#38a169;font-weight:700;margin-top:6px;
      font-size:14px;font-family:'Microsoft JhengHei',sans-serif;`;
    doneNote.textContent = '✓ 審核已核准，可進行發布';
    container.insertAdjacentElement('afterend', doneNote);
  }

  // keyframes（只插一次）
  if (!document.getElementById('tracker-style')) {
    const style = document.createElement('style');
    style.id = 'tracker-style';
    style.textContent = `@keyframes trackerPulse {
      0%,100%{box-shadow:0 0 0 0 rgba(49,130,206,.35)}
      50%{box-shadow:0 0 0 7px rgba(49,130,206,0)}
    }`;
    document.head.appendChild(style);
  }
}

// ─── 圖片燈箱 ─────────────────────────────────────────────────────────────────

let _lightboxEl = null;

/**
 * 開啟圖片燈箱
 * @param {string} src  圖片 URL
 * @param {string} [alt]
 */
export function openLightbox(src, alt = '') {
  if (!_lightboxEl) {
    _lightboxEl = document.createElement('div');
    _lightboxEl.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.85);
      display:none;align-items:center;justify-content:center;
      z-index:20000;cursor:zoom-out;`;
    _lightboxEl.innerHTML = `
      <img id="lightbox-img" style="
        max-width:92vw;max-height:92vh;object-fit:contain;
        border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);" />`;
    _lightboxEl.addEventListener('click', closeLightbox);
    document.body.appendChild(_lightboxEl);
  }
  _lightboxEl.querySelector('#lightbox-img').src = src;
  _lightboxEl.querySelector('#lightbox-img').alt = alt;
  _lightboxEl.style.display = 'flex';
}

export function closeLightbox() {
  if (_lightboxEl) _lightboxEl.style.display = 'none';
}

// ─── 日期格式化 ───────────────────────────────────────────────────────────────

/**
 * 將 ISO 字串格式化為 YYYY/MM/DD
 */
export function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d)) return '—';
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * 將 ISO 字串格式化為 YYYY/MM/DD HH:MM
 */
export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d)) return '—';
  return `${formatDate(isoStr)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ─── 表單驗證提示 ─────────────────────────────────────────────────────────────

/**
 * 標記 input 為錯誤狀態
 */
export function markInvalid(el, message) {
  el.style.borderColor = '#fc8181';
  let hint = el.parentElement.querySelector('.field-error');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'field-error';
    hint.style.cssText = 'color:#e53e3e;font-size:12px;margin-top:4px;';
    el.parentElement.appendChild(hint);
  }
  hint.textContent = message;
}

export function clearInvalid(el) {
  el.style.borderColor = '';
  const hint = el.parentElement?.querySelector('.field-error');
  if (hint) hint.remove();
}
