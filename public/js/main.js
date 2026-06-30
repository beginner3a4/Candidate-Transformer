'use strict';

// ── File upload label update ───────────────────────────────────────────────────
document.querySelectorAll('.upload-zone input[type="file"]').forEach(input => {
  input.addEventListener('change', function () {
    const zone = this.closest('.upload-zone');
    const fn   = zone.querySelector('.filename');
    if (this.files && this.files[0]) {
      fn.textContent = this.files[0].name;
      zone.classList.add('has-file');
    } else {
      fn.textContent = '';
      zone.classList.remove('has-file');
    }
  });
});

// ── Loading overlay ────────────────────────────────────────────────────────────
const overlay = document.getElementById('loadingOverlay');

document.querySelectorAll('form[data-loading]').forEach(form => {
  form.addEventListener('submit', function () {
    if (overlay) overlay.classList.add('active');
  });
});

// ── JSON syntax highlight ─────────────────────────────────────────────────────
function highlightJson(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      match => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="json-key">${match}</span>`;
          return `<span class="json-string">${match}</span>`;
        }
        if (/true|false/.test(match)) return `<span class="json-boolean">${match}</span>`;
        if (/null/.test(match))       return `<span class="json-null">${match}</span>`;
        return `<span class="json-number">${match}</span>`;
      }
    );
}

document.querySelectorAll('.json-viewer[data-raw]').forEach(el => {
  try {
    const raw  = JSON.parse(el.dataset.raw);
    el.innerHTML = highlightJson(JSON.stringify(raw, null, 2));
  } catch { /* keep raw text */ }
});

// ── Copy JSON ─────────────────────────────────────────────────────────────────
document.querySelectorAll('[data-copy-target]').forEach(btn => {
  btn.addEventListener('click', function () {
    const target = document.querySelector(this.dataset.copyTarget);
    if (!target) return;
    const text = target.dataset.raw || target.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const orig = this.textContent;
      this.textContent = 'Copied!';
      setTimeout(() => { this.textContent = orig; }, 1800);
    });
  });
});

// ── Confidence bar colour ─────────────────────────────────────────────────────
document.querySelectorAll('.confidence-bar').forEach(bar => {
  const pct = parseFloat(bar.dataset.pct || 0);
  if (pct >= 85)      bar.classList.add('bg-success');
  else if (pct >= 60) bar.classList.add('bg-warning');
  else                bar.classList.add('bg-danger');
});
