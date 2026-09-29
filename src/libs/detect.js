/**
 * @file detect.js
 * @description 语言检测服务模块。整合了本地浏览器端检测与各大厂商（谷歌、腾讯、百度等）的远程 API 检测服务，为划词和整页翻译提供基础语言代码匹配。
 */

import {
  OPT_TRANS_GOOGLE,
  OPT_TRANS_BAIDU,
  OPT_TRANS_TENCENT,
  OPT_LANGS_TO_CODE,
  OPT_TRANS_BUILTINAI,
  OPT_LANGDETECTOR_MAP,
  isApiTypeSupported,
} from "../config";
import { browser } from "./browser";
import {
  apiGoogleLangdetect,
  apiBaiduLangdetect,
  apiTencentLangdetect,
  apiBuiltinAIDetect,
} from "../apis";
import { kissLog } from "./log";
import { normalizeLanguageCode } from "./language";
import { quickDetectLang } from "./detectFast";

// 各个平台的语言检测函数映射表
const langdetectFns = {
  [OPT_TRANS_GOOGLE]: apiGoogleLangdetect,
  [OPT_TRANS_BAIDU]: apiBaiduLangdetect,
  [OPT_TRANS_TENCENT]: apiTencentLangdetect,
  [OPT_TRANS_BUILTINAI]: apiBuiltinAIDetect,
};

/**
 * 尝试检测给定文本的源语言代码
 * @param {string} text 待检测的文本内容
 * @param {string} [langDetector="-"] 选择的检测算法/接口类型 ("-" 表示仅使用本地检测)
 * @returns {Promise<string>} 语言代码（如 "en", "zh-CN", 若检测失败返回空字符串 ""）
 */
export const tryDetectLang = async (text, langDetector = "-") => {
  let deLang = "";

  // 1. 如果配置了特定的远程/内置 AI 语言检测服务，则首选该服务进行识别
  if (
    OPT_LANGDETECTOR_MAP.has(langDetector) &&
    isApiTypeSupported(langDetector)
  ) {
    try {
      const lang = await langdetectFns[langDetector](text);
      if (lang) {
        // 转换成翻译器统一的语言代码格式
        const mappedLang = OPT_LANGS_TO_CODE[langDetector].get(lang) || lang;
        deLang = normalizeLanguageCode(mappedLang);
      }
    } catch (err) {
      kissLog("detect lang remote", err);
    }
  }

  // 2. 如果远程识别没有得出结果，采用浏览器的 i18n API 执行本地原生识别作为兜底
  if (!deLang) {
    // Safari 和部分脚本环境没有 detectLanguage。复用划词检测的保守本地
    // 快判；无法确定时仍返回空字符串，让翻译服务自行识别，不增加网络请求。
    if (typeof browser?.i18n?.detectLanguage !== "function") {
      return typeof text === "string"
        ? quickDetectLang(text.slice(0, 300))
        : "";
    }
    try {
      const res = await browser.i18n.detectLanguage(text);
      const lang = res?.languages?.[0]?.language;
      const normalizedLang = normalizeLanguageCode(lang);
      // 仅当识别置信度高 (isReliable) 且被当前插件支持时采纳
      if (normalizedLang && (res?.isReliable || /^zh(?:[-_]|$)/i.test(lang))) {
        deLang = normalizedLang;
      }
    } catch (err) {
      kissLog("detect lang local", err);
    }
  }

  return deLang;
};
