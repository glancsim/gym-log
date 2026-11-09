'use strict';
/*
 * Fitko – tréninkový deník. Statická stránka bez backendu.
 * Žádná osobní data v kódu: plán, cviky i jména se načítají z Google tabulky
 * přes Apps Script. Adresa skriptu a token jsou jen v localStorage zařízení.
 */

// ---------- úložiště ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('fitko.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem('fitko.' + k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem('fitko.' + k); }
};

let cfg = LS.get('cfg', { url: '', token: '', osoba: '' });
let data = LS.get('data', null);        // { cviky, plan, nastaveni, zaznamy }
let fronta = LS.get('fronta', []);      // série čekající na odeslání
let dnesni = LS.get('dnesni', null);    // { datum, osoba, zaznamy: { "cvik#serie": zaznam } }
let obrazovka = 'trenink';              // 'trenink' | 'nastaveni'
let hlaska = null;                      // { text, chyba }
let odesilam = false;
let aktualniPlan = [];

// ---------- pomocné ----------
const app = document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dve = n => String(n).padStart(2, '0');
const fmt = n => (n === '' || n == null) ? '' : String(n).replace('.', ',');
const cti = s => { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : null; };
const klic = (cvikId, serie) => cvikId + '#' + serie;
const DNY = ['ne', 'po', 'ut', 'st', 'ct', 'pa', 'so'];

function dnes() { const d = new Date(); return d.getFullYear() + '-' + dve(d.getMonth() + 1) + '-' + dve(d.getDate()); }
function ted() { const d = new Date(); return dnes() + ' ' + dve(d.getHours()) + ':' + dve(d.getMinutes()) + ':' + dve(d.getSeconds()); }
function kratkeDatum(iso) { const p = String(iso).split('-'); return p.length === 3 ? Number(p[2]) + '. ' + Number(p[1]) + '.' : iso; }
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function dnesniStav() {
  if (!dnesni || dnesni.datum !== dnes() || dnesni.osoba !== cfg.osoba) {
    dnesni = { datum: dnes(), osoba: cfg.osoba, zaznamy: {} };
    LS.set('dnesni', dnesni);
  }
  return dnesni;
}

function nastaveni(k, vychozi) {
  const radky = (data && data.nastaveni) || [];
  const r = radky.find(x => x.osoba === cfg.osoba && x.klic === k) || radky.find(x => x.osoba === '*' && x.klic === k);
  const n = r ? Number(r.hodnota) : NaN;
  return isFinite(n) ? n : vychozi;
}

/** Barva appky podle osoby: list Nastaveni, klíč "barva", hodnota jako hex kód. */
function pouzijBarvu() {
  const radky = (data && data.nastaveni) || [];
  const r = radky.find(x => x.osoba === cfg.osoba && x.klic === 'barva') || radky.find(x => x.osoba === '*' && x.klic === 'barva');
  const b = r ? String(r.hodnota).trim() : '';
  if (/^#[0-9a-fA-F]{6}$/.test(b)) document.documentElement.style.setProperty('--akcent', b);
  else document.documentElement.style.removeProperty('--akcent');
}

// ---------- komunikace se skriptem ----------
async function api(action, extra) {
  if (cfg.url === 'demo') return demoApi(action, extra || {});
  // text/plain = jednoduchý požadavek bez CORS preflightu, který Apps Script neumí.
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: cfg.token, action: action }, extra || {}))
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.chyba || 'Chyba serveru');
  return j;
}

async function nacti() {
  const j = await api('nacist', { osoba: cfg.osoba });
  data = { cviky: j.cviky, plan: j.plan, nastaveni: j.nastaveni, zaznamy: j.zaznamy || [] };
  LS.set('data', data);
  // Dnešní série, které už jsou v tabulce (např. po přeinstalaci), doplň do rozpracovaného tréninku.
  if (cfg.osoba) {
    const st = dnesniStav();
    data.zaznamy.filter(z => z.datum === st.datum).forEach(z => {
      const k = klic(z.cvik_id, z.serie_c);
      if (!st.zaznamy[k]) st.zaznamy[k] = z;
    });
    const casy = Object.keys(st.zaznamy).map(k => st.zaznamy[k].cas_zapisu).filter(Boolean).sort();
    if (!st.start && casy.length) st.start = casy[0];
    LS.set('dnesni', st);
  }
}

function doFronty(z) {
  fronta = fronta.filter(x => x.zaznam_id !== z.zaznam_id);
  fronta.push(z);
  LS.set('fronta', fronta);
}

