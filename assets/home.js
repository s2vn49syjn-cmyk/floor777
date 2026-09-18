(async () => {
  const mount = document.querySelector('[data-home-app]'); if (!mount) return;
  const base = mount.dataset.base || './', q = document.getElementById('hallSearch'), list = document.getElementById('hallList'), count = document.getElementById('hallCount');
  const esc = Floor777.escapeHTML;
  q.setAttribute('aria-label','店舗名・地域で検索'); list.setAttribute('aria-live','polite');
  try {
    const data = await Floor777.fetchJSON(`${base}data/halls.json`);
    const halls = data.halls.filter(h => h.status === 'published');
    const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
    function card(h) {
      return `<a class="card hall-card" href="${esc(Floor777.safeURL(base+h.path))}"><div class="hall-card-top"><span class="tag">${esc(h.prefecture)}・${esc(h.city)}</span><span class="favorite-badge" aria-label="${Floor777.isFavorite(h.id)?'お気に入り':'通常'}">${Floor777.isFavorite(h.id)?'★':'☆'}</span></div><h3>${esc(h.name)}</h3><div class="hall-meta"><span>${esc(h.category)} ${Number(h.seat_count).toLocaleString('ja-JP')}台</span><span>島図更新 ${Floor777.formatDate(h.updated_at)}</span></div><div class="feature-row">${(h.features||[]).map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="card-link"><span>島図を見る</span><span aria-hidden="true">→</span></div></a>`;
    }
    function render() {
      const text = norm(q.value), filtered = halls.filter(h => !text || norm([h.name,h.prefecture,h.city,...(h.features||[])].join(' ')).includes(text));
      count.textContent = `${filtered.length}店舗`; list.innerHTML = filtered.length ? filtered.map(card).join('') : '<div class="empty-state">一致する店舗はまだ掲載されていません。</div>';
    }
    q.addEventListener('input',render); q.addEventListener('keydown', e => { if(e.key==='Enter') list.querySelector('a')?.click(); }); render();
    const byId = new Map(halls.map(h => [h.id,h]));
    for (const [id, rows, message] of [['favoriteHalls',Floor777.getFavorites().map(id=>byId.get(id)).filter(Boolean),'お気に入りの店舗がここに表示されます。'],['recentHalls',Floor777.getRecent().map(x=>byId.get(x.id)).filter(Boolean).slice(0,3),'最近見た店舗がここに表示されます。']]) {
      const el = document.getElementById(id); if(el) el.innerHTML = rows.length ? rows.map(card).join('') : `<div class="empty-state compact">${message}</div>`;
    }
  } catch {
    count.textContent = '読込失敗'; list.innerHTML = '<div class="empty-state">店舗一覧を読み込めませんでした。<button class="btn secondary" id="retryHalls">再読み込み</button></div>'; document.getElementById('retryHalls').onclick = () => location.reload();
  }
})();
