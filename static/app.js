const questions = [
  { category: '01 · Feeling comfortable', title: 'What helps you feel comfortable in a conversation?', hint: 'For example: more time to respond, short questions, writing instead of speaking, or a quiet space.' },
  { category: '02 · Your everyday', title: 'What do you enjoy doing in your everyday life?', hint: 'Think about the people, activities, or little moments that matter to you.' },
  { category: '03 · The obstacles', title: 'Is there something you would like to do that feels difficult or out of reach?', hint: 'It might be at home, when getting around, at work, at school, or somewhere else.' },
  { category: '04 · What works for you', title: 'What already helps you do the things you want to do?', hint: 'This could be a tool, a person, an adjustment, or a way of doing things you have found yourself.' },
  { category: '05 · A little change', title: 'If you could make one everyday thing easier, what would it be?', hint: 'Small changes count. Tell us what a better experience would look like for you.' },
  { category: '06 · In your own words', title: 'Is there anything else you would like someone to understand?', hint: 'This is your space. Share anything we haven’t asked about, or leave this question blank.' }
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
  $('step-label').textContent = `Question ${current + 1} of ${questions.length}`;
  $('progress').value = current + 1;
  $('back').textContent = current === 0 ? 'Home' : 'Back';
  $('next').textContent = current === questions.length - 1 ? 'See my answers →' : 'Continue →';
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
    answer.textContent = answers[i].trim() || 'Skipped — nothing shared.';
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
$('restart').onclick = () => { if (window.confirm('Clear all your answers and start again? This cannot be undone.')) { answers = questions.map(() => ''); current = 0; $('answer').value = ''; $('answers').replaceChildren(); show('welcome'); $('start').focus(); } };
$('download').onclick = () => {
  const text = 'Anna · My conversation\n\n' + questions.map((q, i) => `${q.title}\n${answers[i].trim() || '(Skipped)'}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = 'anna-my-conversation.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('announcement').textContent = 'Your answers are ready to download.';
};
$('text-size').onclick = () => { const enabled = document.documentElement.classList.toggle('large'); $('text-size').setAttribute('aria-pressed', String(enabled)); };
$('contrast').onclick = () => { const enabled = document.body.classList.toggle('high-contrast'); $('contrast').setAttribute('aria-pressed', String(enabled)); };
if (!('speechSynthesis' in window)) $('read').hidden = true;
$('read').onclick = () => {
  stopReading();
  const message = new SpeechSynthesisUtterance(`${questions[current].title} ${questions[current].hint}`);
  message.lang = 'en'; message.rate = 0.85;
  const localVoice = speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith('en'));
  if (!localVoice) { $('announcement').textContent = 'An offline English voice is unavailable. You can use your screen reader to read this question.'; return; }
  message.voice = localVoice;
  message.onerror = () => { $('announcement').textContent = 'Audio is unavailable. The question is also shown as text.'; };
  speechSynthesis.speak(message);
};
