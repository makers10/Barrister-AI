/**
 * Barrister AI — Landing Page JavaScript
 * Handles: nav scroll, mobile menu, scroll reveal, counters, FAQ accordion
 */

(function () {
  'use strict';

  /* ——————————————————————————————————
     Navbar: add .scrolled class on scroll
  —————————————————————————————————— */
  const nav = document.getElementById('lpNav');

  function handleNavScroll() {
    if (window.scrollY > 20) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', handleNavScroll, { passive: true });
  handleNavScroll(); // run on load in case page is already scrolled


  /* ——————————————————————————————————
     Mobile Menu
  —————————————————————————————————— */
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  let menuOpen = false;

  function openMenu() {
    menuOpen = true;
    mobileMenu.removeAttribute('hidden');
    hamburger.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.setAttribute('aria-label', 'Close navigation menu');
    document.body.style.overflow = 'hidden';

    // Move focus to first link for keyboard nav
    const firstLink = mobileMenu.querySelector('a, button');
    if (firstLink) firstLink.focus();
  }

  function closeMenu() {
    menuOpen = false;
    mobileMenu.setAttribute('hidden', '');
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    document.body.style.overflow = '';
    hamburger.focus();
  }

  hamburger.addEventListener('click', function () {
    if (menuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menuOpen) {
      closeMenu();
    }
  });

  // Close when a mobile nav link is tapped
  mobileMenu.querySelectorAll('.lp-nav__mobile-link').forEach(function (link) {
    link.addEventListener('click', closeMenu);
  });

  // Close when CTA links inside mobile menu are tapped
  mobileMenu.querySelectorAll('.lp-btn').forEach(function (btn) {
    btn.addEventListener('click', closeMenu);
  });

  // Close on outside click / touch
  document.addEventListener('click', function (e) {
    if (menuOpen && !nav.contains(e.target)) {
      closeMenu();
    }
  });


  /* ——————————————————————————————————
     Smooth scroll for anchor links
  —————————————————————————————————— */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });


  /* ——————————————————————————————————
     Scroll Reveal (IntersectionObserver)
  —————————————————————————————————— */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    // Immediately show everything without animation
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('in-view');
    });
  } else {
    const revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            // Stagger siblings within the same parent
            const siblings = Array.from(entry.target.parentElement.querySelectorAll('.reveal'));
            const index = siblings.indexOf(entry.target);
            entry.target.style.transitionDelay = Math.min(index * 80, 400) + 'ms';
            entry.target.classList.add('in-view');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    document.querySelectorAll('.reveal').forEach(function (el) {
      revealObserver.observe(el);
    });
  }


  /* ——————————————————————————————————
     Counter Animation
  —————————————————————————————————— */
  function animateCounter(el) {
    if (el.dataset.animated) return;
    el.dataset.animated = '1';

    const target = parseInt(el.getAttribute('data-target'), 10);
    const duration = 1400; // ms
    const startTime = performance.now();

    function easeOutExpo(t) {
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = Math.round(easeOutExpo(progress) * target);
      el.textContent = value;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = target;
      }
    }

    requestAnimationFrame(update);
  }

  if (!prefersReducedMotion) {
    const counterObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    document.querySelectorAll('.lp-counter').forEach(function (el) {
      counterObserver.observe(el);
    });
  } else {
    // Set final values immediately
    document.querySelectorAll('.lp-counter').forEach(function (el) {
      el.textContent = el.getAttribute('data-target');
    });
  }


  /* ——————————————————————————————————
     FAQ Accordion
  —————————————————————————————————— */
  document.querySelectorAll('.lp-faq__question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      const answerId = this.getAttribute('aria-controls');
      const answer = document.getElementById(answerId);

      // Close all others
      document.querySelectorAll('.lp-faq__question').forEach(function (otherBtn) {
        if (otherBtn !== btn) {
          otherBtn.setAttribute('aria-expanded', 'false');
          const otherId = otherBtn.getAttribute('aria-controls');
          const otherAnswer = document.getElementById(otherId);
          if (otherAnswer) otherAnswer.setAttribute('hidden', '');
        }
      });

      // Toggle this one
      if (expanded) {
        this.setAttribute('aria-expanded', 'false');
        answer.setAttribute('hidden', '');
      } else {
        this.setAttribute('aria-expanded', 'true');
        answer.removeAttribute('hidden');

        // Smooth scroll into view if needed on mobile
        setTimeout(function () {
          btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 150);
      }
    });
  });

})();
