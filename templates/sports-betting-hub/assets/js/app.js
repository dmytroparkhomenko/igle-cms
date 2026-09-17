function applyDynamicLinks(root) {
  var scope = root || document;
  var links = window.SiteDynamicLinks || {};
  scope.querySelectorAll('[data-dynamic-link]').forEach(function (element) {
    var key = element.getAttribute('data-dynamic-link');
    var item = links[key];
    if (!item || !item.href) return;
    element.setAttribute('href', item.href);
    if (item.target) {
      element.setAttribute('target', item.target);
    } else {
      element.removeAttribute('target');
    }
    if (item.rel) {
      element.setAttribute('rel', item.rel);
    } else {
      element.removeAttribute('rel');
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  applyDynamicLinks(document);

  document.querySelectorAll('[data-include]').forEach(function (slot) {
    var url = slot.getAttribute('data-include');
    if (!url) return;

    fetch(url, { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
        return response.text();
      })
      .then(function (html) {
        slot.innerHTML = html;
        applyDynamicLinks(slot);
        slot.querySelectorAll('script').forEach(function (oldScript) {
          var script = document.createElement('script');
          Array.prototype.slice.call(oldScript.attributes).forEach(function (attr) {
            script.setAttribute(attr.name, attr.value);
          });
          script.text = oldScript.textContent;
          oldScript.parentNode.replaceChild(script, oldScript);
        });
      })
      .catch(function (error) {
        console.warn('Include failed:', url, error);
      });
  });

  document.querySelectorAll('[data-sticky-banner]').forEach(function (banner) {
    var id = banner.getAttribute('id') || 'sticky-banner';
    var storageKey = 'sticky-banner-closed:' + id;
    var delay = parseFloat(banner.getAttribute('data-delay') || '0');
    var closeButton = banner.querySelector('[data-sticky-banner-close]');

    try {
      if (window.sessionStorage && sessionStorage.getItem(storageKey) === '1') {
        return;
      }
    } catch (error) {}

    window.setTimeout(function () {
      banner.classList.add('is-visible');
    }, Math.max(0, delay) * 1000);

    if (closeButton) {
      closeButton.addEventListener('click', function () {
        banner.classList.add('is-closing');
        banner.classList.remove('is-visible');
        try {
          if (window.sessionStorage) sessionStorage.setItem(storageKey, '1');
        } catch (error) {}
        window.setTimeout(function () {
          banner.classList.remove('is-closing');
        }, 320);
      });
    }
  });
});