/** Landing-page presenters: portrait, lip anchor, and natural neural voices per language. */
export type PresenterLang = "en" | "ar";

export interface Presenter {
  id: "layla" | "omar" | "sarah" | "james";
  name: Record<PresenterLang, string>;
  role: Record<PresenterLang, string>;
  src: string;
  anchor: { x: number; y: number };
  gender: "female" | "male";
  voice: Record<PresenterLang, string>;
}

export const PRESENTERS: Presenter[] = [
  { id: "layla", name: { en: "Layla", ar: "ليلى" }, role: { en: "Client intake", ar: "استقبال العملاء" }, src: "/presenters/layla.webp", anchor: { x: 0.449, y: 0.392 }, gender: "female",
    voice: { ar: "ar-SA-ZariyahNeural", en: "en-US-AvaMultilingualNeural" } },
  { id: "omar", name: { en: "Omar", ar: "عمر" }, role: { en: "Contract drafting", ar: "صياغة العقود" }, src: "/presenters/omar.webp", anchor: { x: 0.262, y: 0.52 }, gender: "male",
    voice: { ar: "ar-SA-HamedNeural", en: "en-US-AndrewMultilingualNeural" } },
  { id: "sarah", name: { en: "Sarah", ar: "سارة" }, role: { en: "Legal research", ar: "البحث القانوني" }, src: "/presenters/sarah.webp", anchor: { x: 0.43, y: 0.47 }, gender: "female",
    voice: { ar: "ar-AE-FatimaNeural", en: "en-GB-SoniaNeural" } },
  { id: "james", name: { en: "James", ar: "جيمس" }, role: { en: "Litigation support", ar: "دعم التقاضي" }, src: "/presenters/james.webp", anchor: { x: 0.486, y: 0.604 }, gender: "male",
    voice: { ar: "ar-AE-HamdanNeural", en: "en-GB-RyanNeural" } },
];

export function presenterScript(p: Presenter, lang: PresenterLang): string {
  return lang === "ar"
    ? `مرحباً، أنا ${p.name.ar} من فريق ليكسوس للذكاء الاصطناعي، ${p.gender === "female" ? "متخصصة" : "متخصص"} في ${p.role.ar}. أعمل جنباً إلى جنب مع محاميكم: أستقبل مكالمات العملاء، وأصيغ العقود، وألخّص ملفات القضايا باللغتين العربية والإنجليزية. كل ما أكتبه مسودة يراجعها فريقكم. ابدأوا تجربتكم المجانية اليوم.`
    : `Hi, I'm ${p.name.en}, your AI ${p.role.en.toLowerCase()} assistant at LexOS. I work alongside your lawyers: I take intake calls, draft contracts and summarise your matter files, in English and Arabic. Everything I write is a draft for your team to review. Start a free trial and hire your AI legal team today.`;
}
