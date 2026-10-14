const textSize = document.getElementById('text-size');
const contrast = document.getElementById('contrast');
textSize.onclick = () => {
  const enabled = document.documentElement.classList.toggle('large');
  textSize.setAttribute('aria-pressed', String(enabled));
};
contrast.onclick = () => {
  const enabled = document.body.classList.toggle('high-contrast');
  contrast.setAttribute('aria-pressed', String(enabled));
};
