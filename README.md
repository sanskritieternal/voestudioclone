# VEO Studio Ai — Frontend Clone

A faithful static frontend clone of [veostudioai.com](https://veostudioai.com), built for
study and as the UI foundation for a rebuild. All 45 routes are reproduced as static
pages: landing, auth, dashboard, projects, all 27 tools, API/billing/account sections,
support pages, and the legal pages.

## Run it

```bash
cd app
python3 -m http.server 8080
# open http://localhost:8080/
```

No build step, no dependencies — pure HTML/CSS/JS. Dark/light theme toggle included.

## Layout

| Path | Contents |
|---|---|
| `app/` | The built static site (45 pages). Serve this directory. |
| `app/assets/css/index-DCalCK4u.css` | The real production stylesheet captured from the live site. |
| `app/assets/css/clone-extras.css` | Supplementary styles for reconstructed components (dashboard, wizards, plans, chat, public pages). |
| `app/assets/img/logo.png` | Real logo captured from the live site. |
| `build_clone.py` | Generator that rebuilds every page in `app/` from the captured shell + content definitions. |
| `recon/html/veo-tools.html` | Captured `/tools` page HTML — source of the verbatim sidebar, mobile nav, and quick-actions FAB. |
| `recon/ax_texts.txt` | Extracted accessibility-tree text from the recon pass. |
| `report/veostudio-module-report.md` | In-depth module/feature inventory with plan limits and the API surface observed. |

## Rebuild

```bash
python3 build_clone.py   # regenerates all 45 pages into app/
```

## Notes

- The clone is **frontend only** — forms show a demo notice; no backend calls are made.
- Branding, colors (`#8B5CF6` primary), and layout tokens match the live site.
- Plan-gated tools (ElevenLabs voices, bulk images, image-to-image, multi-character video)
  show an upgrade prompt on the Free plan, mirroring the live behavior.
- The login page is a visual replica; the reCAPTCHA and auth API are not wired up.

## Roadmap

Next: API design and backend logic (auth, projects, TTS/voice jobs, billing) per the
module report.
