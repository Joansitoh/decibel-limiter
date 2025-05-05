// Localization utility for Decibel Limiter extension

// Default language if browser language is not supported
const DEFAULT_LANGUAGE = 'en';

// Supported languages
const SUPPORTED_LANGUAGES = ['en', 'es'];

// Store for loaded translations
let translations = {};

// Get the browser language (first two characters)
function getBrowserLanguage() {
  const language = navigator.language || navigator.userLanguage;
  return language.split('-')[0]; // Get the base language code (e.g., 'en' from 'en-US')
}

// Get the best matching language from supported languages
function getLanguage() {
  const browserLang = getBrowserLanguage();
  return SUPPORTED_LANGUAGES.includes(browserLang) ? browserLang : DEFAULT_LANGUAGE;
}

// Load translations for the current language
async function loadTranslations() {
  const lang = getLanguage();
  try {
    const response = await fetch(`../assets/locale/${lang}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load translations for ${lang}`);
    }
    translations = await response.json();
    return translations;
  } catch (error) {
    console.error(`Error loading translations: ${error.message}`);
    // Fallback to default language if there's an error
    if (lang !== DEFAULT_LANGUAGE) {
      const fallbackResponse = await fetch(`../assets/locale/${DEFAULT_LANGUAGE}.json`);
      translations = await fallbackResponse.json();
    }
    return translations;
  }
}

// Get a translated string by key
function getTranslation(key) {
  return translations[key] || key;
}

// Update all elements with data-i18n attribute
function updateUITranslations() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (translations[key]) {
      element.textContent = translations[key];
    }
  });
}

// Initialize localization
async function initLocalization() {
  await loadTranslations();
  updateUITranslations();
  return translations;
}

// Export functions
window.i18n = {
  getLanguage,
  getTranslation,
  loadTranslations,
  updateUITranslations,
  initLocalization
};
