function isPriceInput(el){if(!el||el.tagName!=='INPUT')return false;const t=el.getAttribute('type');if(t!=='number'&&t!=='text')return false;const n=(el.name||'').toLowerCase();const i=(el.id||'').toLowerCase();return n.includes('precio')||i.includes('precio')}
function getPreview(el){let p=el.nextElementSibling;if(p&&p.classList&&p.classList.contains('mxn-preview'))return p;p=document.createElement('span');p.className='mxn-preview';p.style.marginLeft='8px';p.style.opacity='0.75';p.style.fontSize='0.9em';el.parentNode.insertBefore(p,el.nextSibling);return p}
function formatMXN(val){if(val===null||val===undefined||val==='')return'';const num=Number(val);if(!isFinite(num))return'';try{return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2,maximumFractionDigits:2}).format(num)}catch(e){const parts=num.toFixed(2).split('.');parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');return'$ '+parts.join('.')+' MXN'}}
function updatePreview(el){const p=getPreview(el);p.textContent=formatMXN(el.value)}
function ensurePreview(el){if(!isPriceInput(el))return;updatePreview(el)}
function initAll(){document.querySelectorAll('input[type="number"],input[type="text"]').forEach(function(el){if(isPriceInput(el))updatePreview(el)})}
document.addEventListener('input',function(e){const el=e.target;if(isPriceInput(el))updatePreview(el)});
document.addEventListener('focusin',function(e){const el=e.target;if(isPriceInput(el))ensurePreview(el)});
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initAll)}else{initAll()}
