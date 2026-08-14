// The font family list for signature styling - the 4 explicitly
// requested (Poppins, Work Sans, Open Sans, Verdana) plus 6 other
// widely-used fonts to round out to 10 options. Every Google Font here
// has a matching Google Fonts CSS import (see GOOGLE_FONT_IMPORT_URL)
// used to load it correctly wherever the signature is actually being
// edited or previewed. Verdana is a classic web-safe system font, not a
// Google Font - included anyway since it was explicitly asked for, and
// it needs no import at all since every device already has it.
//
// Worth being upfront about a real limitation: most email clients
// (Gmail, Outlook, etc.) strip external @font-face/@import rules from
// received email for security reasons, so a recipient will often see
// their client's own default font rather than the exact chosen one -
// this is a known, universal constraint of HTML email, not something
// specific to this app. The font-family value below always includes a
// sensible sans-serif fallback for that reason.
const SIGNATURE_FONTS = [
  { value: "'Poppins', sans-serif", label: "Poppins", googleFont: "Poppins:wght@400;600;700" },
  { value: "'Work Sans', sans-serif", label: "Work Sans", googleFont: "Work+Sans:wght@400;600;700" },
  { value: "'Open Sans', sans-serif", label: "Open Sans", googleFont: "Open+Sans:wght@400;600;700" },
  { value: "'Roboto', sans-serif", label: "Roboto", googleFont: "Roboto:wght@400;500;700" },
  { value: "'Lato', sans-serif", label: "Lato", googleFont: "Lato:wght@400;700" },
  { value: "'Montserrat', sans-serif", label: "Montserrat", googleFont: "Montserrat:wght@400;600;700" },
  { value: "'Inter', sans-serif", label: "Inter", googleFont: "Inter:wght@400;600;700" },
  { value: "'Nunito', sans-serif", label: "Nunito", googleFont: "Nunito:wght@400;600;700" },
  { value: "'Raleway', sans-serif", label: "Raleway", googleFont: "Raleway:wght@400;600;700" },
  { value: "Verdana, sans-serif", label: "Verdana", googleFont: null },
];

const SIGNATURE_FONT_OPTIONS = SIGNATURE_FONTS.map((f) => f.value);
const DEFAULT_SIGNATURE_FONT_FAMILY = SIGNATURE_FONTS[0].value; // Poppins
const DEFAULT_SIGNATURE_FONT_SIZE = 14;
const MIN_SIGNATURE_FONT_SIZE = 6;
const MAX_SIGNATURE_FONT_SIZE = 36;

// One combined Google Fonts stylesheet URL covering every Google Font in
// the list above, for the editor/preview to load in a single request.
const GOOGLE_FONTS_IMPORT_URL = `https://fonts.googleapis.com/css2?${SIGNATURE_FONTS.filter((f) => f.googleFont)
  .map((f) => `family=${f.googleFont}`)
  .join("&")}&display=swap`;

module.exports = {
  SIGNATURE_FONTS,
  SIGNATURE_FONT_OPTIONS,
  DEFAULT_SIGNATURE_FONT_FAMILY,
  DEFAULT_SIGNATURE_FONT_SIZE,
  MIN_SIGNATURE_FONT_SIZE,
  MAX_SIGNATURE_FONT_SIZE,
  GOOGLE_FONTS_IMPORT_URL,
};
