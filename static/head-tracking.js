// Suivi des mouvements de tête avec MediaPipe Face Landmarker (Tasks Vision), 100 % dans le navigateur :
// les images de la caméra ne quittent jamais l'appareil, seuls les gestes (oui / non / parler) sont émis.
//   tête tournée vers SA gauche = oui · vers SA droite = non · pencher la tête 1 s = je veux parler
// (getSwap() inverse gauche et droite si la caméra de l'appareil renvoie une image miroir)

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export function createHeadTracker({ video, onGesture, onMeters, onStatus, getSensitivity, getSwap = () => false, getFacing = () => 'environment' }) {
  let landmarker = null, stream = null, running = false, raf = 0, lastTime = -1;
  const st = { base: null, calib: [], exc: null, cool: 0, rollT: 0 };

  async function load() {
    if (landmarker) return;
    onStatus('Chargement du modèle…');
    const { FaceLandmarker, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const opts = delegate => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1 });
    try { landmarker = await FaceLandmarker.createFromOptions(files, opts('GPU')); }
    catch { landmarker = await FaceLandmarker.createFromOptions(files, opts('CPU')); }
  }

  async function start() {
    // Caméra arrière par défaut : le téléphone est tenu par la personne en face d'Anna, écran vers elle.
    const facing = getFacing();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';   // aperçu en miroir seulement pour la caméra avant
    video.srcObject = stream;
    await video.play();
    await load();
    recalibrate();
    running = true;
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function recalibrate() {
    Object.assign(st, { base: null, calib: [], exc: null, rollT: 0 });
    onStatus('Calibration : tête immobile…');
  }

  function loop() {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const res = landmarker.detectForVideo(video, performance.now());
      track(res.faceLandmarks?.[0], (video.videoWidth || 4) / (video.videoHeight || 3));
    }
    raf = requestAnimationFrame(loop);
  }

  // Orientation de la tête à partir du nez et des coins des yeux, normalisée par l'écart entre les yeux
  // et corrigée de l'inclinaison (roll) pour que pencher la tête ne soit pas lu comme oui ou non.
  function track(lm, aspect) {
    if (!lm) { onStatus('Visage non détecté'); return; }
    const n = lm[1], L = lm[33], R = lm[263];
    const lx = L.x * aspect, rx = R.x * aspect, nx = n.x * aspect;
    const eye = Math.hypot(rx - lx, R.y - L.y), mx = (lx + rx) / 2, my = (L.y + R.y) / 2;
    const roll = Math.atan2(R.y - L.y, rx - lx), c = Math.cos(-roll), s = Math.sin(-roll);
    const vx = nx - mx, vy = n.y - my;
    const yaw = (vx * c - vy * s) / eye, pitch = (vx * s + vy * c) / eye;

    if (!st.base) {
      st.calib.push([yaw, pitch, roll]);
      if (st.calib.length >= 25) {
        const m = i => st.calib.reduce((a, v) => a + v[i], 0) / st.calib.length;
        st.base = { y: m(0), p: m(1), r: m(2) };
        onStatus('Prêt');
      }
      return;
    }
    const k = getSensitivity(), kP = 0.12 * k, kY = 0.16 * k, kR = 0.26 * k;
    const dp = pitch - st.base.p, dy = yaw - st.base.y, dr = roll - st.base.r, now = performance.now();
    // Dans l'image brute de la caméra, le nez part vers la droite de l'image quand Anna tourne vers SA gauche.
    const left = getSwap() ? -dy : dy;
    onMeters(Math.max(0, left) / kY, Math.max(0, -left) / kY, Math.abs(dr) / kR);
    if (now < st.cool) { st.exc = null; return; }

    // Pencher la tête et tenir 1 seconde = je veux parler
    if (Math.abs(dr) > kR) {
      if (!st.rollT) st.rollT = now;
      if (now - st.rollT > 1000) { fire('parler'); st.rollT = 0; st.cool = now + 2000; }
      return;
    }
    st.rollT = 0;

    // Un geste = tourner la tête au-delà du seuil puis revenir au repos en moins de 1,6 s.
    // Le sens de la rotation la plus forte décide : vers sa gauche = oui, vers sa droite = non.
    // Un mouvement surtout vertical (hocher, baisser la tête) n'est pas un geste.
    if (!st.exc) {
      if (Math.abs(dy) > kY) st.exc = { t: now, py: 0, pp: 0, peak: 0 };
      else if (Math.abs(dp) < kP * 0.3 && Math.abs(dy) < kY * 0.3) {
        // Au repos : la position de référence suit lentement les petits glissements.
        st.base.p += 0.02 * dp; st.base.y += 0.02 * dy; st.base.r += 0.02 * dr;
      }
    }
    if (st.exc) {
      const e = st.exc;
      if (Math.abs(left) > Math.abs(e.peak)) e.peak = left;
      e.py = Math.max(e.py, Math.abs(dy) / kY); e.pp = Math.max(e.pp, Math.abs(dp) / kP);
      if (now - e.t > 1600) { st.exc = null; if (now - e.t > 4000) recalibrate(); }
      else if (Math.abs(dy) < kY * 0.45) {
        st.exc = null;
        if (e.py > e.pp * 1.15) { fire(e.peak > 0 ? 'oui' : 'non'); st.cool = now + 1200; }
      }
    }
  }

  const fire = g => onGesture(g);

  return { start, stop, recalibrate, get running() { return running; } };
}
