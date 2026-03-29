/**
 * auth.js — MSAL v2 singleton
 *
 * 使用方式：
 *   import { loginIfNeeded, getToken, getCurrentUser } from './shared/auth.js';
 *
 *   await loginIfNeeded();          // 確保已登入
 *   const token = await getToken(); // 取得 Graph token
 *   const user  = getCurrentUser(); // { name, email, account }
 */

import { CLIENT_ID, AUTHORITY, GRAPH_SCOPES } from './config.js?v=4';

// ─── MSAL 設定 ────────────────────────────────────────────────────────────────
const msalConfig = {
  auth: {
    clientId:    CLIENT_ID,
    authority:   AUTHORITY,
    redirectUri: window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/'),
  },
  cache: {
    cacheLocation:        'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

// ─── Singleton 實例 ───────────────────────────────────────────────────────────
let _msalInstance = null;
let _account      = null;

function getMsal() {
  if (!_msalInstance) {
    _msalInstance = new msal.PublicClientApplication(msalConfig);
  }
  return _msalInstance;
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/**
 * 完成初始化並確保使用者已登入。
 * 必須在所有其他 auth/api 呼叫前 await 完成。
 */
export async function loginIfNeeded() {
  const instance = getMsal();

  // 處理 redirect 回調（頁面剛從 Microsoft 登入頁跳回來）
  const response = await instance.handleRedirectPromise();
  if (response) {
    _account = response.account;
    instance.setActiveAccount(_account);
    return;
  }

  // 已有快取帳號
  const accounts = instance.getAllAccounts();
  if (accounts.length > 0) {
    _account = accounts[0];
    instance.setActiveAccount(_account);
    return;
  }

  // 沒有帳號 → 跳轉 Microsoft 登入頁
  await instance.loginRedirect({ scopes: GRAPH_SCOPES });
  // loginRedirect 會離開頁面，下方程式不會繼續執行
}

/**
 * 取得 Graph API access token（自動 silent refresh）
 * @returns {Promise<string>}
 */
export async function getToken() {
  const instance = getMsal();
  const account  = _account ?? instance.getActiveAccount();
  if (!account) throw new Error('[auth] 尚未登入，請先呼叫 loginIfNeeded()');

  try {
    const result = await instance.acquireTokenSilent({
      scopes:  GRAPH_SCOPES,
      account,
    });
    return result.accessToken;
  } catch (err) {
    // silent 失敗（token 過期 / consent 不足）→ 彈出視窗或 redirect
    if (err instanceof msal.InteractionRequiredAuthError) {
      const result = await instance.acquireTokenPopup({ scopes: GRAPH_SCOPES });
      return result.accessToken;
    }
    throw err;
  }
}

/**
 * 取得目前登入使用者資訊
 * @returns {{ name: string, email: string, account: object } | null}
 */
export function getCurrentUser() {
  const instance = getMsal();
  const account  = _account ?? instance.getActiveAccount();
  if (!account) return null;
  return {
    name:    account.name  ?? '',
    email:   account.username ?? '',
    account,
  };
}

/**
 * 登出目前使用者
 */
export async function logout() {
  const instance = getMsal();
  await instance.logoutRedirect();
}
