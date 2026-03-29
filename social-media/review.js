/**
 * social-media/review.js — 自媒體素材審核（查看端）
 *
 * 職責：
 *  1. 從 URL query string 取得 itemId（?id=42）
 *  2. SSO 登入 → 讀取 SP List 項目
 *  3. 渲染：申請內容、媒體預覽、四階段進度條
 *
 * 審核方式：由 Power Automate 透過 Teams / Outlook 核准卡進行。
 * 本頁面為唯讀，僅供查看申請狀態，不提供核准 / 退回操作。
 */

import { loginIfNeeded } from '../shared/auth.js?v=12';
import * as API                          from '../shared/api.js?v=13';
import * as UI                           from '../shared/ui.js?v=11';
import { SOCIAL }                        from '../shared/config.js?v=11';

// ─── 進入點 ───────────────────────────────────────────────────────────────────

let _item   = null;   // 完整的 SP List 項目
let _fields = null;   // _item.fields 的捷徑

(async () => {
  try {
    UI.showLoading('登入中…');
    await loginIfNeeded();

    UI.showLoading('載入中…');
    await API.initSite();

    const itemId = getItemIdFromUrl();
    if (!itemId) {
      showError('URL 缺少 ?id=… 參數');
      return;
    }

    _item   = await API.getItem(SOCIAL.LIST_NAME, itemId);
    _fields = _item.fields;

    renderPage();
    UI.hideLoading();

  } catch (err) {
    UI.hideLoading();
    showError(`載入失敗：${err.message}`);
    console.error('[review] init error', err);
  }
})();

// ─── 渲染整個審核頁面 ─────────────────────────────────────────────────────────

function renderPage() {
  renderMeta();
  renderTracker();
  renderMedia();
}

// 申請資訊區
function renderMeta() {
  setText('r-title',          _fields[SOCIAL.FIELD.TITLE]          ?? '—');
  setText('r-applicant',      _fields[SOCIAL.FIELD.APPLICANT_NAME]  ?? '—');
  setText('r-location',       _fields[SOCIAL.FIELD.LOCATION]        ?? '—');
  setText('r-platform',       _fields[SOCIAL.FIELD.PLATFORM]        ?? '—');
  setText('r-post-date',      UI.formatDate(_fields[SOCIAL.FIELD.PUBLISH_DATE]));
  setText('r-caption',        _fields[SOCIAL.FIELD.CONTENT]         ?? '—');
  setText('r-submitted-at',   UI.formatDateTime(_fields[SOCIAL.FIELD.SUBMITTED_AT]));
  setText('r-item-id',        `#${_item.id}`);


  // Header card
  setText('r-header-title', _fields[SOCIAL.FIELD.TITLE] ?? '—');
  setText('r-header-id',    "#${_item.id} · 送出於 ${UI.formatDateTime(_fields[SOCIAL.FIELD.SUBMITTED_AT])}");
  const metaEl = document.getElementById('r-header-meta');
  if (metaEl) {
    const ap = _fields[SOCIAL.FIELD.APPLICANT_NAME] ?? '—';
    const lo = _fields[SOCIAL.FIELD.LOCATION]       ?? '—';
    const pl = _fields[SOCIAL.FIELD.PLATFORM]       ?? '—';
    const pd = UI.formatDate(_fields[SOCIAL.FIELD.PUBLISH_DATE]);
    metaEl.innerHTML = <span>👤 ${ap}</span><span>📍 ${lo}</span><span>🌐 ${pl}</span><span>📅 預計 ${pd} 發布</span>;
  }

}

