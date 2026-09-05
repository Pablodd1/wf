let catalogData = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('data.json');
    catalogData = await response.json();
    
    initMetrics(catalogData);
    initBrandFilter(catalogData);
    renderGrid(catalogData);
    setupEventListeners();
    setupGuideModal();
  } catch (err) {
    console.error('Failed to load marketplace data:', err);
  }
});

function initMetrics(data) {
  const totalItems = data.length;
  const totalVal = data.reduce((acc, item) => acc + (parseFloat(item.price) || 0), 0);
  const avgVal = totalItems > 0 ? totalVal / totalItems : 0;
  const uniqueSellers = new Set(data.map(item => item.from_number || item.from_name)).size;
  
  document.getElementById('metric-total-value').innerText = '$' + Math.round(totalVal).toLocaleString() + ' USD';
  document.getElementById('metric-items-count').innerText = totalItems + ' Report Items';
  document.getElementById('metric-avg-price').innerText = '$' + Math.round(avgVal).toLocaleString() + ' USD';
  document.getElementById('metric-sellers').innerText = uniqueSellers + ' Active Sellers';
}

function initBrandFilter(data) {
  const brandSelect = document.getElementById('filter-brand');
  const brands = Array.from(new Set(data.map(item => item.brand).filter(Boolean)));
  
  brands.sort().forEach(brand => {
    const opt = document.createElement('option');
    opt.value = brand;
    opt.innerText = brand;
    brandSelect.appendChild(opt);
  });
}

