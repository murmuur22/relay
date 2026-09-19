import {initAppearance} from './appearance.js';
initAppearance();
const $ = selector => document.querySelector(selector);
let clips = [], csrf = '', current = null;
const upload = $('#upload'), detail = $('#detail');
function status(id, text, error = false) { const el = $(id); el.textContent = text; el.classList.toggle('error', error); }
async function api(url, options = {}) {
  options.headers = {...options.headers};
  if (options.method) options.headers['X-CSRF-Token'] = csrf;
  const r = await fetch(url, options);
  const body = await r.json();
  if (!r.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Check the required fields and try again.');
  return body;
}
function sourceName(c) { if (!c.source) return c.creator || 'No source provided'; try {return new URL(c.source).hostname;} catch {return 'Invalid source';} }
function render() {
  const query = $('#search').value.toLocaleLowerCase().trim();
  const shown = clips.filter(c => `${c.title} ${c.source}`.toLocaleLowerCase().includes(query));
  $('#gallery').replaceChildren();
  $('#empty').hidden = clips.length !== 0;
  $('#no-results').hidden = !clips.length || shown.length !== 0;
  $('#count').textContent = `${shown.length} ${shown.length === 1 ? 'CLIPPING' : 'CLIPPINGS'}`;
  for (const clip of shown) {
    const button = document.createElement('button'); button.className = 'clip'; button.setAttribute('aria-label', `Open ${clip.title}`);
    const img = document.createElement('img'); img.className = 'clip-image'; img.src = `/native/keepsakes/api/clips/${clip.id}/asset`; img.alt = clip.title; img.loading = 'lazy';
    const meta = document.createElement('div'); meta.className = 'clip-meta';
    const title = document.createElement('span'); title.className = 'clip-title'; title.textContent = clip.title;
    const format = document.createElement('span'); format.textContent = clip.asset.split('.').pop().toUpperCase() + ' ↗';
    const source = document.createElement('span'); source.className = 'clip-source'; source.textContent = sourceName(clip);
    meta.append(title, format); button.append(img, meta, source); button.onclick = () => openDetail(clip); $('#gallery').append(button);
  }
}
async function refresh() { clips = await api('/native/keepsakes/api/clips'); render(); }
function startUpload() { $('#upload-form').reset(); $('#file-label').textContent = 'Drop an image here, or choose a file'; status('#upload-status', ''); upload.showModal(); }
$('#add').onclick = startUpload; $('#empty-add').onclick = startUpload;
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => document.getElementById(b.dataset.close).close();
$('#search').oninput = render; $('#clear-search').onclick = () => { $('#search').value = ''; render(); $('#search').focus(); };
$('#file').onchange = () => { $('#file-label').textContent = $('#file').files[0]?.name || 'Choose an image'; };
$('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('dragging'); };
$('#drop').ondragleave = () => $('#drop').classList.remove('dragging');
$('#drop').ondrop = e => { e.preventDefault(); $('#drop').classList.remove('dragging'); if (e.dataTransfer.files.length) { $('#file').files = e.dataTransfer.files; $('#file').onchange(); } };
$('#upload-form').onsubmit = async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; status('#upload-status', 'Saving the original…');
  try {
    const file = $('#file').files[0];
    if (!file || file.size > 15 * 1024 * 1024) throw new Error('Choose an image up to 15 MiB.');
    await api('/native/keepsakes/api/clips', {method:'POST', body:new FormData(e.target)});
    await refresh(); upload.close(); status('#global-status', 'Clipping saved. A little more to come back to.');
  } catch(err) {status('#upload-status', err.message, true);} finally {button.disabled = false;}
};
function openDetail(clip) {
  current = clip;
  $('#detail-heading').textContent = clip.title;
  $('#detail-image').src = `/native/keepsakes/api/clips/${clip.id}/asset`; $('#detail-image').alt = clip.title;
  $('#detail-date').textContent = 'SAVED ' + new Date(clip.created).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}).toUpperCase();
  const link = $('#source-link'); link.hidden = !clip.source; link.removeAttribute('href');
  if (clip.source && /^https?:\/\//i.test(clip.source)) link.href = clip.source;
  $('#credit').textContent = clip.creator ? `Credit: ${clip.creator}` : 'No creator credit provided.';
  for (const key of ['title','source','creator','notes']) $('#edit-form').elements[key].value = clip[key];
  status('#detail-status', ''); if (!detail.open) detail.showModal();
}
$('#edit-form').oninput = () => status('#detail-status', 'Unsaved changes');
$('#edit-form').onsubmit = async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; status('#detail-status', 'Saving…');
  try {
    const updated = await api('/native/keepsakes/api/clips/' + current.id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    openDetail(updated); await refresh(); status('#detail-status', 'Saved to your folder.');
  } catch(err) {status('#detail-status', err.message, true);} finally {button.disabled = false;}
};
$('#trash').onclick = async () => {
  if (!confirm('Move this clipping to .trash? Its original and notes are kept there. You can restore the folder manually.')) return;
  try {await api('/native/keepsakes/api/clips/' + current.id, {method:'DELETE'}); await refresh(); detail.close(); status('#global-status', 'Moved to .trash. The original and notes are still in your data folder.');}
  catch(err) {status('#detail-status', err.message, true);}
};
async function init() {try {csrf = (await api('/native/keepsakes/api/session')).csrf; await refresh();} catch(err) {status('#global-status', 'Could not open your collection. ' + err.message + ' Reload to retry.', true); $('#count').textContent = 'UNAVAILABLE';}}
init();