// 進度條（含各關完成時間）
function renderTracker() {
  UI.renderTracker(
    'r-tracker',
    _fields[SOCIAL.FIELD.STAGE]  ?? '',
    _fields[SOCIAL.FIELD.STATUS] ?? '',
    {
      submit:   _fields[SOCIAL.FIELD.SUBMITTED_AT],
      stage2:   _fields[SOCIAL.FIELD.REVIEWED_AT2],
      stage3:   _fields[SOCIAL.FIELD.REVIEWED_AT3],
      stage4:   _fields[SOCIAL.FIELD.REVIEWED_AT4] || _fields[SOCIAL.FIELD.APPROVED_AT],
    },
    {
      applicant: _fields[SOCIAL.FIELD.APPLICANT_NAME] ?? '',
      reviewer2: _fields[SOCIAL.FIELD.REVIEWER2_NAME] ?? '',
      reviewer3: _fields[SOCIAL.FIELD.REVIEWER3_NAME] ?? '',
      reviewer4: _fields[SOCIAL.FIELD.REVIEWER4_NAME] ?? '',
    }
  );
  // Header status badge
  const badgeEl = document.getElementById('r-header-status');
  if (badgeEl) {
    const st = _fields[SOCIAL.FIELD.STATUS] ?? '';
    if (st === SOCIAL.STAGE.APPROVED) { badgeEl.textContent = '✅ 已核准'; badgeEl.className = 'status-badge badge-approved'; }
    else if (st === SOCIAL.STAGE.REJECTED) { badgeEl.textContent = '❌ 已退回'; badgeEl.className = 'status-badge badge-rejected'; }
    else { badgeEl.textContent = '🕐 審核中'; badgeEl.className = 'status-badge badge-pending'; }
  }
}

// 媒體預覽
function renderMedia() {
  // ── 照片 + 附件（MEDIA_PATHS）
  const rawMedia = _fields[SOCIAL.FIELD.MEDIA_PATHS];
  let mediaPaths = {};
  try { if (rawMedia) mediaPaths = JSON.parse(rawMedia); } catch { /* ignore */ }

  const photoWrap = document.getElementById('r-photos');
  if (photoWrap) {
    if (mediaPaths.photos?.length) {
      photoWrap.innerHTML = mediaPaths.photos.map(p => `
        <div style="cursor:zoom-in;" onclick="window._openLightbox('${p.url}','${p.name}')">
          <img src="${p.url}" alt="${p.name}" style="
            width:160px;height:120px;object-fit:cover;border-radius:8px;
            border:2px solid #e2e8f0;" />
          <p style="font-size:11px;color:#718096;margin-top:4px;text-align:center;">${p.name}</p>
        </div>`).join('');
    } else {
      photoWrap.innerHTML = `<span style="color:#718096;font-size:13px;">（無）</span>`;
    }
  }

  // ── 影片（VIDEO_PATHS，獨立欄位）
  const rawVideo = _fields[SOCIAL.FIELD.VIDEO_PATHS];
  let videoPaths = [];
  try { if (rawVideo) videoPaths = JSON.parse(rawVideo); } catch { /* ignore */ }

  const videoWrap = document.getElementById('r-videos');
  if (videoWrap) {
    if (videoPaths.length) {
      videoWrap.innerHTML = videoPaths.map(v => `
        <div>
          <video src="${v.url}" controls style="
            max-width:100%;border-radius:8px;border:2px solid #e2e8f0;"></video>
          <p style="font-size:11px;color:#718096;margin-top:4px;">${v.name}</p>
        </div>`).join('');
    } else {
      videoWrap.innerHTML = `<span style="color:#718096;font-size:13px;">（無）</span>`;
    }
  }

  // ── 附件
  const attachWrap = document.getElementById('r-attachments');
  if (attachWrap) {
    if (mediaPaths.attachments?.length) {
      attachWrap.innerHTML = mediaPaths.attachments.map(a => `
        <a href="${a.url}" target="_blank" style="
          display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;
          background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;
          text-decoration:none;color:#2b6cb0;font-size:13px;font-weight:500;">
          📎 ${a.name}
          <span style="font-size:11px;color:#4299e1;flex-shrink:0;">點擊開啟 ↗</span>
        </a>`).join('');
    } else {
      attachWrap.innerHTML = `<span style="color:#718096;font-size:13px;">（無）</span>`;
    }
  }
}

// 掛到 window 供 onclick 使用
window._openLightbox = UI.openLightbox;

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function getItemIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showError(msg) {
  UI.hideLoading();
  const main = document.getElementById('main-content');
  if (main) {
    main.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <div style="font-size:48px;">⚠️</div>
        <h2 style="margin-top:12px;color:#c53030;">${msg}</h2>
      </div>`;
  }
}
