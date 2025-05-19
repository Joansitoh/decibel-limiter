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
   * Obtiene el código de idioma del navegador (ej. "en" de "en-US").
   * @returns {string}
   */
  #getBrowserLanguage() {
    const navLang = navigator.languages?.[0] || navigator.language || navigator.userLanguage;
    return navLang.split('-')[0].toLowerCase();
  }

  /**
   * Decide el idioma a usar, comprobando si está soportado o usando el por defecto.
   * @returns {string}
   */
  #detectLanguage() {
    const browserLang = this.#getBrowserLanguage();
    return SUPPORTED_LANGUAGES.includes(browserLang) ? browserLang : DEFAULT_LANGUAGE;
  }

  /**
   * Carga el fichero JSON de traducciones para el idioma actual.
   * Si falla, intenta cargar el idioma por defecto.
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
      console.warn(`No se pudieron cargar las traducciones (${this.#language}): ${err.message}`);
      if (this.#language !== DEFAULT_LANGUAGE) {
        this.#translations = await load(DEFAULT_LANGUAGE);
        this.#language = DEFAULT_LANGUAGE;
      }
    }
    return this.#translations;
  }

  /**
   * Obtiene la traducción para una clave dada.
   * Si no existe, devuelve la clave misma.
   * @param {string} key
   * @returns {string}
   */
  get(key) {
    return this.#translations[key] || key;
  }

  /**
   * Actualiza todos los elementos del DOM con atributo [data-i18n].
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
   * Inicializa la localización: carga traducciones y actualiza la UI.
   * @returns {Promise<Localization>}
   */
  async init() {
    await this.loadTranslations();
    this.updateUI();
    return this;
  }

  /**
   * Devuelve el idioma actualmente activo.
   * @returns {string}
   */
  getCurrentLanguage() {
    return this.#language;
  }
}

// Inicialización automática al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  const i18n = new Localization();
  i18n.init().catch((err) => {
    console.error('Error al inicializar i18n:', err);
  });
});
