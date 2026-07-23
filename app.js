/* =========================================================
   MyHappyBox — Κύρια λειτουργία σελίδας
   ========================================================= */

"use strict";


/* =========================================================
   Βασικές μεταβλητές εφαρμογής
   ========================================================= */

const supportedLanguages = ["el", "ar", "bn"];

let currentLanguage = "el";
let currentCategory = "all";
let currentSearchTerm = "";


/* =========================================================
   Επιλογή βασικών στοιχείων HTML
   ========================================================= */

const languageButtons = document.querySelectorAll(
  ".language-button"
);

const categoryButtonsContainer = document.getElementById(
  "category-buttons"
);

const dictionaryGrid = document.getElementById(
  "dictionary-grid"
);

const searchInput = document.getElementById(
  "word-search"
);

const noResultsMessage = document.getElementById(
  "no-results"
);

const currentYearElement = document.getElementById(
  "current-year"
);


/* =========================================================
   Βοηθητική λειτουργία:
   Ανάκτηση μετάφρασης με μορφή "hero.title"
   ========================================================= */

function getTranslation(language, path) {
  const pathParts = path.split(".");

  let result = translations[language];

  for (const part of pathParts) {
    if (
      result === undefined ||
      result === null ||
      typeof result !== "object" ||
      !(part in result)
    ) {
      return null;
    }

    result = result[part];
  }

  return result;
}


/* =========================================================
   Βοηθητική λειτουργία:
   Κανονικοποίηση κειμένου για αναζήτηση
   ========================================================= */

function normalizeText(value) {
  return String(value)
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}


/* =========================================================
   Απόδοση όλων των στατικών μεταφράσεων
   ========================================================= */

function translateStaticContent() {
  const translatedElements = document.querySelectorAll(
    "[data-i18n]"
  );

  translatedElements.forEach((element) => {
    const translationPath = element.dataset.i18n;

    const translatedValue = getTranslation(
      currentLanguage,
      translationPath
    );

    if (typeof translatedValue === "string") {
      element.textContent = translatedValue;
    }
  });

  const placeholderElements = document.querySelectorAll(
    "[data-i18n-placeholder]"
  );

  placeholderElements.forEach((element) => {
    const translationPath =
      element.dataset.i18nPlaceholder;

    const translatedValue = getTranslation(
      currentLanguage,
      translationPath
    );

    if (typeof translatedValue === "string") {
      element.setAttribute(
        "placeholder",
        translatedValue
      );
    }
  });
}


/* =========================================================
   Ορισμός κατεύθυνσης κειμένου και γλώσσας εγγράφου
   ========================================================= */

function updateDocumentLanguage() {
  document.documentElement.lang = currentLanguage;

  if (currentLanguage === "ar") {
    document.documentElement.dir = "rtl";
    document.body.setAttribute("dir", "rtl");
  } else {
    document.documentElement.dir = "ltr";
    document.body.setAttribute("dir", "ltr");
  }
}


/* =========================================================
   Ενημέρωση ενεργού κουμπιού γλώσσας
   ========================================================= */

function updateLanguageButtons() {
  languageButtons.forEach((button) => {
    const buttonLanguage = button.dataset.language;

    const isActive =
      buttonLanguage === currentLanguage;

    button.classList.toggle(
      "active",
      isActive
    );

    button.setAttribute(
      "aria-pressed",
      String(isActive)
    );
  });
}


/* =========================================================
   Δημιουργία κουμπιών κατηγοριών λεξικού
   ========================================================= */

function renderCategoryButtons() {
  if (!categoryButtonsContainer) {
    return;
  }

  categoryButtonsContainer.innerHTML = "";

  const allButton = createCategoryButton(
    "all",
    translations[currentLanguage]
      .dictionary
      .allCategories
  );

  categoryButtonsContainer.appendChild(allButton);

  dictionaryCategories.forEach((categoryKey) => {
    const categoryLabel =
      translations[currentLanguage]
        .dictionary
        .categories[categoryKey];

    const button = createCategoryButton(
      categoryKey,
      categoryLabel
    );

    categoryButtonsContainer.appendChild(button);
  });
}


/* =========================================================
   Δημιουργία ενός κουμπιού κατηγορίας
   ========================================================= */

function createCategoryButton(categoryKey, label) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "category-button";
  button.dataset.category = categoryKey;
  button.textContent = label;

  const isActive =
    currentCategory === categoryKey;

  button.classList.toggle(
    "active",
    isActive
  );

  button.setAttribute(
    "aria-pressed",
    String(isActive)
  );

  button.addEventListener("click", () => {
    currentCategory = categoryKey;

    renderCategoryButtons();
    renderDictionary();
  });

  return button;
}


/* =========================================================
   Απόδοση καρτών λεξικού
   ========================================================= */

function renderDictionary() {
  if (!dictionaryGrid) {
    return;
  }

  dictionaryGrid.innerHTML = "";

  const filteredWords = dictionaryWords.filter((word) => {
    const matchesCategory =
      currentCategory === "all" ||
      word.category === currentCategory;

    const translationValue =
      currentLanguage === "el"
        ? word.greek
        : word[currentLanguage];

    const searchableContent = normalizeText(
      [
        word.greek,
        word.ar,
        word.bn,
        translationValue,
        translations[currentLanguage]
          .dictionary
          .categories[word.category]
      ].join(" ")
    );

    const matchesSearch =
      currentSearchTerm === "" ||
      searchableContent.includes(
        normalizeText(currentSearchTerm)
      );

    return matchesCategory && matchesSearch;
  });

  filteredWords.forEach((word) => {
    const card = createWordCard(word);

    dictionaryGrid.appendChild(card);
  });

  if (noResultsMessage) {
    noResultsMessage.hidden =
      filteredWords.length > 0;
  }
}


