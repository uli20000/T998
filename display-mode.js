/* T998 browser-local display preference. Both modes are rendered by the site. */
(function () {
  'use strict';
  const key = 't998-display-mode';
  let mode;
  try { mode = localStorage.getItem(key); } catch (_) {}
  if (mode !== 'light' && mode !== 'dark') mode = matchMedia('(prefers-color-scheme: dark)').matches || document.documentElement.hasAttribute('data-darkreader-scheme') ? 'dark' : 'light';
  // Keep the extension paused in both modes: removing its lock cannot resume it live.
  if (!document.querySelector('meta[name="darkreader-lock"]')) {
    const lock = document.createElement('meta');
    lock.name = 'darkreader-lock';
    document.head.appendChild(lock);
  }
  let meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'color-scheme'; document.head.appendChild(meta); }
  function apply() {
    const light = mode === 'light';
    document.documentElement.dataset.displayMode = mode;
    document.documentElement.style.colorScheme = light ? 'only light' : 'dark';
    meta.content = light ? 'only light' : 'dark';
    document.querySelectorAll('[data-display-mode-toggle]').forEach(button => {
      button.textContent = light ? '☀️' : '🌙';
      button.setAttribute('aria-pressed', String(!light));
      button.setAttribute('aria-label', light ? '目前為日間模式，切換夜間模式' : '目前為夜間模式，切換日間模式');
      button.title = light ? '日間模式｜點擊切換夜間' : '夜間模式｜點擊切換日間';
    });
  }
  window.addEventListener('storage', event => { if(event.key === key && ['light','dark'].includes(event.newValue)){ mode=event.newValue; apply(); } });
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-display-mode-toggle]').forEach(button => button.addEventListener('click', () => {
      mode = mode === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(key, mode); } catch (_) {}
      apply();
    }));
  });
})();
