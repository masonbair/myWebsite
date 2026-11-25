/** Every word on the site. The game's name lives here only; change GAME.name and it updates everywhere. */
export const GAME = {
  name: 'Unfaded',
  domain: 'unfaded.masonbair.com',
  status: 'Coming soon',
  platforms: 'Android first. iPhone after.',
  firstPlatform: 'Android first',
};

export const LINKS = {
  mason: 'https://masonbair.com',
  /** masonbair.com's Person node, so search engines tie the game to the same Mason Bair. */
  masonPersonId: 'https://masonbair.com/#person',
};

export const SITE_URL = `https://${GAME.domain}`;

/** Shows the "How we made it" section. Mason said yes, 2026-11-25. */
export const SHOW_MAKING_OF = true;

export const COPY = {
  title: `${GAME.name}: a quiet clicker game by Mason Bair`,
  description:
    'A small, quiet game for your phone. Tap a grey Orb for Glow, and bit by bit, color finds its way back into a grey world. Coming soon to Android.',
  heroTitle: 'A grey Orb.',
  heroTitleStrong: 'Tap it.',
  heroLede:
    'A small, quiet game for your phone. Tap the Orb for Glow. Bit by bit, color finds its way back into a grey world.',
  cards: [
    { label: 'What it is', title: 'A clicker you can sit with', body: 'Tap and hold the Orb to make Glow. Spend it on small helpers that make more Glow while you rest.', dot: 'mint' },
    { label: 'The idea', title: 'It starts with nothing', body: 'No color. One lonely music box. One grey Orb. Everything you see after that, you earned.', dot: 'pink' },
    { label: 'Secrets', title: 'The Orb talks', body: 'It is not always honest. Some things only show up if you try odd things.', dot: 'blue' },
  ],
  feelLabel: 'How it feels',
  shots: [
    { src: '/shots/m1-hush-start.webp', width: 560, height: 1212, caption: 'The first second', alt: 'The first screen of the game: a white Orb glowing in a dark room, with 0 Glow above it.' },
    { src: '/shots/hour-one.webp', width: 372, height: 826, caption: 'About an hour in', alt: 'The game about an hour in: 12.6 million Glow, small grey orbs drifting around the big Orb, and the Orb saying "You\'re really good at this. Again!"' },
  ],
  quote: 'Your taps feel like rain on a roof.',
  quoteBy: 'The Orb, about an hour in',
  soonTitle: 'Android first. iPhone after.',
  soonBody: 'The game is not out yet. Mason shares what he is building on his own site.',
  soonCta: 'Visit masonbair.com',
  makingOfTitle: 'How we made it',
  makingOfLede: `${GAME.name} is made by Mason with a small crew of Claude agents. Mason decides; the agents draft, build and test.`,
  makingOfSteps: [
    { title: 'A brain dump', body: 'It started as a page of notes from Mason: a grey Orb, a world without color, and a game you can sit with.' },
    { title: 'A shared design board', body: 'The agents turned the notes into hundreds of small ideas and mockups. Mason marked each one yes, maybe or no.' },
    { title: 'A playable prototype', body: 'The yeses became a web version you can play.' },
    { title: 'Next: your phone', body: 'Android comes first. A version built in the Godot game engine is on the way.' },
  ],
  footer: 'Made by Mason Bair',
  ogImageAlt: 'A white Orb glowing in a dark room, with the words: A grey Orb. Tap it.',
  faqTitle: 'Quick answers',
  faq: [
    { q: `What is ${GAME.name}?`, a: `${GAME.name} is an idle clicker game for phones, made by Mason Bair. You tap a grey Orb to make Glow, spend Glow on small helpers that make more of it, and slowly bring color back to a grey world. It is dark, calm and minimal.` },
    { q: `Is ${GAME.name} out yet?`, a: 'Not yet. It is coming soon, on Android first and on iPhone after that. There is no release date yet.' },
    { q: 'How do you play?', a: 'Tap the Orb, or hold it, to make Glow. Glow buys helpers that keep making Glow while you rest. New things appear as you go, and some are hidden on purpose.' },
    { q: 'Who is making it?', a: 'Mason Bair, a forward deployed engineer and digital nomad. You can read about him at masonbair.com.' },
  ],
  orbLabel: 'Tap the Orb',
};

/** The privacy policy at /privacy. Google Play links to it, so keep it true to the shipped app. */
export const PRIVACY = {
  title: `${GAME.name} privacy policy`,
  description: `${GAME.name} collects no personal data. Saves stay on your device, and the app makes no network requests. No ads, no accounts.`,
  updated: { iso: '2026-11-25', text: 'November 25, 2026' },
  lede: `${GAME.name} is a game by Mason Bair. This policy covers the ${GAME.name} app and this website.`,
  sections: [
    { title: 'The short version', body: [`${GAME.name} collects no personal data. It shares none and sells none.`] },
    { title: 'What the app keeps', body: ['Your game progress is saved on your device. The game does not send it anywhere.'] },
    {
      title: 'What the app sends',
      body: ['Nothing. The app makes no network requests.', 'It has no accounts, no ads, no analytics and no tracking.'],
    },
    {
      title: 'Purchases',
      body: [
        'The app is free. In-app purchases may come in a later update.',
        'If they change anything on this page, this policy will be updated, along with the date at the top.',
      ],
    },
    { title: 'Children', body: ['The app collects nothing from anyone, children included.'] },
    {
      title: 'This website',
      body: [
        'This website uses no cookies, no analytics and no trackers.',
        'Like any website, its host, Vercel, handles basic request data such as IP addresses to deliver pages.',
      ],
    },
  ],
  contactTitle: 'Questions',
  contactBefore: 'Reach Mason through ',
  contactAfter: ', where his email is listed.',
  footerLink: 'Privacy',
};
