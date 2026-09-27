// Explicit requests ("I'm craving pizza", "quiero pizza", "피자 먹고 싶어", "can we do the aquarium") in a member's
// answers or the group chat. make-plan treats each one as MUST-INCLUDE: a solo planner gets every plan anchored on
// it, a group gets at least one plan per request, unless nothing that matches passes the group's hard rules
// (budget cap, hard no's, diet, transit). Pure code, no Deno APIs.
// Voice answers reach here already translated to English by parse-prefs, but the no-Grok fallback parse keeps the
// raw transcript in "other", so keywords cover the app's other languages too.

type Matchable = { id: string; name: string; category: string; tags?: readonly string[] };

export type RequestKind = {
  key: string;
  /** Group-level label for plan text and the Grok payload, e.g. "pizza". */
  label: string;
  /** Latin-script words are matched at a word start; other scripts anywhere. */
  words: RegExp;
  matches: (c: Matchable) => boolean;
};

const tagged = (...tags: string[]) => (c: Matchable) => (c.tags ?? []).some((t) => tags.includes(t));

export const REQUEST_KINDS: RequestKind[] = [
  {
    key: "pizza", label: "pizza",
    words: /(?:\bpi[z]{1,2}[ae]|\bpizzer|पिज़्ज़ा|पिज्जा|피자|ピザ|披萨|比萨|بيتزا|פיצה)/i,
    matches: tagged("pizza"),
  },
  {
    key: "sushi", label: "sushi",
    words: /(?:\bsushi|\bsashimi|\bjapanese food|\bcomida japonesa|스시|초밥|寿司|सुशी|سوشي|סושי)/i,
    matches: tagged("sushi"),
  },
  {
    key: "tacos", label: "tacos",
    words: /(?:\btacos?\b|\btaquer|\bmexican|\bmexicana|\bburrito|\benchilada|타코|멕시코|टाको|तको|تاكو|טאקו|墨西哥)/i,
    matches: tagged("tacos", "mexican"),
  },
  {
    key: "burgers", label: "burgers",
    words: /(?:burger|\bhamburgues|\bhambúrguer|버거|बर्गर|برجر|برغر|המבורגר|汉堡)/i,
    matches: tagged("burgers"),
  },
  {
    key: "bbq", label: "barbecue",
    words: /(?:\bbbq\b|\bbarbe[cq]ue|\bbar-b-q|\bbarbacoa|\bbrisket|바비큐|बारबेक्यू|باربكيو|ברביקיו)/i,
    matches: tagged("bbq"),
  },
  {
    key: "southern", label: "Southern food",
    words: /(?:\bsoul food|\bsouthern food|\bfried chicken|\bcomida sureña|\bmac and cheese)/i,
    matches: tagged("southern", "soul-food"),
  },
  {
    key: "aquarium", label: "the aquarium",
    words: /(?:\baquarium|\bacuario|\baquário|수족관|एक्वेरियम|حوض السمك|אקווריום|水族馆)/i,
    matches: (c) => /aquarium/i.test(c.id),
  },
  {
    key: "coca-cola", label: "World of Coca-Cola",
    words: /(?:\bcoca[- ]?cola|\bworld of coke)/i,
    matches: (c) => c.id === "world-of-coca-cola",
  },
  {
    key: "museum", label: "a museum",
    words: /(?:\bmuseums?\b|\bmuseo|\bmuseu|\bmusée|박물관|미술관|संग्रहालय|متحف|מוזיאון|博物馆)/i,
    matches: (c) => c.category === "museum",
  },
  {
    key: "art", label: "art",
    words: /(?:\bart museum|\bart gallery|\bsee (?:some )?art\b|\bgaller(?:y|ies)|\barte\b)/i,
    matches: tagged("art"),
  },
  {
    key: "hike", label: "a hike",
    words: /(?:\bhike|\bhiking|\bsenderismo|\bcaminata|하이킹|등산|हाइक|المشي لمسافات|טיול רגלי)/i,
    matches: tagged("hike", "nature"),
  },
  {
    key: "movie", label: "a movie",
    words: /(?:\bmovies?\b|\bfilm\b|\bcinema|\bpel[ií]cula|\bcine\b|영화|फ़िल्म|फिल्म|فيلم|סרט)/i,
    matches: tagged("indie-film"),
  },
  {
    key: "comedy", label: "a comedy show",
    words: /(?:\bcomedy|\bimprov|\bstand-?up|\bcomedia|코미디|कॉमेडी|كوميديا|קומדיה)/i,
    matches: tagged("comedy"),
  },
  {
    key: "bowling", label: "bowling",
    words: /(?:\bbowling|\bgo bowl\b|\bboliche|\bbolos\b|\bboliches\b|볼링|बॉलिंग|बोलिंग|بولينغ|بولينج|באולינג|保龄球|ボウリング)/i,
    matches: tagged("bowling"),
  },
  {
    key: "golf", label: "golf",
    words: /(?:\bgolf|\btopgolf|골프|गोल्फ|غولف|גולף)/i,
    matches: (c) => /golf/i.test(c.id),
  },
  {
    key: "garden", label: "the botanical garden",
    words: /(?:\bbotanical|\bgardens?\b|\bjard[ií]n|정원|बगीचा|حديقة نباتية|גן בוטני)/i,
    matches: tagged("gardens"),
  },
];

/**
 * A negation in the 3 words before the keyword: "no pizza", "no quiero pizza", "sin tacos", "I don't really want sushi".
 * Only the last few words count, so "I have no restrictions, I just want pizza" and "not picky I want pizza" are requests.
 */
const NEGATED = /(?:\b(?:no|not|nothing|never|don'?t|dont|doesn'?t|won'?t|can'?t|cannot|avoid|hate|hates|skip|without|allergic|sin|nada|nunca|odio|ni|pas|jamais|nahi|nahin)\b|n't\b|नहीं|नही|मत|안|싫|말고|لا|بدون|לא|בלי|不要|不想|不吃)/i;
/** Negations that follow the word: "피자 싫어", "피자 말고", "पिज़्ज़ा नहीं", "pizza nahi", "pizza no". */
const NEGATED_AFTER = /^\s*(?:싫|말고|빼고|안|नहीं|नही|मत|nahi|nope|is a no)/i;
/** Permission is not a request: "pizza is fine", "I don't mind tacos". */
const JUST_OK = /\b(?:is|are|'s)\s+(?:fine|ok|okay)\b|\bdon'?t mind\b/i;
const CLAUSES = /[,;.!?\n،。，]|\b(?:but|and|so|pero|mais|aber|y)\b|لكن|אבל/i;

/** Request keys found in free text, in order of first mention. Negated mentions ("no pizza") are hard no's, not requests. */
export function requestKeysOf(text: string): string[] {
  const out: string[] = [];
  for (const clause of text.replace(/[‘’ʼ]/g, "'").split(CLAUSES)) {
    if (JUST_OK.test(clause)) continue;
    for (const k of REQUEST_KINDS) {
      const m = clause.match(k.words);
      if (!m || out.includes(k.key)) continue;
      const before = clause.slice(0, m.index).trim().split(/\s+/).slice(-3).join(" ");
      if (NEGATED.test(before) || NEGATED_AFTER.test(clause.slice(m.index! + m[0].length))) continue;
      out.push(k.key);
    }
  }
  return out;
}

export const requestKind = (key: string) => REQUEST_KINDS.find((k) => k.key === key);

/** Catalog items that satisfy a request key. */
export function matchesRequest(c: Matchable, key: string): boolean {
  return requestKind(key)?.matches(c) ?? false;
}
