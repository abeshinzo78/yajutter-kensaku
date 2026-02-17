/**
 * ヤジュッター検索 Content Script v3
 *
 * Injected into yajutter.yajuvideo.in pages.
 * - Injects search bar into the site header (right of "ヤジュッター" logo)
 * - Progressively fetches & filters posts with caching
 * - Shows results in dropdown overlay with user info enrichment
 * - IME-safe (compositionstart/end)
 *
 * Depends on: lib/api.js, lib/filter.js, lib/cache.js, lib/search-engine.js
 * (loaded before this file via manifest.json content_scripts)
 */
(function () {
  'use strict';

  // ============================================================
  // Import from YajuSearch namespace (populated by lib/*.js)
  // ============================================================
  const {
    fetchPostsPage, fetchPostDetail, fetchUser,
    filterPostsByQuery, resolveDisplayName, resolveUsername, resolveAvatarUrl,
    createPostsCache, createUserCache,
    progressiveSearch,
  } = window.YajuSearch;

  const SITE_BASE = 'https://yajutter.yajuvideo.in';
  const LOG_PREFIX = '[ヤジュッター検索]';

  // ============================================================
  // State
  // ============================================================
  let apiKey = '';
  let isComposing = false;
  let debounceId = null;
  let currentAbortController = null;

  const postsCache = createPostsCache();
  const userCache = createUserCache();

  // ============================================================
  // Init
  // ============================================================
  function init() {
    log('拡張機能を初期化中...');
    loadApiKey().then((key) => {
      apiKey = key;
      if (apiKey) {
        log('APIキー読み込み済み');
      } else {
        log('APIキーが未設定です');
      }
      injectSearchBar();
    });
  }

  // ============================================================
  // Header detection
  // ============================================================
  function findHeader() {
    const navs = document.querySelectorAll('nav, header, [class*="nav"], [class*="header"], [class*="Navbar"], [class*="navbar"]');
    for (const el of navs) {
      const text = el.textContent || '';
      if (text.includes('ヤジュッター')) {
        log('ヘッダーを発見 (nav/header要素):', el.tagName, el.className);
        return el;
      }
    }

    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length > 0 && el.textContent?.includes('ヤジュッター')) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 80 && rect.width > window.innerWidth * 0.5 && rect.height < 100 && rect.height > 20) {
          log('ヘッダーを発見 (位置ベース):', el.tagName, el.className);
          return el;
        }
      }
    }

    log('ヘッダーが見つかりませんでした。フォールバック使用');
    return null;
  }

  function findBrandElement(header) {
    const candidates = header.querySelectorAll('a, span, div, h1, h2, p');
    for (const el of candidates) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');
      if (directText.includes('ヤジュッター') || el.textContent?.trim() === 'ヤジュッター') {
        const rect = el.getBoundingClientRect();
        if (rect.width < 300) {
          log('ブランド要素を発見:', el.tagName, el.textContent?.trim());
          return el;
        }
      }
    }
    return null;
  }

  // ============================================================
  // Inject search bar
  // ============================================================
  function injectSearchBar() {
    if (document.querySelector('.yaju-search-container')) {
      log('検索バーは既に注入済み');
      return;
    }

    const header = findHeader();
    if (!header) {
      log('ヘッダーが見つからないため、MutationObserverで待機します');
      waitForHeader();
      return;
    }

    const brand = findBrandElement(header);

    const container = document.createElement('div');
    container.className = 'yaju-search-container';

    const wrap = document.createElement('div');
    wrap.className = 'yaju-search-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'yaju-search-input';
    input.placeholder = '投稿・ユーザーを検索...';
    input.autocomplete = 'off';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yaju-search-btn';
    btn.textContent = '🔍';

    wrap.appendChild(input);
    wrap.appendChild(btn);
    container.appendChild(wrap);

    const dropdown = document.createElement('div');
    dropdown.className = 'yaju-search-dropdown';
    container.appendChild(dropdown);

    if (brand && brand.parentElement === header) {
      brand.insertAdjacentElement('afterend', container);
    } else if (brand) {
      brand.parentElement.insertAdjacentElement('afterend', container);
    } else {
      const firstChild = header.firstElementChild;
      if (firstChild) {
        firstChild.insertAdjacentElement('afterend', container);
      } else {
        header.appendChild(container);
      }
    }

    header.style.display = 'flex';
    header.style.alignItems = 'center';

    log('検索バーを注入しました');
    bindSearchEvents(input, btn, dropdown);

    if (!apiKey) {
      showApiKeyBanner();
    }
  }

  function waitForHeader() {
    let attempts = 0;
    const observer = new MutationObserver(() => {
      attempts++;
      const header = findHeader();
      if (header || attempts > 100) {
        observer.disconnect();
        if (header) injectSearchBar();
        else log('ヘッダーの検出に失敗しました（タイムアウト）');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (!document.querySelector('.yaju-search-container')) {
        observer.disconnect();
        injectSearchBar();
      }
    }, 3000);
  }

  // ============================================================
  // Search events (IME-safe)
  // ============================================================
  function bindSearchEvents(input, btn, dropdown) {
    input.addEventListener('compositionstart', () => { isComposing = true; });
    input.addEventListener('compositionend', () => {
      isComposing = false;
      debouncedSearch(input, dropdown);
    });

    input.addEventListener('input', () => {
      if (!isComposing) debouncedSearch(input, dropdown);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !isComposing) {
        clearTimeout(debounceId);
        performSearch(input.value, dropdown);
      }
      if (e.key === 'Escape') {
        dropdown.classList.remove('active');
        dropdown.textContent = '';
      }
    });

    btn.addEventListener('click', () => {
      if (!isComposing) {
        clearTimeout(debounceId);
        performSearch(input.value, dropdown);
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.yaju-search-container')) {
        dropdown.classList.remove('active');
      }
    });

    input.addEventListener('focus', () => {
      if (dropdown.children.length > 0 && input.value.trim()) {
        dropdown.classList.add('active');
      }
    });
  }

  function debouncedSearch(input, dropdown) {
    clearTimeout(debounceId);g
    debounceId = setTimeout(() => performSearch(input.value, dropdown), 350);
  }

  // ============================================================
  // Search execution (progressive)
  // ============================================================
  async function performSearch(rawQuery, dropdown) {
    const query = (rawQuery || '').trim();
    if (!query) {
      dropdown.classList.remove('active');
      dropdown.textContent = '';
      return;
    }

    if (!apiKey) {
      showDropdownMessage(dropdown, '⚙️ APIキーを設定してください（ページ右上）', true);
      showApiKeyBanner();
      return;
    }

    // 前の検索をキャンセル
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    showDropdownMessage(dropdown, '🔍 検索中...');

    try {
      // ユーザー検索（完全一致、並列で実行）
      const userPromise = fetchUser(query, apiKey, { signal }).catch((e) => {
        if (e.name !== 'AbortError') log('ユーザー検索エラー:', e.message);
        return null;
      });

      // プログレッシブ投稿検索
      const postResults = await progressiveSearch(query, {
        fetchPostsPage,
        apiKey,
        postsCache,
        userCache,
        filterPostsByQuery,
        signal,
      }, {
        onProgress: (currentPage, totalPages) => {
          if (signal.aborted) return;
          updateProgressIndicator(dropdown, currentPage, totalPages);
        },
        onResults: (results, info) => {
          if (signal.aborted) return;
          renderDropdown(dropdown, results, query, info.fromCache, null);
        },
        onError: (err) => {
          if (err.name !== 'AbortError') {
            log('検索エラー:', err);
          }
        },
      });

      if (signal.aborted) return;

      // ユーザー検索結果を待つ
      const userResult = await userPromise;

      // 最終的な結果を描画
      renderDropdown(dropdown, postResults, query, postsCache.isFresh(), userResult);

      // 検索結果の投稿からユーザー情報を取得（バックグラウンド）
      enrichPostsWithUserInfo(postResults.slice(0, 20), dropdown, query, signal);

    } catch (err) {
      if (err.name === 'AbortError') return;
      log('検索エラー:', err);
      showDropdownMessage(dropdown, `❌ エラー: ${err.message}`, true);
    }
  }

  /**
   * 検索結果の投稿に対してGET /posts/:idを並列フェッチし、
   * ユーザー情報を取得してDOMを更新する。
   */
  async function enrichPostsWithUserInfo(posts, dropdown, query, signal) {
    // ユーザー情報が不明な投稿のみ対象
    const needsEnrich = posts.filter(p => p.user_id && !userCache.has(p.user_id) && !p.user);
    if (needsEnrich.length === 0) return;

    // 並列でフェッチ（最大5件ずつ）
    const BATCH_SIZE = 5;
    for (let i = 0; i < needsEnrich.length; i += BATCH_SIZE) {
      if (signal.aborted) return;

      const batch = needsEnrich.slice(i, i + BATCH_SIZE);
      const details = await Promise.all(
        batch.map(p => fetchPostDetail(p.id, apiKey, { signal }).catch(() => null))
      );

      for (const detail of details) {
        if (detail && detail.user) {
          userCache.set(detail.user.id, detail.user);
        }
      }

      // DOMを更新
      if (!signal.aborted) {
        updatePostCardsWithUserInfo(dropdown, query);
      }
    }
  }

  /**
   * ドロップダウン内の投稿カードのユーザー情報をuserCacheから更新する。
   */
  function updatePostCardsWithUserInfo(dropdown, query) {
    const cards = dropdown.querySelectorAll('.yaju-result-post[data-user-id]');
    for (const card of cards) {
      const userId = parseInt(card.dataset.userId, 10);
      const user = userCache.get(userId);
      if (!user) continue;

      const authorEl = card.querySelector('.yaju-post-author');
      const handleEl = card.querySelector('.yaju-post-handle');
      const avatarEl = card.querySelector('.yaju-post-avatar');

      if (authorEl && authorEl.classList.contains('yaju-user-loading')) {
        authorEl.textContent = resolveDisplayName(user);
        authorEl.classList.remove('yaju-user-loading');
      }
      if (handleEl && handleEl.textContent.startsWith('#')) {
        handleEl.textContent = `@${resolveUsername(user)}`;
      }
      if (avatarEl) {
        const avatarUrl = resolveAvatarUrl(user);
        if (avatarUrl && !avatarEl.querySelector('img')) {
          const img = document.createElement('img');
          img.src = avatarUrl;
          img.alt = '';
          avatarEl.textContent = '';
          avatarEl.appendChild(img);
        }
      }
    }
  }

  // ============================================================
  // Display helpers
  // ============================================================
  function buildPostUrl(postId) {
    return `${SITE_BASE}/posts/${postId}`;
  }

  function buildUserUrl(username) {
    return `${SITE_BASE}/${encodeURIComponent(username)}`;
  }

  function relativeTime(iso) {
    try {
      const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (sec < 60) return '今';
      if (sec < 3600) return `約${Math.floor(sec / 60)}分前`;
      if (sec < 86400) return `約${Math.floor(sec / 3600)}時間前`;
      const days = Math.floor(sec / 86400);
      if (days < 30) return `約${days}日前`;
      return new Date(iso).toLocaleDateString('ja-JP');
    } catch { return ''; }
  }

  // ============================================================
  // Rendering
  // ============================================================
  function showDropdownMessage(dropdown, msg, isError = false) {
    dropdown.textContent = '';
    const div = document.createElement('div');
    div.className = 'yaju-dropdown-status' + (isError ? ' error' : '');
    div.textContent = msg;
    dropdown.appendChild(div);
    dropdown.classList.add('active');
  }

  function updateProgressIndicator(dropdown, currentPage, totalPages) {
    let progress = dropdown.querySelector('.yaju-search-progress');
    if (!progress) {
      progress = document.createElement('div');
      progress.className = 'yaju-search-progress';
      // 先頭に挿入
      dropdown.insertBefore(progress, dropdown.firstChild);
    }
    const pct = totalPages ? Math.round((currentPage / totalPages) * 100) : 0;

    progress.textContent = '';
    const span = document.createElement('span');
    span.textContent = `検索中... (${currentPage}/${totalPages || '?'}ページ)`;
    progress.appendChild(span);

    const barOuter = document.createElement('div');
    barOuter.className = 'yaju-progress-bar';
    const barFill = document.createElement('div');
    barFill.className = 'yaju-progress-fill';
    barFill.style.width = `${pct}%`;
    barOuter.appendChild(barFill);
    progress.appendChild(barOuter);
  }

  function renderDropdown(dropdown, postResults, query, fromCache, userResult) {
    dropdown.textContent = '';

    // 結果件数ヘッダー
    const countEl = document.createElement('div');
    countEl.className = 'yaju-result-count';
    const cacheInfo = fromCache ? '（キャッシュ）' : '';
    countEl.textContent = `${postResults.length}件の投稿がヒット${cacheInfo}`;
    dropdown.appendChild(countEl);

    // ユーザーカード
    if (userResult) {
      dropdown.appendChild(renderUserCard(userResult));
    }

    if (postResults.length === 0 && !userResult) {
      const empty = document.createElement('div');
      empty.className = 'yaju-dropdown-status';
      empty.textContent = '検索結果が見つかりませんでした';
      dropdown.appendChild(empty);
      dropdown.classList.add('active');
      return;
    }

    // 投稿カード（最初は最大20件）
    const INITIAL_DISPLAY = 20;
    const displayPosts = postResults.slice(0, INITIAL_DISPLAY);
    for (const post of displayPosts) {
      dropdown.appendChild(renderPostCard(post, query));
    }

    // 20件超の結果がある場合「もっと見る」ボタン
    if (postResults.length > INITIAL_DISPLAY) {
      const remaining = postResults.length - INITIAL_DISPLAY;
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'yaju-show-more';
      moreBtn.textContent = `他 ${remaining}件の検索結果を表示`;
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 残りの投稿を展開
        const extraPosts = postResults.slice(INITIAL_DISPLAY);
        for (const post of extraPosts) {
          dropdown.insertBefore(renderPostCard(post, query), moreBtn);
        }
        moreBtn.remove();
      });
      dropdown.appendChild(moreBtn);
    }

    dropdown.classList.add('active');
  }

  function renderUserCard(user) {
    const el = document.createElement('a');
    el.className = 'yaju-result-user';
    el.href = buildUserUrl(resolveUsername(user));

    const displayName = resolveDisplayName(user);
    const username = resolveUsername(user);
    const avatar = resolveAvatarUrl(user);

    const badge = document.createElement('span');
    badge.className = 'yaju-badge';
    badge.textContent = 'ユーザー';
    el.appendChild(badge);

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'yaju-avatar';
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = '';
      avatarDiv.appendChild(img);
    } else {
      avatarDiv.textContent = '👤';
    }
    el.appendChild(avatarDiv);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'yaju-user-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'yaju-display-name';
    nameDiv.textContent = displayName;
    infoDiv.appendChild(nameDiv);
    const usernameDiv = document.createElement('div');
    usernameDiv.className = 'yaju-username';
    usernameDiv.textContent = `@${username}`;
    infoDiv.appendChild(usernameDiv);
    el.appendChild(infoDiv);

    return el;
  }

  function renderPostCard(post, query) {
    const el = document.createElement('a');
    el.className = 'yaju-result-post';
    el.href = buildPostUrl(post.id);

    // user_idからuserCacheを参照
    const user = post.user || (post.user_id ? userCache.get(post.user_id) : null);
    const hasUser = !!user;
    const displayName = hasUser ? resolveDisplayName(user) : '読み込み中...';
    const username = hasUser ? resolveUsername(user) : `#${post.user_id || '?'}`;
    const avatar = hasUser ? resolveAvatarUrl(user) : '';
    const time = post.created_at ? relativeTime(post.created_at) : '';

    if (post.user_id) {
      el.setAttribute('data-user-id', post.user_id);
    }

    // アバター
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'yaju-post-avatar';
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = '';
      avatarDiv.appendChild(img);
    } else {
      avatarDiv.textContent = '👤';
    }
    el.appendChild(avatarDiv);

    // ボディ
    const body = document.createElement('div');
    body.className = 'yaju-post-body';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'yaju-post-header';
    const authorSpan = document.createElement('span');
    authorSpan.className = 'yaju-post-author' + (hasUser ? '' : ' yaju-user-loading');
    authorSpan.textContent = displayName;
    header.appendChild(authorSpan);
    const handleSpan = document.createElement('span');
    handleSpan.className = 'yaju-post-handle';
    handleSpan.textContent = (hasUser ? '@' : '') + username;
    header.appendChild(handleSpan);
    if (time) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'yaju-post-time';
      timeSpan.textContent = time;
      header.appendChild(timeSpan);
    }
    body.appendChild(header);

    // コンテンツ（ハイライト付き - DOMベースで安全に）
    const contentDiv = document.createElement('div');
    contentDiv.className = 'yaju-post-content';
    appendHighlightedText(contentDiv, post.content || '', query);
    body.appendChild(contentDiv);

    // メタ情報
    const metaDiv = document.createElement('div');
    metaDiv.className = 'yaju-post-meta';
    if (post.likes_count != null) {
      const likesSpan = document.createElement('span');
      likesSpan.textContent = `❤️ ${post.likes_count}`;
      metaDiv.appendChild(likesSpan);
    }
    body.appendChild(metaDiv);

    el.appendChild(body);
    return el;
  }

  /**
   * テキストをハイライト付きでDOMに安全に挿入する。
   * innerHTMLを使わず、TextNodeとmark要素で構築。
   */
  function appendHighlightedText(parent, text, query) {
    if (!query || !text) {
      parent.textContent = text;
      return;
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re;
    try { re = new RegExp(`(${escaped})`, 'gi'); } catch { parent.textContent = text; return; }

    let lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      // マッチ前のテキスト
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      // マッチ部分を<mark>で囲む
      const mark = document.createElement('mark');
      mark.textContent = match[1];
      parent.appendChild(mark);
      lastIndex = re.lastIndex;
    }
    // 残りのテキスト
    if (lastIndex < text.length) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  // ============================================================
  // API Key management
  // ============================================================
  async function loadApiKey() {
    try {
      const r = await browser.storage.local.get('yajutter_api_key');
      return r.yajutter_api_key || '';
    } catch {
      return '';
    }
  }

  async function saveApiKey(key) {
    try {
      await browser.storage.local.set({ yajutter_api_key: key });
    } catch (e) {
      log('APIキー保存エラー:', e);
    }
  }

  function showApiKeyBanner() {
    if (document.querySelector('.yaju-apikey-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'yaju-apikey-banner';

    const h3 = document.createElement('h3');
    h3.textContent = '🔑 ヤジュッター検索 APIキー設定';
    banner.appendChild(h3);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'yaju_xxxxxxxxxxxxxxxx';
    input.spellcheck = false;
    input.autocomplete = 'off';
    banner.appendChild(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '保存';
    banner.appendChild(button);

    const msg = document.createElement('div');
    msg.className = 'yaju-key-msg';
    banner.appendChild(msg);

    button.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) {
        msg.textContent = 'キーを入力してください';
        msg.style.color = '#c62828';
        return;
      }
      await saveApiKey(key);
      apiKey = key;
      postsCache.clear();
      userCache.clear();
      msg.textContent = '✓ 保存しました';
      msg.style.color = '#2e7d32';
      setTimeout(() => banner.remove(), 1000);
    });

    document.body.appendChild(banner);
  }

  // ============================================================
  // Logging
  // ============================================================
  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  // ============================================================
  // Boot
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