async function odesli() {
  if (odesilam || !fronta.length) { kresliSync(); return; }
  odesilam = true;
  const davka = fronta.slice();
  try {
    const j = await api('zapsat', { zaznamy: davka });
    const ulozeno = new Set(j.ulozeno || []);
    // Záznam upravený během odesílání (jiný čas zápisu) ve frontě zůstane.
    fronta = fronta.filter(x => !davka.some(d => d.zaznam_id === x.zaznam_id && d.cas_zapisu === x.cas_zapisu && ulozeno.has(x.zaznam_id)));
    LS.set('fronta', fronta);
    odesilam = false;
    kresliSync();
    // Série zapsané během odesílání pošli hned v další dávce.
    if (fronta.length && ulozeno.size) odesli();
    return;
  } catch (e) { /* bez signálu: zůstává ve frontě */ }
  odesilam = false;
  kresliSync();
}

// ---------- plán a progrese ----------
function osoby() {
  const s = [];
  ((data && data.plan) || []).forEach(p => { if (p.osoba && s.indexOf(p.osoba) === -1) s.push(p.osoba); });
  return s;
}

function treninky() {
  const s = [];
  data.plan.filter(p => p.osoba === cfg.osoba && p.aktivni !== 'ne').forEach(p => {
    if (!s.some(t => t.nazev === p.trenink)) s.push({ nazev: p.trenink, den: p.den });
  });
  return s;
}

function vybranyTrenink() {
  const t = treninky();
  if (!t.length) return null;
  const v = LS.get('vyber', null);
  if (v && v.datum === dnes() && v.osoba === cfg.osoba && t.some(x => x.nazev === v.trenink)) return v.trenink;
  const podleDne = t.find(x => x.den === DNY[new Date().getDay()]);
  return (podleDne || t[0]).nazev;
}

function minule(cvikId) {
  const stare = data.zaznamy.filter(z => z.cvik_id === cvikId && z.datum < dnes());
  if (!stare.length) return [];
  const posledni = stare.map(z => z.datum).sort().pop();
  return stare.filter(z => z.datum === posledni).sort((a, b) => a.serie_c - b.serie_c);
}

/** Dvojitá progrese: drž váhu, dokud nejsou všechny série na horní hranici; pak přidej krok. */
function navrh(c, p, m) {
  if (c.typ !== 'vaha') return { vaha: null, text: '' };
  if (!m.length) return { vaha: null, text: 'První zápis: zvol váhu, se kterou dáš ' + p.opak_min + '–' + p.opak_max + ' opakování s rezervou.' };
  const krok = Number(c.krok_kg) || nastaveni('vychozi_krok_kg', 2.5);
  const tolerance = nastaveni('snizeni_tolerance_opak', 2);
  const vaha = Math.max.apply(null, m.map(z => Number(z.vaha_kg) || 0));
  const opak = m.map(z => Number(z.opakovani) || 0);
  const prumer = opak.reduce((a, b) => a + b, 0) / opak.length;
  const splneno = m.length >= Number(p.serie) && m.every(z => (Number(z.vaha_kg) || 0) === vaha && Number(z.opakovani) >= Number(p.opak_max));
  if (splneno) return { vaha: vaha + krok, zmena: true, text: 'přidej ' + fmt(krok) + ' kg, minule splněno ' + p.serie + '×' + p.opak_max };
  if (prumer < Number(p.opak_min) - tolerance) return { vaha: Math.max(0, vaha - krok), zmena: true, text: 'uber ' + fmt(krok) + ' kg, minule výrazně pod ' + p.opak_min + ' opak.' };
  return { vaha: vaha, text: 'drž váhu, cíl ' + p.serie + '×' + p.opak_max };
}

function predvypln(c, p, n) {
  const m = minule(c.cvik_id);
  const nv = navrh(c, p, m);
  const stejna = m.find(z => Number(z.serie_c) === n);
  let opak = Number(p.opak_max);
  if (nv.zmena) opak = Number(p.opak_min);
  else if (stejna) opak = Number(stejna.opakovani);
  // Váhu převezmi z předchozí dnes zapsané série, pokud existuje.
  const st = dnesniStav();
  let vaha = nv.vaha;
  for (let i = n - 1; i >= 1; i--) {
    const z = st.zaznamy[klic(c.cvik_id, i)];
    if (z) { vaha = z.vaha_kg; break; }
  }
  return { vaha: vaha, opak: opak };
}

