import languagesData from "@/data/languages.json";

export type LanguageOption = {
  code: string;
  name: string;
  nativeName: string;
};

export const SUPPORTED_LANGUAGES: LanguageOption[] = languagesData;

const codes = new Set(SUPPORTED_LANGUAGES.map((l) => l.code.toLowerCase()));

function normalizeBrowserTag(tag: string): string {
  const parts = tag.trim().split("-");
  if (parts.length >= 2 && parts[0].toLowerCase() === "zh") {
    const region = parts[1].toLowerCase();
    if (region === "tw" || region === "hk" || region === "mo") return "zh-TW";
    return "zh-CN";
  }
  if (parts.length >= 2 && parts[0].toLowerCase() === "pt" && parts[1].toLowerCase() === "br") {
    return "pt-BR";
  }
  return parts[0].toLowerCase();
}

function resolveSupportedCode(candidate: string): string | null {
  const lower = candidate.toLowerCase();
  if (codes.has(lower)) {
    const match = SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === lower);
    return match?.code ?? null;
  }
  const primary = lower.split("-")[0];
  const byPrefix = SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === primary || l.code.toLowerCase().startsWith(`${primary}-`));
  return byPrefix?.code ?? null;
}

/** Browser / OS locale → supported language code, or `"en"` when unknown. */
export function detectBrowserLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  const tags = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
  for (const tag of tags) {
    const normalized = normalizeBrowserTag(tag);
    const resolved = resolveSupportedCode(normalized);
    if (resolved) return resolved;
    const resolvedRaw = resolveSupportedCode(tag);
    if (resolvedRaw) return resolvedRaw;
  }
  return "en";
}

export function isSupportedLanguageCode(code: string): boolean {
  return codes.has(code.toLowerCase());
}

export function getLanguageOption(code: string): LanguageOption | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase());
}

export function getLanguageName(code: string): string {
  return getLanguageOption(code)?.name ?? code;
}

export function translationPromptLabel(code: string): string {
  return `Translate to ${getLanguageName(code)}`;
}

export function translationInstruction(code: string): string {
  return `Translate this to ${getLanguageName(code)}.`;
}
