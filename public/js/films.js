// The films on the home page: a playlist in the hero's program monitor. When the monitor comes
// into view it plays the films one after another (muted: browsers only start sound when you
// ask), then hands over to the live demo. The keys under the wall pick one; the one on air has
// its tally lit and a progress bar along its foot. A film that isn't there (not uploaded yet)
// is skipped and its key hidden. Nothing plays by itself for anyone who's asked for less motion.
import { trackEvent } from '/js/vm.js';

const FILMS = [
  { id: 'wedding', title: 'First Dance', src: '/media/wedding.mp4' },
  { id: 'concert', title: 'Live Tonight', src: '/media/concert.mp4' },
  { id: 'arena', title: 'Game Night', src: '/media/arena.mp4' },
];
const $ = (s) => document.querySelector(s);
const layer = $('#filmLayer'), video = $('#film'), bus = $('#bus');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const keyOf = (id) => bus?.querySelector(`[data-film="${id}"]`);
const missing = new Set(), counted = new Set();
let current = null;          // a film id, or 'demo'
let started = false;         // the playlist has begun (by itself, or by a click)
let wanted = false;          // a film should be playing (it's paused only while the monitor is off screen)

const available = () => FILMS.filter((f) => !missing.has(f.id));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function mark(id) {
  current = id;
  bus?.querySelectorAll('.key').forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.film === id)));
}

function play(id) {
  const f = FILMS.find((x) => x.id === id && !missing.has(x.id));
  if (!f) return showDemo();
  started = true;
  wanted = true;
  mark(id);
  layer.hidden = false;
  window.vmFilmPlaying = true;
  const list = available();
  $('#filmOn').textContent = `Now playing · ${f.title}`;
  $('#filmOf').textContent = `Film ${list.indexOf(f) + 1} of ${list.length} · made with AI`;
  if (!video.src.endsWith(f.src)) {
    video.src = f.src;
    video.currentTime = 0;
  } else if (video.ended) video.currentTime = 0;
  video.play().catch(() => {
    // (a browser that won't start it: leave the film showing, ready to play on a click)
    wanted = false;
  });
  if (!counted.has(id)) {
    counted.add(id);
    trackEvent(`film:${id}:play`);
  }
}

function showDemo() {
  wanted = false;
  video.pause();
  layer.hidden = true;
  window.vmFilmPlaying = false;
  mark('demo');
  bus?.querySelectorAll('.key .prog').forEach((p) => p.style.setProperty('--p', 0));
}

function next() {
  const list = available(), i = list.findIndex((f) => f.id === current);
  if (i >= 0 && i < list.length - 1) play(list[i + 1].id);
  else showDemo(); // (after the last film, the live demo: try it yourself)
}

if (layer && video && bus) {
  // each film's length on its key, and the keys of films that aren't there hidden
  for (const f of FILMS) {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    probe.onloadedmetadata = () => {
      const d = keyOf(f.id)?.querySelector('.dur');
      if (d && Number.isFinite(probe.duration)) d.textContent = `· ${fmt(probe.duration)}`;
      probe.removeAttribute('src');
    };
    probe.onerror = () => {
      missing.add(f.id);
      keyOf(f.id).hidden = true;
      if (current === f.id) next();
    };
    probe.src = f.src;
  }
  bus.addEventListener('click', (e) => {
    const k = e.target.closest('.key');
    if (!k) return;
    if (k.dataset.film === 'demo') return showDemo();
    if (k.dataset.film === current && !video.paused) {
      wanted = false;
      return video.pause();
    }
    play(k.dataset.film);
  });
  $('#filmSound').addEventListener('click', () => {
    video.muted = !video.muted;
    $('#filmSound').setAttribute('aria-pressed', String(!video.muted));
    $('#filmSound').textContent = video.muted ? 'Sound on' : 'Sound off';
    if (video.paused && current !== 'demo') play(current);
  });
  video.addEventListener('timeupdate', () => {
    const p = video.duration ? video.currentTime / video.duration : 0;
    keyOf(current)?.querySelector('.prog')?.style.setProperty('--p', p.toFixed(4));
  });
  video.addEventListener('ended', () => {
    keyOf(current)?.querySelector('.prog')?.style.setProperty('--p', 1);
    trackEvent(`film:${current}:done`);
    next();
  });
  video.addEventListener('error', () => {
    if (current && current !== 'demo') {
      missing.add(current);
      keyOf(current).hidden = true;
      next();
    }
  });
  mark('demo');
  // Presented: when the monitor is well into view, the films start (once, by themselves); off
  // screen they pause, and carry on when it's back.
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      const seen = e.intersectionRatio >= 0.5;
      if (seen && !started && !reduce) {
        const first = available()[0];
        if (first) play(first.id);
      } else if (seen && wanted && video.paused && current !== 'demo') {
        video.play().catch(() => {});
      } else if (!seen && !video.paused) {
        video.pause(); // (wanted stays: it resumes when it's back in view)
      }
    }
  }, { threshold: [0, 0.5] }).observe($('.program'));
}