function pocetRadku(c, p) {
  const st = dnesniStav();
  let n = Number(p.serie) || 1;
  Object.keys(st.zaznamy).forEach(k => {
    const z = st.zaznamy[k];
    if (z.cvik_id === c.cvik_id && Number(z.serie_c) > n) n = Number(z.serie_c);
  });
  return n;
}

function zapsano(c) {
  const st = dnesniStav();
  return Object.keys(st.zaznamy).filter(k => st.zaznamy[k].cvik_id === c.cvik_id).length;
}

// ---------- čas a ukončení tréninku ----------
function minuty() {
  const st = dnesniStav();
  if (!st.start) return null;
  const od = new Date(st.start.replace(' ', 'T'));
  const po = st.konec ? new Date(st.konec.replace(' ', 'T')) : new Date();
  return Math.max(0, Math.round((po - od) / 60000));
}

function kresliCas() {
  const el = document.querySelector('.cas');
  if (!el) return;
  const m = minuty();
  el.textContent = m == null ? '' : ' · ' + m + ' min' + (dnesniStav().konec ? ' (ukončeno)' : '');
}

function konecHTML() {
  const st = dnesniStav();
  const n = Object.keys(st.zaznamy).length;
  if (!n) return '';
  if (!st.konec) return '<button class="velke hlavni" data-akce="ukoncit">Ukončit trénink</button>';
  return '<div class="souhrn"><b>Trénink ukončen.</b><br>Doba: ' + minuty() + ' min · zapsané série: ' + n + '<br>' +
    (fronta.length ? 'Na odeslání čeká ' + fronta.length + '. Otevři appku, až bude signál.' : 'Vše je uložené v tabulce.') +
    '</div><button class="velke" data-akce="pokracovat">Pokračovat v tréninku</button>';
}

function kresliKonec() {
  const el = document.getElementById('konec');
  if (el) el.innerHTML = konecHTML();
  kresliCas();
}

// ---------- vykreslení ----------
function kresli() {
  pouzijBarvu();
  if (!cfg.url) return kresliPripojeni();
  if (!data) return kresliNacitani();
  if (!cfg.osoba || osoby().indexOf(cfg.osoba) === -1) return kresliOsoby();
  if (obrazovka === 'nastaveni') return kresliNastaveni();
  kresliTrenink();
}

function hlaskaHTML() {
  return hlaska ? '<div class="hlaska ' + (hlaska.chyba ? 'chyba' : '') + '">' + esc(hlaska.text) + '</div>' : '';
}

function kresliPripojeni() {
  app.innerHTML = '<div class="formular"><h1>Fitko</h1>' +
    '<p>Zadej adresu Apps Scriptu a token. Uloží se jen v tomto zařízení.</p>' + hlaskaHTML() +
    '<label for="url">Adresa skriptu (končí /exec)</label><input id="url" type="url" autocomplete="off" autocapitalize="off" spellcheck="false">' +
    '<label for="token">Token</label><input id="token" type="password" autocomplete="off">' +
    '<button class="velke hlavni" data-akce="pripojit">Připojit</button>' +
    '<button class="velke" data-akce="demo">Vyzkoušet s ukázkovými daty</button></div>';
}

function kresliNacitani() {
  app.innerHTML = '<div class="formular"><h1>Fitko</h1><p>Načítám plán…</p>' + hlaskaHTML() +
    '<button class="velke" data-akce="znovu">Zkusit znovu</button>' +
    '<button class="velke nebezpecne" data-akce="odpojit">Zadat jinou adresu nebo token</button></div>';
}

function kresliOsoby() {
  app.innerHTML = '<div class="formular"><h1>Kdo cvičí?</h1><p>Volba se uloží v tomto zařízení, změníš ji v nastavení.</p>' +
    osoby().map(o => '<button class="velke" data-akce="osoba" data-osoba="' + esc(o) + '">' + esc(o) + '</button>').join('') +
    (osoby().length ? '' : '<div class="hlaska chyba">V listu Plan nejsou žádné osoby.</div>') + '</div>';
}

