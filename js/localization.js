/**
 * @file Localization utility for Decibel Limiter extension
 * @module Localization
 */

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'es'];
const LOCALES_PATH = '../assets/locale';

/**
 * Singleton class for managing translations and locale-specific UI updates.
 */
export default class Localization {
  /** @type {Localization} */
  static instance;

  /** @type {string} */
  #language;

  /** @type {Record<string, string>} */
  #translations = {};

  constructor() {
    if (Localization.instance) {
      return Localization.instance;
    }
    this.#language = this.#detectLanguage();
    Localization.instance = this;
  }

  /**
   * Retrieves the browser's language code (e.g., "en" from "en-US").
   * @returns {string}
   */
  #getBrowserLanguage() {
    const navLang = navigator.languages?.[0] || navigator.language || navigator.userLanguage;
    return navLang.split('-')[0].toLowerCase();
  }

  /**
   * Determines the language to use by checking if it's supported or falling back to default.
   * @returns {string}
   */
  #detectLanguage() {
    const browserLang = this.#getBrowserLanguage();
    return SUPPORTED_LANGUAGES.includes(browserLang) ? browserLang : DEFAULT_LANGUAGE;
  }

  /**
   * Loads the JSON translation file for the current language.
   * Falls back to the default language if loading fails.
   * @returns {Promise<Record<string, string>>}
   */
  async loadTranslations() {
    const load = async (lang) => {
      const url = `${LOCALES_PATH}/${lang}.json`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${resp.statusText}`);
      }
      return resp.json();
    };

    try {
      this.#translations = await load(this.#language);
    } catch (err) {
      console.warn(`Failed to load translations (${this.#language}): ${err.message}`);
      if (this.#language !== DEFAULT_LANGUAGE) {
        this.#translations = await load(DEFAULT_LANGUAGE);
        this.#language = DEFAULT_LANGUAGE;
      }
    }
    return this.#translations;
  }

  /**
   * Retrieves the translation for a given key.
   * Returns the key itself if no translation is found.
   * @param {string} key
   * @returns {string}
   */
  get(key) {
    return this.#translations[key] || key;
  }

  /**
   * Updates all DOM elements with the [data-i18n] attribute.
   */
  updateUI() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (key) {
        el.textContent = this.get(key);
      }
    });
  }

  /**
   * Initializes localization: loads translations and updates the UI.
   * @returns {Promise<Localization>}
   */
  async init() {
    await this.loadTranslations();
    this.updateUI();
    return this;
  }

  /**
   * Returns the currently active language.
   * @returns {string}
   */
  getCurrentLanguage() {
    return this.#language;
  }
}

// Automatic initialization on DOM load
document.addEventListener('DOMContentLoaded', () => {
  const i18n = new Localization();
  i18n.init().catch((err) => {
    console.error('Failed to initialize i18n:', err);
  });
});
