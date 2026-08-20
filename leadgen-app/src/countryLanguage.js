// Maps each of the automation's 30 supported countries to a language
// for outreach content. Constrained strictly to the 14 languages the
// AI content system actually supports (see LANGUAGES in
// outreachContent.js: English, French, Spanish, German, Portuguese,
// Arabic, Chinese, Hebrew, Hungarian, Russian, Italian, Bengali, Urdu,
// Pashto) - several of these countries' native languages (Dutch,
// Swedish, Danish, Norwegian, Finnish, Japanese, Korean, Polish, Czech)
// simply aren't options in that list, so those fall back to English.
// This is a real, worth-knowing limitation, not a silent choice - it's
// documented per country below rather than hidden.
const COUNTRY_LANGUAGE = {
  "United States": { language: "English" },
  "Australia": { language: "English" },
  "Canada": { language: "English" },
  "United Kingdom": { language: "English" },
  "Germany": { language: "German" },
  "Netherlands": { language: "English", note: "Dutch isn't a supported outreach language - falls back to English (very high business English proficiency in the Netherlands)." },
  "New Zealand": { language: "English" },
  "Ireland": { language: "English" },
  "France": { language: "French" },
  "Switzerland": { language: "German", note: "Switzerland is multilingual (German/French/Italian) - German is the plurality language, used as the default." },
  "Sweden": { language: "English", note: "Swedish isn't a supported outreach language - falls back to English (very high business English proficiency in Sweden)." },
  "Denmark": { language: "English", note: "Danish isn't a supported outreach language - falls back to English (very high business English proficiency in Denmark)." },
  "Norway": { language: "English", note: "Norwegian isn't a supported outreach language - falls back to English (very high business English proficiency in Norway)." },
  "Austria": { language: "German" },
  "Belgium": { language: "English", note: "Belgium is split between Dutch (majority, unsupported) and French speakers - English avoids guessing wrong between the two regions." },
  "Singapore": { language: "English" },
  "United Arab Emirates": { language: "English", note: "Arabic is supported and official, but English is the dominant language of B2B business in the UAE - used as the more practical default." },
  "South Africa": { language: "English" },
  "Spain": { language: "Spanish" },
  "Portugal": { language: "Portuguese" },
  "Italy": { language: "Italian" },
  "Finland": { language: "English", note: "Finnish isn't a supported outreach language - falls back to English (very high business English proficiency in Finland)." },
  "Japan": { language: "English", note: "Japanese isn't a supported outreach language - falls back to English. Worth knowing: business English proficiency in Japan is generally lower than the other English-fallback countries here, so outreach may be less effective." },
  "South Korea": { language: "English", note: "Korean isn't a supported outreach language - falls back to English. Worth knowing: business English proficiency in South Korea is generally lower than the other English-fallback countries here, so outreach may be less effective." },
  "Brazil": { language: "Portuguese" },
  "Mexico": { language: "Spanish" },
  "Poland": { language: "English", note: "Polish isn't a supported outreach language - falls back to English." },
  "Czech Republic": { language: "English", note: "Czech isn't a supported outreach language - falls back to English." },
  "Luxembourg": { language: "French", note: "Luxembourg is trilingual (Luxembourgish/French/German) - French is commonly used in business, used as the default." },
  "Saudi Arabia": { language: "Arabic" },
};

function getLanguageForCountry(country) {
  return COUNTRY_LANGUAGE[country]?.language || "English";
}

module.exports = { COUNTRY_LANGUAGE, getLanguageForCountry };
