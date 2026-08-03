// "Modern" design style: confident, editorial-but-contemporary.
// Signature elements: an angled accent shape behind the hero headline, a
// solid-color "why us" band, and an oversized pull-quote testimonial.
// Fraunces (serif, characterful) for display type paired with Inter for
// body copy - deliberately not the "warm cream + terracotta" or
// "near-black + acid accent" AI-design defaults, since color here is a
// separate, swappable axis (the CSS variables) from this template's own
// typographic/layout personality.
function renderModernTemplate({ businessName, niche, city, sections, useVisuals, colorVars, meetingLink, websiteFooterUrl }) {
  const cssVars = Object.entries(colorVars).map(([k, v]) => `${k}: ${v};`).join(" ");
  const iconLink = useVisuals ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.11.3/font/bootstrap-icons.min.css">` : "";
  const serviceIcons = ["bi-check2-circle", "bi-stars", "bi-shield-check", "bi-lightning-charge"];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${businessName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${iconLink}
<style>
  :root { ${cssVars} }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--ink); line-height: 1.6; overflow-x: hidden; }
  h1, h2, .display { font-family: 'Fraunces', serif; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 28px; }
  a { color: inherit; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px; background: var(--primary); color: var(--bg);
    padding: 14px 28px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none;
    transition: transform 0.2s ease, box-shadow 0.2s ease; border: none; cursor: pointer;
  }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.15); }
  .btn-light { background: var(--bg); color: var(--primary-dark); }
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s ease; }
  .reveal.in { opacity: 1; transform: translateY(0); }

  /* ---------- Nav ---------- */
  nav { position: sticky; top: 0; z-index: 20; background: var(--bg); border-bottom: 1px solid var(--border); }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; padding-top: 18px; padding-bottom: 18px; }
  .brand { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; }
  nav a.nav-cta { font-size: 14px; font-weight: 600; padding: 10px 20px; }

  /* ---------- Hero ---------- */
  .hero { position: relative; padding: 88px 0 96px; overflow: hidden; }
  .hero::before {
    content: ""; position: absolute; top: -120px; right: -160px; width: 480px; height: 480px;
    background: var(--accent); opacity: 0.14; transform: rotate(24deg); border-radius: 40px; z-index: 0;
  }
  .hero::after {
    content: ""; position: absolute; bottom: -180px; right: -60px; width: 320px; height: 320px;
    background: var(--primary); opacity: 0.08; transform: rotate(-16deg); border-radius: 32px; z-index: 0;
  }
  .hero-inner { position: relative; z-index: 1; max-width: 640px; }
  .eyebrow { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); margin-bottom: 18px; display: block; }
  .hero h1 { font-size: 52px; font-weight: 600; line-height: 1.08; letter-spacing: -0.01em; margin-bottom: 22px; }
  .hero p { font-size: 19px; color: var(--ink-muted); margin-bottom: 34px; max-width: 480px; }

  /* ---------- About ---------- */
  .about { padding: 88px 0; }
  .about .wrap { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 64px; align-items: center; }
  .about h2 { font-size: 34px; font-weight: 600; margin-bottom: 20px; }
  .about p { font-size: 17px; color: var(--ink-muted); }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 36px; }
  .stat-card .big { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 600; color: var(--primary); line-height: 1; }
  .stat-card .label { font-size: 14px; color: var(--ink-muted); margin-top: 8px; }

  /* ---------- Services ---------- */
  .services { padding: 88px 0; background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .services h2 { font-size: 34px; font-weight: 600; margin-bottom: 44px; text-align: center; }
  .service-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; }
  .service-card {
    background: var(--bg); border: 1px solid var(--border); border-radius: 18px; padding: 30px;
    transition: transform 0.25s ease, box-shadow 0.25s ease;
  }
  .service-card:hover { transform: translateY(-6px); box-shadow: 0 16px 32px rgba(0,0,0,0.08); }
  .service-card i { font-size: 26px; color: var(--primary); margin-bottom: 16px; display: block; }
  .service-card h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; font-family: 'Inter', sans-serif; }
  .service-card p { font-size: 14.5px; color: var(--ink-muted); }

  /* ---------- Why us band ---------- */
  .why { padding: 84px 0; background: var(--primary); color: var(--bg); }
  .why h2 { font-size: 32px; font-weight: 600; margin-bottom: 36px; color: var(--bg); }
  .why-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 28px; }
  .why-item { display: flex; align-items: flex-start; gap: 14px; font-size: 16.5px; }
  .why-item i { font-size: 20px; margin-top: 2px; color: var(--accent); }

  /* ---------- Testimonial ---------- */
  .testimonial { padding: 100px 0; text-align: center; }
  .testimonial .mark { font-family: 'Fraunces', serif; font-size: 90px; color: var(--accent); line-height: 1; opacity: 0.5; }
  .testimonial blockquote {
    font-family: 'Fraunces', serif; font-style: italic; font-size: 30px; font-weight: 500;
    max-width: 720px; margin: 0 auto 20px; line-height: 1.4;
  }
  .testimonial cite { font-style: normal; font-size: 14px; color: var(--ink-muted); font-weight: 600; }

  /* ---------- CTA ---------- */
  .cta-band { background: var(--primary-dark); color: var(--bg); padding: 84px 0; text-align: center; }
  .cta-band h2 { font-size: 36px; font-weight: 600; margin-bottom: 14px; color: var(--bg); }
  .cta-band p { font-size: 17px; opacity: 0.8; margin-bottom: 30px; }

  /* ---------- Footer ---------- */
  footer { padding: 32px 0; text-align: center; font-size: 13px; color: var(--ink-muted); }
  footer a { color: var(--primary); text-decoration: none; font-weight: 600; }

  @media (max-width: 760px) {
    .hero h1 { font-size: 36px; }
    .about .wrap { grid-template-columns: 1fr; gap: 32px; }
    .testimonial blockquote { font-size: 22px; }
  }
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <span class="brand">${businessName}</span>
    <a class="btn nav-cta" href="#contact">${sections.cta.buttonLabel}</a>
  </div>
