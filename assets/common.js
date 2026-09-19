const Floor777 = (() => {
  const FAV_KEY = 'floor777:favorites:v1';
  const RECENT_KEY = 'floor777:recent:v1';
  const memory = new Map();
  const storage = {
    get(key) { try { return memory.has(key) ? memory.get(key) : localStorage.getItem(key); } catch { return memory.get(key) ?? null; } },
    set(key, value) { memory.set(key, String(value)); try { localStorage.setItem(key, String(value)); return true; } catch { return false; } },
    json(key, fallback) { try { return JSON.parse(this.get(key)) ?? fallback; } catch { return fallback; } }
  };
  function getFavorites() { const value = storage.json(FAV_KEY, []); return Array.isArray(value) ? value.filter(x => typeof x === 'string') : []; }
  function isFavorite(id) { return getFavorites().includes(id); }
  function toggleFavorite(id) {
    const set = new Set(getFavorites()); set.has(id) ? set.delete(id) : set.add(id);
    if (!storage.set(FAV_KEY, JSON.stringify([...set]))) toast('このブラウザーでは保存できません。今回の画面内で保持します。');
    return set.has(id);
  }
  function getRecent() { const value = storage.json(RECENT_KEY, []); return Array.isArray(value) ? value.filter(x => x && typeof x.id === 'string') : []; }
  function addRecent(id) { const rows = getRecent().filter(x => x.id !== id); rows.unshift({ id, at: Date.now() }); storage.set(RECENT_KEY, JSON.stringify(rows.slice(0, 8))); }
  function formatDate(s) { if (!s) return '—'; const d = new Date(`${s}T00:00:00+09:00`); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', year:'numeric', month:'numeric', day:'numeric' }).format(d); }
  function escapeHTML(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function safeURL(value, base = location.href) { try { const u = new URL(value, base); return ['https:', 'http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } }
  async function fetchJSON(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try { const r = await fetch(url, { cache:'no-cache', signal:controller.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(timer); }
  }
  async function share(data) {
    if (navigator.share) { try { await navigator.share(data); return true; } catch (e) { if (e.name === 'AbortError') return false; } }
    try { if (navigator.clipboard && data.url) { await navigator.clipboard.writeText(data.url); return true; } } catch {}
    toast('共有できませんでした。アドレス欄のURLをコピーしてください。'); return false;
  }
  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
    el.textContent = message; el.classList.add('show'); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 3500);
  }
  function registerSW(base='./') {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    const register = () => navigator.serviceWorker.register(`${base}service-worker.js`, {updateViaCache:'none'}).catch(() => {});
    if (document.readyState === 'complete') register(); else window.addEventListener('load', register, {once:true});
  }
  function setupInstallPrompt() {
    const host = document.querySelector('.site-header .header-inner');
    if (!host || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return;
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let installEvent = null;
    let button = null;
    const ensureButton = () => {
      if (button) return button;
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = '＋ ホーム追加';
      button.setAttribute('aria-label', 'FLOOR777をホーム画面に追加');
      Object.assign(button.style, {marginLeft:'auto',minHeight:'36px',padding:'0 11px',border:'1px solid #2b4669',borderRadius:'10px',background:'#182a43',color:'#d9e8fb',fontWeight:'800',fontSize:'.78rem',whiteSpace:'nowrap'});
      host.appendChild(button);
      button.addEventListener('click', async () => {
        if (installEvent) {
          installEvent.prompt();
          try { await installEvent.userChoice; } catch {}
          installEvent = null;
          button.remove();
        } else {
          toast('iPhoneは共有ボタン →「ホーム画面に追加」で、FLOOR777をすぐ開けます。');
        }
      });
      return button;
    };
    if (isiOS) ensureButton();
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; ensureButton(); });
    window.addEventListener('appinstalled', () => { if (button) button.remove(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupInstallPrompt, {once:true}); else setupInstallPrompt();
  return {storage, getFavorites, isFavorite, toggleFavorite, addRecent, getRecent, formatDate, escapeHTML, safeURL, fetchJSON, share, toast, registerSW};
})();
