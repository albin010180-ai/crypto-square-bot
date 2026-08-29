// Informational topics used when news feed is weak.
// Articles and videos share the same pool; different topics are picked in the same cycle.
export const INFO_TOPICS = [
  {
    id: "airdrop-nedir",
    en: "How crypto airdrops work and how to follow them without falling for scams",
    tags: ["#Airdrop", "#CryptoEducation"],
  },
  {
    id: "delist-isaretleri",
    en: "How to read exchange delisting announcements and their warning signs",
    tags: ["#Delisting", "#Exchange"],
  },
  {
    id: "resmi-duyuru-takibi",
    en: "Following official exchange and project announcements the right way",
    tags: ["#Announcements", "#CryptoEducation"],
  },
  {
    id: "p2e-oyunlar",
    en: "Crypto-reward games: how the play-to-earn ecosystem works",
    tags: ["#PlayToEarn", "#Gaming"],
  },
  {
    id: "whitepaper-analiz",
    en: "How to analyze a crypto project's white paper for credibility",
    tags: ["#WhitePaper", "#Research"],
  },
  {
    id: "yeni-proje-degerlendirme",
    en: "A checklist for evaluating new crypto projects: team, technology, community",
    tags: ["#NewProjects", "#DueDiligence"],
  },
  {
    id: "tokenomics-okuma",
    en: "Reading tokenomics: supply, distribution and lock-up mechanics",
    tags: ["#Tokenomics", "#Research"],
  },
  {
    id: "staking-temelleri",
    en: "The basics of staking and what to watch out for",
    tags: ["#Staking", "#CryptoEducation"],
  },
  {
    id: "gas-ucretleri",
    en: "Why gas fees on blockchain networks rise and fall",
    tags: ["#GasFees", "#Blockchain"],
  },
  {
    id: "stablecoin-mantigi",
    en: "How stablecoins hold their value and what risks they carry",
    tags: ["#Stablecoins", "#DeFi"],
  },
  {
    id: "layer2-farki",
    en: "How Layer-2 networks differ from mainchains and why they matter",
    tags: ["#Layer2", "#Scaling"],
  },
  {
    id: "audit-onemi",
    en: "What smart contract audits tell you and where their limits are",
    tags: ["#Audit", "#Security"],
  },
  {
    id: "cuzdan-guvenligi",
    en: "Essential security practices for crypto wallets",
    tags: ["#Security", "#Wallets"],
  },
  {
    id: "halving-mantigi",
    en: "What the Bitcoin halving is and how it is programmed to occur",
    tags: ["#Bitcoin", "#Halving"],
  },
  {
    id: "etf-temelleri",
    en: "How crypto ETFs work and their market impact",
    tags: ["#ETF", "#Markets"],
  },
  {
    id: "memecoin-riskleri",
    en: "The anatomy of meme coin speculation and its common risks",
    tags: ["#MemeCoins", "#RiskManagement"],
  },
  {
    id: "likidite-kilitleri",
    en: "Liquidity locks and token vesting schedules: their market impact",
    tags: ["#Liquidity", "#Tokenomics"],
  },
  {
    id: "rug-pull-isaretleri",
    en: "Spotting early red flags of rug pull schemes",
    tags: ["#ScamAlert", "#Security"],
  },
];

// offset ensures article and video pick different topics in the same cycle.
export function pickInfoTopic(now = new Date(), offset = 0) {
  const cycle = Math.floor(now.getTime() / (4 * 60 * 60 * 1000));
  const topic = INFO_TOPICS[(cycle + offset) % INFO_TOPICS.length];
  return { ...topic };
}
