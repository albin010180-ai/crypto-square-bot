// Haber akisi zayif oldugunda kullanilan sablon bilgilendirme konulari.
// Makale ve video ayni havuzu kullanir; ayni dongude farkli konu secerler.
export const INFO_TOPICS = [
  {
    id: "airdrop-nedir",
    tr: "Kripto airdrop'larinin nasil calistigi ve dolandiriciliklara karsi guvenli takip yontemleri",
    en: "How crypto airdrops work and how to follow them without falling for scams",
    tags: ["#Airdrop", "#CryptoEducation"],
  },
  {
    id: "delist-isaretleri",
    tr: "Borsa delist duyurularinin nasil okunacagi ve uyari isaretleri",
    en: "How to read exchange delisting announcements and their warning signs",
    tags: ["#Delisting", "#Exchange"],
  },
  {
    id: "resmi-duyuru-takibi",
    tr: "Borsa ve proje duyurularini resmi kanallardan takip etmenin yollari",
    en: "Following official exchange and project announcements the right way",
    tags: ["#Announcements", "#CryptoEducation"],
  },
  {
    id: "p2e-oyunlar",
    tr: "Kripto odullu oyunlar: play-to-earn ekosisteminin nasil isledigi",
    en: "Crypto-reward games: how the play-to-earn ecosystem works",
    tags: ["#PlayToEarn", "#Gaming"],
  },
  {
    id: "whitepaper-analiz",
    tr: "Bir kripto projesinin white paper'i guvenilirlik acisindan nasil analiz edilir",
    en: "How to analyze a crypto project's white paper for credibility",
    tags: ["#WhitePaper", "#Research"],
  },
  {
    id: "yeni-proje-degerlendirme",
    tr: "Yeni kripto projelerini degerlendirme kontrol listesi: ekip, teknoloji, topluluk",
    en: "A checklist for evaluating new crypto projects: team, technology, community",
    tags: ["#NewProjects", "#DueDiligence"],
  },
  {
    id: "tokenomics-okuma",
    tr: "Tokenomics okuma rehberi: arz, dagitim ve kilitlenme mekanizmalari",
    en: "Reading tokenomics: supply, distribution and lock-up mechanics",
    tags: ["#Tokenomics", "#Research"],
  },
  {
    id: "staking-temelleri",
    tr: "Staking'in temel mantigi ve dikkat edilmesi gerekenler",
    en: "The basics of staking and what to watch out for",
    tags: ["#Staking", "#CryptoEducation"],
  },
  {
    id: "gas-ucretleri",
    tr: "Blockchain aglarinda gas ucretleri neden yukselir ve duser",
    en: "Why gas fees on blockchain networks rise and fall",
    tags: ["#GasFees", "#Blockchain"],
  },
  {
    id: "stablecoin-mantigi",
    tr: "Stablecoin'lerin nasil deger korudugu ve riskleri",
    en: "How stablecoins hold their value and what risks they carry",
    tags: ["#Stablecoins", "#DeFi"],
  },
  {
    id: "layer2-farki",
    tr: "Layer-2 aglarinin ana zincirden farklari ve sagladigi avantajlar",
    en: "How Layer-2 networks differ from mainchains and why they matter",
    tags: ["#Layer2", "#Scaling"],
  },
  {
    id: "audit-onemi",
    tr: "Smart contract denetimlerinin (audit) ne anlatmadigi ve sinirlari",
    en: "What smart contract audits tell you and where their limits are",
    tags: ["#Audit", "#Security"],
  },
  {
    id: "cuzdan-guvenligi",
    tr: "Kripto cuzdanlarinda temel guvenlik uygulamalari",
    en: "Essential security practices for crypto wallets",
    tags: ["#Security", "#Wallets"],
  },
  {
    id: "halving-mantigi",
    tr: "Bitcoin halving'in ne oldugu ve programlanarak nasil gerceklestigi",
    en: "What the Bitcoin halving is and how it is programmed to occur",
    tags: ["#Bitcoin", "#Halving"],
  },
  {
    id: "etf-temelleri",
    tr: "Kripto ETF'lerinin nasil calistigi ve piyasaya etkileri",
    en: "How crypto ETFs work and their market impact",
    tags: ["#ETF", "#Markets"],
  },
  {
    id: "memecoin-riskleri",
    tr: "Meme coin spekulasyonunun yapisi ve yaygin riskleri",
    en: "The anatomy of meme coin speculation and its common risks",
    tags: ["#MemeCoins", "#RiskManagement"],
  },
  {
    id: "likidite-kilitleri",
    tr: "Likidite kilitleri ve token vesting programlarinin piyasaya etkisi",
    en: "Liquidity locks and token vesting schedules: their market impact",
    tags: ["#Liquidity", "#Tokenomics"],
  },
  {
    id: "rug-pull-isaretleri",
    tr: "Rug pull dolandiriciliklarinda erken uyari isaretlerini tanimak",
    en: "Spotting early red flags of rug pull schemes",
    tags: ["#ScamAlert", "#Security"],
  },
];

// offset ile ayni dongude makale ve videonun farkli konu almasi saglanir.
export function pickInfoTopic(now = new Date(), offset = 0) {
  const cycle = Math.floor(now.getTime() / (4 * 60 * 60 * 1000));
  const topic = INFO_TOPICS[(cycle + offset) % INFO_TOPICS.length];
  return { ...topic };
}
