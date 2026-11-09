# Fitko – tréninkový deník

Statická PWA pro zápis tréninků. Data jsou v soukromé Google tabulce, appka do ní
zapisuje přes Apps Script. V tomto repu nejsou žádná osobní data, adresa skriptu
ani token – ty se zadávají až v appce a zůstávají jen v zařízení.

```
index.html, app.js      aplikace
sw.js, manifest, ikony  instalace na plochu a provoz bez signálu
apps-script/Code.gs     skript, který se vloží do Google tabulky
```

## 1. Apps Script (asi 5 minut)

1. Otevři tabulku → **Rozšíření → Apps Script**.
2. Smaž obsah `Code.gs` a vlož obsah souboru `apps-script/Code.gs`. Ulož.
3. Nahoře vyber funkci **nastavToken** a klikni **Spustit**. Google se zeptá na
   oprávnění k tabulce – povol (u varování „aplikace není ověřena“ zvol
   Rozšířené → Přejít na projekt).
4. Dole v **Protokolu spuštění** je vypsaný token. Zkopíruj si ho do správce hesel.
   Nikdy ho nedávej do repa.
5. **Nasadit → Nové nasazení → typ Webová aplikace**:
   - Spustit jako: **Já**
   - Kdo má přístup: **Kdokoli**
6. Zkopíruj **adresu webové aplikace** (končí `/exec`).

Kontrola: adresa otevřená v prohlížeči vypíše `Fitko API běží.`

Při pozdější změně kódu: **Nasadit → Spravovat nasazení → tužka → Verze: Nová
verze → Nasadit**. Adresa zůstane stejná. Nový token získáš opětovným spuštěním
`nastavToken` (starý tím přestane platit).

## 2. GitHub Pages

1. Na GitHubu vytvoř nový **veřejný** repozitář (např. `fitko`).
2. Nahraj do něj obsah této složky (Add file → Upload files, nebo přes git).
3. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` → Save**.
4. Za minutu až dvě poběží appka na `https://<uživatel>.github.io/<repo>/`.

## 3. Telefon

1. Otevři adresu z kroku 2 (Android: Chrome, iPhone: Safari).
2. Přidej na plochu: Chrome **⋮ → Přidat na plochu**, Safari **Sdílet → Přidat na plochu**.
3. Spusť appku **z plochy** a teprve tam zadej adresu skriptu a token
   (na iPhonu má appka z plochy vlastní úložiště, oddělené od Safari).
4. Vyber, kdo cvičí.

Adresu skriptu a token pošli druhému člověku soukromým kanálem, ne e-mailem ani
do veřejného chatu.

## 4. Test před prvním tréninkem

| Krok | Co má nastat |
|---|---|
| Zapiš jednu sérii (✓) | V listu `Zaznamy` přibude řádek, vpravo nahoře je ✓ |
| Zapni režim Letadlo, zapiš sérii | Vpravo nahoře `↑ 1` |
| Vypni režim Letadlo, klepni na `↑ 1` | Řádek se objeví v tabulce, ukazatel se vrátí na ✓ |
| Změň opakování zapsané série a znovu ✓ | Řádek v tabulce se přepíše, nevznikne druhý |
| Zavři a otevři appku | Dnešní série zůstanou vyplněné |

Testovací řádky pak v listu `Zaznamy` smaž. Appka sérii smazat neumí, jen přepsat;
omylem zapsanou sérii smaž přímo v tabulce.

Bez tabulky si appku vyzkoušíš tlačítkem **Vyzkoušet s ukázkovými daty**.

## Úpravy

- **Plán a cviky** se mění jen v tabulce (listy `Plan`, `Cviky`). V appce pak
  Nastavení → Načíst znovu plán z tabulky.
- **Cvik vypnout**: v listu `Plan` nastav `aktivni` na `ne`.
- **Progrese**: list `Nastaveni` a sloupec `krok_kg` v listu `Cviky`.
- **Změna kódu appky**: zvyš `VERZE` v `sw.js`, jinak telefon drží starou verzi.

## Obrázky

Fotky cviků jsou z [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
(volné dílo, licence Unlicense) a načítají se přímo odtud. Klepnutí na fotku
přepne mezi výchozí a koncovou polohou.
