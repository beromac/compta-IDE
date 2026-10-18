'use strict';
/* ============================================================
   Compta IDEL — application locale (aucune donnée n'est envoyée sur internet)
   Données : IndexedDB (opérations + justificatifs). Réglages : localStorage.
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/* ---------- Stockage ---------- */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('idel-compta', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('entries', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' }).createIndex('entryId', 'entryId');
    };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
function run(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    try { out = fn(t); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbAll = (store) => run(store, 'readonly', (t) => t.objectStore(store).getAll());
const dbPut = (store, v) => run(store, 'readwrite', (t) => t.objectStore(store).put(v));
const dbDel = (store, k) => run(store, 'readwrite', (t) => t.objectStore(store).delete(k));
const dbFilesOf = (entryId) => run('files', 'readonly', (t) => t.objectStore('files').index('entryId').getAll(entryId));
const dbClear = () => run(['entries', 'files'], 'readwrite', (t) => { t.objectStore('entries').clear(); t.objectStore('files').clear(); });

const settings = {
  get(k, d) { try { const v = localStorage.getItem('idel.' + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('idel.' + k, v); } catch { /* ignoré */ } },
  all() { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('idel.') && k !== 'idel.lastBackup') o[k.slice(5)] = localStorage.getItem(k); } } catch { /* ignoré */ } return o; },
};
const vehOpts = () => ({ vehMethod: settings.get('vehMethod.' + year, 'bareme'), vehType: settings.get('vehType', 'auto5'), elec: settings.get('vehElec', '0') === '1' });
const fmtKm = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n || 0) + ' km';

/* ---------- État ---------- */
let entries = [];
let year = new Date().getFullYear();
let month = new Date().getMonth();
let editing = null;          // opération en cours de modification
let pendingFiles = [];       // { id, name, type, blob, isNew }
let removedFileIds = [];
let urls = [];
let editedFrom = null;       // onglet d'où part une modification               // object URLs à libérer

async function reload() { entries = (await dbAll('entries')).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); }

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- Navigation ---------- */
function show(view) {
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'mois') renderMonth();
  if (view === 'annee') renderRecap();
  if (view === 'cot') renderCot();
  if (view === 'reglages') renderSettings();
  window.scrollTo({ top: 0 });
}

function fillYears() {
  const ys = new Set([new Date().getFullYear(), year]);
  entries.forEach((e) => e.date && ys.add(Number(e.date.slice(0, 4))));
  const list = [...ys].sort((a, b) => b - a);
  $('#yearSel').innerHTML = list.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
}

/* ---------- Formulaire ---------- */
function curType() { return $('input[name=type]:checked').value; }

