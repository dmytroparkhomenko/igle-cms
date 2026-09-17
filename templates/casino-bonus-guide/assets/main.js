/**
 * Bônus 20 Reais (bonus20reais.com) - Core Interactive Logic
 * Ultra-lightweight Vanilla JS (Zero external dependencies)
 * Optimized for maximum Core Web Vitals & Accessibility (ARIA)
 */
(function () {
  'use strict';

  // =========================================================================
  // AFFILIATE CONFIGURATION / CẤU HÌNH LINK AFFILIATE TOÀN SITE
  // Thay đổi link ở đây sẽ tự động áp dụng cho TOÀN BỘ site bonus20reais.com:
  // =========================================================================
  var AFFILIATE_URL = 'http://aff.imphos.org/go/gbg';

  // true: Mở tab mới (_blank) | false: Chuyển hướng ngay tại tab hiện tại
  var OPEN_IN_NEW_TAB = true;

  // 1. Dynamic Year Updater
  function initYear() {
    var year = new Date().getFullYear();
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = year;
    });
  }

  // 2. Lightweight Accessible Offcanvas Controller
  function initOffcanvas() {
    var togglers = document.querySelectorAll('[data-bs-toggle="offcanvas"]');
    var backdrop = null;
    var activeOffcanvas = null;
    var lastFocusedElement = null;

    function createBackdrop() {
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'offcanvas-backdrop';
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', closeAllOffcanvas);
      }
    }

    function openOffcanvas(targetEl, togglerEl) {
      if (!targetEl) return;
      createBackdrop();
      activeOffcanvas = targetEl;
      lastFocusedElement = togglerEl || document.activeElement;

      targetEl.classList.add('show');
      targetEl.setAttribute('aria-modal', 'true');
      targetEl.setAttribute('role', 'dialog');
      if (togglerEl) togglerEl.setAttribute('aria-expanded', 'true');

      // Trigger reflow for backdrop transition
      requestAnimationFrame(function () {
        if (backdrop) backdrop.classList.add('show');
      });

      document.body.classList.add('offcanvas-open');

      var closeBtn = targetEl.querySelector('.btn-close, [data-bs-dismiss="offcanvas"]');
      if (closeBtn) {
        setTimeout(function () { closeBtn.focus(); }, 50);
      }
    }

    function closeAllOffcanvas() {
      if (!activeOffcanvas) return;

      activeOffcanvas.classList.remove('show');
      activeOffcanvas.removeAttribute('aria-modal');

      if (backdrop) backdrop.classList.remove('show');
      document.body.classList.remove('offcanvas-open');

      togglers.forEach(function (t) {
        if (t.getAttribute('data-bs-target') === '#' + activeOffcanvas.id) {
          t.setAttribute('aria-expanded', 'false');
        }
      });

      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }

      activeOffcanvas = null;
    }

    togglers.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var selector = btn.getAttribute('data-bs-target') || btn.getAttribute('href');
        if (!selector) return;
        var target = document.querySelector(selector);
        if (target && target.classList.contains('show')) {
          closeAllOffcanvas();
        } else if (target) {
          openOffcanvas(target, btn);
        }
      });
    });

    document.querySelectorAll('[data-bs-dismiss="offcanvas"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closeAllOffcanvas();
      });
    });

    // Close when clicking any nav-link inside offcanvas
    document.querySelectorAll('.offcanvas .nav-link, .offcanvas .btn-x').forEach(function (link) {
      link.addEventListener('click', function () {
        closeAllOffcanvas();
      });
    });

    // Keyboard ESC listener
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && activeOffcanvas) {
        closeAllOffcanvas();
      }
    });
  }

  // 3. Lightweight Accessible Accordion Controller
  function initAccordion() {
    document.querySelectorAll('[data-bs-toggle="collapse"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var targetSelector = btn.getAttribute('data-bs-target') || btn.getAttribute('href');
        if (!targetSelector) return;
        var target = document.querySelector(targetSelector);
        if (!target) return;

        var isOpen = target.classList.contains('show');
        var parentSelector = target.getAttribute('data-bs-parent');

        // If part of parent accordion group, close other siblings
        if (parentSelector && !isOpen) {
          var parentEl = document.querySelector(parentSelector);
          if (parentEl) {
            parentEl.querySelectorAll('.accordion-collapse.show').forEach(function (openCollapse) {
              openCollapse.classList.remove('show');
              var openBtn = parentEl.querySelector('[data-bs-target="#' + openCollapse.id + '"], [href="#' + openCollapse.id + '"]');
              if (openBtn) {
                openBtn.classList.add('collapsed');
                openBtn.setAttribute('aria-expanded', 'false');
              }
            });
          }
        }

        if (isOpen) {
          target.classList.remove('show');
          btn.classList.add('collapsed');
          btn.setAttribute('aria-expanded', 'false');
        } else {
          target.classList.add('show');
          btn.classList.remove('collapsed');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  // 4. Affiliate Links Controller (.nnn-aff-link)
  // GIỮ NGUYÊN href="#" 100% - HOÀN TOÀN GIẤU LINK AFFILIATE KHÔNG LỘ TRÊN TRÌNH DUYỆT
  function initAffLinks() {
    document.addEventListener('click', function (e) {
      var affTarget = e.target.closest('.nnn-aff-link');
      if (!affTarget) return;

      e.preventDefault();
      e.stopPropagation();

      var destUrl = affTarget.getAttribute('data-aff-url') || AFFILIATE_URL;

      if (OPEN_IN_NEW_TAB) {
        var win = window.open(destUrl, '_blank');
        if (win) {
          win.opener = null;
        } else {
          // Fallback nếu trình duyệt chặn mở tab mới (như khi test file:/// offline)
          window.location.href = destUrl;
        }
      } else {
        window.location.href = destUrl;
      }
    });

    document.addEventListener('auxclick', function (e) {
      if (e.button === 1) { // Chuột giữa (middle click)
        var affTarget = e.target.closest('.nnn-aff-link');
        if (affTarget) {
          e.preventDefault();
          var destUrl = affTarget.getAttribute('data-aff-url') || AFFILIATE_URL;
          var win = window.open(destUrl, '_blank');
          if (win) {
            win.opener = null;
          }
        }
      }
    });
  }

  // 5. Clean /index.html from browser URL if requested directly (only on http/https web servers)
  function cleanIndexHtmlFromUrl() {
    try {
      if (!window.location || !window.location.pathname) return;
      // Do not run on local file:// protocol where browser origin is null
      if (window.location.protocol === 'file:' || window.location.origin === 'null') return;
      if (/\/index\.html\/?$/i.test(window.location.pathname)) {
        var cleanPath = window.location.pathname.replace(/\/index\.html\/?$/i, '/') + window.location.search + window.location.hash;
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', cleanPath);
        }
      }
    } catch (e) {
      // Gracefully ignore any browser security restrictions
    }
  }

  // DOM Ready initialization
  cleanIndexHtmlFromUrl();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initYear();
      initOffcanvas();
      initAccordion();
      initAffLinks();
    });
  } else {
    initYear();
    initOffcanvas();
    initAccordion();
    initAffLinks();
  }
})();
