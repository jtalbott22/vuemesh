import { $, api, esc, toast, eventIdFromUrl, verifyStatement, thumbprint, themeButton, betaBanner } from '/js/vm.js';
import { BRAND, FEATURES } from '/js/brand.js';

betaBanner();

themeButton($('#themeBtn'));
$('#patreonLink').href = BRAND.patreon;

const eventId = eventIdFromUrl();

init().catch((e) => {
  $('#title').textContent = e.message;
});

async function init() {
  const ev = await api(`events/${eventId}`);
  document.title = ev.title;
  $('#title').textContent = ev.title;
  $('#camLink').href = `/cam?e=${eventId}`;
  if (!ev.published) {
    $('#film').hidden = true;
    $('#waiting').hidden = false;
    $('#waiting').textContent = !FEATURES.publish
      ? 'During the beta, films aren’t hosted online. Ask the host for the file.'
      : ev.live
        ? 'This event is happening now. The film appears here once the host publishes it.'
        : 'Nothing published yet. Check back after the event.';
    return;
  }
  const film = $('#film');
  film.src = ev.published.filmUrl;
  // The player takes the film's own shape: portrait films play tall, landscape wide.
  film.addEventListener('loadedmetadata', () => $('#screen').classList.toggle('portrait', film.videoHeight > film.videoWidth), { once: true });
  $('#note').textContent = ev.published.title || '';
  const manifest = await fetch(ev.published.manifestUrl).then((r) => r.json()).catch(() => null);
  if (!manifest) return;
  renderCredits(manifest, ev.poolPct);
  if (manifest.sponsor?.name) {
    $('#sponsorName').textContent = manifest.sponsor.name;
    if (manifest.sponsor.image?.startsWith('data:image/')) $('#sponsorImg').src = manifest.sponsor.image;
    else $('#sponsorImg').hidden = true;
    if (/^https?:\/\//.test(manifest.sponsor.link || '')) $('#sponsor').href = manifest.sponsor.link;
    else $('#sponsor').removeAttribute('href');
    $('#sponsor').hidden = false;
  }
  verify(manifest);
}

function renderCredits(m, poolPct) {
  const list = m.credits || [];
  $('#credits').hidden = !list.length;
  $('#creditList').innerHTML = list
    .map((c) => {
      const pct = (c.share * 100).toFixed(c.share < 0.1 ? 1 : 0);
      const pool = poolPct ? `, ${(c.poolShare * 100).toFixed(2)}% of this film’s revenue` : '';
      return `<li>${esc(c.name)} <span>— ${pct}% of the film${pool}</span></li>`;
    })
    .join('') + (m.sound ? `<li>${esc(m.sound)} <span>— sound</span></li>` : '');
  if (m.sound) $('#credits').hidden = false;
}

// Anyone can check the sign-offs: every clip in the film is signed by the phone that shot it.
async function verify(m) {
  let ok = 0;
  for (const c of m.clips || []) {
    const keyOk = (await thumbprint(c.jwk)) === c.cid;
    const joined = await verifyStatement(c.jwk, c.joinSig, ['vuemesh-join-v1', m.event.id, m.event.termsHash, c.name]);
    const signed = await verifyStatement(c.jwk, c.sig, ['vuemesh-signoff-v1', m.event.id, c.id, c.root, m.event.termsHash]);
    if (keyOk && joined && signed) ok++;
  }
  const n = (m.clips || []).length;
  if (n) $('#verify').textContent = ok === n ? `All ${n} clips in this film are signed by the phones that shot them.` : `${ok} of ${n} clip signatures check out.`;
}

$('#share').onclick = async () => {
  const url = `${location.origin}/watch?e=${eventId}`;
  try {
    if (navigator.share) await navigator.share({ title: document.title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch {}
};
