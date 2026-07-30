(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const els = document.querySelectorAll(
    ".feature-list article, .steps li, .links a, .hero-copy",
  );
  els.forEach((el, i) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(12px)";
    el.style.transition = `opacity 0.55s ease ${Math.min(i * 0.04, 0.3)}s, transform 0.55s ease ${Math.min(i * 0.04, 0.3)}s`;
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.style.opacity = "1";
        e.target.style.transform = "translateY(0)";
        io.unobserve(e.target);
      });
    },
    { threshold: 0.12 },
  );
  els.forEach((el) => io.observe(el));
})();
