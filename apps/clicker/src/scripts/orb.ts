const GLOW_PER_DOT = 10;
const orb = document.querySelector<HTMLButtonElement>('[data-orb]');
const counter = document.querySelector('[data-glow]');
const cards = document.querySelectorAll<HTMLElement>('[data-cards] .card');

if (orb && counter) {
  let glow = 0;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  const shedSpecks = () => {
    if (calm.matches) return;
    const wrap = orb.parentElement!;
    for (let i = 0; i < 5; i++) {
      const speck = document.createElement('span');
      speck.className = 'speck';
      const angle = Math.random() * Math.PI * 2;
      const reach = orb.offsetWidth * (0.55 + Math.random() * 0.35);
      speck.style.setProperty('--dx', `${Math.cos(angle) * reach}px`);
      speck.style.setProperty('--dy', `${Math.sin(angle) * reach}px`);
      speck.addEventListener('animationend', () => speck.remove());
      wrap.append(speck);
    }
  };

  orb.addEventListener('click', () => {
    glow += 1;
    counter.textContent = glow.toLocaleString('en-US');
    // Each card's dot lights up in turn, the way the game marks something new.
    const lit = Math.min(cards.length, Math.floor(glow / GLOW_PER_DOT));
    cards.forEach((card, i) => card.classList.toggle('lit', i < lit));
    shedSpecks();
  });
}
