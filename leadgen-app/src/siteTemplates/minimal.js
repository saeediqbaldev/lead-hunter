// "Minimal" design style: restraint as the design. Generous whitespace,
// a single quiet serif reserved only for the testimonial (Instrument
// Serif), hairline rules instead of colored bands or card shadows, plain
// rows instead of boxed grids. The opposite instinct from Modern's
// confident color band - here the absence of ornamentation IS the
// signature.
function renderMinimalTemplate({ businessName, niche, city, sections, useVisuals, colorVars, meetingLink, websiteFooterUrl }) {
  const cssVars = Object.entries(colorVars).map(([k, v]) => `${k}: ${v};`).join(" ");
  const iconLink = useVisuals ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.11.3/font/bootstrap-icons.min.css">` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${businessName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${iconLink}
<style>
  :root { ${cssVars} }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--ink); line-height: 1.7; font-weight: 400; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 28px; }
  a { color: var(--primary); }
  .rule { height: 1px; background: var(--border); border: none; margin: 0; }
  .btn {
    display: inline-block; border: 1.5px solid var(--ink); color: var(--ink); padding: 13px 30px;
    font-size: 14px; font-weight: 500; text-decoration: none; letter-spacing: 0.02em;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .btn:hover { background: var(--ink); color: var(--bg); }
  .reveal { opacity: 0; transform: translateY(16px); transition: opacity 0.8s ease, transform 0.8s ease; }
  .reveal.in { opacity: 1; transform: translateY(0); }

  nav { padding: 36px 0; }
  nav .wrap { display: flex; justify-content: space-between; align-items: center; }
  .brand { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
  nav a.top-link { font-size: 13px; color: var(--ink-muted); text-decoration: none; }

  .hero { padding: 60px 0 100px; }
  .eyebrow { font-size: 12.5px; color: var(--ink-muted); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 24px; display: block; }
  .hero h1 { font-size: 42px; font-weight: 500; line-height: 1.25; letter-spacing: -0.01em; margin-bottom: 24px; max-width: 560px; }
  .hero p { font-size: 17px; color: var(--ink-muted); max-width: 460px; margin-bottom: 32px; }

  section { padding: 64px 0; }
  h2 { font-size: 15px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 28px; }
  .about p { font-size: 18px; max-width: 560px; }

  .service-row { display: flex; justify-content: space-between; align-items: baseline; padding: 18px 0; border-bottom: 1px solid var(--border); }
  .service-row:first-of-type { border-top: 1px solid var(--border); }
  .service-row .title { font-size: 16px; font-weight: 500; display: flex; align-items: center; gap: 10px; }
  .service-row .desc { font-size: 14px; color: var(--ink-muted); text-align: right; max-width: 280px; }

  .why-list { display: flex; flex-direction: column; gap: 16px; }
  .why-item { font-size: 16px; display: flex; gap: 12px; align-items: baseline; }
  .why-item .num { font-size: 13px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }

  .testimonial blockquote { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 26px; line-height: 1.5; max-width: 560px; margin-bottom: 16px; }
  .testimonial cite { font-style: normal; font-size: 13px; color: var(--ink-muted); }

  .cta-band { text-align: left; border-top: 1px solid var(--border); }
  .cta-band h2 { color: var(--ink); text-transform: none; letter-spacing: 0; font-size: 28px; font-weight: 500; margin-bottom: 12px; }
  .cta-band p { font-size: 16px; color: var(--ink-muted); margin-bottom: 28px; max-width: 440px; }

  footer { padding: 40px 0; font-size: 13px; color: var(--ink-muted); }
  footer a { font-weight: 500; text-decoration: none; }

  @media (max-width: 640px) {
    .hero h1 { font-size: 30px; }
    .service-row { flex-direction: column; align-items: flex-start; gap: 4px; }
    .service-row .desc { text-align: left; }
  }
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <span class="brand">${businessName}</span>
    <a class="top-link" href="#contact">${sections.cta.buttonLabel}</a>
  </div>
</nav>

<section class="hero">
  <div class="wrap">
    <span class="eyebrow">${niche} — ${city}</span>
    <h1>${sections.hero.headline}</h1>
    <p>${sections.hero.subheadline}</p>
    <a class="btn" href="#contact">${sections.cta.buttonLabel}</a>
  </div>
</section>

<hr class="rule">

<section class="about reveal">
  <div class="wrap">
    <h2>${sections.about.heading}</h2>
    <p>${sections.about.body}</p>
  </div>
</section>

<section class="services reveal">
  <div class="wrap">
    <h2>${sections.services.heading}</h2>
    ${sections.services.items
      .map(
        (item) => `
    <div class="service-row">
      <span class="title">${useVisuals ? '<i class="bi bi-dash"></i>' : ""}${item.title}</span>
      <span class="desc">${item.description}</span>
    </div>`
      )
      .join("")}
  </div>
</section>

<section class="why reveal">
  <div class="wrap">
    <h2>${sections.whyUs.heading}</h2>
    <div class="why-list">
      ${sections.whyUs.points
        .map((point, i) => `<div class="why-item"><span class="num">0${i + 1}</span><span>${point}</span></div>`)
        .join("")}
    </div>
  </div>
</section>

<section class="testimonial reveal">
  <div class="wrap">
    <blockquote>&ldquo;${sections.testimonial.quote}&rdquo;</blockquote>
    <cite>${sections.testimonial.author}</cite>
  </div>
</section>

<section class="cta-band reveal" id="contact">
  <div class="wrap">
    <h2>${sections.cta.heading}</h2>
    <p>${sections.cta.subtext}</p>
    <a class="btn" href="${meetingLink || "#"}">${sections.cta.buttonLabel}</a>
  </div>
</section>

<footer>
  <div class="wrap">Built by <a href="${websiteFooterUrl}" target="_blank" rel="noopener">Xeven Pixels</a></div>
</footer>

<script>
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }
</script>
</body>
</html>`;
}

module.exports = { renderMinimalTemplate };
