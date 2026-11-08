// Brand, money links, and beta switches, all in one place.
export const BRAND = {
  name: 'VUEMesh',
  patreon: 'https://www.patreon.com/duh_live_video',
  // Where partner inquiries go (the Work with VUEMesh page's buttons, each with its own subject). Leave empty
  // to send people to Patreon messages instead.
  sponsorEmail: 'jtalbott22@gmail.com',
};

// Beta switches. Turn these on when the legal and security groundwork is in place.
export const FEATURES = {
  publish: false, // upload finished films to the cloud and host a watch page
  globe: false,   // the public map of events (the server has its own switch too)
};

// Bump this when the Terms change; people are asked to agree again.
export const TERMS_VERSION = '2026-10-11';

export const sponsorContactHref = (subject = 'Hello from the VUEMesh site') =>
  BRAND.sponsorEmail
    ? `mailto:${BRAND.sponsorEmail}?subject=${encodeURIComponent(subject)}`
    : BRAND.patreon;

/** Shown in diagnostics reports (keep in step with package.json). */
export const APP_VERSION = '0.66.10';
