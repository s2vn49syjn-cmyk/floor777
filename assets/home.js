(async () => {
  const mount = document.querySelector('[data-home-app]');
  if (!mount) return;
  const res = await fetch('data/halls.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('店舗データの読み込みに失敗しました');
  const data = await res.json();
  const halls = data.halls.filter(h => h.status === 'published');
  const q = document.getElementById('hallSearch');
  const list = document.getElementById('hallList');
  const count = document.getElementById('hallCount');
  const favBox = document.getElementById('favoriteHalls');
  const recentBox = document.getElementById('recentHalls');

  function normalize(v='') { return String(v).normalize('NFKC').toLowerCase().replace(/\s+/g,''); }
  function card(h) {
    const fav = Floor777.isFavorite(h.id);
    return `<a class="card hall-card" href="${h.path}">
      <div class="hall-card-top"><span class="tag">${h.prefecture}・${h.city}</span><span class="favorite-badge" aria-label="${fav?'お気に入り':'通常'}">${fav?'★':'☆'}</span></div>
      <h3>${h.name}</h3>
      <div class="hall-meta"><span>${h.category} ${Number(h.seat_count).toLocaleString('ja-JP')}台</span><span>更新 ${Floor777.formatDate(h.updated_at)}</span></div>
      <div class="feature-row">${h.features.map(x=>`<span>${x}</span>`).join('')}</div>
      <div class="card-link"><span>島図を見る</span><span aria-hidden="true">→</span></div>
    </a>`;
  }
  function render() {
    const nq = normalize(q.value);
    const filtered = halls.filter(h => !nq || normalize([h.name,h.prefecture,h.city,...h.features].join(' ')).includes(nq));
    count.textContent = `${filtered.length}店舗`;
    list.innerHTML = filtered.length ? filtered.map(card).join('') : '<div class="empty-state">一致する店舗はまだ掲載されていません。</div>';
  }
  q.addEventListener('input', render);
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = list.querySelector('a.hall-card');
      if (first) location.href = first.href;
    }
  });
  render();

  const byId = new Map(halls.map(h => [h.id,h]));
  const favs = Floor777.getFavorites().map(id=>byId.get(id)).filter(Boolean);
  favBox.innerHTML = favs.length ? favs.map(card).join('') : '<div class="empty-state compact">お気に入り登録した店舗がここに表示されます。</div>';
  const recents = Floor777.getRecent().map(x=>byId.get(x.id)).filter(Boolean);
  recentBox.innerHTML = recents.length ? recents.slice(0,3).map(card).join('') : '<div class="empty-state compact">閲覧した店舗がここに表示されます。</div>';
})();
