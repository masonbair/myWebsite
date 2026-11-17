const MAX_LENGTH = 200;
// Capitalised words are where names of places, people and businesses show up; these are the only ones allowed.
const ALLOWED_CAPITALISED = new Set(["Mason", "Mason's", "Mason’s","A", "An", "The", "Two", "Three", "Four", "Several", "Close-up"]);
// Words that only appear when a description is about to say where, or read out a sign.
const PLACE_WORDS =
  /\b(city|cities|town|village|country|countries|capital|street|avenue|boulevard|district|province|state of|landmark|downtown|sign(s)? (that )?(reads?|says?|saying)|reading|labell?ed|named|called|written|logo|brand)\b/i;

const REGION_CODES = Array.from({ length: 26 * 26 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)));
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
/** Every country and territory name, lower case, so even an uncapitalised one is caught. */
const COUNTRY_NAMES: string[] = Array.from(
  new Set(
    REGION_CODES.map((code) => regionNames.of(code))
      .filter((name): name is string => !!name && !/unknown|pseudo/i.test(name))
      // "Myanmar (Burma)" and "Bosnia & Herzegovina" become their parts.
      .flatMap((name) => name.toLowerCase().split(/\s*[&()]\s*/))
      .filter((name) => name.length >= 4),
  ),
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COUNTRY_PATTERN = new RegExp(`(^|[^a-z])(${COUNTRY_NAMES.map(escape).join("|")})($|[^a-z])`, "i");

/** Why a description is unsafe to publish, or null when it passes. */
export function privacyProblem(text: string): string | null {
  if (text.length > MAX_LENGTH) return "too long";
  if (/\d/.test(text)) return "digits";
  if (/["“”«»]|(^|\s)'|'(\s|$)/.test(text)) return "quotes";
  if (PLACE_WORDS.test(text)) return "place word";
  if (COUNTRY_PATTERN.test(text)) return "country";
  for (const word of text.split(/[\s,.;:!?()]+/)) {
    if (/^\p{Lu}/u.test(word) && !ALLOWED_CAPITALISED.has(word)) return "proper noun";
  }
  return null;
}

/** The description trimmed, or null when it is empty or could reveal a place, a sign or anyone but Mason. */
export function safeDescription(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return privacyProblem(text) === null ? text : null;
}
