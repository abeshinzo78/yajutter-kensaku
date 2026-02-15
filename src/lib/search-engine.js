/**
 * Search Engine
 *
 * プログレッシブ検索を担当する。
 * ページを順次フェッチしながらフィルタリングし、結果が見つかり次第コールバックで通知する。
 */

const CONCURRENT_PAGES = 3;
const MAX_RESULTS = 20;

/**
 * プログレッシブ検索を実行する。
 * @param {string} query - 検索クエリ
 * @param {object} deps - 依存関係
 * @param {function} deps.fetchPostsPage - (page, apiKey, options) => {posts, meta}
 * @param {string} deps.apiKey
 * @param {object} deps.postsCache - createPostsCache()の戻り値
 * @param {object} deps.userCache - createUserCache()の戻り値
 * @param {function} deps.filterPostsByQuery - (posts, query, userCacheMap) => filteredPosts
 * @param {AbortSignal} [deps.signal] - AbortController用signal
 * @param {object} [callbacks]
 * @param {function} [callbacks.onResults] - (results, progress) => void 結果が見つかるたびに呼ばれる
 * @param {function} [callbacks.onProgress] - (currentPage, totalPages) => void 進捗通知
 * @param {function} [callbacks.onComplete] - (allResults, totalPosts) => void 完了時
 * @param {function} [callbacks.onError] - (error) => void エラー時
 * @returns {Promise<Array>}
 */
async function progressiveSearch(query, deps, callbacks = {}) {
  const { fetchPostsPage, apiKey, postsCache, userCache, filterPostsByQuery, signal } = deps;
  const { onResults, onProgress, onComplete, onError } = callbacks;

  const allResults = [];
  const userCacheMap = userCache ? userCache.getMap() : new Map();

  // キャッシュがある場合は即座にフィルタリング
  const cached = postsCache.get();
  if (cached) {
    const filtered = filterPostsByQuery(cached, query, userCacheMap);
    allResults.push(...filtered);
    if (onResults) onResults(allResults, { fromCache: true });
    if (onComplete) onComplete(allResults, cached.length);
    return allResults;
  }

  // キャッシュがない場合はプログレッシブフェッチ
  let totalPages = null;
  let currentPage = 1;
  let totalPostsFetched = 0;
  const allPostsForCache = [];

  try {
    // 最初のページをフェッチしてtotal_pagesを取得
    const first = await fetchPostsPage(1, apiKey, { signal });
    if (signal && signal.aborted) return allResults;

    totalPages = first.meta ? first.meta.total_pages : null;
    allPostsForCache.push(...first.posts);
    totalPostsFetched += first.posts.length;

    const filtered = filterPostsByQuery(first.posts, query, userCacheMap);
    allResults.push(...filtered);

    if (onProgress) onProgress(1, totalPages);
    if (filtered.length > 0 && onResults) onResults(allResults, { fromCache: false });

    currentPage = 2;

    // 残りのページを並列フェッチ（全ページ取得してキャッシュの完全性を保証）
    while (totalPages && currentPage <= totalPages) {
      if (signal && signal.aborted) break;

      const batch = [];
      for (let i = 0; i < CONCURRENT_PAGES && currentPage <= totalPages; i++) {
        batch.push(currentPage);
        currentPage++;
      }

      const results = await Promise.all(
        batch.map(page => fetchPostsPage(page, apiKey, { signal }).catch(() => ({ posts: [], meta: null })))
      );
      if (signal && signal.aborted) break;

      for (const result of results) {
        allPostsForCache.push(...result.posts);
        totalPostsFetched += result.posts.length;
        const filtered = filterPostsByQuery(result.posts, query, userCacheMap);
        allResults.push(...filtered);
      }

      if (onProgress) onProgress(currentPage - 1, totalPages);
      if (onResults) onResults(allResults, { fromCache: false });
    }

    // キャッシュに保存
    const meta = totalPages ? { total_pages: totalPages, total_count: totalPostsFetched } : null;
    postsCache.set(allPostsForCache, meta);

    if (onComplete) onComplete(allResults, totalPostsFetched);
  } catch (err) {
    if (err.name === 'AbortError') return allResults;
    if (onError) onError(err);
    throw err;
  }

  return allResults;
}

// ブラウザ環境: グローバルネームスペースに登録
if (typeof window !== 'undefined') {
  window.YajuSearch = window.YajuSearch || {};
  Object.assign(window.YajuSearch, { progressiveSearch, CONCURRENT_PAGES, MAX_RESULTS });
}
// テスト環境: CJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { progressiveSearch, CONCURRENT_PAGES, MAX_RESULTS };
}
