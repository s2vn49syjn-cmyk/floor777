const Floor777 = (() => {
  const FAV_KEY = 'floor777:favorites:v1';
  const RECENT_KEY = 'floor777:recent:v1';

  function safeJSON(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }
  function getFavorites() { return safeJSON(localStorage.getItem(FAV_KEY), []); }
  function isFavorite(id) { return getFavorites().includes(id); }
  function toggleFavorite(id) {
    const set = new Set(getFavorites());
    set.has(id) ? set.delete(id) : set.add(id);
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
    return set.has(id);
  }
  function addRecent(id) {
    const now = Date.now();
    const rows = safeJSON(localStorage.getItem(RECENT_KEY), []).filter(x => x && x.id !== id);
    rows.unshift({ id, at: now });
    localStorage.setItem(RECENT_KEY, JSON.stringify(rows.slice(0, 8)));
  }
  function getRecent() { return safeJSON(localStorage.getItem(RECENT_KEY), []); }
  function formatDate(s) {
    if (!s) return '—';
    const d = new Date(`${s}T00:00:00+09:00`);
    if (Number.isNaN(d.getTime())) return s;
    return new Intl.DateTimeFormat('ja-JP', { year:'numeric', month:'numeric', day:'numeric' }).format(d);
  }
  async function share(data) {
    if (navigator.share) {
      try { await navigator.share(data); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    if (navigator.clipboard && data.url) {
      await navigator.clipboard.writeText(data.url);
      return true;
    }
    return false;
  }
  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role','status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function registerSW(base='./') {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => navigator.serviceWorker.register(`${base}service-worker.js`).catch(() => {}));
    }
  }
  return { getFavorites, isFavorite, toggleFavorite, addRecent, getRecent, formatDate, share, toast, registerSW };
})();