function renderGrid(items) {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '';
  
  if (items.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-muted); font-family: var(--font-serif-headline); font-style: italic;">No editorial listings found matching your search parameters.</div>';
    return;
  }
  
  items.forEach(item => {
    const card = document.createElement('article');
    card.className = 'editorial-card';
    
    const intentClass = item.type === 'sale' ? 'badge-sale' : 'badge-search';
    const intentLabel = item.type === 'sale' ? 'WTS • FOR SALE' : 'WTB • SEEKING';
    const priceFormatted = parseFloat(item.price) > 0 ? '$' + parseFloat(item.price).toLocaleString() : 'INQUIRE FOR QUOTE';
    
    const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240" viewBox="0 0 300 240"><rect width="300" height="240" fill="%230b0d11"/><text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="%23d4af37" font-family="serif" font-size="14" font-weight="bold">THE LUXURY GAZETTE</text><text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="%2364748b" font-family="sans-serif" font-size="11">IMAGE ARCHIVE VERIFICATION</text></svg>`;
    const imgSrc = item.full_image_url || fallbackSvg;
    
    const colorTag = item.detected_color || 'Classic';

    card.innerHTML = `
      <div class="card-media">
        <span class="badge-editorial-intent ${intentClass}">${intentLabel}</span>
        <span class="badge-color-tag">${colorTag}</span>
        <img class="card-img-content" src="${imgSrc}" alt="${item.brand || 'Item'}" loading="lazy" onerror="this.src='${fallbackSvg}'; this.parentElement.parentElement.style.order=9999;">
      </div>
      <div class="card-details">
        <div class="card-category-strip">${item.category_name || 'LUXURY FINE GOODS'} • ${item.origin || 'GROUP POST'}</div>
        <h3 class="card-item-title">${item.brand || 'Luxury Good'} ${item.model || ''}</h3>
        <p class="card-excerpt">${item.raw_message}</p>
        <div class="card-bottom-bar">
          <div class="card-price-tag">${priceFormatted}</div>
          <div class="card-seller-tag">👤 ${item.from_name || 'Verified Member'}</div>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => openModal(item));
    grid.appendChild(card);
  });
}

function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  const intentSelect = document.getElementById('filter-intent');
  const brandSelect = document.getElementById('filter-brand');
  const sortSelect = document.getElementById('filter-sort');
  
  const filterHandler = () => {
    let filtered = [...catalogData];
    const searchVal = searchInput.value.toLowerCase().trim();
    const intentVal = intentSelect.value;
    const brandVal = brandSelect.value;
    const sortVal = sortSelect.value;
    
    if (searchVal) {
      filtered = filtered.filter(i => 
        (i.raw_message && i.raw_message.toLowerCase().includes(searchVal)) ||
        (i.from_name && i.from_name.toLowerCase().includes(searchVal)) ||
        (i.brand && i.brand.toLowerCase().includes(searchVal)) ||
        (i.detected_color && i.detected_color.toLowerCase().includes(searchVal))
      );
    }
    
    if (intentVal !== 'all') {
      filtered = filtered.filter(i => i.type === intentVal);
    }
    
    if (brandVal !== 'all') {
      filtered = filtered.filter(i => i.brand === brandVal);
    }
    
    if (sortVal === 'price-desc') {
      filtered.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
    } else if (sortVal === 'price-asc') {
      filtered.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0));
    } else if (sortVal === 'newest') {
      filtered.sort((a, b) => new Date(b.date_time) - new Date(a.date_time));
    }
    
    renderGrid(filtered);
  };
  
  searchInput.addEventListener('input', filterHandler);
  intentSelect.addEventListener('change', filterHandler);
  brandSelect.addEventListener('change', filterHandler);
  sortSelect.addEventListener('change', filterHandler);
  
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}

function setupGuideModal() {
  const guideOverlay = document.getElementById('guide-modal-overlay');
  const guideClose = document.getElementById('guide-modal-close');
  
  const openGuide = () => guideOverlay.classList.add('active');
  const closeGuide = () => guideOverlay.classList.remove('active');

  const btnTop = document.getElementById('btn-top-guide');
  const btnSidebar = document.getElementById('btn-sidebar-guide');
  const btnBottom = document.getElementById('btn-bottom-guide');

  if (btnTop) btnTop.addEventListener('click', openGuide);
  if (btnSidebar) btnSidebar.addEventListener('click', openGuide);
  if (btnBottom) btnBottom.addEventListener('click', openGuide);
  if (guideClose) guideClose.addEventListener('click', closeGuide);

  guideOverlay.addEventListener('click', (e) => {
    if (e.target.id === 'guide-modal-overlay') closeGuide();
  });
}

function openModal(item) {
  const overlay = document.getElementById('modal-overlay');
  
  const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240" viewBox="0 0 300 240"><rect width="300" height="240" fill="%230b0d11"/><text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="%23d4af37" font-family="serif" font-size="14" font-weight="bold">THE LUXURY GAZETTE</text><text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="%2364748b" font-family="sans-serif" font-size="11">IMAGE ARCHIVE VERIFICATION</text></svg>`;
  
  const imgElem = document.getElementById('modal-img');
  imgElem.src = item.full_image_url || fallbackSvg;
  imgElem.onerror = () => { imgElem.src = fallbackSvg; };

  document.getElementById('modal-category').innerText = (item.category_name || 'LUXURY FINE GOODS').toUpperCase();
  document.getElementById('modal-title').innerText = `${item.brand || 'Luxury Good'} ${item.model || ''}`;
  
  const priceVal = parseFloat(item.price);
  document.getElementById('modal-price').innerText = priceVal > 0 ? '$' + priceVal.toLocaleString() + ' USD' : 'INQUIRE FOR QUOTE';
  
  document.getElementById('modal-raw-text').innerText = item.raw_message;
  
  // Brand & Color Comparative Analytics
  const ba = item.brand_analytics || {};
  document.getElementById('modal-brand-listings').innerText = `${ba.total_listings_for_brand || 1} Items`;
  document.getElementById('modal-brand-avg-price').innerText = ba.avg_brand_price ? '$' + Math.round(ba.avg_brand_price).toLocaleString() + ' USD' : 'N/A';
  document.getElementById('modal-brand-range').innerText = (ba.min_brand_price && ba.max_brand_price) ? `$${Math.round(ba.min_brand_price).toLocaleString()} - $${Math.round(ba.max_brand_price).toLocaleString()}` : 'Market Price';
  document.getElementById('modal-color-edition').innerText = item.detected_color ? `${item.detected_color}` : 'Classic Edition';

  // Seller Profile & Tracking
  const sellerName = item.from_name || 'Verified Member';
  document.getElementById('modal-seller-name').innerText = sellerName;
  
  const cleanPhone = (item.from_number || '').replace(/[^0-9]/g, '');
  document.getElementById('modal-seller-phone').innerText = item.from_number ? `+${item.phone_code || ''} ${item.from_number}` : 'Verified Member';
  
  const waBtn = document.getElementById('modal-wa-btn');
  if (cleanPhone) {
    waBtn.href = `https://wa.me/${cleanPhone}`;
    waBtn.style.display = 'block';
  } else {
    waBtn.style.display = 'none';
  }
  
  overlay.classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}
