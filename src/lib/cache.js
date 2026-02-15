/**
 * Cache Layer
 *
 * 投稿キャッシュとユーザー情報キャッシュを管理する。
 */

const DEFAULT_CACHE_TTL = 300000; // 5分

/**
 * PostsCacheを作成する。
 * @param {number} [ttl] - キャッシュ有効期間（ミリ秒）
 * @returns {object}
 */
function createPostsCache(ttl = DEFAULT_CACHE_TTL) {
  let posts = null;
  let timestamp = 0;
  let totalPages = null;

  return {
    get() {
      if (posts && (Date.now() - timestamp) < ttl) {
        return posts;
      }
      return null;
    },

    set(newPosts, meta) {
      posts = newPosts;
      timestamp = Date.now();
      if (meta && meta.total_pages) {
        totalPages = meta.total_pages;
      }
    },

    append(newPosts) {
      if (!posts) posts = [];
      posts.push(...newPosts);
      timestamp = Date.now();
    },

    getTotalPages() {
      return totalPages;
    },

    clear() {
      posts = null;
      timestamp = 0;
      totalPages = null;
    },

    isFresh() {
      return posts !== null && (Date.now() - timestamp) < ttl;
    },

    getTimestamp() {
      return timestamp;
    },

    size() {
      return posts ? posts.length : 0;
    },
  };
}

/**
 * UserCacheを作成する。
 * user_id → ユーザーオブジェクトのマップ。
 * @returns {Map}
 */
function createUserCache() {
  const cache = new Map();

  return {
    get(userId) {
      return cache.get(userId) || null;
    },

    set(userId, user) {
      cache.set(userId, user);
    },

    has(userId) {
      return cache.has(userId);
    },

    getMap() {
      return cache;
    },

    size() {
      return cache.size;
    },

    clear() {
      cache.clear();
    },
  };
}

// ブラウザ環境: グローバルネームスペースに登録
if (typeof window !== 'undefined') {
  window.YajuSearch = window.YajuSearch || {};
  Object.assign(window.YajuSearch, { createPostsCache, createUserCache, DEFAULT_CACHE_TTL });
}
// テスト環境: CJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPostsCache, createUserCache, DEFAULT_CACHE_TTL };
}
