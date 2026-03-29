/**
 * config.js — 全站共用常數
 * 所有表單共用：AUTH / TENANT / SP Host
 * 每個表單的專屬路徑放在各自的 form.js / review.js 最頂端
 */

// ─── Azure AD ────────────────────────────────────────────────────────────────
export const CLIENT_ID  = 'fd92f9c5-6ff7-4e6a-b126-1e11615cdb72';
export const TENANT_ID  = '6cfd6e7d-2a19-4221-9694-84d6e95ede87';
export const AUTHORITY  = `https://login.microsoftonline.com/${TENANT_ID}`;

// ─── Microsoft Graph scopes ──────────────────────────────────────────────────
// 使用 Graph API 存取 SharePoint / Files / User
export const GRAPH_SCOPES = [
  'User.Read',
  'Sites.ReadWrite.All',
  'Files.ReadWrite.All',
];

// ─── SharePoint ───────────────────────────────────────────────────────────────
export const SP_HOST      = 'fetcb107004.sharepoint.com';
export const SP_SITE_PATH = '/sites/technology';          // 目前使用的 SP 網站
export const SP_SITE_URL  = `https://${SP_HOST}${SP_SITE_PATH}`;

// Graph API 根端點
export const GRAPH_BASE   = 'https://graph.microsoft.com/v1.0';

// ─── 自媒體素材審核 — 表單專屬常數 ──────────────────────────────────────────
// （如未來新增其他表單，將其常數另放在該表單的 form.js）
export const SOCIAL = {
  /** SP 清單名稱 */
  LIST_NAME: '自媒體素材審核資料',

  /** SiteAssets 下的媒體存放根目錄 */
  MEDIA_ROOT: '自媒體素材審核',

  /** 審核路由表 Excel（相對於 SiteAssets/） */
  ROUTE_TABLE_PATH: '自媒體素材審核/審核路由表.xlsx',

  /** 勞工名冊 Excel（相對於 SiteAssets/，全表單共用） */
  ROSTER_PATH: 'mjmotor-forms/_config/勞工名冊讀取檔案.xlsx',

  /** 支援的照片副檔名（轉小寫後比對） */
  PHOTO_EXTS: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'],

  /** 支援的影片副檔名 */
  VIDEO_EXTS: ['mp4', 'mov', 'avi', 'mkv', 'webm'],

  /** 支援的附件副檔名 */
  ATTACH_EXTS: ['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'txt'],

  /** 審核階段代碼（與 SP 欄位值一致） */
  STAGE: {
    DRAFT:    '草稿',
    PENDING:  '送審',          // 申請人送出，等待所長
    STAGE2:   '第二階段',      // 所長審核中
    STAGE3:   '第三階段',      // 行銷審核中
    STAGE4:   '第四階段',      // 部長審核中
    APPROVED: '已核准',
    REJECTED: '已退回',
    RESUBMIT: '重新送審',
  },

  /** SP List 欄位名（internal name，與 SP List 實際欄位一致） */
  FIELD: {
    TITLE:          'Title',
    APPLICANT_NAME: 'ApplicantName',
    APPLICANT_EMAIL:'ApplicantEmail',
    LOCATION:       'Location',
    PLATFORM:       'Platform',
    PUBLISH_DATE:   'PublishDate',   // 預計發布日期
    CONTENT:        'Content',       // 素材內容說明（貼文內容）
    STAGE:          'Stage',         // 審核階段（內部流程用）
    STATUS:         'Status',        // 審核狀態（對外顯示用）
    // 各關審核人
    REVIEWER2_NAME:  'Reviewer2Name',
    REVIEWER2_EMAIL: 'Reviewer2Email',
    REVIEWER3_NAME:  'Reviewer3Name',
    REVIEWER3_EMAIL: 'Reviewer3Email',
    REVIEWER4_NAME:  'Reviewer4Name',
    REVIEWER4_EMAIL: 'Reviewer4Email',
    // 媒體檔案路徑（JSON 字串，含照片 / 附件）
    MEDIA_PATHS:    'MediaPaths',
    // 影片（獨立欄位，JSON 字串 [{name, url}]）
    VIDEO_PATHS:    'VideoPaths',
    // 各關意見
    COMMENT2:       'Comment2',
    COMMENT3:       'Comment3',
    COMMENT4:       'Comment4',
    // 時間戳
    SUBMITTED_AT:   'SubmittedAt',
    REVIEWED_AT2:   'ReviewedAt2',   // 所長完成時間
    REVIEWED_AT3:   'ReviewedAt3',   // 行銷完成時間
    REVIEWED_AT4:   'ReviewedAt4',   // 部長完成時間
    APPROVED_AT:    'ApprovedAt',
  },

  /** MSAL redirect URI（本機 dev 與 GitHub Pages 共用同一份設定，兩個都要加到 Azure AD） */
  REDIRECT_URIS: [
    'http://localhost:5500',
    'https://davincichou.github.io/mjmotor-forms',
  ],
};
