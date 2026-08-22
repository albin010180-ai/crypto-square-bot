// Tum icerik turleri (makale, video, kisa post) icin ortak guvenlik katmani.
export const SAFETY_RULES = `SAFETY RULES (absolute - violating content is rejected automatically):
- NEVER include adult/sexual content, nudity or pornography of any kind.
- NEVER include violence, gore, self-harm or weapons-related instructions.
- NEVER include hate speech, discrimination, harassment or defamation.
- NEVER promote gambling, casinos, betting or lotteries.
- NEVER promote scams: Ponzi/pyramid schemes, pump-and-dump coordination, phishing, fake giveaways or airdrop fraud.
- NEVER provide instructions for illegal activity (hacking, money laundering, drug trade).
- NEVER promise profits or give financial advice (no "guaranteed profit", "get rich", price targets).
- Allowed content ONLY: neutral news reporting, education, factual project/exchange information, risk awareness.`;

const BANNED_PATTERNS = [
  /\bporn\w*\b/i,
  /\bxxx\b/i,
  /\bnudes?\b/i,
  /\berotik\b/i,
  /\bcasino\b/i,
  /\bkumar(bane)?\b/i,
  /\bbahis (sitesi|reklami|promosyon)/i,
  /bet\s?(now|today)\b/i,
  /\bponzi scheme\b/i,
  /pyramid scheme/i,
  /garanti(li)?\s*(kazan[cç]?|profit|return|getiri)/i,
  /guaranteed\s+(profit|return|gains?)/i,
  /\bget[- ]rich[- ]quick\b/i,
  /\bzengin ol(mak)?\s*(garanti)?/i,
];

export function assertSafe(text, label = "icerik") {
  const hay = String(text);
  for (const re of BANNED_PATTERNS) {
    if (re.test(hay)) {
      throw new Error(`${label} guvenlik kurallarina aykiri terim iceriyor (${re})`);
    }
  }
  return true;
}