function kresliNastaveni() {
  app.innerHTML = '<header><div class="lista"><h1>Nastavení</h1><button data-akce="zpet">Zpět</button></div></header>' +
    '<div class="formular">' + hlaskaHTML() +
    '<label>Kdo cvičí</label>' +
    osoby().map(o => '<button class="velke ' + (o === cfg.osoba ? 'hlavni' : '') + '" data-akce="osoba" data-osoba="' + esc(o) + '">' + esc(o) + '</button>').join('') +
    '<label>Data</label>' +
    '<button class="velke" data-akce="obnovit">Načíst znovu plán z tabulky</button>' +
    '<button class="velke" data-akce="odeslat">Odeslat čekající série (' + fronta.length + ')</button>' +
    '<label>Připojení' + (cfg.url === 'demo' ? ' – ukázková data' : '') + '</label>' +
    '<button class="velke nebezpecne" data-akce="odpojit">Odpojit toto zařízení</button></div>';
}

function kresliSync() {
  const b = document.querySelector('.sync');
  if (!b) return;
  b.className = 'sync ' + (fronta.length ? 'ceka' : 'vse');
  b.textContent = fronta.length ? '↑ ' + fronta.length : '✓';
  b.setAttribute('aria-label', fronta.length ? 'Čeká na odeslání: ' + fronta.length : 'Vše odesláno');
  kresliKonec();
}

function kresliTrenink() {
  const vybrany = vybranyTrenink();
  const t = treninky();
  aktualniPlan = data.plan
    .filter(p => p.osoba === cfg.osoba && p.trenink === vybrany && p.aktivni !== 'ne')
    .sort((a, b) => a.poradi - b.poradi);
  const d = new Date();
  let html = '<header><div class="lista"><h1>' + esc(vybrany || 'Žádný trénink') +
    '<small>' + esc(cfg.osoba) + ' · ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.<span class="cas"></span></small></h1>' +
    '<button class="sync" data-akce="odeslat"></button>' +
    '<button data-akce="nastaveni" aria-label="Nastavení">⚙</button></div>';
  if (t.length > 1) {
    html += '<div class="cipy">' + t.map(x => '<button data-akce="trenink" data-trenink="' + esc(x.nazev) + '" class="' +
      (x.nazev === vybrany ? 'vybrany' : '') + '">' + esc(x.nazev) + '</button>').join('') + '</div>';
  }
  html += '</header>' + hlaskaHTML();
  if (!aktualniPlan.length) html += '<div class="hlaska">Pro tuto osobu není v listu Plan žádný aktivní cvik.</div>';
  html += aktualniPlan.map((p, i) => kartaHTML(p, i)).join('') + '<div class="formular" id="konec"></div>';
  app.innerHTML = html;
  kresliSync();
}

function cvikPodleId(id) {
  return data.cviky.find(c => c.cvik_id === id) || { cvik_id: id, nazev: id, typ: 'vaha', popis: '', obrazek_url: '' };
}

function kartaHTML(p, i) {
  const c = cvikPodleId(p.cvik_id);
  const m = minule(c.cvik_id);
  const nv = navrh(c, p, m);
  const jednotka = c.typ === 'cas' ? ' s' : ' opak.';
  let h = '<article class="karta ' + (zapsano(c) >= Number(p.serie) ? 'hotovo' : '') + '" data-i="' + i + '"><div class="hlava">';
  if (c.obrazek_url) {
    h += '<img class="foto" crossorigin="anonymous" loading="lazy" alt="" src="' + esc(c.obrazek_url) + '" data-akce="foto">';
  }
  h += '<div><h2>' + esc(c.nazev) + '</h2><div class="cil">' + esc(p.serie) + ' × ' + esc(p.opak_min) +
    (String(p.opak_max) !== String(p.opak_min) ? '–' + esc(p.opak_max) : '') + jednotka +
    (p.poznamka && p.lekar !== 'ano' ? ' · ' + esc(p.poznamka) : '') + '</div></div></div>';
  if (p.lekar === 'ano') {
    h += '<div class="lekar">⚕ Zátěž rukou – jen po souhlasu lékaře.' + (p.poznamka ? ' ' + esc(p.poznamka) : '') + '</div>';
  }
  if (m.length) {
    const vahy = m.map(z => z.vaha_kg);
    const stejne = vahy.every(v => v === vahy[0]);
    let txt;
    if (c.typ !== 'vaha') txt = m.map(z => z.opakovani).join(', ') + (c.typ === 'cas' ? ' s' : '');
    else if (stejne) txt = fmt(vahy[0]) + ' kg × ' + m.map(z => z.opakovani).join(', ');
    else txt = m.map(z => fmt(z.vaha_kg) + '×' + z.opakovani).join(', ');
    h += '<div class="info">Minule (' + kratkeDatum(m[0].datum) + '): <b>' + esc(txt) + '</b></div>';
  }
  if (nv.text) {
    h += '<div class="info navrh">Dnes: ' + (nv.vaha != null ? '<b>' + fmt(nv.vaha) + ' kg</b> – ' : '') + esc(nv.text) + '</div>';
  }
  h += '<details><summary>Jak na to</summary>' + esc(c.popis || 'Popis chybí.') +
    (c.alternativa ? '<br>Náhrada: ' + esc(c.alternativa) : '') + '</details><div class="serie">';
  const n = pocetRadku(c, p);
  for (let s = 1; s <= n; s++) h += radekHTML(c, p, s);
  h += '</div><button class="pridat" data-akce="pridat">+ série</button>' +
    '<button class="pridat" data-akce="odebrat">− série</button></article>';
  return h;
}

