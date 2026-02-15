/**
 * Filter Layer
 *
 * 投稿のフィルタリングロジックを担当する。
 */

/**
 * ユーザーの表示名を解決する。
 * @param {object|null} user - ユーザーオブジェクト
 * @returns {string}
 */
function resolveDisplayName(user) {
  if (!user) return '不明';
  const name = user.display_name || user.displayName || user.name || user.nickname || '';
  if (name.trim()) return name;
  const uname = user.username || user.user_name || user.screen_name || user.id || '';
  if (String(uname).trim()) return String(uname);
  return '不明';
}

/**
 * ユーザー名を解決する。
 * @param {object|null} user - ユーザーオブジェクト
 * @returns {string}
 */
function resolveUsername(user) {
  if (!user) return '';
  return user.username || user.user_name || user.screen_name || user.id || '';
}

/**
 * アバターURLを解決する。
 * @param {object|null} user - ユーザーオブジェクト
 * @returns {string}
 */
function resolveAvatarUrl(user) {
  if (!user) return '';
  return user.avatar_url || user.avatarUrl || user.avatar || user.profile_image || '';
}

/**
 * 投稿をクエリでフィルタリングする。
 * contentの部分一致で検索。userCacheがある場合はユーザー名でも検索。
 * @param {Array} posts - 投稿配列
 * @param {string} query - 検索クエリ
 * @param {Map} [userCache] - user_id → userオブジェクトのマップ
 * @returns {Array}
 */
function filterPostsByQuery(posts, query, userCache) {
  if (!query || !query.trim()) return posts;
  const q = query.trim().toLowerCase();
  return posts.filter((post) => {
    const content = (post.content || '').toLowerCase();
    if (content.includes(q)) return true;

    // userCacheがあればユーザー名でも検索
    if (userCache && post.user_id) {
      const user = userCache.get(post.user_id);
      if (user) {
        const username = resolveUsername(user).toLowerCase();
        const displayName = resolveDisplayName(user).toLowerCase();
        if (username.includes(q) || displayName.includes(q)) return true;
      }
    }

    // post.userが直接ある場合（GET /posts/:id のレスポンス）
    if (post.user) {
      const username = resolveUsername(post.user).toLowerCase();
      const displayName = resolveDisplayName(post.user).toLowerCase();
      if (username.includes(q) || displayName.includes(q)) return true;
    }

    return false;
  });
}

// ブラウザ環境: グローバルネームスペースに登録
if (typeof window !== 'undefined') {
  window.YajuSearch = window.YajuSearch || {};
  Object.assign(window.YajuSearch, { filterPostsByQuery, resolveDisplayName, resolveUsername, resolveAvatarUrl });
}
// テスト環境: CJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { filterPostsByQuery, resolveDisplayName, resolveUsername, resolveAvatarUrl };
}