</nav>

<section class="hero">
  <div class="wrap hero-inner">
    <span class="eyebrow">${niche} · ${city}</span>
    <h1>${sections.hero.headline}</h1>
    <p>${sections.hero.subheadline}</p>
    <a class="btn" href="#contact">${sections.cta.buttonLabel} <i class="bi bi-arrow-right" style="${useVisuals ? "" : "display:none;"}"></i></a>
  </div>
</section>

<section class="about reveal">
  <div class="wrap">
    <div>
      <h2>${sections.about.heading}</h2>
      <p>${sections.about.body}</p>
    </div>
    <div class="stat-card">
      <div class="big">${sections.whyUs.points.length}+</div>
      <div class="label">Reasons locals in ${city} choose ${businessName}</div>
    </div>
  </div>
</section>

<section class="services reveal">
  <div class="wrap">
    <h2>${sections.services.heading}</h2>
    <div class="service-grid">
      ${sections.services.items
        .map(
          (item, i) => `
      <div class="service-card">
        ${useVisuals ? `<i class="bi ${serviceIcons[i % serviceIcons.length]}"></i>` : ""}
        <h3>${item.title}</h3>
        <p>${item.description}</p>
      </div>`
        )
        .join("")}
    </div>
  </div>
</section>

<section class="why reveal">
  <div class="wrap">
    <h2>${sections.whyUs.heading}</h2>
    <div class="why-list">
      ${sections.whyUs.points
        .map(
          (point) => `
      <div class="why-item">
        ${useVisuals ? `<i class="bi bi-check-circle-fill"></i>` : "<span>&#8226;</span>"}
        <span>${point}</span>
      </div>`
        )
        .join("")}
    </div>
  </div>
</section>

<section class="testimonial reveal">
  <div class="wrap">
    <div class="mark">&ldquo;</div>
    <blockquote>${sections.testimonial.quote}</blockquote>
    <cite>&mdash; ${sections.testimonial.author}</cite>
  </div>
</section>

<section class="cta-band reveal" id="contact">
  <div class="wrap">
    <h2>${sections.cta.heading}</h2>
    <p>${sections.cta.subtext}</p>
    <a class="btn btn-light" href="${meetingLink || "#"}">${sections.cta.buttonLabel}</a>
  </div>
</section>

<footer>
  Built by <a href="${websiteFooterUrl}" target="_blank" rel="noopener">Xeven Pixels</a>
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

module.exports = { renderModernTemplate };