function radekHTML(c, p, n) {
  const z = dnesniStav().zaznamy[klic(c.cvik_id, n)];
  const pre = z ? { vaha: z.vaha_kg, opak: z.opakovani } : predvypln(c, p, n);
  const sVahou = c.typ === 'vaha';
  let h = '<div class="radek ' + (sVahou ? '' : 'bezvahy ') + (z ? 'ok' : '') + '" data-serie="' + n + '"><span class="cislo">' + n + '</span>';
  if (sVahou) {
    h += '<button data-akce="krok" data-pole="vaha" data-smer="-1" aria-label="Ubrat váhu">−</button>' +
      '<input class="vaha" type="text" inputmode="decimal" placeholder="kg" aria-label="Váha v kg" value="' + esc(fmt(pre.vaha)) + '">' +
      '<button data-akce="krok" data-pole="vaha" data-smer="1" aria-label="Přidat váhu">+</button>';
  }
  h += '<button data-akce="krok" data-pole="opak" data-smer="-1" aria-label="Ubrat">−</button>' +
    '<input class="opak" type="text" inputmode="numeric" placeholder="' + (c.typ === 'cas' ? 's' : 'op.') + '" aria-label="' +
    (c.typ === 'cas' ? 'Čas v sekundách' : 'Opakování') + '" value="' + esc(fmt(pre.opak)) + '">' +
    '<button data-akce="krok" data-pole="opak" data-smer="1" aria-label="Přidat">+</button>' +
    '<button class="zapsat" data-akce="zapsat" aria-label="Zapsat sérii ' + n + '">✓</button>';
  if (z) {
    h += '<div class="podradek"><button data-akce="pozn">✎ ' + esc(z.poznamka || 'poznámka') + '</button>' +
      '<button data-akce="smazat" aria-label="Smazat sérii ' + n + '">✕ smazat</button></div>';
  }
  return h + '</div>';
}

// ---------- akce ----------
function kontext(el) {
  const karta = el.closest('.karta');
  const p = aktualniPlan[Number(karta.dataset.i)];
  const radek = el.closest('.radek');
  return { karta: karta, p: p, c: cvikPodleId(p.cvik_id), radek: radek, n: radek ? Number(radek.dataset.serie) : null };
}

function krok(el) {
  const k = kontext(el);
  const vaha = el.dataset.pole === 'vaha';
  const input = k.radek.querySelector(vaha ? '.vaha' : '.opak');
  const o = vaha ? (Number(k.c.krok_kg) || nastaveni('vychozi_krok_kg', 2.5)) : (k.c.typ === 'cas' ? 5 : 1);
  const nova = Math.max(0, (cti(input.value) || 0) + Number(el.dataset.smer) * o);
  input.value = fmt(Math.round(nova * 100) / 100);
  k.radek.classList.remove('ok');
}

function zapis(el) {
  const k = kontext(el);
  const sVahou = k.c.typ === 'vaha';
  const vstupOpak = k.radek.querySelector('.opak');
  const vstupVaha = k.radek.querySelector('.vaha');
  const opak = cti(vstupOpak.value);
  const vaha = sVahou ? cti(vstupVaha.value) : '';
  if (sVahou && (vaha == null || vaha < 0)) { vstupVaha.focus(); return; }
  if (opak == null || opak <= 0) { vstupOpak.focus(); return; }
  const st = dnesniStav();
  const stary = st.zaznamy[klic(k.c.cvik_id, k.n)];
  const z = {
    zaznam_id: stary ? stary.zaznam_id : uid(),
    cas_zapisu: ted(), datum: st.datum, osoba: cfg.osoba, trenink: k.p.trenink,
    cvik_id: k.c.cvik_id, serie_c: k.n, vaha_kg: vaha, opakovani: Math.round(opak),
    poznamka: stary ? stary.poznamka || '' : ''
  };
  ulozZaznam(z);
  k.radek.outerHTML = radekHTML(k.c, k.p, k.n);
  // Další nezapsaná série převezme právě zapsanou váhu.
  const dalsi = k.karta.querySelector('.radek[data-serie="' + (k.n + 1) + '"]');
  if (dalsi && !dalsi.classList.contains('ok') && sVahou) dalsi.querySelector('.vaha').value = fmt(vaha);
  k.karta.classList.toggle('hotovo', zapsano(k.c) >= Number(k.p.serie));
  if (navigator.vibrate) navigator.vibrate(15);
}

