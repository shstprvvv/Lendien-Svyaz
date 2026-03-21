/**
 * Анимации: секции (data-reveal), явные элементы (data-ai), шапка при скролле.
 * prefers-reduced-motion — отключает motion.
 */
(function () {
  var root = document.documentElement;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("reduce-motion");
    return;
  }

  root.classList.add("motion-ok");

  var header = document.querySelector(".site-header");
  if (header) {
    var ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function () {
          header.classList.toggle("is-scrolled", window.scrollY > 8);
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  var heroBox = document.querySelector(".hero .container");
  if (heroBox) {
    var kids = heroBox.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].classList.add("hero-appear");
    }
  }

  var vh = window.innerHeight;

  function isInView(el) {
    var rect = el.getBoundingClientRect();
    return rect.top < vh * 0.92 && rect.bottom > 40;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var t = entry.target;
        if (t.hasAttribute("data-reveal")) t.classList.add("is-revealed");
        if (t.hasAttribute("data-ai")) t.classList.add("is-ai-visible");
        io.unobserve(t);
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -24px 0px" }
  );

  var sections = document.querySelectorAll("main > section:not(.hero)");
  var si = 0;
  sections.forEach(function (el) {
    if (el.classList.contains("section-no-reveal")) return;
    el.style.setProperty("--reveal-delay", Math.min(si * 0.05, 0.28) + "s");
    el.setAttribute("data-reveal", "");
    si++;
    if (isInView(el)) el.classList.add("is-revealed");
    else io.observe(el);
  });

  var aiEls = document.querySelectorAll("[data-ai]");
  aiEls.forEach(function (el) {
    var delay = el.getAttribute("data-ai-delay");
    if (delay !== null && delay !== "") {
      var d = String(delay).trim();
      el.style.setProperty("--ai-delay", /s$/i.test(d) ? d : d + "s");
    }
    if (isInView(el)) el.classList.add("is-ai-visible");
    else io.observe(el);
  });
})();
