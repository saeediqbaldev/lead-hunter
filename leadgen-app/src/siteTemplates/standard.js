// "Standard" design style: warm and conventional on purpose. Rounded,
// friendly geometry throughout, a centered hero, a classic 3-up feature
// grid, and a trust-strip of quick credibility signals - built for niches
// (medical, home services, family businesses) where a customer's first
// instinct needs to be "this looks legitimate and safe," not "this looks
// edgy." Nunito for warm rounded display type, Inter for body.
function renderStandardTemplate({ businessName, niche, city, sections, useVisuals, colorVars, meetingLink, websiteFooterUrl }) {
  const cssVars = Object.entries(colorVars).map(([k, v]) => `${k}: ${v};`).join(" ");
  const iconLink = useVisuals ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.11.3/font/bootstrap-icons.min.css">` : "";
  const serviceIcons = ["bi-hand-thumbs-up", "bi-clock-history", "bi-award", "bi-people"];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${businessName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${iconLink}
<style>
  :root { ${cssVars} }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--ink); line-height: 1.65; }
  h1, h2, .display { font-family: 'Nunito', sans-serif; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 28px; }
  a { color: inherit; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px; background: var(--primary); color: var(--bg);
    padding: 15px 32px; border-radius: 14px; font-weight: 700; font-size: 15.5px; text-decoration: none;
    box-shadow: 0 8px 20px rgba(0,0,0,0.12); transition: transform 0.2s ease;
  }
  .btn:hover { transform: translateY(-2px); }
  .reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
  .reveal.in { opacity: 1; transform: translateY(0); }

  nav { padding: 24px 0; }
  nav .wrap { display: flex; justify-content: space-between; align-items: center; }
  .brand { font-weight: 800; font-size: 21px; }
  .brand .dot { color: var(--accent); }
  nav a.nav-cta { font-size: 14px; padding: 11px 22px; }

  .hero { text-align: center; padding: 76px 0 60px; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 999px; padding: 8px 18px; font-size: 13.5px; font-weight: 600; color: var(--ink-muted); margin-bottom: 26px;
  }
  .badge i { color: var(--accent); }
  .hero h1 { font-size: 44px; font-weight: 800; line-height: 1.2; max-width: 680px; margin: 0 auto 20px; }
  .hero p { font-size: 17.5px; color: var(--ink-muted); max-width: 500px; margin: 0 auto 32px; }

  .trust-strip { background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 28px 0; }
  .trust-strip .wrap { display: flex; justify-content: center; flex-wrap: wrap; gap: 40px; }
  .trust-item { display: flex; align-items: center; gap: 10px; font-size: 14.5px; font-weight: 600; color: var(--ink-muted); }
  .trust-item i { color: var(--primary); font-size: 18px; }

  section.pad { padding: 76px 0; }
  .section-head { text-align: center; margin-bottom: 44px; }
  .section-head h2 { font-size: 30px; font-weight: 800; }

  .about-box { background: var(--surface); border-radius: 24px; padding: 44px; text-align: center; max-width: 720px; margin: 0 auto; border: 1px solid var(--border); }
  .about-box p { font-size: 17px; color: var(--ink-muted); }

  .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 28px; }
  .feature-card { text-align: center; padding: 12px; }
  .feature-icon {
    width: 64px; height: 64px; border-radius: 18px; background: var(--primary); color: var(--bg);
    display: flex; align-items: center; justify-content: center; font-size: 26px; margin: 0 auto 18px;
  }
  .feature-card h3 { font-size: 17px; font-weight: 700; margin-bottom: 8px; font-family: 'Inter', sans-serif; }
  .feature-card p { font-size: 14.5px; color: var(--ink-muted); }

  .why-band { background: var(--bg); }
  .why-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; max-width: 800px; margin: 0 auto; }
  .why-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 12px; font-size: 15px; font-weight: 600; }
  .why-pill i { color: var(--accent); font-size: 20px; flex-shrink: 0; }

  .testimonial-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 24px; padding: 44px;
    max-width: 620px; margin: 0 auto; text-align: center;
  }
  .stars { color: var(--accent); font-size: 18px; margin-bottom: 16px; letter-spacing: 3px; }
  .testimonial-card blockquote { font-size: 19px; font-weight: 500; margin-bottom: 16px; }
  .testimonial-card cite { font-style: normal; font-size: 14px; color: var(--ink-muted); }

  .cta-band { background: var(--primary); color: var(--bg); border-radius: 28px; padding: 56px 40px; text-align: center; margin: 0 28px 76px; }
  .cta-band h2 { font-size: 30px; font-weight: 800; margin-bottom: 12px; color: var(--bg); }
  .cta-band p { font-size: 16px; opacity: 0.85; margin-bottom: 28px; }
  .cta-band .btn { background: var(--bg); color: var(--primary-dark); }

  footer { padding: 32px 0; text-align: center; font-size: 13px; color: var(--ink-muted); }
  footer a { color: var(--primary); text-decoration: none; font-weight: 700; }

  @media (max-width: 720px) {
    .hero h1 { font-size: 30px; }
    .cta-band { margin: 0 16px 56px; padding: 40px 24px; }
  }
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <span class="brand">${businessName}<span class="dot">.</span></span>
    <a class="btn nav-cta" href="#contact">${sections.cta.buttonLabel}</a>
  </div>