function ulozZaznam(z) {
  const st = dnesniStav();
  st.zaznamy[klic(z.cvik_id, z.serie_c)] = z;
  if (!st.start) st.start = z.cas_zapisu;
  delete st.konec;
  LS.set('dnesni', st);
  doFronty(z);
  kresliSync();
  odesli();
}

function poznamka(el) {
  const k = kontext(el);
  const z = dnesniStav().zaznamy[klic(k.c.cvik_id, k.n)];
  if (!z) return;
  const t = prompt('Poznámka k sérii', z.poznamka || '');
  if (t === null) return;
  ulozZaznam(Object.assign({}, z, { poznamka: t.trim(), cas_zapisu: ted() }));
  k.radek.outerHTML = radekHTML(k.c, k.p, k.n);
}

function smazat(el) {
  const k = kontext(el);
  const st = dnesniStav();
  const z = st.zaznamy[klic(k.c.cvik_id, k.n)];
  if (!z || !confirm('Smazat ' + k.n + '. sérii?')) return;
  delete st.zaznamy[klic(k.c.cvik_id, k.n)];
  LS.set('dnesni', st);
  doFronty({ zaznam_id: z.zaznam_id, cas_zapisu: ted(), smazat: true });
  const posledni = k.n === k.karta.querySelectorAll('.radek').length;
  if (posledni && k.n > Number(k.p.serie)) k.radek.remove();
  else k.radek.outerHTML = radekHTML(k.c, k.p, k.n);
  k.karta.classList.toggle('hotovo', zapsano(k.c) >= Number(k.p.serie));
  kresliSync();
  odesli();
}

function odebratSerii(el) {
  const k = kontext(el);
  const radky = k.karta.querySelectorAll('.radek');
  if (radky.length <= 1) return;
  if (dnesniStav().zaznamy[klic(k.c.cvik_id, radky.length)]) {
    alert('Poslední série je zapsaná. Nejdřív ji smaž tlačítkem „✕ smazat“ pod ní.');
    return;
  }
  radky[radky.length - 1].remove();
}

function ukoncit(konec) {
  const st = dnesniStav();
  if (konec) st.konec = ted(); else delete st.konec;
  LS.set('dnesni', st);
  kresliKonec();
  if (konec) odesli();
}

/** Fotka přes celou obrazovku: výchozí i koncová poloha pod sebou, klepnutím se zavře. */
function zvetsit(el) {
  const prvni = el.getAttribute('src');
  const druha = prvni.replace(/\/0\.jpg$/, '/1.jpg');
  const nazev = el.closest('.karta').querySelector('h2').textContent;
  let h = '<div class="lupa" data-akce="zavrit"><b>' + esc(nazev) + '</b>' +
    '<img class="foto-velka" crossorigin="anonymous" alt="Výchozí poloha" src="' + esc(prvni) + '">';
  if (druha !== prvni) h += '<img class="foto-velka" crossorigin="anonymous" alt="Koncová poloha" src="' + esc(druha) + '">';
  app.insertAdjacentHTML('beforeend', h + '<small>Klepnutím zavřeš</small></div>');
}

function pridatSerii(el) {
  const k = kontext(el);
  const n = k.karta.querySelectorAll('.radek').length + 1;
  k.karta.querySelector('.serie').insertAdjacentHTML('beforeend', radekHTML(k.c, k.p, n));
}

async function nactiAKresli(zprava) {
  hlaska = zprava ? { text: zprava } : null;
  kresli();
  try {
    await nacti();
    hlaska = null;
  } catch (e) {
    hlaska = { text: data ? 'Nepodařilo se načíst nová data, zobrazuji uložená. (' + e.message + ')' : 'Načtení selhalo: ' + e.message, chyba: true };
  }
  kresli();
}

async function pripojit(url, token) {
  cfg = { url: url, token: token, osoba: '' };
  LS.set('cfg', cfg);
  data = null;
  await nactiAKresli();
}

