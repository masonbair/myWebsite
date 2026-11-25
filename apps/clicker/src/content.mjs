/** Every word on the site. The game has no public name yet; change GAME.name and it updates everywhere. */
export const GAME = {
  name: 'Grey Orb',
  nameIsFinal: false,
  domain: 'clicker.masonbair.com',
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

/** Set to true to show the "How we made it" card. Mason has not decided yet. */
export const SHOW_MAKING_OF = false;

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
  makingOfBody: 'Mason plus a crew of Claude agents, from a brain dump to a playable game.',
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
