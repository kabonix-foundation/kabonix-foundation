# Publishing Guide — Communications

Purpose
- This short guide explains how to add photos, project cards, news and articles to the website so the communications team can publish content that looks consistent and performs well.

Image basics
- Recommended formats: WebP for modern browsers, fall back to JPEG/PNG for older browsers.
- Colour profile: sRGB.
- Filenames: lowercase, hyphen-separated, no spaces. Example: project-mangrove-2026-04.jpg.
- Compress images so individual source files are under 300 KB when possible. Hero and large images may be up to ~600–900 KB if optimized.

Recommended sizes
- Hero / banner: supply at least 1600 px wide (ideal aspect 16:9). Provide a responsive set: 1600w, 1200w, 800w.
- Project thumbnails / card images: supply a large source (1200 × 800 px, 3:2) and create responsive versions (800w, 400w). The UI displays thumbnails at a small height; supplying a larger source ensures sharpness on high-DPI screens.
- Full-width article images: 1200–1600 px wide.

Accessibility & metadata
- Always include a concise alt attribute describing the image for visually impaired users (who/what/where). E.g. "Community planting mangroves, Kilifi, Kenya".
- If the image is purely decorative, use alt="" but avoid this for project thumbnails.
- Add a short caption in the card description to give context (location, program name).

Where to put files
- Drop images in the website assets folder: apps/website/assets/ (use consistent filenames).
- The site serves these statically; ensure files are committed to the repository and deployed.

How to add a Featured Project card (manual)
1. Upload the image(s) to apps/website/assets/.
2. Add a new card inside the projects-grid section in apps/website/index.html.

Example markup (copy & edit):

```html
<div class="post-card card-with-thumb fade">
  <div class="card-img" style="background-image:url('/assets/project-5.jpg')" role="img" aria-label="Community planting mangroves, Kilifi, Kenya"></div>
  <div class="post-card-body">
    <span class="post-badge b-news">Project</span>
    <h3>Community Environmental Program</h3>
    <p class="sans">Kilimanjaro, Tanzania · Community outreach and nursery support.</p>
    <div style="margin-top:10px;font-size:13px;color:var(--ink-faint)">Kilimanjaro, Tanzania</div>
    <a href="#" class="read-more">View project →</a>
  </div>
</div>
```

Notes on the snippet
- Use descriptive headings and a one-line summary for the card body — this helps scanning and SEO.
- card-img uses background-image for simple card crops; if you need finer control or srcset support, replace it with an <img> element and srcset attributes.

Example responsive <img> with srcset (optional):

```html
<picture>
  <source type="image/webp" srcset="/assets/project-5-1600.webp 1600w, /assets/project-5-1200.webp 1200w, /assets/project-5-800.webp 800w" sizes="(min-width:1100px) 360px, 100vw">
  <img src="/assets/project-5-1200.jpg" alt="Community planting mangroves, Kilifi, Kenya" loading="lazy" decoding="async" style="width:100%;height:auto;display:block;border-radius:12px;">
</picture>
```

Publishing workflow recommendations
- Prepare images in a simple folder, compress and export both WebP and JPEG versions.
- For each card include: image, short title, 1-line summary, location and a link to the full project page or post.
- Keep text concise — headlines should be 6–8 words; summaries 1–2 short sentences.

SEO & social share
- When publishing a full article, include a clear title, description (summary) and an og:image sized at least 1200 × 630 px for good social previews.

If you want automation
- We can wire the grid to the API so the communications team can publish via a CMS or a small scripting tool. I can implement that next if you want.

Contact
- If you need sample compressed images or a tiny image-export script (ImageMagick), tell me and I will add it.

--
Kabonix web team — publishing guide (short and practical)
