/**
 * ヤジュッター検索 オプションページスクリプト
 */
'use strict';

const keyInput = document.getElementById('key');
const msg = document.getElementById('msg');

browser.storage.local.get('yajutter_api_key').then(r => {
  keyInput.value = r.yajutter_api_key || '';
});

document.getElementById('save').addEventListener('click', async () => {
  const k = keyInput.value.trim();
  if (!k) {
    msg.textContent = 'キーを入力してください';
    msg.style.color = '#c62828';
    return;
  }
  await browser.storage.local.set({ yajutter_api_key: k });
  msg.textContent = '✓ 保存しました。ヤジュッターのページをリロードしてください。';
  msg.style.color = '#2e7d32';
});
