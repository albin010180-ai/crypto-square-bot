# Crypto Square Bot

Her 2 saatte bir kripto haber kaynaklarini tarar, en ilgi cekici haberleri secip
OpenRouter (ucretsiz model) ile **Turkce + Ingilizce** makaleye cevirir ve
**Binance Square** hesabinizda otomatik yayinlar. Tamamen GitHub Actions uzerinde
calisir; genel repo oldugu surece **0 TL maliyet**.

## Mimari

```
GitHub Actions (cron: 0 */2 * * *)
        |
        v
[1] Haber toplama  -> CoinDesk, Cointelegraph, Decrypt, The Block,
                       CryptoSlate, NewsBTC, Bitcoinist, U.Today (RSS)
[2] Secim + makale -> OpenRouter ucretsiz modeli (TR + EN)
[3] Yayin          -> Binance Square OpenAPI (contentType=2, makale)
[4] Durum kaydi    -> data/history.json repoya commit'lenir (mukerrer onleme)
```

## Kurulum (10 dakika)

### 1. GitHub reposu olusturun

1. GitHub'da yeni bir **public** repo olusturun (public = Actions dakikasi sinirsiz ucretsiz).
2. Bu klasorun icerigini repoya yukleyin:

```bash
cd crypto-square-bot
git init
git add .
git commit -m "crypto square bot"
git branch -M main
git remote add origin https://github.com/<KULLANICI_ADI>/<REPO>.git
git push -u origin main
```

> Not: `data/` klasorunu da yukleyin; bot her calistiginda gecmisini bu klasorde tutar.

### 2. Ucretsiz anahtarlari alin

| Anahtar | Nereden | Ucret |
|---|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys | Ucretsiz (kredi karti gerekmez) |
| `BINANCE_SQUARE_OPENAPI_KEY` | https://www.binance.com/square/creator-center/home (Creator Center > API) | Ucretsiz |

### 3. Secret'lari ekleyin

Repo > **Settings > Secrets and variables > Actions > New repository secret**:

- `OPENROUTER_API_KEY`
- `BINANCE_SQUARE_OPENAPI_KEY`

(Opsiyonel) **Variables** sekmesine `OPENROUTER_MODEL` ekleyerek modeli degistirebilirsiniz.
Varsayilan: `google/gemma-4-31b-it:free`.

### 4. Calistirin

- Ilk test: Repo > **Actions > Square Publish > Run workflow** (elle tetikleme).
- Sonrasinda otomatik: her 2 saatte bir (UTC 00:00, 02:00, ...).
- Not: GitHub zamanlanmis isler bazen 5-15 dk gecikebilir; normaldir.

## Ucretsiz limitler ve yeterlilik

| Kaynak | Limit | Kullanimimiz |
|---|---|---|
| GitHub Actions (public repo) | Sinirsiz dk | ~720 dk/ay |
| OpenRouter ucretsiz model | 50 istek/gun (kredisiz hesap) | ~12 istek/gun |
| Binance Square OpenAPI | 100 gonderi/gun | 24 gonderi/gun (12 tur x TR+EN) |

## Dosyalar

| Yol | Aciklama |
|---|---|
| `run.mjs` | Ana orkestrator (topla -> yaz -> yayinla -> kaydet) |
| `src/news.mjs` | RSS toplayici, onceliklendirme ve mukerrer temizligi |
| `src/write.mjs` | OpenRouter istemcisi (JSON dogrulama + model fallback) |
| `src/publish.mjs` | Binance Square OpenAPI istemcisi |
| `src/store.mjs` | Gecmis/yayin kaydi (repoda saklanir) |
| `.github/workflows/publish.yml` | 2 saatlik cron workflow'u |
| `data/history.json` | Kullanilan haber linkleri/basliklari (mukerrer onleme) |
| `data/published.json` | Yayinlanan post kayitlari (id, url, baslik) |
| `logs/` | Her calismanin detay logu (commit'lenmez) |

## Yerel bilgisayarda test

```bash
cp .env.example .env   # .env dosyasina anahtarlarinizi yazin
node run.mjs --dry-run # yayin yapmaz, makaleyi konsola yazar
node run.mjs           # gercek yayin
```

## Sik sorulanlar

- **Zamanlanmis is durdu?** GitHub, 60 gun commit olmayan reponun schedule'ini kapatir.
  Bot her 2 saatte commit attigi icin bu genellikle olusmaz; olursa Actions sekmesinden
  workflow'u yeniden etkinlestirin.
- **Model degistirmek istiyorum?** https://openrouter.ai/models adresinde `:free`
  filtresiyle guncel listeyi gorun, `OPENROUTER_MODEL` variable'ini guncelleyin.
  Yapilandirilan model calismazsa bot otomatik olarak `openrouter/free`
  (otomatik ucretsiz model secici) ile tekrar dener.
- **Ayni haber tekrar yayinlanir mi?** Hayir. Link ve normalize edilmis baslik
  `data/history.json` icinde saklanir.
