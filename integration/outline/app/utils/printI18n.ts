import type { i18n } from "i18next";
import { useTranslation } from "react-i18next";
import en from "../locales/print/en_US.json";
import zhTW from "../locales/print/zh_TW.json";
import zhCN from "../locales/print/zh_CN.json";

const namespace = "outline-pdf";
const registered = new WeakSet<i18n>();
const translations: Record<string, typeof en> = {
  "en-US": en,
  "zh-TW": zhTW,
  "zh-CN": zhCN,
};

/** Register only this extension's namespace on Outline's existing instance. */
export function registerPrintTranslations(instance: i18n) {
  if (registered.has(instance)) {
    return;
  }
  for (const [language, messages] of Object.entries(translations)) {
    instance.addResourceBundle(language, namespace, messages);
  }
  registered.add(instance);
}

export function usePrintTranslation(locale?: string) {
  const { i18n: instance } = useTranslation();
  registerPrintTranslations(instance);
  const language = Object.prototype.hasOwnProperty.call(
    translations,
    locale ?? instance.language,
  )
    ? (locale ?? instance.language)
    : "en-US";
  return { language, t: instance.getFixedT(language, namespace) };
}
