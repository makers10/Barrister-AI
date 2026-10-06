/**
 * UploadAnimator — requestAnimationFrame-driven animation engine
 * for the Barrister AI document upload experience.
 *
 * Philosophy (WorksWheel-style):
 *   - All motion driven by RAF loops, not CSS keyframes
 *   - Spring physics for enter/exit (no canned easing curves)
 *   - Transform + opacity only — no layout thrashing
 *   - State-driven: each phase owns its loop; loops stop cleanly on state change
 *   - prefers-reduced-motion respected throughout
 *   - No external dependencies
 */

const UploadAnimator = (() => {
  'use strict';

  /* ─────────────────────────────────────────────
     Reduced-motion guard
  ───────────────────────────────────────────── */
  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ─────────────────────────────────────────────
     Spring physics
     A simple damped spring: given current value,
     velocity, and target, returns next {value, velocity}.
     stiffness ~120-200, damping ~14-20, mass 1
  ───────────────────────────────────────────── */
  function springStep(value, velocity, target, stiffness, damping, dt) {
    const force = -stiffness * (value - target) - damping * velocity;
    const newVelocity = velocity + force * dt;
    const newValue    = value + newVelocity * dt;
    return { value: newValue, velocity: newVelocity };
  }

  /* ─────────────────────────────────────────────
     Linear interpolation (lerp)
  ───────────────────────────────────────────── */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* ─────────────────────────────────────────────
     Ease functions (used by counter animations in script.js)
  ───────────────────────────────────────────── */
  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  /* ─────────────────────────────────────────────
     RAF loop manager
     Tracks all running loops so we can cancel
     everything cleanly on state transitions.
  ───────────────────────────────────────────── */
  const loops = new Map(); // key → rafId

  function startLoop(key, fn) {
    stopLoop(key);
    let lastTime = performance.now();
    function tick(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms (tab hidden)
      lastTime = now;
      fn(now, dt);
      loops.set(key, requestAnimationFrame(tick));
    }
    loops.set(key, requestAnimationFrame(tick));
  }

  function stopLoop(key) {
    if (loops.has(key)) {
      cancelAnimationFrame(loops.get(key));
      loops.delete(key);
    }
  }

  function stopAll() {
    loops.forEach((id) => cancelAnimationFrame(id));
    loops.clear();
  }

  /* ─────────────────────────────────────────────
     PHASE ENTER
     Spring-in a freshly-rendered phase element.
     Animates: opacity 0→1, translateY 20→0, scale 0.97→1
  ───────────────────────────────────────────── */
  function playEnter(el, onDone) {
    if (!el) return;

    if (reducedMotion()) {
      el.style.opacity   = '1';
      el.style.transform = 'none';
      if (onDone) onDone();
      return;
    }

    let opacity  = 0;
    let y        = 20;   // px
    let scale    = 0.97;
    let velY     = 0;
    let velScale = 0;
    const key    = 'phase-enter-' + Date.now();

    el.style.willChange = 'transform, opacity';

    startLoop(key, (now, dt) => {
      // Spring toward targets
      const sy = springStep(y, velY, 0, 160, 18, dt);
      y   = sy.value;
      velY = sy.velocity;

      const ss = springStep(scale, velScale, 1, 160, 18, dt);
      scale    = ss.value;
      velScale = ss.velocity;

      // Opacity: simple lerp (no overshoot wanted on opacity)
      opacity = lerp(opacity, 1, Math.min(dt * 8, 1));

      el.style.opacity   = Math.min(opacity, 1).toFixed(3);
      el.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;

      // Settle check
      if (Math.abs(y) < 0.15 && Math.abs(1 - scale) < 0.001 && opacity > 0.998) {
        el.style.opacity   = '1';
        el.style.transform = 'none';
        el.style.willChange = 'auto';
        stopLoop(key);
        if (onDone) onDone();
      }
    });
  }

  /* ─────────────────────────────────────────────
     PHASE EXIT
     Spring-out before removing.
     Animates: opacity 1→0, translateY 0→-14, scale 1→0.96
  ───────────────────────────────────────────── */
  function playExit(el, onDone) {
    if (!el) {
      if (onDone) onDone();
      return;
    }

    if (reducedMotion()) {
      el.style.opacity = '0';
      if (onDone) onDone();
      return;
    }

    let opacity  = 1;
    let y        = 0;
    let scale    = 1;
    let velY     = 0;
    let velScale = 0;
    const key    = 'phase-exit-' + Date.now();

    el.style.willChange = 'transform, opacity';

    startLoop(key, (now, dt) => {
      const sy = springStep(y, velY, -14, 200, 20, dt);
      y    = sy.value;
      velY = sy.velocity;

      const ss = springStep(scale, velScale, 0.96, 200, 20, dt);
      scale    = ss.value;
      velScale = ss.velocity;

      opacity = lerp(opacity, 0, Math.min(dt * 10, 1));

      el.style.opacity   = Math.max(opacity, 0).toFixed(3);
      el.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;

      if (opacity < 0.01) {
        stopLoop(key);
        el.style.opacity = '0';
        if (onDone) onDone();
      }
    });
  }

  /* ─────────────────────────────────────────────
     UPLOADING PHASE ANIMATIONS

     Four concurrent loops:
       1. upload-float  — document card gently bobs up/down
       2. upload-scan   — scanning beam travels top → bottom, loops
       3. upload-shimmer — progress bar shimmer sweeps continuously
       4. upload-dots   — thinking dots pulse with stagger

     All loops write only transform/opacity.
  ───────────────────────────────────────────── */
  function startUploading(container) {
    if (!container) return;

    const docCard    = container.querySelector('.ua-doc-card');
    const scanLine   = container.querySelector('.ua-scan-line');
    const shimmerEl  = container.querySelector('.ua-shimmer-fill');
    const dotEls     = container.querySelectorAll('.ua-dot');

    if (reducedMotion()) {
      // Static fallback: just show a visible bar
      if (shimmerEl) shimmerEl.style.transform = 'translateX(0%)';
      return;
    }

    // ── 1. Doc card float (sine oscillation) ──────────────
    // Uses a spring that continuously chases a sine-wave target
    let floatY     = 0;
    let floatVel   = 0;
    let floatTime  = 0;

    if (docCard) {
      docCard.style.willChange = 'transform';
    }

    // ── 2. Scan beam (interpolated top→bottom, repeating) ──
    // The beam has a soft feathered gradient; we just move it
    let beamY        = -10;   // % of container height, starts just above top
    let beamVel      = 0;
    let beamTarget   = 105;   // % — just past the bottom

    if (scanLine) {
      scanLine.style.willChange = 'transform, opacity';
      scanLine.style.opacity    = '0';
    }

    // ── 3. Shimmer ──────────────────────────────────────────
    let shX    = -140;  // % translateX start (shimmer width is ~140%)
    let shXVel = 0;

    if (shimmerEl) {
      shimmerEl.style.willChange = 'transform';
    }

    // ── 4. Thinking dots (stagger via phase offset) ─────────
    const DOT_SPEED = 1.8; // cycles per second
    let dotTime = 0;

    startLoop('upload-float', (now, dt) => {
      floatTime += dt;
      // Sine target: ±5px at 0.4 Hz
      const floatTarget = Math.sin(floatTime * 0.4 * Math.PI * 2) * 5;
      const sf = springStep(floatY, floatVel, floatTarget, 80, 10, dt);
      floatY   = sf.value;
      floatVel = sf.velocity;

      if (docCard) {
        docCard.style.transform = `translateY(${floatY.toFixed(2)}px)`;
      }
    });

    startLoop('upload-scan', (now, dt) => {
      // Move beam toward target, then reset
      if (beamY >= beamTarget) {
        // Instant reset to top (off-screen), no flash
        beamY   = -18;
        beamVel = 0;
      }

      // Lerp toward target at a constant-ish speed
      // We use a very slight spring (low stiffness) for a natural feel
      const sb = springStep(beamY, beamVel, beamTarget, 1.8, 0.8, dt);
      beamY    = sb.value;
      beamVel  = sb.velocity;

      const frac = (beamY + 18) / (beamTarget + 18); // 0 → 1
      // Fade in at the top, fade out at the bottom
      const opacity = Math.sin(Math.PI * frac) * 0.65;

      if (scanLine) {
        scanLine.style.transform = `translateY(${beamY.toFixed(2)}%)`;
        scanLine.style.opacity   = Math.max(0, opacity).toFixed(3);
      }
    });

    startLoop('upload-shimmer', (now, dt) => {
      // Continuous shimmer: constant velocity
      shX += dt * 120; // 120% per second
      if (shX > 140) shX = -140;

      if (shimmerEl) {
        shimmerEl.style.transform = `translateX(${shX.toFixed(1)}%)`;
      }
    });

    startLoop('upload-dots', (now, dt) => {
      dotTime += dt;
      dotEls.forEach((dot, i) => {
        // Each dot offset by 0.25s
        const phase   = (dotTime * DOT_SPEED - i * 0.25) % 1;
        // Sine pulse: scale 0.5→1.2 and opacity 0.3→1
        const pulse   = Math.sin(Math.max(0, phase) * Math.PI);
        const s       = lerp(0.5, 1.2, pulse);
        const alpha   = lerp(0.25, 1, pulse);
        dot.style.transform = `scale(${s.toFixed(3)})`;
        dot.style.opacity   = alpha.toFixed(3);
      });
    });
  }

  function stopUploading() {
    stopLoop('upload-float');
    stopLoop('upload-scan');
    stopLoop('upload-shimmer');
    stopLoop('upload-dots');
  }

  /* ─────────────────────────────────────────────
     SUCCESS PHASE

     Sequence:
       1. Scan beam decelerates and fades out
       2. Check circle springs in (scale 0→1 with overshoot)
       3. Check path "draws" via strokeDashoffset
       4. Stats reveal staggered (handled by caller, we just
          provide the container fade-in)
  ───────────────────────────────────────────── */
  function playSuccess(container, onDone) {
    stopUploading();

    if (!container) {
      if (onDone) onDone();
      return;
    }

    const checkCircle = container.querySelector('.ua-check-circle');
    const checkIcon   = container.querySelector('.ua-check-icon');

    if (reducedMotion()) {
      if (checkCircle) checkCircle.style.transform = 'scale(1)';
      if (checkCircle) checkCircle.style.opacity   = '1';
      if (checkIcon)   checkIcon.style.opacity     = '1';
      if (onDone) onDone();
      return;
    }

    // Spring the check circle in
    let circleScale    = 0.3;
    let circleVel      = 0;
    let circleOpacity  = 0;
    const key          = 'success-check';

    if (checkCircle) {
      checkCircle.style.willChange = 'transform, opacity';
      checkCircle.style.transform  = 'scale(0.3)';
      checkCircle.style.opacity    = '0';
    }
    if (checkIcon) {
      checkIcon.style.opacity   = '0';
      checkIcon.style.transform = 'scale(0)';
    }

    let iconShown = false;
    let elapsed   = 0;

    startLoop(key, (now, dt) => {
      elapsed += dt;

      // Spring toward scale 1 with overshoot (low damping)
      const sc = springStep(circleScale, circleVel, 1, 300, 14, dt);
      circleScale = sc.value;
      circleVel   = sc.velocity;
      circleOpacity = Math.min(circleOpacity + dt * 6, 1);

      if (checkCircle) {
        checkCircle.style.transform = `scale(${circleScale.toFixed(4)})`;
        checkCircle.style.opacity   = circleOpacity.toFixed(3);
      }

      // After circle is mostly in, spring the icon in too
      if (elapsed > 0.15 && !iconShown && checkIcon) {
        iconShown = true;
        let iconScale = 0;
        let iconVel   = 0;
        startLoop('success-icon', (n2, dt2) => {
          const si = springStep(iconScale, iconVel, 1, 350, 16, dt2);
          iconScale = si.value;
          iconVel   = si.velocity;
          checkIcon.style.transform = `scale(${iconScale.toFixed(4)})`;
          checkIcon.style.opacity   = Math.min(iconScale * 1.5, 1).toFixed(3);
          if (Math.abs(1 - iconScale) < 0.003) {
            checkIcon.style.transform = 'scale(1)';
            checkIcon.style.opacity   = '1';
            stopLoop('success-icon');
          }
        });
      }

      // Settle
      if (Math.abs(1 - circleScale) < 0.003 && circleOpacity >= 0.999) {
        if (checkCircle) {
          checkCircle.style.transform = 'scale(1)';
          checkCircle.style.opacity   = '1';
        }
        stopLoop(key);
        setTimeout(() => { if (onDone) onDone(); }, 200);
      }
    });
  }

  /* ─────────────────────────────────────────────
     ERROR PHASE

     Sequence:
       1. Current container shakes horizontally (spring oscillation)
       2. Fades out
       3. Error container springs in
       4. onDone called
  ───────────────────────────────────────────── */
  function playError(container, onDone) {
    stopUploading();

    if (!container || reducedMotion()) {
      if (onDone) onDone();
      return;
    }

    // Horizontal shake
    let shakeX   = 0;
    let shakeVel = 18;  // initial impulse rightward
    let elapsed  = 0;
    const key    = 'error-shake';

    container.style.willChange = 'transform';

    startLoop(key, (now, dt) => {
      elapsed += dt;

      // Decaying oscillation via spring toward 0 with initial velocity
      const ss = springStep(shakeX, shakeVel, 0, 280, 10, dt);
      shakeX   = ss.value;
      shakeVel = ss.velocity;

      container.style.transform = `translateX(${shakeX.toFixed(2)}px)`;

      // After 0.55s, fade out and call onDone
      if (elapsed > 0.55) {
        container.style.transition = 'opacity 0.25s ease';
        container.style.opacity    = '0';
        container.style.transform  = 'none';
        container.style.willChange = 'auto';
        stopLoop(key);
        setTimeout(() => { if (onDone) onDone(); }, 260);
      }
    });
  }

  /* ─────────────────────────────────────────────
     IDLE HOVER 3D tilt
     Applies a subtle perspective tilt to the upload
     card as the cursor moves over it.
  ───────────────────────────────────────────── */
  function attachIdleTilt(uploadArea) {
    if (!uploadArea || reducedMotion()) return;

    let targetRX = 0;
    let targetRY = 0;
    let currentRX = 0;
    let currentRY = 0;
    let isHovered = false;

    // Start a persistent (very light) lerp loop only when hovered
    uploadArea.addEventListener('mouseenter', () => {
      isHovered = true;
      startLoop('idle-tilt', (now, dt) => {
        currentRX = lerp(currentRX, isHovered ? targetRX : 0, Math.min(dt * 8, 1));
        currentRY = lerp(currentRY, isHovered ? targetRY : 0, Math.min(dt * 8, 1));
        uploadArea.style.transform = `perspective(600px) rotateX(${currentRX.toFixed(3)}deg) rotateY(${currentRY.toFixed(3)}deg)`;

        // Stop when settled back to rest
        if (!isHovered && Math.abs(currentRX) < 0.01 && Math.abs(currentRY) < 0.01) {
          uploadArea.style.transform = '';
          stopLoop('idle-tilt');
        }
      });
    });

    uploadArea.addEventListener('mousemove', (e) => {
      if (!isHovered) return;
      const rect   = uploadArea.getBoundingClientRect();
      const cx     = rect.left + rect.width / 2;
      const cy     = rect.top  + rect.height / 2;
      const dx     = (e.clientX - cx) / (rect.width  / 2); // -1 → +1
      const dy     = (e.clientY - cy) / (rect.height / 2); // -1 → +1
      // Max ±3 degrees — subtle
      targetRX = -dy * 3;
      targetRY =  dx * 3;
    });

    uploadArea.addEventListener('mouseleave', () => {
      isHovered = false;
      targetRX  = 0;
      targetRY  = 0;
    });
  }

  /* ─────────────────────────────────────────────
     WORKSPACE TRANSITION
     Fades/slides the upload section out, slides
     the intelligence area in — using RAF for smooth
     interpolation rather than CSS transitions.
  ───────────────────────────────────────────── */
  function playWorkspaceTransition(uploadSection, intelligenceArea, onDone) {
    if (!uploadSection || !intelligenceArea) {
      if (onDone) onDone();
      return;
    }

    if (reducedMotion()) {
      uploadSection.style.display    = 'none';
      intelligenceArea.style.display = 'block';
      intelligenceArea.style.opacity = '1';
      intelligenceArea.style.transform = 'none';
      if (onDone) onDone();
      return;
    }

    // Phase 1: exit upload section
    let exitOpacity = 1;
    let exitY       = 0;
    const exitKey   = 'ws-exit';

    uploadSection.style.willChange = 'transform, opacity';

    startLoop(exitKey, (now, dt) => {
      exitOpacity = lerp(exitOpacity, 0, Math.min(dt * 5, 1));
      exitY       = lerp(exitY, -10, Math.min(dt * 5, 1));
      uploadSection.style.opacity   = Math.max(exitOpacity, 0).toFixed(3);
      uploadSection.style.transform = `translateY(${exitY.toFixed(2)}px)`;

      if (exitOpacity < 0.02) {
        uploadSection.style.display  = 'none';
        uploadSection.style.opacity  = '';
        uploadSection.style.transform = '';
        uploadSection.style.willChange = 'auto';
        stopLoop(exitKey);

        // Phase 2: enter intelligence area
        intelligenceArea.style.display   = 'block';
        intelligenceArea.style.opacity   = '0';
        intelligenceArea.style.transform = 'translateY(16px)';
        intelligenceArea.style.willChange = 'transform, opacity';

        let enterOpacity = 0;
        let enterY       = 16;
        let enterVel     = 0;
        const enterKey   = 'ws-enter';

        startLoop(enterKey, (n2, dt2) => {
          const se  = springStep(enterY, enterVel, 0, 150, 16, dt2);
          enterY    = se.value;
          enterVel  = se.velocity;
          enterOpacity = Math.min(enterOpacity + dt2 * 4, 1);

          intelligenceArea.style.opacity   = enterOpacity.toFixed(3);
          intelligenceArea.style.transform = `translateY(${enterY.toFixed(2)}px)`;

          if (enterOpacity >= 0.999 && Math.abs(enterY) < 0.1) {
            intelligenceArea.style.opacity    = '1';
            intelligenceArea.style.transform  = 'none';
            intelligenceArea.style.willChange = 'auto';
            stopLoop(enterKey);
            if (onDone) onDone();
          }
        });
      }
    });
  }

  /* ─────────────────────────────────────────────
     Public API
  ───────────────────────────────────────────── */
  return {
    playEnter,
    playExit,
    startUploading,
    stopUploading,
    playSuccess,
    playError,
    playWorkspaceTransition,
    attachIdleTilt,
    stopAll,
  };

})();