function odpojit() {
  if (fronta.length && !confirm('Na odeslání čeká ' + fronta.length + ' sérií. Odpojením o ně přijdeš. Pokračovat?')) return;
  ['cfg', 'data', 'fronta', 'dnesni', 'vyber', 'demo'].forEach(LS.del);
  cfg = { url: '', token: '', osoba: '' }; data = null; fronta = []; dnesni = null; hlaska = null; obrazovka = 'trenink';
  kresli();
}

app.addEventListener('click', function (e) {
  const el = e.target.closest('[data-akce]');
  if (!el) return;
  const a = el.dataset.akce;
  if (a === 'krok') krok(el);
  else if (a === 'zapsat') zapis(el);
  else if (a === 'pozn') poznamka(el);
  else if (a === 'pridat') pridatSerii(el);
  else if (a === 'odebrat') odebratSerii(el);
  else if (a === 'smazat') smazat(el);
  else if (a === 'ukoncit') ukoncit(true);
  else if (a === 'pokracovat') ukoncit(false);
  else if (a === 'foto') zvetsit(el);
  else if (a === 'zavrit') el.remove();
  else if (a === 'trenink') { LS.set('vyber', { datum: dnes(), osoba: cfg.osoba, trenink: el.dataset.trenink }); window.scrollTo(0, 0); kresli(); }
  else if (a === 'nastaveni') { obrazovka = 'nastaveni'; hlaska = null; kresli(); }
  else if (a === 'zpet') { obrazovka = 'trenink'; hlaska = null; kresli(); }
  else if (a === 'odeslat') odesli().then(() => { if (obrazovka === 'nastaveni') kresli(); });
  else if (a === 'obnovit') { obrazovka = 'trenink'; nactiAKresli('Načítám…'); }
  else if (a === 'znovu') nactiAKresli('Načítám…');
  else if (a === 'odpojit') odpojit();
  else if (a === 'demo') pripojit('demo', '');
  else if (a === 'pripojit') {
    const url = document.getElementById('url').value.trim();
    const token = document.getElementById('token').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) || !token) {
      hlaska = { text: 'Zadej adresu ve tvaru https://script.google.com/…/exec a token.', chyba: true };
      kresli();
    } else pripojit(url, token);
  } else if (a === 'osoba') {
    cfg.osoba = el.dataset.osoba;
    LS.set('cfg', cfg);
    obrazovka = 'trenink';
    nactiAKresli('Načítám…');
  }
});

// Ruční úprava zapsané série: dokud ji znovu nepotvrdíš, není označená jako zapsaná.
app.addEventListener('input', function (e) {
  const r = e.target.closest('.radek');
  if (r) r.classList.remove('ok');
});
app.addEventListener('focusin', function (e) {
  if (e.target.matches('.radek input')) e.target.select();
});
// Obrázek, který se nenačte (např. offline bez mezipaměti), se skryje.
app.addEventListener('error', function (e) {
  const c = e.target.classList;
  if (c && (c.contains('foto') || c.contains('foto-velka'))) e.target.style.display = 'none';
}, true);

window.addEventListener('online', odesli);
setInterval(kresliCas, 20000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) odesli(); });

