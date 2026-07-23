function updatePriceFromSelect(selectEl) {
  if (!selectEl || !selectEl.name || !selectEl.name.endsWith('-refaccion')) return;
  const prefix = selectEl.name.slice(0, selectEl.name.lastIndexOf('-refaccion'));
  const row = selectEl.closest('tr');
  const priceInput = row ? row.querySelector(`input[name="${prefix}-precio_unitario"]`) : document.querySelector(`input[name="${prefix}-precio_unitario"]`);
  const priceReadonly = row ? row.querySelector('.field-precio_unitario .readonly') : null;
  const priceCell = row ? row.querySelector('td.field-precio_unitario') : null;
  const refId = selectEl.value;
  if (!refId) return;
  fetch(`/api/refacciones/${refId}/precio/`, { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      if (data && data.precio_venta !== undefined) {
        const val = String(data.precio_venta);
        if (priceInput) priceInput.value = val;
        const fmt = (v) => `$ ${Number(v).toFixed(2)} MXN`;
        if (priceReadonly) {
          priceReadonly.textContent = fmt(val);
        } else if (priceCell) {
          priceCell.textContent = fmt(val);
        }
        recalcTotal();
      }
    })
    .catch(() => {});
}

document.addEventListener('change', function (e) {
  const el = e.target;
  if (!el || !el.name) return;
  if (el.name.endsWith('-refaccion')) {
    updatePriceFromSelect(el);
  } else if (el.name.endsWith('-refaccion_autocomplete')) {
    const hiddenName = el.name.replace('_autocomplete', '');
    const hidden = document.querySelector(`input[name="${hiddenName}"]`);
    if (hidden) updatePriceFromSelect(hidden);
  }
});

document.addEventListener('select2:select', function (e) {
  const el = e.target;
  if (!el || !el.name) return;
  if (el.name.endsWith('-refaccion')) {
    updatePriceFromSelect(el);
  } else if (el.name.endsWith('-refaccion_autocomplete')) {
    const hiddenName = el.name.replace('_autocomplete', '');
    const hidden = document.querySelector(`input[name="${hiddenName}"]`);
    if (hidden) updatePriceFromSelect(hidden);
  }
});

function recalcTotal() {
  let total = 0;
  const qtyInputs = document.querySelectorAll('input[name$="-cantidad"]');
  qtyInputs.forEach(qtyInput => {
    const name = qtyInput.name;
    if (!name || !name.endsWith('-cantidad')) return;
    const prefix = name.slice(0, name.lastIndexOf('-cantidad'));
    const row = qtyInput.closest('tr');
    const del = document.querySelector(`input[name="${prefix}-DELETE"]`);
    if (del && del.checked) return;
    const priceInput = document.querySelector(`input[name="${prefix}-precio_unitario"]`);
    const priceReadonly = row ? row.querySelector('.field-precio_unitario .readonly') : null;
    const priceCell = row ? row.querySelector('td.field-precio_unitario') : null;
    const qty = parseFloat(qtyInput.value);
    let price = NaN;
    if (priceInput && priceInput.value !== '') {
      price = parseFloat(priceInput.value);
    } else if (priceReadonly && priceReadonly.textContent.trim() !== '') {
      price = parseFloat(priceReadonly.textContent.replace(/[^\d.]/g, ''));
    } else if (priceCell && priceCell.textContent.trim() !== '') {
      price = parseFloat(priceCell.textContent.replace(/[^\d.]/g, ''));
    }
    if (!isFinite(qty) || !isFinite(price)) return;
    total += qty * price;
  });
  const ro = document.querySelector('.field-total .readonly');
  if (ro) ro.textContent = total.toFixed(2);
  const totalInput = document.querySelector('input[name="total"], #id_total');
  if (totalInput) totalInput.value = total.toFixed(2);
}

document.addEventListener('input', function (e) {
  const el = e.target;
  if (!el || !el.name) return;
  if (el.name.endsWith('-cantidad') || el.name.endsWith('-precio_unitario')) {
    recalcTotal();
  }
});

function initialPopulate() {
  const candidates = document.querySelectorAll('input[name$="-refaccion"], select[name$="-refaccion"], input[name$="-refaccion_autocomplete"]');
  candidates.forEach(el => {
    let triggerEl = el;
    if (el.name.endsWith('_autocomplete')) {
      const hiddenName = el.name.replace('_autocomplete', '');
      const hidden = document.querySelector(`input[name="${hiddenName}"]`);
      if (hidden) triggerEl = hidden;
    }
    if (!triggerEl || !triggerEl.value) return;
    const prefix = triggerEl.name.slice(0, triggerEl.lastIndexOf('-refaccion'));
    const row = el.closest('tr');
    const priceInput = document.querySelector(`input[name="${prefix}-precio_unitario"]`);
    const priceReadonly = row ? row.querySelector('.field-precio_unitario .readonly') : null;
    const priceCell = row ? row.querySelector('td.field-precio_unitario') : null;
    const hasPrice = (priceInput && priceInput.value) || (priceReadonly && priceReadonly.textContent.trim() !== '') || (priceCell && priceCell.textContent.trim() !== '');
    if (!hasPrice) updatePriceFromSelect(triggerEl);
  });
  recalcTotal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialPopulate);
} else {
  initialPopulate();
}
