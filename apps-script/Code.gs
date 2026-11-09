/**
 * Fitko – API nad Google tabulkou (Apps Script web app).
 *
 * Skript je vázaný na tabulku (Rozšíření → Apps Script). Token se neukládá
 * do kódu, ale do Vlastností skriptu: jednou spusť funkci nastavToken().
 *
 * Všechny požadavky jdou přes POST s JSON tělem: { token, action, ... }
 *   action "nacist"  { osoba? }    → cviky, plan, nastaveni, zaznamy (poslední 2 dny na cvik)
 *   action "zapsat"  { zaznamy[] } → přidá nebo přepíše řádky podle zaznam_id;
 *                                   záznam { zaznam_id, smazat: true } řádek smaže
 */

const ZAZNAMY_SLOUPCE = ['zaznam_id', 'cas_zapisu', 'datum', 'osoba', 'trenink',
  'cvik_id', 'serie_c', 'vaha_kg', 'opakovani', 'poznamka'];
const MAX_ZAZNAMU_V_POZADAVKU = 500;

/** Spusť jednou ručně v editoru. Token se vypíše do protokolu (Zobrazit → Protokoly). */
function nastavToken() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('Token (zadej ho do aplikace, nikam ho neukládej veřejně): ' + token);
}

function doGet() {
  return ContentService.createTextOutput('Fitko API běží.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) {
      out = { ok: false, chyba: 'Neplatný token' };
    } else if (req.action === 'nacist') {
      out = nacist(req);
    } else if (req.action === 'zapsat') {
      out = zapsat(req);
    } else {
      out = { ok: false, chyba: 'Neznámá akce' };
    }
  } catch (err) {
    out = { ok: false, chyba: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function nacist(req) {
  const out = {
    ok: true,
    cviky: ctiList('Cviky'),
    plan: ctiList('Plan'),
    nastaveni: ctiList('Nastaveni'),
    zaznamy: []
  };
  if (req.osoba) {
    // Pro každý cvik vrátí série ze dvou posledních dnů (dnešek + minule).
    const moje = ctiList('Zaznamy').filter(function (r) { return r.osoba === req.osoba; });
    const dnyCviku = {};
    moje.forEach(function (r) {
      (dnyCviku[r.cvik_id] = dnyCviku[r.cvik_id] || {})[r.datum] = true;
    });
    Object.keys(dnyCviku).forEach(function (id) {
      const dny = Object.keys(dnyCviku[id]).sort().reverse().slice(0, 2);
      dnyCviku[id] = dny;
    });
    out.zaznamy = moje.filter(function (r) {
      return dnyCviku[r.cvik_id].indexOf(r.datum) !== -1;
    });
  }
  return out;
}

function zapsat(req) {
  const zaznamy = req.zaznamy || [];
  if (!Array.isArray(zaznamy) || zaznamy.length > MAX_ZAZNAMU_V_POZADAVKU) {
    return { ok: false, chyba: 'Neplatný počet záznamů' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const list = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Zaznamy');
    const posledni = list.getLastRow();
    const radekPodleId = {};
    if (posledni > 1) {
      list.getRange(2, 1, posledni - 1, 1).getValues().forEach(function (r, i) {
        radekPodleId[String(r[0])] = i + 2;
      });
    }
    const nove = [];
    const ulozeno = [];
    const keSmazani = [];
    zaznamy.forEach(function (z) {
      if (!z || !z.zaznam_id) return;
      if (z.smazat) {
        const r = radekPodleId[String(z.zaznam_id)];
        if (r && r <= posledni && keSmazani.indexOf(r) === -1) keSmazani.push(r);
        ulozeno.push(String(z.zaznam_id));
        return;
      }
      const radek = [
        text(z.zaznam_id), text(z.cas_zapisu), text(z.datum), text(z.osoba), text(z.trenink),
        text(z.cvik_id), cislo(z.serie_c), cislo(z.vaha_kg), cislo(z.opakovani), text(z.poznamka)
      ];
      const existujici = radekPodleId[radek[0]];
      if (existujici) {
        list.getRange(existujici, 1, 1, radek.length).setValues([radek]);
      } else {
        radekPodleId[radek[0]] = posledni + nove.length + 1;
        nove.push(radek);
      }
      ulozeno.push(radek[0]);
    });
    if (nove.length) {
      list.getRange(posledni + 1, 1, nove.length, ZAZNAMY_SLOUPCE.length).setValues(nove);
    }
    // Mazání až nakonec a odspodu, aby se neposunula čísla řádků.
    keSmazani.sort(function (a, b) { return b - a; }).forEach(function (r) { list.deleteRow(r); });
    return { ok: true, ulozeno: ulozeno };
  } finally {
    lock.releaseLock();
  }
}

/** Načte list jako pole objektů podle hlavičky; prázdné řádky přeskočí. */
function ctiList(nazev) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const list = ss.getSheetByName(nazev);
  if (!list || list.getLastRow() < 2) return [];
  const tz = ss.getSpreadsheetTimeZone();
  const data = list.getDataRange().getValues();
  const hlavicka = data.shift().map(String);
  return data
    .filter(function (r) { return r.some(function (b) { return b !== ''; }); })
    .map(function (r) {
      const o = {};
      hlavicka.forEach(function (h, i) {
        let v = r[i];
        if (v instanceof Date) {
          v = Utilities.formatDate(v, tz, h === 'datum' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
        }
        if (h) o[h] = v;
      });
      return o;
    });
}

/** Text bezpečný pro zápis do buňky (nesmí se z něj stát vzorec). */
function text(v) {
  const s = v == null ? '' : String(v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cislo(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isFinite(n) ? n : '';
}