// ---------- ukázková data (bez připojení k tabulce) ----------
function demoApi(action, req) {
  const base = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
  const ulozene = LS.get('demo', []);
  if (action === 'zapsat') {
    req.zaznamy.forEach(z => {
      const i = ulozene.findIndex(x => x.zaznam_id === z.zaznam_id);
      if (z.smazat) { if (i >= 0) ulozene.splice(i, 1); }
      else if (i >= 0) ulozene[i] = z; else ulozene.push(z);
    });
    LS.set('demo', ulozene);
    return Promise.resolve({ ok: true, ulozeno: req.zaznamy.map(z => z.zaznam_id) });
  }
  const vcera = new Date(Date.now() - 2 * 864e5);
  const dv = vcera.getFullYear() + '-' + dve(vcera.getMonth() + 1) + '-' + dve(vcera.getDate());
  const hist = (cvik, serie) => serie.map((s, i) => ({ zaznam_id: 'demo-' + cvik + i, datum: dv, osoba: 'Osoba A', trenink: 'Ukázka', cvik_id: cvik, serie_c: i + 1, vaha_kg: s[0], opakovani: s[1], poznamka: '' }));
  return Promise.resolve({
    ok: true,
    cviky: [
      { cvik_id: 'tlak', nazev: 'Tlak s jednoručkami na lavici', typ: 'vaha', krok_kg: 2, popis: 'Ukázkový popis cviku.', obrazek_url: base + 'Dumbbell_Bench_Press/0.jpg', alternativa: 'stroj na prsa' },
      { cvik_id: 'kladka', nazev: 'Stahování horní kladky', typ: 'vaha', krok_kg: 5, popis: 'Ukázkový popis cviku.', obrazek_url: base + 'Wide-Grip_Lat_Pulldown/0.jpg', alternativa: '' },
      { cvik_id: 'biceps', nazev: 'Bicepsový zdvih', typ: 'vaha', krok_kg: 1, popis: 'Ukázkový popis cviku.', obrazek_url: base + 'Dumbbell_Bicep_Curl/0.jpg', alternativa: '' },
      { cvik_id: 'plank', nazev: 'Plank', typ: 'cas', krok_kg: '', popis: 'Ukázkový popis cviku.', obrazek_url: base + 'Plank/0.jpg', alternativa: '' },
      { cvik_id: 'vypady', nazev: 'Výpady v chůzi', typ: 'vlastni_vaha', krok_kg: '', popis: 'Ukázkový popis cviku.', obrazek_url: base + 'Bodyweight_Walking_Lunge/0.jpg', alternativa: '' }
    ],
    plan: [
      { osoba: 'Osoba A', trenink: 'Ukázka', den: '', poradi: 1, cvik_id: 'tlak', serie: 3, opak_min: 8, opak_max: 10, lekar: 'ne', aktivni: 'ano', poznamka: '' },
      { osoba: 'Osoba A', trenink: 'Ukázka', den: '', poradi: 2, cvik_id: 'kladka', serie: 3, opak_min: 8, opak_max: 10, lekar: 'ne', aktivni: 'ano', poznamka: '' },
      { osoba: 'Osoba A', trenink: 'Ukázka', den: '', poradi: 3, cvik_id: 'biceps', serie: 2, opak_min: 10, opak_max: 12, lekar: 'ne', aktivni: 'ano', poznamka: '' },
      { osoba: 'Osoba A', trenink: 'Ukázka', den: '', poradi: 4, cvik_id: 'plank', serie: 3, opak_min: 30, opak_max: 45, lekar: 'ne', aktivni: 'ano', poznamka: '' },
      { osoba: 'Osoba B', trenink: 'Ukázka', den: '', poradi: 1, cvik_id: 'vypady', serie: 3, opak_min: 8, opak_max: 10, lekar: 'ne', aktivni: 'ano', poznamka: 'na každou nohu' },
      { osoba: 'Osoba B', trenink: 'Ukázka', den: '', poradi: 2, cvik_id: 'biceps', serie: 2, opak_min: 12, opak_max: 15, lekar: 'ano', aktivni: 'ano', poznamka: '' }
    ],
    nastaveni: [{ osoba: '*', klic: 'snizeni_tolerance_opak', hodnota: 2 }, { osoba: '*', klic: 'vychozi_krok_kg', hodnota: 2.5 }, { osoba: 'Osoba B', klic: 'barva', hodnota: '#ff7eb6' }],
    zaznamy: req.osoba === 'Osoba A'
      ? hist('tlak', [[20, 10], [20, 10], [20, 10]]).concat(hist('kladka', [[40, 9], [40, 8], [40, 7]]), hist('biceps', [[12, 6], [12, 5]]), hist('plank', [['', 30], ['', 30], ['', 25]]), ulozene.filter(z => z.osoba === req.osoba))
      : ulozene.filter(z => z.osoba === req.osoba)
  });
}

// ---------- start ----------
if ('serviceWorker' in navigator) {
  // Když se na pozadí nainstaluje nová verze appky, stránka se jednou sama obnoví,
  // aby neběžel starý kód s novým vzhledem. Při úplně první instalaci se neobnovuje.
  const melaVerzi = !!navigator.serviceWorker.controller;
  let obnoveno = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (melaVerzi && !obnoveno) { obnoveno = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
kresli();
if (cfg.url) {
  // Překresli jen při skutečné změně dat, ať se nepřepíše rozepsaná série.
  const pred = JSON.stringify(data);
  nacti().then(
    function () { if (JSON.stringify(data) !== pred) kresli(); },
    function () { if (!data) { hlaska = { text: 'Načtení selhalo. Zkontroluj připojení.', chyba: true }; kresli(); } }
  );
}
odesli();
