// Studio, part 30 of 30: song mode in Edit.
// Loads after callin.js: that import comes first, so the parts run in order (see ../studio.js).
//
// A tempo and a meter under the edit (seq.song, see ../song.js), for making music one take at a
// time: the ruler counts bars and beats, clips snap to the beat, and a click can play along.
// Song → Bars and beats turns it on; the tempo is typed or tapped; Bar 1 at the playhead lines the
// grid up with music that's already there. It's part of the edit: saved with it, and undoable.
import './callin.js';
import { announce } from '/js/vm.js';
import * as G from '/js/song.js';
import { $, player, seq, mode, timeline } from './core.js';
import { commit, snapshot } from './clips.js';

const box = $('#songMenu');
if (box) {
  const ui = {
    on: $('#songOn'), bpm: $('#songBpm'), tap: $('#songTap'), beats: $('#songBeats'),
    at: $('#songAt'), click: $('#songClick'), sum: $('#songSum'), pos: $('#tlBar'), menu: box.querySelector('.songbox'),
  };

  /** Change the song settings as one undoable step. */
  const change = (patch, say) => {
    snapshot();
    seq.song = { ...G.songOf(seq), ...patch };
    commit();
    show();
    if (say) announce(say);
  };

  // the controls show the edit's settings (also after undo, or another edit loading)
  function show() {
    const s = G.songOf(seq);
    ui.on.checked = s.on;
    if (document.activeElement !== ui.bpm) ui.bpm.value = s.bpm;
    ui.beats.value = String(s.beats);
    ui.click.checked = s.click;
    for (const el of [ui.bpm, ui.tap, ui.beats, ui.at, ui.click]) el.disabled = !s.on;
    ui.menu.toggleAttribute('data-off', !s.on);
    box.toggleAttribute('data-on', s.on);
    ui.sum.textContent = s.on ? `♩ ${s.bpm} · ${s.beats}/4` : 'Song';
    ui.sum.setAttribute('aria-label', s.on ? `Song: ${s.bpm} beats a minute, ${s.beats} beats a bar${s.click ? ', click on' : ''}` : 'Song mode, off');
    ui.pos.hidden = !s.on;
  }

  ui.on.onchange = () => change({ on: ui.on.checked }, ui.on.checked ? 'Bars and beats on' : 'Bars and beats off');
  ui.bpm.onchange = () => change({ bpm: G.clampBpm(ui.bpm.value) }, null);
  ui.beats.onchange = () => change({ beats: +ui.beats.value }, null);
  ui.click.onchange = () => change({ click: ui.click.checked }, ui.click.checked ? 'Click on' : 'Click off');
  ui.at.onclick = () => change({ at: player.t }, 'Bar 1 starts at the playhead');

  // tap tempo: the tempo follows the taps; a pause of two seconds starts again
  let taps = [];
  ui.tap.onclick = () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    taps = taps.slice(-12);
    const bpm = G.tapTempo(taps);
    if (bpm) {
      ui.bpm.value = bpm;
      ui.tap.textContent = `Tap (${bpm})`;
    } else ui.tap.textContent = `Tap ${'•'.repeat(taps.length)}`;
  };
  // the tempo is kept once the taps stop (one undo step for the whole run of taps)
  let tapIdle = 0;
  ui.tap.addEventListener('click', () => {
    clearTimeout(tapIdle);
    tapIdle = setTimeout(() => {
      const bpm = G.tapTempo(taps);
      taps = [];
      ui.tap.textContent = 'Tap';
      if (bpm && bpm !== G.songOf(seq).bpm) change({ bpm }, `Tempo ${bpm}`);
    }, 2100);
  });

  // the keys inside the menu are its own (Space and S mustn't play or snap the timeline)
  ui.menu.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') box.open = false;
  });

  // the controls follow the edit's settings however they change (undo, redo, the edit loading):
  // every change redraws the timeline
  timeline.rendered = show;
  show();

  // the playhead in bars and beats, beside its time
  player.on('tick', (t) => {
    if (mode !== 'edit' || !seq.song?.on) return;
    const v = G.fmtPos(G.songOf(seq), t);
    if (ui.pos.textContent !== v) ui.pos.textContent = v;
  });
  box.addEventListener('toggle', show);
}
