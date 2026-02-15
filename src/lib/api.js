/**
 * API Layer
 *
 * ヤジュッターAPIとの通信を担当する。
 * 各関数はfetch依存を外部から注入可能にし、テスト容易性を確保する。
 */

const API_BASE = 'https://yajutter.yajuvideo.in/api/yajutter';

function authHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * 投稿一覧を1ページ分取得する。
 * @param {number} page - ページ番号
 * @param {string} apiKey - APIキー
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - AbortController用signal
 * @returns {Promise<{posts: Array, meta: {current_page: number, next_page: number|null, prev_page: number|null, total_pages: number, total_count: number}}>}
 */
async function fetchPostsPage(page, apiKey, options = {}) {
  const url = `${API_BASE}/posts?page=${page}`;
  const res = await fetch(url, {
    headers: authHeaders(apiKey),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const posts = extractPostArray(json);
  const meta = json.meta || null;
  return { posts, meta };
}

/**
 * 投稿の詳細を取得する（ユーザー情報付き）。
 * @param {number} id - 投稿ID
 * @param {string} apiKey - APIキー
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object|null>}
 */
async function fetchPostDetail(id, apiKey, options = {}) {
  const url = `${API_BASE}/posts/${id}`;
  const res = await fetch(url, {
    headers: authHeaders(apiKey),
    signal: options.signal,
  });
  if (!res.ok) return null;
  return await res.json();
}

/**
 * ユーザー情報を取得する（完全一致）。
 * @param {string} username - ユーザー名
 * @param {string} apiKey - APIキー
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object|null>}
 */
async function fetchUser(username, apiKey, options = {}) {
  const url = `${API_BASE}/users/${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: authHeaders(apiKey),
    signal: options.signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`User API error: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * APIレスポンスから投稿配列を抽出する。
 * @param {*} response
 * @returns {Array}
 */
function extractPostArray(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.posts)) return response.posts;
  if (Array.isArray(response.results)) return response.results;
  return [];
}

// ブラウザ環境: グローバルネームスペースに登録
if (typeof window !== 'undefined') {
  window.YajuSearch = window.YajuSearch || {};
  Object.assign(window.YajuSearch, { fetchPostsPage, fetchPostDetail, fetchUser, extractPostArray, authHeaders, API_BASE });
}
// テスト環境: CJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchPostsPage, fetchPostDetail, fetchUser, extractPostArray, authHeaders, API_BASE };
}