/* =========================================================
   Δημιουργία μίας κάρτας λέξης
   ========================================================= */

function createWordCard(word) {
  const article = document.createElement("article");

  article.className = "word-card";
  article.dataset.category = word.category;

  const number = document.createElement("span");

  number.className = "word-number";
  number.textContent = String(word.id);

  const greekWord = document.createElement("p");

  greekWord.className = "word-greek";
  greekWord.lang = "el";
  greekWord.dir = "ltr";
  greekWord.textContent = word.greek;

  const translatedWord = document.createElement("p");

  translatedWord.className = "word-translation";

  if (currentLanguage === "el") {
    translatedWord.textContent =
      "Ελληνική λέξη ή έκφραση";

    translatedWord.lang = "el";
    translatedWord.dir = "ltr";
  } else {
    translatedWord.textContent =
      word[currentLanguage];

    translatedWord.lang = currentLanguage;

    translatedWord.dir =
      currentLanguage === "ar"
        ? "rtl"
        : "ltr";
  }

  const category = document.createElement("span");

  category.className = "word-category";

  category.textContent =
    translations[currentLanguage]
      .dictionary
      .categories[word.category];

  article.appendChild(number);
  article.appendChild(greekWord);
  article.appendChild(translatedWord);
  article.appendChild(category);

  return article;
}


/* =========================================================
   Αλλαγή γλώσσας
   ========================================================= */

function changeLanguage(language) {
  if (!supportedLanguages.includes(language)) {
    return;
  }

  currentLanguage = language;

  updateDocumentLanguage();
  updateLanguageButtons();
  translateStaticContent();
  renderCategoryButtons();
  renderDictionary();

  localStorage.setItem(
    "myHappyBoxLanguage",
    currentLanguage
  );
}


/* =========================================================
   Ανάκτηση αποθηκευμένης γλώσσας
   ========================================================= */

function getSavedLanguage() {
  const savedLanguage = localStorage.getItem(
    "myHappyBoxLanguage"
  );

  if (supportedLanguages.includes(savedLanguage)) {
    return savedLanguage;
  }

  return "el";
}


/* =========================================================
   Συμβάντα κουμπιών γλώσσας
   ========================================================= */

function attachLanguageEvents() {
  languageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedLanguage =
        button.dataset.language;

      changeLanguage(selectedLanguage);
    });
  });
}


/* =========================================================
   Συμβάν αναζήτησης λεξικού
   ========================================================= */

function attachSearchEvent() {
  if (!searchInput) {
    return;
  }

  searchInput.addEventListener("input", (event) => {
    currentSearchTerm =
      event.target.value || "";

    renderDictionary();
  });
}


/* =========================================================
   Αυτόματη ενημέρωση έτους
   ========================================================= */

function updateCurrentYear() {
  if (!currentYearElement) {
    return;
  }

  currentYearElement.textContent =
    new Date().getFullYear();
}


/* =========================================================
   Ομαλή κύλιση για εσωτερικούς συνδέσμους
   ========================================================= */

function attachSmoothScroll() {
  const internalLinks = document.querySelectorAll(
    'a[href^="#"]'
  );

  internalLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId =
        link.getAttribute("href");

      if (
        !targetId ||
        targetId === "#"
      ) {
        return;
      }

      const targetElement =
        document.querySelector(targetId);

      if (!targetElement) {
        return;
      }

      event.preventDefault();

      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });
}


/* =========================================================
   Προαιρετική επισήμανση του ενεργού τμήματος
   ========================================================= */

function observePageSections() {
  if (!("IntersectionObserver" in window)) {
    return;
  }

  const sections = document.querySelectorAll(
    "main section[id]"
  );

  const navigationLinks = document.querySelectorAll(
    '.quick-navigation a[href^="#"]'
  );

  if (
    sections.length === 0 ||
    navigationLinks.length === 0
  ) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const sectionId = entry.target.id;

        navigationLinks.forEach((link) => {
          const linkTarget =
            link.getAttribute("href");

          link.classList.toggle(
            "current-section",
            linkTarget === `#${sectionId}`
          );
        });
      });
    },
    {
      root: null,
      rootMargin: "-25% 0px -60% 0px",
      threshold: 0
    }
  );

  sections.forEach((section) => {
    observer.observe(section);
  });
}


/* =========================================================
   Έλεγχος ότι φορτώθηκαν τα δεδομένα
   ========================================================= */

function validateApplicationData() {
  if (typeof translations === "undefined") {
    console.error(
      "Δεν φορτώθηκε το αρχείο translations.js."
    );

    return false;
  }

  if (!Array.isArray(dictionaryWords)) {
    console.error(
      "Δεν βρέθηκε ο πίνακας dictionaryWords."
    );

    return false;
  }

  if (!Array.isArray(dictionaryCategories)) {
    console.error(
      "Δεν βρέθηκε ο πίνακας dictionaryCategories."
    );

    return false;
  }

  return true;
}


/* =========================================================
   Εκκίνηση εφαρμογής
   ========================================================= */

function initializeApplication() {
  const applicationDataIsValid =
    validateApplicationData();

  if (!applicationDataIsValid) {
    return;
  }

  currentLanguage = getSavedLanguage();

  updateCurrentYear();
  attachLanguageEvents();
  attachSearchEvent();
  attachSmoothScroll();
  observePageSections();

  changeLanguage(currentLanguage);
}


/* =========================================================
   Εκτέλεση όταν φορτώσει το HTML
   ========================================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
  );
} else {
  initializeApplication();
}
