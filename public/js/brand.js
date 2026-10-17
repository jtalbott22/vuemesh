// Brand, money links, and beta switches, all in one place.
export const BRAND = {
  name: 'VUEMesh',
  patreon: 'https://www.patreon.com/duh_live_video',
  // Where sponsor and advertising inquiries go. Leave empty to send people to Patreon messages instead.
  sponsorEmail: '',
};

// Beta switches. Turn these on when the legal and security groundwork is in place.
export const FEATURES = {
  publish: false, // upload finished films to the cloud and host a watch page
  globe: false,   // the public map of events (the server has its own switch too)
};

// Bump this when the Terms change; people are asked to agree again.
export const TERMS_VERSION = '2026-10-11';

export const sponsorContactHref = () =>
  BRAND.sponsorEmail
    ? `mailto:${BRAND.sponsorEmail}?subject=${encodeURIComponent('Advertising on VUEMesh')}`
    : BRAND.patreon;

/** Shown in diagnostics reports (keep in step with package.json). */
export const APP_VERSION = '0.46.4';
