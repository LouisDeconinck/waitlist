import { ui, defaultLang } from './ui';
export { defaultLang };

export function getLangFromCookie(cookieStr: string | null): keyof typeof ui | null {
    if (!cookieStr) return null;
    const match = cookieStr.match(/locale=(en|nl|fr|de)/);
    if (match && match[1]) {
        return match[1] as keyof typeof ui;
    }
    return null;
}

export function useTranslations(lang: keyof typeof ui) {
    return function t(key: keyof typeof ui[typeof defaultLang]) {
        return ui[lang][key] || ui[defaultLang][key];
    }
}
