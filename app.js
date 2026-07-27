(function () {
  'use strict';

  var VERSION = '4.0.6';
  var BUILD_DATE = '2026-07-27';
  var NIGHTLY_RELOAD_HOUR = 3;
  var NIGHTLY_RELOAD_MINUTE = 5;
  var SLOT_MINUTES = 75;
  var SLOT_SECONDS = SLOT_MINUTES * 60;
  var OPEN_MINUTES = 4 * 60;
  var CLOSE_MINUTES = 24 * 60;

  var slots = [];
  var i;
  for (i = 0; i < 16; i++) {
    slots.push({
      index: i,
      start: OPEN_MINUTES + i * SLOT_MINUTES,
      end: OPEN_MINUTES + (i + 1) * SLOT_MINUTES
    });
  }

  var el = {
    app: document.getElementById('app'),
    logo: document.getElementById('logo'),
    clock: document.getElementById('clock'),
    active: document.getElementById('screen-active'),
    night: document.getElementById('screen-night'),
    between: document.getElementById('screen-between'),
    slotLabel: document.getElementById('slot-label'),
    countdown: document.getElementById('countdown'),
    endTime: document.getElementById('end-time'),
    warn10: document.getElementById('warn10'),
    exitBox: document.getElementById('exit-box'),
    lastMinute: document.getElementById('last-minute'),
    nextStart: document.getElementById('next-start'),
    nextCountdown: document.getElementById('next-countdown'),
    progress: document.getElementById('progress'),
    endedOverlay: document.getElementById('ended-overlay'),
    service: document.getElementById('service-menu'),
    closeService: document.getElementById('close-service'),
    testSound: document.getElementById('test-sound'),
    testNormal: document.getElementById('test-normal'),
    test10: document.getElementById('test-10'),
    test5: document.getElementById('test-5'),
    test1: document.getElementById('test-1'),
    testLast10: document.getElementById('test-last10'),
    testEnded: document.getElementById('test-ended'),
    testNight: document.getElementById('test-night'),
    diagSlot: document.getElementById('diag-slot'),
    diagRemaining: document.getElementById('diag-remaining'),
    diagAudio: document.getElementById('diag-audio'),
    diagOnline: document.getElementById('diag-online'),
    diagWake: document.getElementById('diag-wake'),
    diagSync: document.getElementById('diag-sync'),
    diagWatchdog: document.getElementById('diag-watchdog'),
    restartApp: document.getElementById('restart-app')
  };

  var state = {
    initialized: false,
    currentSlotId: null,
    previousRemaining: null,
    previousNow: null,
    overlayUntil: 0,
    warningKeys: {},
    logoTapCount: 0,
    lastLogoTap: 0,
    serviceTimer: null,
    wakeLock: null,
    audioContext: null,
    lastAudioError: '',
    previewMode: null,
    previewUntil: 0,
    previewHint: null,
    lastSecondBeepKey: null,
    lastTickWallTime: 0,
    lastSyncTime: 0,
    lastNightlyReloadKey: '',
    watchdogHealthy: true
  };

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatClock(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatDuration(seconds) {
    if (seconds < 0) seconds = 0;
    seconds = Math.floor(seconds);
    var minutes = Math.floor(seconds / 60);
    var secs = seconds % 60;
    return pad(minutes) + ':' + pad(secs);
  }

  function formatActiveRemaining(seconds) {
    if (seconds < 0) seconds = 0;
    seconds = Math.floor(seconds);
    var minutes = Math.floor(seconds / 60);
    var secs = seconds % 60;
    var separator = ':';
    return pad(minutes) + separator + pad(secs);
  }

  function formatMinutes(total) {
    var dayMinutes = total;
    if (dayMinutes >= 1440) dayMinutes -= 1440;
    return pad(Math.floor(dayMinutes / 60)) + ':' + pad(dayMinutes % 60);
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function getContext(now) {
    var mins = now.getHours() * 60 + now.getMinutes();
    var secondsInMinute = now.getSeconds();
    var millis = now.getMilliseconds();
    var exactMinutes = mins + secondsInMinute / 60 + millis / 60000;
    var idx;

    if (exactMinutes < OPEN_MINUTES) {
      return {
        kind: 'night',
        nextStart: OPEN_MINUTES,
        secondsUntilNext: Math.max(0, Math.floor((OPEN_MINUTES - exactMinutes) * 60))
      };
    }

    for (idx = 0; idx < slots.length; idx++) {
      if (exactMinutes >= slots[idx].start && exactMinutes < slots[idx].end) {
        return {
          kind: 'active',
          index: idx,
          slot: slots[idx],
          slotId: dayKey(now) + '-' + idx,
          startLabel: formatMinutes(slots[idx].start),
          endLabel: formatMinutes(slots[idx].end),
          remaining: Math.max(0, Math.ceil((slots[idx].end - exactMinutes) * 60))
        };
      }
    }

    return {
      kind: 'night',
      nextStart: OPEN_MINUTES,
      secondsUntilNext: Math.max(0, Math.floor(((1440 - exactMinutes) + OPEN_MINUTES) * 60))
    };
  }

  function hideAllScreens() {
    el.active.className = 'screen hidden';
    el.night.className = 'screen hidden';
    el.between.className = 'screen hidden';
  }

  function warningState(remaining) {
    if (remaining <= 60) return 'warn1';
    if (remaining <= 300) return 'warn5';
    if (remaining <= 600) return 'warn10';
    return 'normal';
  }

  function render(now, ctx) {
    el.clock.innerHTML = formatClock(now);
    el.app.className = 'app';
    hideAllScreens();

    if (ctx.kind === 'night') {
      el.night.className = 'screen';
      el.nextCountdown.innerHTML = formatDuration(ctx.secondsUntilNext);
      el.progress.style.width = '0%';
      el.diagSlot.innerHTML = 'Noční režim';
      el.diagRemaining.innerHTML = formatDuration(ctx.secondsUntilNext);
      return;
    }

    el.active.className = 'screen active-screen';
    el.slotLabel.innerHTML = 'REZERVACE ' + ctx.startLabel + ' – ' + ctx.endLabel;
    el.countdown.innerHTML = formatActiveRemaining(ctx.remaining);
    el.endTime.innerHTML = ctx.endLabel;

    var ws = warningState(ctx.remaining);
    el.warn10.className = 'warn10 hidden';
    el.exitBox.className = 'exit-box hidden';
    el.lastMinute.className = 'last-minute hidden';

    if (ws === 'warn10') {
      el.app.className = 'app state-warn10';
      el.warn10.className = 'warn10';
      el.exitBox.className = 'exit-box';
    } else if (ws === 'warn5') {
      el.app.className = 'app state-warn5';
      el.exitBox.className = 'exit-box';
    } else if (ws === 'warn1') {
      el.app.className = ctx.remaining <= 10 ? 'app state-warn1 state-last10' : 'app state-warn1';
      el.exitBox.className = 'exit-box';
      el.lastMinute.className = 'last-minute';
    }

    var elapsed = SLOT_SECONDS - ctx.remaining;
    var pct = Math.max(0, Math.min(100, (elapsed / SLOT_SECONDS) * 100));
    el.progress.style.width = pct + '%';

    el.diagSlot.innerHTML = ctx.startLabel + '–' + ctx.endLabel;
    el.diagRemaining.innerHTML = formatDuration(ctx.remaining);
  }

  function getAudioContext() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!state.audioContext) {
      try {
        state.audioContext = new AC();
      } catch (e) {
        state.lastAudioError = String(e);
      }
    }
    return state.audioContext;
  }

  function playTone(pattern) {
    var ac = getAudioContext();
    if (!ac) {
      el.diagAudio.innerHTML = 'nepodporován';
      return;
    }

    try {
      if (ac.state === 'suspended' && ac.resume) {
        ac.resume();
      }

      var master = ac.createGain();
      var compressor = ac.createDynamicsCompressor ? ac.createDynamicsCompressor() : null;
      master.gain.value = 1.0;

      if (compressor) {
        compressor.threshold.value = -26;
        compressor.knee.value = 8;
        compressor.ratio.value = 18;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;
        master.connect(compressor);
        compressor.connect(ac.destination);
      } else {
        master.connect(ac.destination);
      }

      var start = ac.currentTime + 0.03;
      var parts = pattern || [{ f: 2400, d: 0.25, g: 1.0, type: 'square' }];
      var pos = start;
      var p;

      for (p = 0; p < parts.length; p++) {
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        var part = parts[p];

        osc.type = part.type || 'square';
        osc.frequency.value = part.f;

        gain.gain.setValueAtTime(0.0001, pos);
        gain.gain.exponentialRampToValueAtTime(part.g || 1.0, pos + 0.012);
        gain.gain.setValueAtTime(part.g || 1.0, pos + Math.max(0.02, part.d - 0.035));
        gain.gain.exponentialRampToValueAtTime(0.0001, pos + part.d);

        osc.connect(gain);
        gain.connect(master);
        osc.start(pos);
        osc.stop(pos + part.d + 0.04);

        pos += part.d + (part.gap || 0.09);
      }

      el.diagAudio.innerHTML = ac.state || 'aktivní';
    } catch (e) {
      state.lastAudioError = String(e);
      el.diagAudio.innerHTML = 'blokován';
    }
  }

  function playWarning(kind) {
    /* Příjemnější zvuky pro malý reproduktor: sinus/triangle místo ostré sirény. */
    if (kind === 'warn10') {
      playTone([
        { f: 740, d: 0.18, g: 0.82, type: 'sine', gap: 0.12 },
        { f: 988, d: 0.30, g: 0.88, type: 'sine' }
      ]);
    } else if (kind === 'warn5') {
      playTone([
        { f: 659, d: 0.16, g: 0.82, type: 'triangle', gap: 0.08 },
        { f: 784, d: 0.16, g: 0.84, type: 'triangle', gap: 0.08 },
        { f: 988, d: 0.30, g: 0.90, type: 'sine' }
      ]);
    } else if (kind === 'warn1') {
      playTone([
        { f: 659, d: 0.13, g: 0.80, type: 'triangle', gap: 0.06 },
        { f: 784, d: 0.13, g: 0.82, type: 'triangle', gap: 0.14 },
        { f: 659, d: 0.13, g: 0.80, type: 'triangle', gap: 0.06 },
        { f: 784, d: 0.13, g: 0.82, type: 'triangle', gap: 0.06 },
        { f: 988, d: 0.28, g: 0.90, type: 'sine' }
      ]);
    } else if (kind === 'last10') {
      playTone([
        { f: 1047, d: 0.075, g: 0.72, type: 'sine', gap: 0 }
      ]);
    } else if (kind === 'ended') {
      playTone([
        { f: 988, d: 0.24, g: 0.92, type: 'sine', gap: 0.05 },
        { f: 659, d: 0.34, g: 0.88, type: 'sine', gap: 0.38 },
        { f: 988, d: 0.24, g: 0.92, type: 'sine', gap: 0.05 },
        { f: 659, d: 0.34, g: 0.88, type: 'sine', gap: 0.38 },
        { f: 988, d: 0.24, g: 0.92, type: 'sine', gap: 0.05 },
        { f: 659, d: 0.34, g: 0.88, type: 'sine', gap: 0.38 },
        { f: 988, d: 0.24, g: 0.92, type: 'sine', gap: 0.05 },
        { f: 659, d: 0.42, g: 0.88, type: 'sine' }
      ]);
    }
  }

  function markWarning(slotId, warning) {
    state.warningKeys[slotId + ':' + warning] = true;
  }

  function isWarningMarked(slotId, warning) {
    return !!state.warningKeys[slotId + ':' + warning];
  }

  function processWarnings(ctx, nowMs, gapMs) {
    if (ctx.kind !== 'active') return;
    if (state.previousRemaining === null || state.currentSlotId !== ctx.slotId) return;
    if (gapMs > 5000) return;

    var thresholds = [
      { key: 'warn10', value: 600 },
      { key: 'warn5', value: 300 },
      { key: 'warn1', value: 60 }
    ];

    var k;
    for (k = 0; k < thresholds.length; k++) {
      var t = thresholds[k];
      if (state.previousRemaining > t.value && ctx.remaining <= t.value && !isWarningMarked(ctx.slotId, t.key)) {
        markWarning(ctx.slotId, t.key);
        playWarning(t.key);
      }
    }
  }

  function processLastTenSeconds(ctx, gapMs) {
    if (ctx.kind !== 'active' || ctx.remaining < 1 || ctx.remaining > 10) {
      state.lastSecondBeepKey = null;
      return;
    }
    if (gapMs > 5000) return;

    var key = ctx.slotId + ':' + ctx.remaining;
    if (state.lastSecondBeepKey !== key) {
      state.lastSecondBeepKey = key;
      playWarning('last10');
    }
  }

  function showEndedOverlay(nowMs) {
    state.overlayUntil = nowMs + 30000;
    el.endedOverlay.className = 'overlay';
    playWarning('ended');
  }

  function hideEndedOverlayIfNeeded(nowMs) {
    if (state.overlayUntil && nowMs >= state.overlayUntil) {
      state.overlayUntil = 0;
      el.endedOverlay.className = 'overlay hidden';
    }
  }

  function tick() {
    var previewNow = new Date().getTime();
    if (state.previewMode) {
      if (previewNow >= state.previewUntil) {
        stopScreenPreview();
      } else {
        renderPreview(state.previewMode);
      }
      return;
    }

    var now = new Date();
    var nowMs = now.getTime();
    state.lastTickWallTime = nowMs;
    state.lastSyncTime = nowMs;
    var ctx = getContext(now);
    var gap = state.previousNow === null ? 0 : nowMs - state.previousNow;

    if (state.initialized) {
      processWarnings(ctx, nowMs, gap);
      processLastTenSeconds(ctx, gap);

      if (state.currentSlotId && ctx.kind === 'active' && state.currentSlotId !== ctx.slotId && gap <= 5000) {
        showEndedOverlay(nowMs);
      } else if (state.currentSlotId && ctx.kind === 'night' && gap <= 5000) {
        showEndedOverlay(nowMs);
      }
    }

    render(now, ctx);
    hideEndedOverlayIfNeeded(nowMs);

    state.initialized = true;
    state.currentSlotId = ctx.kind === 'active' ? ctx.slotId : null;
    state.previousRemaining = ctx.kind === 'active' ? ctx.remaining : null;
    state.previousNow = nowMs;

    el.diagOnline.innerHTML = navigator.onLine === false ? 'offline' : 'online';
    if (el.diagSync) el.diagSync.innerHTML = formatClock(now);
    if (el.diagWatchdog) el.diagWatchdog.innerHTML = state.watchdogHealthy ? 'v pořádku' : 'obnovuji';
    checkNightlyReload(now);
  }


  function checkNightlyReload(now) {
    var key = dayKey(now);
    if (now.getHours() === NIGHTLY_RELOAD_HOUR && now.getMinutes() === NIGHTLY_RELOAD_MINUTE) {
      if (state.lastNightlyReloadKey !== key) {
        state.lastNightlyReloadKey = key;
        try { localStorage.setItem('justyou_last_nightly_reload', key); } catch (e) {}
        window.setTimeout(function () { window.location.reload(); }, 250);
      }
    }
  }

  function runWatchdog() {
    var nowMs = new Date().getTime();
    if (state.lastTickWallTime && nowMs - state.lastTickWallTime > 12000) {
      state.watchdogHealthy = false;
      if (el.diagWatchdog) el.diagWatchdog.innerHTML = 'obnovuji';
      try { localStorage.setItem('justyou_watchdog_reload', String(nowMs)); } catch (e) {}
      window.location.reload();
      return;
    }
    state.watchdogHealthy = true;
    if (el.diagWatchdog) el.diagWatchdog.innerHTML = 'v pořádku';
  }

  function forceResync() {
    state.previousNow = null;
    state.previousRemaining = null;
    tick();
  }


  function removePreviewHint() {
    if (state.previewHint && state.previewHint.parentNode) {
      state.previewHint.parentNode.removeChild(state.previewHint);
    }
    state.previewHint = null;
  }

  function showPreviewHint() {
    removePreviewHint();
    var hint = document.createElement('div');
    hint.className = 'preview-hint';
    hint.innerHTML = 'TEST OBRAZOVKY — návrat za 8 sekund';
    document.body.appendChild(hint);
    state.previewHint = hint;
  }

  function renderPreview(mode) {
    var fakeNow = new Date();
    var fakeCtx;

    el.endedOverlay.className = 'overlay hidden';
    el.app.className = 'app';
    hideAllScreens();

    if (mode === 'night') {
      el.night.className = 'screen';
      el.progress.style.width = '0%';
      el.clock.innerHTML = formatClock(fakeNow);
      return;
    }

    if (mode === 'ended') {
      el.active.className = 'screen active-screen';
      el.slotLabel.innerHTML = 'REZERVACE 16:30 – 17:45';
      el.countdown.innerHTML = '00:00';
      el.endTime.innerHTML = '17:45';
      el.warn10.className = 'warn10 hidden';
      el.exitBox.className = 'exit-box hidden';
      el.lastMinute.className = 'last-minute hidden';
      el.progress.style.width = '100%';
      el.clock.innerHTML = formatClock(fakeNow);
      el.endedOverlay.className = 'overlay';
      return;
    }

    fakeCtx = {
      kind: 'active',
      slotId: 'preview',
      startLabel: '16:30',
      endLabel: '17:45',
      remaining: mode === 'warn10' ? 598 :
                 mode === 'warn5' ? 298 :
                 mode === 'last10' ? 9 :
                 mode === 'warn1' ? 58 : 3118
    };

    render(fakeNow, fakeCtx);
  }

  function startScreenPreview(mode) {
    state.previewMode = mode;
    state.previewUntil = new Date().getTime() + 8000;
    el.service.className = 'service preview-hidden';
    renderPreview(mode);
    showPreviewHint();

    if (mode === 'warn10') playWarning('warn10');
    if (mode === 'warn5') playWarning('warn5');
    if (mode === 'warn1') playWarning('warn1');
    if (mode === 'last10') playWarning('last10');
    if (mode === 'ended') playWarning('ended');
  }

  function stopScreenPreview() {
    state.previewMode = null;
    state.previewUntil = 0;
    removePreviewHint();
    el.endedOverlay.className = 'overlay hidden';
    el.service.className = 'service';
    tick();
    resetServiceTimer();
  }

  function requestWakeLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) {
      el.diagWake.innerHTML = 'nepodporován';
      return;
    }
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        state.wakeLock = lock;
        el.diagWake.innerHTML = 'aktivní';
        if (lock.addEventListener) {
          lock.addEventListener('release', function () {
            el.diagWake.innerHTML = 'uvolněn';
          });
        }
      }).catch(function () {
        el.diagWake.innerHTML = 'blokován';
      });
    } catch (e) {
      el.diagWake.innerHTML = 'blokován';
    }
  }

  function openService() {
    el.service.className = 'service';
    resetServiceTimer();
  }

  function closeService() {
    el.service.className = 'service hidden';
    if (state.serviceTimer) {
      clearTimeout(state.serviceTimer);
      state.serviceTimer = null;
    }
  }

  function resetServiceTimer() {
    if (state.serviceTimer) clearTimeout(state.serviceTimer);
    state.serviceTimer = setTimeout(closeService, 60000);
  }

  function logoTap() {
    var now = new Date().getTime();
    if (now - state.lastLogoTap > 1500) state.logoTapCount = 0;
    state.logoTapCount++;
    state.lastLogoTap = now;
    if (state.logoTapCount >= 5) {
      state.logoTapCount = 0;
      openService();
    }
  }

  function preventDefault(e) {
    if (e && e.preventDefault) e.preventDefault();
    return false;
  }

  el.logo.onclick = logoTap;
  el.closeService.onclick = closeService;
  el.testSound.onclick = function () {
    playWarning('ended');
    resetServiceTimer();
  };
  el.testNormal.onclick = function () { startScreenPreview('normal'); };
  el.test10.onclick = function () { startScreenPreview('warn10'); };
  el.test5.onclick = function () { startScreenPreview('warn5'); };
  el.test1.onclick = function () { startScreenPreview('warn1'); };
  el.testLast10.onclick = function () { startScreenPreview('last10'); };
  el.testEnded.onclick = function () { startScreenPreview('ended'); };
  el.testNight.onclick = function () { startScreenPreview('night'); };
  el.service.onclick = resetServiceTimer;
  if (el.restartApp) {
    el.restartApp.onclick = function () { window.location.reload(); };
  }

  document.addEventListener('contextmenu', preventDefault, false);
  document.addEventListener('dragstart', preventDefault, false);
  document.addEventListener('selectstart', preventDefault, false);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      tick();
      requestWakeLock();
      var ac = getAudioContext();
      if (ac && ac.state === 'suspended' && ac.resume) {
        try { ac.resume(); } catch (e) {}
      }
    }
  }, false);

  window.addEventListener('focus', function () {
    forceResync();
    requestWakeLock();
  }, false);

  window.addEventListener('pageshow', function () {
    forceResync();
    requestWakeLock();
  }, false);

  window.addEventListener('online', tick, false);
  window.addEventListener('offline', tick, false);

  window.onerror = function (message) {
    try {
      localStorage.setItem('justyou_last_error', String(message));
    } catch (e) {}
    return false;
  };

  // Burn-in protection: tiny, barely visible shift every 3 minutes.
  var shiftIndex = 0;
  var shifts = [[0,0],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1]];
  setInterval(function () {
    shiftIndex = (shiftIndex + 1) % shifts.length;
    document.getElementById('main').style.transform =
      'translate(' + shifts[shiftIndex][0] + 'px,' + shifts[shiftIndex][1] + 'px)';
  }, 180000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      try {
        navigator.serviceWorker.register('sw.js');
      } catch (e) {}
    });
  }

  tick();
  setInterval(tick, 1000);
  setInterval(runWatchdog, 5000);
  requestWakeLock();
}());
