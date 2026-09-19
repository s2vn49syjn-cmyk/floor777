(() => {
  const cfg = window.FLOOR777_CONFIG || {};
  const slots = [...document.querySelectorAll('[data-ad-slot]')].filter(el=>!el.closest('.original-detail'));
  slots.forEach(el => { el.hidden = false; el.classList.add('ad-placeholder'); el.setAttribute('aria-label','広告掲載スペース'); if (el.previousElementSibling?.classList.contains('ad-label')) el.previousElementSibling.hidden = false; });
  if (!cfg.adsenseClient || (!cfg.enableAutoAds && !cfg.adsenseSlot)) {
    return;
  }

  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.adsenseClient)}`;
  document.head.appendChild(s);

  if (!cfg.adsenseSlot) return;
  slots.forEach(el => {
    el.innerHTML = '';
    el.classList.remove('ad-placeholder');
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = cfg.adsenseClient;
    ins.dataset.adSlot = cfg.adsenseSlot;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    el.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
  });
})();