function fillCats(selected) {
  const t = curType();
  applyTypeUI();
  $('#f-cat').innerHTML = CATS.filter((c) => c.type === t)
    .map((c) => `<option value="${c.key}" ${c.key === selected ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
  onCatChange();
}

function applyTypeUI() {
  const km = curType() === 'km';
  $('#amountWrap').hidden = km; $('#f-amount').required = !km;
  $('#catWrap').hidden = km; $('#modeGrid').hidden = km; $('#docsBox').hidden = km;
  $('#kmWrap').hidden = !km; $('#kmHint').hidden = !km; $('#f-km').required = km;
  $('#f-label').placeholder = km ? 'Ex. : Tournée du matin, semaine 42…' : 'Ex. : Facture CPAM semaine 42, Pharmacie du centre…';
  $('#f-label').required = !km;
}

function onCatChange() {
  const c = catByKey($('#f-cat').value);
  const dep = curType() === 'depense';
  $('#pctWrap').hidden = !dep || (c && c.special === 'cot');
  $('#cotWrap').hidden = !(dep && c && c.key === 'urssaf');
  $('#dureeWrap').hidden = !(c && c.special === 'immo');
  const h = $('#catHint'); h.hidden = !(c && c.hint); h.textContent = c && c.hint ? c.hint : '';
}

function resetForm() {
  editing = null; pendingFiles = []; removedFileIds = [];
  $('#form').reset();
  $('#t-rec').checked = true;
  $('#f-date').value = todayISO();
  $('#f-pct').value = 100; $('#f-duree').value = 5; $('#f-km').value = ''; $('#f-csgded').value = ''; $('#f-csgnd').value = '';
  $('#formTitle').textContent = 'Nouvelle opération';
  $('#btnSave').textContent = 'Enregistrer';
  $('#btnCancel').hidden = true;
  fillCats();
  renderDocList();
}

async function startEdit(id) {
  const e = entries.find((x) => x.id === id); if (!e) return;
  editedFrom = $$('.view').find((v) => !v.hidden)?.id.replace('view-', '') || 'mois';
  resetForm();
  editing = e;
  $('#t-' + ({ recette: 'rec', depense: 'dep', km: 'km' }[e.type] || 'rec')).checked = true;
  fillCats(e.cat);
  $('#f-date').value = e.date; $('#f-amount').value = e.type === 'km' ? '' : e.amount; $('#f-label').value = e.label || '';
  $('#f-mode').value = e.mode || 'Virement'; $('#f-pct').value = e.pct ?? 100;
  $('#f-km').value = e.km ?? ''; $('#f-duree').value = e.duree ?? 5;
  $('#f-csgded').value = e.csgDed ?? ''; $('#f-csgnd').value = e.csgND ?? '';
  $('#f-note').value = e.note || '';
  const files = await dbFilesOf(id);
  pendingFiles = files.map((f) => ({ id: f.id, name: f.name, type: f.type, blob: f.blob, isNew: false }));
  $('#formTitle').textContent = 'Modifier l\'opération';
  $('#btnSave').textContent = 'Enregistrer les modifications';
  $('#btnCancel').hidden = false;
  renderDocList();
  show('saisie');
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 1800, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

async function addFiles(fileList) {
  for (const f of fileList) {
    const blob = await compressImage(f);
    const isPdf = f.type === 'application/pdf';
    const base = (f.name || 'photo').replace(/\.[^.]+$/, '');
    const name = isPdf ? (f.name || base + '.pdf') : base + '.jpg';
    pendingFiles.push({ id: uid(), name, type: isPdf ? 'application/pdf' : (blob.type || 'image/jpeg'), blob, isNew: true });
  }
  renderDocList();
}

function freeUrls() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; }
function objUrl(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }

function renderDocList() {
  freeUrls();
  $('#docList').innerHTML = '';
  pendingFiles.forEach((f) => {
    const li = document.createElement('li');
    const isImg = f.type.startsWith('image/');
    li.innerHTML = (isImg ? `<img class="thumb" src="${objUrl(f.blob)}" alt="">` : `<button type="button" class="thumb">📄</button>`) +
      `<span class="thumb-name">${esc(f.name)}</span><button type="button" class="rm" aria-label="Retirer">×</button>`;
    li.querySelector('.thumb').onclick = () => openFile(f);
    li.querySelector('.rm').onclick = () => {
      pendingFiles = pendingFiles.filter((x) => x.id !== f.id);
      if (!f.isNew) removedFileIds.push(f.id);
      renderDocList();
    };
    $('#docList').appendChild(li);
  });
}

function openFile(f) {
  const u = objUrl(f.blob);
  if (f.type.startsWith('image/')) { $('#viewerImg').src = u; $('#viewer').hidden = false; }
  else window.open(u, '_blank');
}

async function saveForm(ev) {
  ev.preventDefault();
  const type = curType();
  const isKm = type === 'km';
  const num = (id) => Math.round((parseFloat(String($(id).value).replace(',', '.')) || 0) * 100) / 100;
  const amount = isKm ? 0 : num('#f-amount');
  if (isKm) { if (!(Number($('#f-km').value) > 0)) { toast('Saisissez un nombre de kilomètres supérieur à 0'); return; } }
  else if (!(amount > 0)) { toast('Saisissez un montant supérieur à 0'); return; }
  const cat = catByKey(isKm ? 'km_pro' : $('#f-cat').value);
  const csgDed = cat.key === 'urssaf' ? num('#f-csgded') : null, csgND = cat.key === 'urssaf' ? num('#f-csgnd') : null;
  if (cat.key === 'urssaf' && csgDed + csgND > amount) { toast('La CSG-CRDS ne peut pas dépasser le montant payé'); return; }
  const e = {
    id: editing ? editing.id : uid(),
    type, date: $('#f-date').value, amount, cat: cat.key,
    label: $('#f-label').value.trim() || (isKm ? 'Trajets professionnels' : ''), mode: isKm ? '' : $('#f-mode').value,
    pct: type === 'depense' && cat.special !== 'cot' ? Math.min(100, Math.max(0, Number($('#f-pct').value || 100))) : null,
    km: isKm ? Number($('#f-km').value) : null,
    csgDed, csgND,
    duree: cat.special === 'immo' ? Math.max(1, Number($('#f-duree').value) || 5) : null,
    note: $('#f-note').value.trim(),
    nFiles: isKm ? 0 : pendingFiles.length,
    updated: new Date().toISOString(),
  };
  if (!e.date) { toast('Date obligatoire'); return; }
  try {
    await dbPut('entries', e);
    for (const id of removedFileIds) await dbDel('files', id);
    for (const f of pendingFiles.filter((x) => x.isNew)) await dbPut('files', { id: f.id, entryId: e.id, name: f.name, type: f.type, blob: f.blob });
  } catch (err) {
    toast('Échec de l\'enregistrement (espace insuffisant ?)'); console.error(err); return;
  }
  const wasEdit = !!editing;
  const d = e.date;
  await reload();
  year = Number(d.slice(0, 4)); month = Number(d.slice(5, 7)) - 1;
  fillYears();
  toast(wasEdit ? 'Modification enregistrée' : 'Opération enregistrée');
  const keepType = type;
  resetForm();
  if (keepType !== 'recette') { $('#t-' + (keepType === 'km' ? 'km' : 'dep')).checked = true; fillCats(); }
  const back = editedFrom; editedFrom = null;
  if (wasEdit || back === 'cot') show(back || 'mois');
}

async function deleteEntry(id) {
  if (!confirm('Supprimer cette opération et ses justificatifs ?')) return;
  const files = await dbFilesOf(id);
  for (const f of files) await dbDel('files', f.id);
  await dbDel('entries', id);
  await reload(); renderMonth(); toast('Opération supprimée');
}

/* ---------- Vue mensuelle ---------- */
function fillMonthSel() {
  $('#monthSel').innerHTML = MONTHS.map((m, i) => `<option value="${i}" ${i === month ? 'selected' : ''}>${m} ${year}</option>`).join('');
}

function renderMonth() {
  fillMonthSel();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const list = entries.filter((e) => e.date && e.date.startsWith(key)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const R = computeYear(entries, year, vehOpts());
  const M = R.months[month];
  $('#monthTotals').innerHTML =
    `<div class="card"><small>Recettes</small><b class="rec">${eur(M.rec)}</b></div>` +
    `<div class="card"><small>Dépenses (part pro)</small><b class="dep">${eur(M.dep)}</b></div>` +
    `<div class="card"><small>Solde du mois</small><b>${eur(M.rec - M.dep)}</b></div>` +
    (M.km ? `<div class="card"><small>Kilomètres${R.veh.method === 'bareme' ? ' (indemnité)' : ''}</small><b>${fmtKm(M.km)}</b>${R.veh.method === 'bareme' ? `<small>${eur(M.ik)}</small>` : ''}</div>` : '');
  if (!list.length) { $('#monthList').innerHTML = '<p class="hint">Aucune opération ce mois-ci.</p>'; return; }
  $('#monthList').innerHTML = list.map((e) => {
    const tools = `<div class="tools">${e.nFiles ? '<button class="btn alt small" data-act="docs">Voir justificatifs</button>' : ''}
          <button class="btn alt small" data-act="edit">Modifier</button>
          <button class="btn ghost small" data-act="del">Supprimer</button></div>`;
    if (e.type === 'km') {
      return `<div class="item" data-id="${e.id}"><div class="main"><div class="t">${esc(e.label || 'Trajets professionnels')}</div>
        <div class="s">${e.date.slice(8, 10)}/${e.date.slice(5, 7)} · Kilomètres professionnels</div>${tools}</div><div class="amt">${fmtKm(e.km)}</div></div>`;
    }
    const c = catByKey(e.cat);
    const ignored = e.type === 'depense' && e.cat === 'veh_reel' && R.veh.method === 'bareme';
    const warn = e.type === 'depense' && !e.nFiles ? '<span class="chip warn">sans justificatif</span>' : '';
    const part = e.type === 'depense' && e.pct != null && e.pct < 100 ? `<span class="chip">${e.pct} % pro</span>` : '';
    const docs = e.nFiles ? `<span class="chip">📎 ${e.nFiles}</span>` : '';
    const ign = ignored ? '<span class="chip warn">non compté : méthode barème</span>' : '';
    return `<div class="item" data-id="${e.id}">
      <div class="main">
        <div class="t">${esc(e.label || (c && c.label) || '')}</div>
        <div class="s">${e.date.slice(8, 10)}/${e.date.slice(5, 7)} · ${esc(c ? c.label : e.cat)} · ${esc(e.mode || '')}</div>
        <div>${docs}${part}${warn}${ign}</div>
        ${tools}
      </div>
      <div class="amt ${e.type === 'recette' ? 'rec' : 'dep'}">${e.type === 'recette' ? '+' : '−'} ${eur(e.amount)}</div>
    </div>`;
  }).join('');
}

async function showDocs(id) {
  const files = await dbFilesOf(id);
  if (!files.length) return;
  if (files.length === 1) { openFile(files[0]); return; }
  // plusieurs fichiers : on ouvre le premier visuel, les autres s'enchaînent en cliquant
  let i = 0;
  const next = () => { openFile(files[i % files.length]); i++; };
  next();
  $('#viewerImg').onclick = () => { if (files.length > 1 && i < files.length) next(); else $('#viewer').hidden = true; };
}

/* ---------- Récapitulatif annuel ---------- */
function renderRecap() {
  $('#recapYear').textContent = year;
  const R = computeYear(entries, year, vehOpts());
  const C = compareRegimes(R, year);
  const regime = settings.get('regime', 'inconnu');
  const oga = settings.get('oga', 'oui') === 'oui';
  const name = settings.get('name', '');
  const L = (p) => (LIGNES[p] ? ` <span class="chip">ligne ${esc(LIGNES[p])}</span>` : '');

  const warnings = [];
  if (R.missing) warnings.push(`${R.missing} dépense(s) de ${year} sans justificatif : ajoutez la photo ou le scan (onglet Mois → Modifier).`);
  if (R.veh.method === 'bareme' && R.veh.ignoreReel > 0) warnings.push(`Méthode « barème kilométrique » : ${eur(R.veh.ignoreReel)} de frais réels de véhicule saisis ne sont pas comptés (déjà inclus dans le forfait). Changez de méthode ci-dessous si les frais réels sont plus avantageux.`);
  if (R.veh.method === 'bareme' && R.veh.totalKm === 0 && R.rec > 0) warnings.push('Méthode « barème kilométrique » sans aucun kilomètre saisi : ajoutez vos kilomètres professionnels (Saisie → Km), sinon aucun frais de véhicule n\'est déduit.');
  if (R.veh.method === 'reel' && R.veh.reel === 0 && R.veh.totalKm > 0) warnings.push('Méthode « frais réels » choisie alors que vous avez saisi des kilomètres : saisissez vos frais de véhicule (catégorie « Véhicule : frais réels ») ou repassez au barème.');
  if (entries.some((e) => e.date?.startsWith(String(year)) && e.cat === 'petit_mat' && e.amount > 500)) warnings.push('Une dépense « petit matériel » dépasse 500 € HT : un bien de plus de 500 € HT doit en principe être immobilisé et amorti (catégorie « Achat de matériel > 500 € »).');
  if (C.depassePlafond) warnings.push(`Vos recettes dépassent le plafond micro-BNC (${eur(C.plafond)}). Le régime de la déclaration contrôlée (2035) peut s'imposer, vérifiez avec votre centre de gestion ou votre comptable.`);

  let h = `<div class="print-head"><b>${esc(name) || 'Infirmière libérale'}</b> — récapitulatif de l'année ${year} (comptabilité de trésorerie : recettes encaissées, dépenses payées)</div>`;
  h += `<div class="cards">
    <div class="card"><small>Recettes encaissées</small><b class="rec">${eur(R.rec)}</b></div>
    <div class="card"><small>Dépenses déductibles</small><b class="dep">${eur(R.dep)}</b></div>
    <div class="card"><small>Amortissements</small><b class="dep">${eur(R.amort)}</b></div>
    <div class="card"><small>Résultat (régime réel)</small><b>${eur(R.resultat)}</b></div></div>`;
  warnings.forEach((w) => (h += `<p class="note">⚠ ${esc(w)}</p>`));
  if (!R.count) h += '<p class="hint">Aucune opération saisie pour cette année.</p>';

  // Mois par mois
  h += '<h3>Mois par mois</h3><div class="tablewrap"><table><thead><tr><th>Mois</th><th class="n">Recettes</th><th class="n">Dépenses</th><th class="n">Solde</th></tr></thead><tbody>';
  R.months.forEach((m, i) => { h += `<tr><td>${MONTHS[i]}</td><td class="n">${eur(m.rec)}</td><td class="n">${eur(m.dep)}</td><td class="n">${eur(m.rec - m.dep)}</td></tr>`; });
  h += `<tr class="total"><td>Total</td><td class="n">${eur(R.rec)}</td><td class="n">${eur(R.dep)}</td><td class="n">${eur(R.rec - R.dep)}</td></tr></tbody></table></div>`;
  h += '<p class="hint">Les amortissements (matériel > 500 €) sont comptés à l\'année et ne figurent pas dans le tableau mensuel.</p>';

  // Régime réel
  const reelOpen = regime !== 'micro';
  h += `<details ${reelOpen ? 'open' : ''}><summary><h3 style="display:inline">A. Déclaration contrôlée (2035) — où reporter chaque montant</h3></summary>`;
  h += '<div class="tablewrap"><table><thead><tr><th>Formulaire</th><th>Poste à remplir</th><th class="n">Montant</th></tr></thead><tbody>';
  const order = Object.keys(POSTES);
  const row = (p, sign = '') => {
    const v = R.byPoste[p]; if (!v || !v.total) return '';
    const P = POSTES[p];
    return `<tr><td>${esc(P.form)}${P.section ? `<br><small class="hint">${esc(P.section)}</small>` : ''}</td><td>${esc(P.label)}${L(p)}<br><small class="hint">${v.count} opération(s)</small></td><td class="n">${sign}${eur(v.total)}</td></tr>`;
  };
  order.filter((p) => POSTES[p].side === 'recette').forEach((p) => (h += row(p)));
  h += `<tr class="total"><td colspan="2">Total recettes</td><td class="n">${eur(R.rec)}</td></tr>`;
  order.filter((p) => POSTES[p].side === 'depense').forEach((p) => (h += row(p)));
  h += `<tr class="total"><td colspan="2">Total dépenses (dont amortissements)</td><td class="n">${eur(R.dep + R.amort)}</td></tr>`;
  h += `<tr class="total"><td>2035</td><td>${R.resultat >= 0 ? 'Bénéfice' : 'Déficit'} de l'année</td><td class="n">${eur(R.resultat)}</td></tr>`;
  h += '</tbody></table></div>';

  // Report 2042-C-PRO
  const bC = oga ? '5QC' : '5QI', dC = oga ? '5QE' : '5QK';
  if (R.resultat >= 0) h += `<p class="note ok">Report sur la <b>2042-C-PRO</b>, rubrique « régime de la déclaration contrôlée » : bénéfice en case <span class="case">${bC}</span> (déclarante 1 ; 5RC/5SC pour le conjoint ou la personne à charge). Prenez le résultat final de votre 2035 (il reprend aussi les éventuelles plus-values et réintégrations).</p>`;
  else h += `<p class="note ok">Résultat négatif : déficit à reporter sur la <b>2042-C-PRO</b> case <span class="case">${dC}</span>. Il est imputable sur vos autres revenus selon les règles des déficits BNC.</p>`;
  h += `<p class="hint">Cases pour ${oga ? 'adhérente à un OGA/AGA' : 'non-adhérente'} (modifiable dans Réglages). </p>`;
  if (R.rec > SEUIL_2035E) h += `<p class="note">Vos recettes dépassent ${eur(SEUIL_2035E)} : l'annexe 2035-E (valeur ajoutée / CVAE) doit être jointe à la liasse.</p>`;
  if (R.per) h += `<p class="note">Versements PER / Madelin retraite saisis : <b>${eur(R.per)}</b>. À reporter sur la <b>2042</b> (cases <span class="case">6NS</span> / <span class="case">6NT</span> selon la déclarante), jamais sur la 2035.</p>`;
  h += '<p class="hint">À savoir : la CSG est déductible pour sa part de 6,8 % seulement. La CSG est de 9,2 % : 6,8 % sont déductibles, 2,4 % ne le sont pas, ni la CRDS (0,5 %), soit 2,9 % non déductibles au total. L\'impôt sur le revenu et les amendes ne sont jamais déductibles.</p>';
  // Véhicule : barème ou frais réels
  {
    const V = R.veh, best = V.ik < V.reel ? 'reel' : 'bareme';
    h += `<h3>Véhicule : barème kilométrique ou frais réels ?</h3>
      <label class="no-print">Méthode retenue pour ${year}
        <select id="recapVeh"><option value="bareme" ${V.method === 'bareme' ? 'selected' : ''}>Barème kilométrique (forfait)</option><option value="reel" ${V.method === 'reel' ? 'selected' : ''}>Frais réels</option></select></label>
      <div class="tablewrap"><table><tbody>
        <tr><td>Kilomètres professionnels saisis</td><td class="n">${fmtKm(V.totalKm)}</td></tr>
        <tr><td>Barème kilométrique estimé (${esc(BAREME_KM[V.type]?.label || '')}${V.elec ? ', électrique +20 %' : ''})</td><td class="n">${eur(V.ik)}</td></tr>
        <tr><td>Frais réels de véhicule saisis (part pro)</td><td class="n">${eur(V.reel)}</td></tr>
        <tr class="total"><td>Déduit dans la 2035 (${V.method === 'bareme' ? 'barème' : 'frais réels'})</td><td class="n">${eur(V.method === 'bareme' ? V.ik : V.reel)}</td></tr></tbody></table></div>
      <p class="hint">${V.totalKm > 0 && V.reel > 0 ? `Sur vos chiffres, ${best === 'bareme' ? 'le barème kilométrique' : 'les frais réels'} est plus avantageux (écart ${eur(Math.abs(V.ik - V.reel))}).` : 'Saisissez vos kilomètres et vos frais réels pour comparer les deux méthodes.'} Une seule méthode par année, pour tous vos véhicules. Péages et parkings se déduisent en plus. Les IK et IFD versées par la CPAM restent des recettes. Le carnet de kilomètres est votre justificatif en cas de contrôle.</p>`;
  }
  if (R.immos.length) {
    h += '<h3>Tableau des immobilisations (annexe 2035, tableau des biens amortissables)</h3><div class="tablewrap"><table><thead><tr><th>Bien</th><th>Acquisition</th><th class="n">Valeur HT*</th><th class="n">Durée</th><th class="n">Dotation ' + year + '</th></tr></thead><tbody>';
    R.immos.forEach((i) => (h += `<tr><td>${esc(i.label)}</td><td>${i.date.split('-').reverse().join('/')}</td><td class="n">${eur(i.valeur)}</td><td class="n">${i.duree} ans</td><td class="n">${eur(i.dotation)}</td></tr>`));
    h += '</tbody></table></div><p class="hint">*Saisissez les montants HT : une infirmière libérale est en principe exonérée de TVA, donc le prix TTC payé est le prix HT.</p>';
  }
  h += '</details>';

  // Micro-BNC
  h += `<details ${regime === 'micro' ? 'open' : ''} style="margin-top:14px"><summary><h3 style="display:inline">B. Micro-BNC — déclaration simplifiée</h3></summary>`;
  h += `<p class="note ok">Aucune 2035. Sur la <b>2042-C-PRO</b>, rubrique « régime déclaratif spécial ou micro-BNC » : recettes brutes <b>${eur(R.rec)}</b> en case <span class="case">5HQ</span> (5IQ pour le conjoint), <u>sans retirer l'abattement</u> : l'administration applique automatiquement 34 % (minimum 305 €). Si vous êtes au versement libératoire, la case est <span class="case">5TE</span>.</p>`;
  h += `<p>Base imposable après abattement : <b>${eur(C.baseMicro)}</b> (abattement ${eur(C.abatt)}).</p></details>`;

  // Comparaison
  if (R.rec > 0) {
    const better = C.meilleur === 'reel' ? 'la déclaration contrôlée (frais réels)' : 'le micro-BNC';
    h += `<h3 style="margin-top:18px">Quel régime est le plus avantageux ?</h3><div class="tablewrap"><table><tbody>
      <tr><td>Base imposable en micro-BNC</td><td class="n">${eur(C.baseMicro)}</td></tr>
      <tr><td>Base imposable en déclaration contrôlée</td><td class="n">${eur(C.baseReel)}</td></tr>
      <tr><td>Charges réelles / recettes</td><td class="n">${(C.ratioCharges * 100).toFixed(0)} % (seuil : 34 %)</td></tr></tbody></table></div>
      <p class="hint">Sur ces chiffres, ${better} donne la base la plus faible (écart ${eur(C.ecart)}). Comparaison avant cotisations sociales, qui se calculent différemment dans les deux régimes : vérifiez avec votre comptable, le choix du régime engage plusieurs années.</p>`;
  }

  h += '<p class="hint small no-print">Les numéros de cases proviennent des notices publiques de la 2042-C-PRO et peuvent changer d\'une année sur l\'autre : contrôlez toujours sur le formulaire de l\'année avant de déclarer sur impots.gouv.fr.</p>';
  $('#recap').innerHTML = h;
  const sel = $('#recapVeh');
  if (sel) sel.onchange = () => { settings.set('vehMethod.' + year, sel.value); renderRecap(); };
}

/* ---------- Cotisations URSSAF / CARPIMKO ---------- */
function renderCot() {
  $('#cotYear').textContent = year;
  const R = computeYear(entries, year, vehOpts());
  const orgs = [['URSSAF', 'urssaf', 'URSSAF', 'maladie-maternité, allocations familiales, CSG-CRDS, contribution à la formation professionnelle'], ['CARPIMKO', 'carpimko', 'CARPIMKO', 'retraite de base, retraite complémentaire, invalidité-décès, ASV']];
  const paidTotal = R.sociales;
  const taux = R.rec > 0 ? (paidTotal / R.rec * 100) : 0;
  let h = `<div class="cards">
    <div class="card"><small>Cotisations payées</small><b class="dep">${eur(paidTotal)}</b></div>
    <div class="card"><small>dont URSSAF</small><b>${eur(R.cot.URSSAF.paid)}</b></div>
    <div class="card"><small>dont CARPIMKO</small><b>${eur(R.cot.CARPIMKO.paid)}</b></div>
    <div class="card"><small>% des recettes</small><b>${taux.toFixed(1).replace('.', ',')} %</b></div></div>`;
  for (const [org, catKey, name, desc] of orgs) {
    const c = R.cot[org];
    const appel = parseFloat(String(settings.get(`appel.${year}.${org}`, '')).replace(',', '.')) || 0;
    const reste = appel - c.paid;
    const pct = appel > 0 ? Math.min(100, c.paid / appel * 100) : 0;
    const pays = entries.filter((e) => e.date?.startsWith(String(year)) && e.cat === catKey).sort((a, b) => (a.date < b.date ? -1 : 1));
    h += `<div class="panel"><h3>${name}</h3><p class="hint">${esc(desc)}.</p>
      <label>Montant appelé pour ${year} (€), d'après votre échéancier
        <input type="number" inputmode="decimal" min="0" step="0.01" data-appel="${org}" value="${appel || ''}" placeholder="Facultatif"></label>
      ${appel > 0 ? `<div class="bar"><i style="width:${pct}%"></i></div><p>Payé ${eur(c.paid)} sur ${eur(appel)} · ${reste >= 0 ? `reste à payer <b>${eur(reste)}</b>` : `<b>${eur(-reste)}</b> payés en plus de l'appel`}</p>` : `<p>Payé en ${year} : <b>${eur(c.paid)}</b></p>`}
      ${pays.length ? '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Libellé</th><th class="n">Payé</th></tr></thead><tbody>' + pays.map((e) => `<tr data-id="${e.id}"><td>${e.date.split('-').reverse().join('/')}</td><td>${esc(e.label)}${e.csgDed || e.csgND ? `<br><small class="hint">dont CSG déd. ${eur(e.csgDed || 0)} · non déd. ${eur(e.csgND || 0)}</small>` : ''}${e.nFiles ? '' : ' <span class="chip warn">sans justificatif</span>'}</td><td class="n">${eur(e.amount)}<br><button class="btn alt small" data-edit="${e.id}">Modifier</button></td></tr>`).join('') + '</tbody></table></div>' : '<p class="hint">Aucun paiement enregistré.</p>'}
      <button class="btn" data-addcot="${catKey}">＋ Ajouter un paiement ${name}</button></div>`;
  }
  const u = R.cot.URSSAF;
  h += `<div class="panel"><h3>Ce qui est déductible (déclaration 2035)</h3><div class="tablewrap"><table><tbody>
    <tr><td>Cotisations sociales obligatoires (hors CSG-CRDS)</td><td class="n">${eur(R.byPoste.charges_perso?.total || 0)}</td></tr>
    <tr><td>CSG déductible (6,8 %)</td><td class="n">${eur(R.byPoste.csg?.total || 0)}</td></tr>
    <tr><td>CSG non déductible + CRDS (à ne pas déduire)</td><td class="n">${eur(R.byPoste.csg_nd?.total || 0)}</td></tr></tbody></table></div>
    <p class="hint">Comptabilité de trésorerie : seules les sommes payées dans l'année sont déduites, y compris les régularisations d'années passées. La CSG-CRDS détaillée sur votre échéancier ou votre attestation URSSAF permet de séparer la part déductible. Si vous ne la renseignez pas, tout le paiement est compté comme cotisation déductible : vérifiez avec votre comptable. Les cotisations facultatives Madelin santé/prévoyance se saisissent à part ; PER et Madelin retraite vont sur la 2042.${u.paid && !u.csgDed && !u.csgND ? ' <b>Aucun détail CSG-CRDS saisi pour l\'URSSAF cette année.</b>' : ''}</p></div>`;
  $('#cotBody').innerHTML = h;
  $$('#cotBody [data-appel]').forEach((i) => (i.onchange = () => { settings.set(`appel.${year}.${i.dataset.appel}`, i.value); renderCot(); }));
  $$('#cotBody [data-edit]').forEach((b) => (b.onclick = () => startEdit(b.dataset.edit)));
  $$('#cotBody [data-addcot]').forEach((b) => (b.onclick = () => { resetForm(); $('#t-dep').checked = true; fillCats(b.dataset.addcot); editedFrom = 'cot'; $('#f-label').value = b.dataset.addcot === 'urssaf' ? 'Cotisations URSSAF' : 'Cotisations CARPIMKO'; show('saisie'); }));
}

/* ---------- Réglages / sauvegardes ---------- */
function renderSettings() {
  $('#s-name').value = settings.get('name', '');
  $('#s-regime').value = settings.get('regime', 'inconnu');
  $('#s-oga').value = settings.get('oga', 'oui');
  $('#vehYear').textContent = year;
  if (!$('#s-vehtype').options.length) $('#s-vehtype').innerHTML = Object.entries(BAREME_KM).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#s-vehmethod').value = settings.get('vehMethod.' + year, 'bareme');
  $('#s-vehtype').value = settings.get('vehType', 'auto5');
  $('#s-vehelec').checked = settings.get('vehElec', '0') === '1';
  const lb = settings.get('lastBackup', '');
  $('#lastBackup').textContent = lb ? 'Dernière sauvegarde : ' + new Date(lb).toLocaleDateString('fr-FR') : 'Aucune sauvegarde faite sur cet appareil.';
}

function backupBanner() {
  const lb = settings.get('lastBackup', '');
  const b = $('#backupBanner');
  const days = lb ? (Date.now() - new Date(lb).getTime()) / 864e5 : Infinity;
  if (entries.length && days > 30) { b.hidden = false; b.textContent = lb ? 'Dernière sauvegarde il y a plus d\'un mois. Pensez à sauvegarder (Réglages).' : 'Aucune sauvegarde pour le moment. Pensez à sauvegarder (Réglages).'; }
  else b.hidden = true;
}

const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const dataURLToBlob = async (u) => (await fetch(u)).blob();

function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportBackup() {
  toast('Préparation de la sauvegarde…');
  const files = await dbAll('files');
  const out = { app: 'compta-idel', version: 1, exported: new Date().toISOString(), settings: settings.all(), entries, files: [] };
  for (const f of files) out.files.push({ id: f.id, entryId: f.entryId, name: f.name, type: f.type, data: await blobToDataURL(f.blob) });
  download(`compta-idel-sauvegarde-${todayISO()}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
  settings.set('lastBackup', new Date().toISOString()); renderSettings(); backupBanner();
  toast('Sauvegarde téléchargée');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'compta-idel') throw new Error('format');
    if (!confirm(`Restaurer ${data.entries.length} opération(s) ? Les opérations de même identifiant seront remplacées, les autres sont conservées.`)) return;
    for (const e of data.entries) await dbPut('entries', e);
    for (const f of data.files || []) await dbPut('files', { id: f.id, entryId: f.entryId, name: f.name, type: f.type, blob: await dataURLToBlob(f.data) });
    if (data.settings) Object.entries(data.settings).forEach(([k, v]) => settings.set(k, v));
    await reload(); fillYears(); renderSettings(); backupBanner(); toast('Sauvegarde restaurée');
  } catch (err) { console.error(err); toast('Fichier de sauvegarde invalide'); }
}

function exportCsv() {
  const list = entries.filter((e) => e.date?.startsWith(String(year))).sort((a, b) => (a.date < b.date ? -1 : 1));
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const num = (n) => String(n).replace('.', ',');
  const rows = [['Date', 'Type', 'Catégorie', 'Poste fiscal', 'Libellé', 'Mode', 'Montant', 'Part pro %', 'Montant déductible', 'Justificatifs', 'Kilomètres', 'Note'].map(q).join(';')];
  list.forEach((e) => {
    const c = catByKey(e.cat);
    rows.push([e.date, e.type, c?.label, POSTES[c?.poste]?.label, e.label, e.mode, num(e.amount), e.pct ?? '', e.type === 'depense' ? num(deductible(e)) : e.type === 'recette' ? num(e.amount) : '', e.nFiles || 0, e.km ?? '', e.note].map(q).join(';'));
  });
  download(`livre-journal-${year}.csv`, new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
}

/* ---------- Initialisation ---------- */
async function init() {
  try { await openDB(); } catch (e) { document.body.innerHTML = '<p style="padding:20px">Stockage local indisponible (navigation privée ?). Ouvrez l\'application dans une fenêtre normale.</p>'; return; }
  await reload();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  fillYears(); resetForm(); backupBanner();

  $$('.tabs button').forEach((b) => (b.onclick = () => { editedFrom = null; show(b.dataset.view); }));
  $('#yearSel').onchange = (e) => { year = Number(e.target.value); const v = $$('.view').find((x) => !x.hidden).id.replace('view-', ''); show(v); };
  $$('input[name=type]').forEach((r) => (r.onchange = () => fillCats()));
  $('#f-cat').onchange = onCatChange;
  $('#form').onsubmit = saveForm;
  $('#btnCancel').onclick = () => { const back = editedFrom || 'mois'; resetForm(); show(back); };
  $('#btnPhoto').onclick = () => $('#inPhoto').click();
  $('#btnFile').onclick = () => $('#inFile').click();
  $('#inPhoto').onchange = async (e) => { await addFiles([...e.target.files]); e.target.value = ''; };
  $('#inFile').onchange = async (e) => { await addFiles([...e.target.files]); e.target.value = ''; };

  $('#monthSel').onchange = (e) => { month = Number(e.target.value); renderMonth(); };
  $('#mPrev').onclick = () => { month--; if (month < 0) { month = 11; year--; fillYears(); } renderMonth(); };
  $('#mNext').onclick = () => { month++; if (month > 11) { month = 0; year++; fillYears(); } renderMonth(); };
  $('#monthList').onclick = (ev) => {
    const btn = ev.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.item').dataset.id;
    ({ edit: startEdit, del: deleteEntry, docs: showDocs })[btn.dataset.act](id);
  };

  $('#viewerClose').onclick = () => { $('#viewer').hidden = true; $('#viewerImg').onclick = null; };
  $('#viewer').onclick = (e) => { if (e.target.id === 'viewer') $('#viewer').hidden = true; };

  $('#btnPrint').onclick = () => window.print();
  $('#s-name').oninput = (e) => settings.set('name', e.target.value);
  $('#s-regime').onchange = (e) => settings.set('regime', e.target.value);
  $('#s-oga').onchange = (e) => settings.set('oga', e.target.value);
  $('#s-vehmethod').onchange = (e) => settings.set('vehMethod.' + year, e.target.value);
  $('#s-vehtype').onchange = (e) => settings.set('vehType', e.target.value);
  $('#s-vehelec').onchange = (e) => settings.set('vehElec', e.target.checked ? '1' : '0');
  $('#btnExport').onclick = exportBackup;
  $('#inRestore').onchange = async (e) => { if (e.target.files[0]) await importBackup(e.target.files[0]); e.target.value = ''; };
  $('#btnCsv').onclick = exportCsv;
  $('#btnWipe').onclick = async () => {
    if (!confirm('Effacer TOUTES les données de cet appareil ? Faites d\'abord une sauvegarde.')) return;
    if (!confirm('Dernière confirmation : cette action est définitive.')) return;
    await dbClear(); await reload(); fillYears(); backupBanner(); toast('Données effacées');
  };

  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#btnInstall').hidden = false; });
  $('#btnInstall').onclick = async () => { if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $('#btnInstall').hidden = true; } };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