</nav>

<section class="hero">
  <div class="wrap">
    <span class="badge">${useVisuals ? '<i class="bi bi-geo-alt-fill"></i>' : ""} Serving ${city}</span>
    <h1>${sections.hero.headline}</h1>
    <p>${sections.hero.subheadline}</p>
    <a class="btn" href="#contact">${sections.cta.buttonLabel}</a>
  </div>
</section>

<div class="trust-strip">
  <div class="wrap">
    <div class="trust-item">${useVisuals ? '<i class="bi bi-star-fill"></i>' : ""} Locally trusted</div>
    <div class="trust-item">${useVisuals ? '<i class="bi bi-shield-check"></i>' : ""} Reliable service</div>
    <div class="trust-item">${useVisuals ? '<i class="bi bi-clock-fill"></i>' : ""} Quick response</div>
  </div>
</div>

<section class="pad reveal">
  <div class="wrap">
    <div class="section-head"><h2>${sections.about.heading}</h2></div>
    <div class="about-box"><p>${sections.about.body}</p></div>
  </div>
</section>

<section class="pad reveal">
  <div class="wrap">
    <div class="section-head"><h2>${sections.services.heading}</h2></div>
    <div class="feature-grid">
      ${sections.services.items
        .map(
          (item, i) => `
      <div class="feature-card">
        ${useVisuals ? `<div class="feature-icon"><i class="bi ${serviceIcons[i % serviceIcons.length]}"></i></div>` : ""}
        <h3>${item.title}</h3>
        <p>${item.description}</p>
      </div>`
        )
        .join("")}
    </div>
  </div>
</section>

<section class="pad why-band reveal">
  <div class="wrap">
    <div class="section-head"><h2>${sections.whyUs.heading}</h2></div>
    <div class="why-list">
      ${sections.whyUs.points
        .map((point) => `<div class="why-pill">${useVisuals ? '<i class="bi bi-check-circle-fill"></i>' : ""}<span>${point}</span></div>`)
        .join("")}
    </div>
  </div>
</section>

<section class="pad reveal">
  <div class="wrap">
    <div class="testimonial-card">
      <div class="stars">${useVisuals ? "&#9733;&#9733;&#9733;&#9733;&#9733;" : "*****"}</div>
      <blockquote>&ldquo;${sections.testimonial.quote}&rdquo;</blockquote>
      <cite>&mdash; ${sections.testimonial.author}</cite>
    </div>
  </div>
</section>

<section class="reveal" id="contact">
  <div class="cta-band">
    <h2>${sections.cta.heading}</h2>
    <p>${sections.cta.subtext}</p>
    <a class="btn" href="${meetingLink || "#"}">${sections.cta.buttonLabel}</a>
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

module.exports = { renderStandardTemplate };
