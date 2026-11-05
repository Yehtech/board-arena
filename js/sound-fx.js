/**
 * Classic Board Arena — Native WebAudio Tactile Sound Synthesizer
 * Zero external MP3 dependencies; produces realistic wood clacks, stone snaps,
 * baize disc flips, dice rolls, check alerts, and clock low-time ticks.
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (AC) ctx = new AC();
      }
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(function () {});
      }
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function playNoiseClick(duration, filterFreq, gainVal) {
    const ac = ensureCtx();
    if (!ac) return;
    try {
      const sampleCount = Math.max(128, Math.floor(ac.sampleRate * duration));
      const buffer = ac.createBuffer(1, sampleCount, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) {
        const env = Math.exp((-i / sampleCount) * 7.5);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;

      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = filterFreq;
      filter.Q.value = 2.4;

      const gain = ac.createGain();
      gain.gain.setValueAtTime(gainVal, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);
      src.start();
    } catch (e) {}
  }

  function playTone(freq, duration, type, endFreq, vol) {
    const ac = ensureCtx();
    if (!ac) return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), ac.currentTime + duration);
      }
      gain.gain.setValueAtTime(vol || 0.12, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + duration);
    } catch (e) {}
  }

  BoardArena.SoundFX = {
    isEnabled() {
      return enabled;
    },
    setEnabled(val) {
      enabled = !!val;
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      return enabled;
    },
    playSelect() {
      playTone(620, 0.045, 'sine', 780, 0.06);
    },
    playStone() {
      // Crisp slate/clamshell stone snap on Kaya wood
      playNoiseClick(0.055, 1850, 0.22);
      playTone(920, 0.04, 'triangle', 380, 0.09);
    },
    playWood() {
      // Carved Xiangqi / Shogi / Chess wooden clack
      playNoiseClick(0.07, 980, 0.25);
      playTone(340, 0.065, 'triangle', 165, 0.14);
    },
    playFlip() {
      // Othello disc flip on felt
      playNoiseClick(0.06, 1300, 0.16);
      playTone(480, 0.06, 'sine', 660, 0.08);
    },
    playCapture() {
      // Heavy authoritative capture impact
      playNoiseClick(0.09, 760, 0.3);
      playTone(260, 0.09, 'sawtooth', 120, 0.14);
    },
    playDice() {
      // Rattling 3D dice roll
      [0, 55, 115, 175].forEach(function (ms, idx) {
        setTimeout(function () {
          playNoiseClick(0.04, 1500 + idx * 220, 0.18);
        }, ms);
      });
    },
    playCheck() {
      playTone(587.33, 0.11, 'sawtooth', 880, 0.13);
      setTimeout(function () {
        playTone(880, 0.16, 'triangle', 880, 0.13);
      }, 105);
    },
    playVictory() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (n, idx) {
        setTimeout(function () {
          playTone(n, 0.18, 'triangle', n, 0.12);
        }, idx * 110);
      });
    },
    playIllegal() {
      playTone(190, 0.11, 'sawtooth', 140, 0.1);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
