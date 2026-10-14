const questions = [
  { category: '01 · Se sentir à l’aise', title: 'Qu’est-ce qui t’aide à te sentir à l’aise dans une conversation ?', hint: 'Par exemple : plus de temps pour répondre, des questions courtes, écrire plutôt que parler ou un endroit calme.' },
  { category: '02 · Ton quotidien', title: 'Qu’est-ce que tu aimes faire au quotidien ?', hint: 'Pense aux personnes, aux activités ou aux petits moments qui comptent pour toi.' },
  { category: '03 · Les obstacles', title: 'Y a-t-il quelque chose que tu aimerais faire, mais qui te semble difficile ou inaccessible ?', hint: 'Cela peut être à la maison, dans tes déplacements, au travail, à l’école ou ailleurs.' },
  { category: '04 · Ce qui t’aide', title: 'Qu’est-ce qui t’aide déjà à faire ce dont tu as envie ?', hint: 'Cela peut être un outil, une personne, un aménagement ou une façon de faire que tu as trouvée.' },
  { category: '05 · Un petit changement', title: 'Si tu pouvais rendre une chose du quotidien plus facile, laquelle choisirais-tu ?', hint: 'Les petits changements comptent aussi. Explique ce qui te conviendrait mieux.' },
  { category: '06 · Avec tes mots', title: 'Y a-t-il autre chose que tu aimerais que l’on comprenne ?', hint: 'Cet espace est le tien. Partage ce que tu souhaites ou passe cette question.' }
];
let current = 0;
let answers = questions.map(() => '');
const $ = id => document.getElementById(id);
const screens = ['welcome', 'conversation', 'break', 'summary'];
function stopReading() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
function show(id) { stopReading(); screens.forEach(screen => $(screen).hidden = screen !== id); window.scrollTo(0, 0); }
function save() { answers[current] = $('answer').value; }
function renderQuestion() {
  show('conversation');
  const q = questions[current];
  $('category').textContent = q.category;
  $('question-title').textContent = q.title;
  $('hint').textContent = q.hint;
  $('answer').value = answers[current];
  $('step-label').textContent = `Question ${current + 1} sur ${questions.length}`;
  $('progress').value = current + 1;
  $('back').textContent = current === 0 ? 'Accueil' : 'Retour';
  $('next').textContent = current === questions.length - 1 ? 'Voir les réponses →' : 'Continuer →';
  $('question-title').focus();
}
function summary() {
  show('summary');
  $('answers').replaceChildren();
  questions.forEach((q, i) => {
    const article = document.createElement('article');
    const heading = document.createElement('h2');
    const answer = document.createElement('p');
    heading.textContent = q.title;
    answer.textContent = answers[i].trim() || 'Question passée — aucune réponse.';
    article.append(heading, answer);
    $('answers').append(article);
  });
  $('summary').querySelector('h1').focus();
}
function advance() { current < questions.length - 1 ? (current++, renderQuestion()) : summary(); }
$('start').onclick = renderQuestion;
$('next').onclick = () => { save(); advance(); };
$('skip').onclick = () => { answers[current] = ''; advance(); };
$('back').onclick = () => { save(); if (current > 0) { current--; renderQuestion(); } else { show('welcome'); $('start').focus(); } };
$('pause').onclick = () => { save(); show('break'); $('break').querySelector('h1').focus(); };
$('resume').onclick = renderQuestion;
$('edit').onclick = () => { current = 0; renderQuestion(); };
$('restart').onclick = () => { if (window.confirm('Effacer toutes les réponses et recommencer ? Cette action est irréversible.')) { answers = questions.map(() => ''); current = 0; $('answer').value = ''; $('answers').replaceChildren(); show('welcome'); $('start').focus(); } };
$('download').onclick = () => {
  const text = 'Anna · Ma conversation\n\n' + questions.map((q, i) => `${q.title}\n${answers[i].trim() || '(Question passée)'}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = 'anna-ma-conversation.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('announcement').textContent = 'Les réponses sont prêtes à être téléchargées.';
};
$('text-size').onclick = () => { const enabled = document.documentElement.classList.toggle('large'); $('text-size').setAttribute('aria-pressed', String(enabled)); };
$('contrast').onclick = () => { const enabled = document.body.classList.toggle('high-contrast'); $('contrast').setAttribute('aria-pressed', String(enabled)); };
if (!('speechSynthesis' in window)) $('read').hidden = true;
$('read').onclick = () => {
  stopReading();
  const message = new SpeechSynthesisUtterance(`${questions[current].title} ${questions[current].hint}`);
  message.lang = 'fr-FR'; message.rate = 0.85;
  const localVoice = speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith('fr'));
  if (!localVoice) { $('announcement').textContent = 'Aucune voix française hors ligne n’est disponible. Vous pouvez utiliser votre lecteur d’écran pour écouter cette question.'; return; }
  message.voice = localVoice;
  message.onerror = () => { $('announcement').textContent = 'La lecture audio est indisponible. La question est également affichée à l’écran.'; };
  speechSynthesis.speak(message);
};
