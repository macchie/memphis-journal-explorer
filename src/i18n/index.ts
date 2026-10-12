import { derived, get, writable } from "svelte/store";
import { en } from "./en";
import { it } from "./it";

export type Locale = "it" | "en";
export type Messages = Record<string, string>;
export type Params = Record<string, string | number>;

export const LOCALES: readonly Locale[] = ["it", "en"];
export const DEFAULT_LOCALE: Locale = "it";

const dictionaries: Record<Locale, Messages> = { it, en };

/** BCP-47 tags used for Intl date/number formatting per locale. */
const INTL_TAGS: Record<Locale, string> = { it: "it-IT", en: "en-GB" };

/** The active locale. Set once from the URL on startup (see initLocale). */
export const locale = writable<Locale>(DEFAULT_LOCALE);

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

/** Non-reactive translation — usable outside Svelte components (e.g. main.ts). */
export function translate(loc: Locale, key: string, params?: Params): string {
  const template = dictionaries[loc]?.[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

/** Reactive translator for components: `{$t("some.key", { count: 3 })}`. */
export const t = derived(
  locale,
  ($locale) => (key: string, params?: Params) => translate($locale, key, params),
);

/** Reactive, locale-aware formatters: `{$fmt.money(x)}`, `{$fmt.date(s)}`. */
export const fmt = derived(locale, ($locale) => {
  const tag = INTL_TAGS[$locale];
  const money = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
  // Timestamps are rendered as stored (POS-local), hence the fixed UTC zone.
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return {
    money: (value: unknown) => money.format(Number(value ?? 0) / 100),
    date: (value: string) => dateTime.format(new Date(value)),
  };
});

/** Reactive BCP-47 tag, e.g. for the Flowbite datepicker's `locale` prop. */
export const intlTag = derived(locale, ($locale) => INTL_TAGS[$locale]);

/** Current locale value for non-reactive callers. */
export const currentLocale = (): Locale => get(locale);

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const code = value?.trim().toLowerCase().slice(0, 2) ?? "";
  return (LOCALES as readonly string[]).includes(code) ? (code as Locale) : null;
}

function applyLocale(loc: Locale): void {
  locale.set(loc);
  document.documentElement.lang = loc;
  document.title = translate(loc, "app.title");
}

/** Resolve the startup locale from `?lang=` (falling back to the default). */
export function initLocale(): Locale {
  const fromUrl = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
  const chosen = fromUrl ?? DEFAULT_LOCALE;
  applyLocale(chosen);
  return chosen;
}

/** Switch locale at runtime (updates the store and the document lang/title). */
export function setLocale(loc: Locale): void {
  applyLocale(loc);
}
