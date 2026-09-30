# VEO Studio Ai — In-Depth Module & Feature Report

**Source:** live recon of https://veostudioai.com (2026-09-30, logged-in Free account `milanparmar9621@gmail.com`)
**Scope:** every route, tool, and feature observed; plan-gated items noted. Read-only exploration — nothing created or changed.

---

## 1. Platform Overview

VEO Studio Ai is a React SPA (Vite build, Tailwind + custom CSS, Inter font, Lucide icons, i18n via EN dropdown) that
bundles **27 tool cards across 4 creative suites** plus project management, API access, billing, affiliate, and support
modules into one dashboard. A separate browser-local video editor lives at `editor.veostudioai.com`.

- **Design system:** light default theme, dark-mode toggle; primary `#8B5CF6` / hover `#7C3AED`; accent `#3B82F6`;
  amber `#F59E0B`; success `#10b981`; danger `#ef4444`; sidebar 260px (collapsible to 68px); mobile bottom nav;
  floating quick-actions FAB (Rate this Platform / AI Assistant); entrance animations (`fade-in`, `stagger-1..5`);
  footer: "© 2026 VEO Studio Ai, Developed by Zain Ali | Powered by DevZea"; support email support@devzea.com.
- **Free plan baseline:** 1 thread · 2 min max video · 1 scene/cycle · daily reset; AI token counter
  (23.9K in / 5.4K out / 29.4K total observed); 1 image/day; 100 TTS chars/day; 10 niche analyses/day.
- **Observed API surface (no secrets):** `POST /api/auth/login`, `GET /api/auth/me`, `GET/POST /api/projects`,
  `GET /api/projects/:id`, `GET /api/voices`, `GET /api/voices/languages`, `POST /api/tools/tts/generate`,
  `POST /api/tools/bulk-images/generate`, `POST /api/tools/bulk-videos/start`,
  `POST /api/tools/first-last-video/start`, `GET /api/branding/logo_*.png`, `GET /api/branding/favicon_*.png`.

---

## 2. Module Inventory (in sidebar order)

### A. Authentication & App Shell
| Route | Features |
|---|---|
| `/login` | Email/password sign-in, **mandatory reCAPTCHA** ("I'm not a robot") |
| `/dashboard` | Welcome banner; Free-plan banner (1 thread · 2 min max · 1 scene/cycle · Daily Reset) with Upgrade CTA; **10 stat cards** (Total Projects, Completed, Processing, Failed, Scenes Generated, Total Duration, Images 0/1 + reset countdown, TTS Characters 0/100, Niche Analyses 0/10, AI Usage); **AI Token Usage** (in/out/total); **Project Activity** 14-day bar chart; **Status Breakdown**, **Login Activity** (logins/failed), **Project Types**, **Scenes Generated**, **Scenes Status** charts; **Quick Tools** grid (6 shortcuts); **Recent Activity** feed; **Recent Projects**; floating **Rate this Platform** modal (5-star + category + feedback) and **AI Assistant** pill; top-right **EN language dropdown**, notifications bell, **New Project** CTA |
| `/profile` | Profile Information (name, email, role, member-since, save); Change Password (current/new/confirm) |
| `/my-jobs` | Background-job monitor: auto-refresh toggle, manual refresh, "Clear Stuck", Active Jobs + Recent History lists |

### B. Projects
| Route | Features |
|---|---|
| `/projects/new` | **Auto Pilot Video Gen — 4-step wizard:** 1) Content (topic textarea, Content Mode = AI Prompt vs Manual Input, "Generate Content Ideas", script preview); 2) Video Settings; 3) Voice & Language; 4) Captions & Transitions |
| `/projects/templates` | **Templates Gallery** — 25 viral-niche cards (Motivation Daily, Scary Stories, Fun Facts, History Facts, Billionaire Mindset, Animal Facts, Space Wonders, Tech News, Fitness Tips, Cooking Hacks, Travel Vlogs, Finance Tips, Relationship Advice, True Crime, Mythology Tales, Sports Highlights, Gaming Clips, Movie Recaps, Luxury Lifestyle, Nature Wonders, Science Experiments, Daily Quotes, Business Ideas, Health Tips, Comedy Skits) with search + category chips |
| `/projects` | Project list: tabs (Projects / Videos / Archived), search, type filter (Auto Pilot/Bulk/Long), status filter (Completed/Processing/Failed), empty states |
| `/projects/prompting-rules` | **Prompting Rules** — "AI Prompt Refiner for Google Flow Safe Output": canned system prompt (family-safe, cinematic, <500 chars, no real names/brands), Copy button |

### C. Video Tools (6)
| Route | Features |
|---|---|
| `/tools/video-studio` | **Long Videos Generator:** model picker (Google Flow VEO), Content Type (Video Niche/Topic vs Own Script), Generation Type (Bulk/Extender), duration (plan-locked), Video Style, CC Mode, Character Consistency, Auto Prompt Refine toggle, Aspect Ratio 16:9/9:16, **Frame Extender** explainer, daily-scene quota display, template quick-chips, "Create Project & Enter Studio" → scene-by-scene studio; Recent Projects |
| `/tools/bulk-videos` | **Bulk Videos Generator:** single image + prompt → many videos; project name, Video Style (some styles plan-locked), Auto Prompt Refine, aspect ratio, CC/character consistency, prompts textarea (0/100), "Generate N Videos"; history |
| `/tools/first-last-video` | **First & Last Frame:** required first-frame + optional last-frame upload, prompt, chain count 1–10, Image Analyzer model (Fast Image Analyzer), Google Flow VEO picker, aspect ratio; history |
| `/tools/bulk-images-to-video` | **Bulk Images to Video:** numbered images (max 50, 50MB each), bulk prompts via textbox or .txt upload, "Studio Project" toggle, VEO picker, aspect ratio; history |
| `/tools/lip-sync` | **AI Lip Sync Video:** 3 tabs (Audio File: avatar image + audio voice file; Full Story; Prompts), VEO picker, aspect ratio, checkboxes (enhance facial details, stabilize head motion, HD upscale); history |
| `/tools/ugc-ads` | **UGC Ads Creator:** product images (max 10), AI instructions textarea, Image Analyzer model, VEO picker, aspect ratio; history |

### D. Audio Tools (3)
| Route | Features |
|---|---|
| `/tools/text-to-speech` | **Text to Speech:** textarea w/ daily char counter (0/100); **322+ voice grid** w/ preview-play buttons, search, Language / Gender / Country filters, "Load More", "Use" per voice; disabled Generate (Free) |
| `/tools/multi-character-tts` | **Multi Character Voice:** paragraph textarea, "Split into Sentences (0)", per-sentence voice assignment for dialogues/narrations; history |
| `/tools/voice-history` | **Voice History:** tabs (All / Single Voice / Multi Character), full voiceover library |

### E. Image Tools (1 live of 4 shown)
| Route | Features |
|---|---|
| `/tools/image-to-prompt` | **Image to Prompt:** Single Image / Bulk Images tabs, Image Analyzer model selector (Fast Image Analyzer New), drag-drop upload, AI caption/prompt output; history |
| Plan-gated (redirect to `/dashboard` on Free): | `/tools/elevenlabs-tts`, `/tools/elevenlabs-sfx`, `/tools/elevenlabs-sts`, `/tools/elevenlabs-voice-design`, `/tools/elevenlabs-voice-cloning`, `/tools/bulk-images`, `/tools/image-to-image`, `/tools/multi-char-video` |

### F. YouTube Automation Suite (7)
| Route | Features |
|---|---|
| `/tools/youtube-niche-finder` | **Niche Finder:** keyword/niche input → demand/competition/opportunity scores; 10 analyses/day quota display |
| `/tools/youtube-seo-generator` | **SEO Metadata Generator:** topic → SEO title, description, tags + optional AI thumbnail; daily-scene quota |
| `/tools/tags-generator` | **Tags Generator:** topic + 7 platform chips (YouTube, Instagram, TikTok, Twitter, Facebook, LinkedIn, Pinterest) → tags & hashtags |
| `/tools/channel-analyzer` | **Channel Analyzer:** channel URL → competitor content-pattern extraction; daily quota display |
| `/tools/video-breakdown` | **Video Breakdown:** video URL + Image Analyzer model → structure/strategy breakdown |
| `/tools/video-master-prompt` | **Video Master Prompt:** 4-step explainer (paste URL/upload → frame extraction → scene analysis → master prompt); YouTube URL / Upload tabs, Image Analyzer model, additional-notes field |
| `/tools/youtube-history` | **YouTube Automation History:** total-search counter, search, per-tool filter, empty state |

### G. API
| Route | Features |
|---|---|
| `/api-keys` | JWT API token (masked) with Copy + Regenerate; Base URL `https://veostudioai.com` with Copy; cURL quick-start snippet |
| `/api-docs` | Auth instructions (Bearer header), **11 documented endpoints**: auth login/me, projects list/create/detail, voices list/languages, tools tts-generate, bulk-images-generate, bulk-videos-start, first-last-video-start |

### H. Accounts & Billing
| Route | Features |
|---|---|
| `/my-accounts` | "Feature Not Activated" — connect own Google Flow accounts; WhatsApp admin contact CTA |
| `/plans` | Current-plan summary (plan, scenes used today, days left); 5 plan cards: **Free Rs.0/day · Starter Rs.3,500/mo · Basic Rs.4,000/mo · Premium Rs.5,000/mo · Ultra Premium Rs.7,000/mo**; Child Panel upsell banner |
| `/offers` | Offer-code activation (disabled), "No Offers Available" empty state |
| `/billing` | Subscription card (Free Plan Active badge, plan, period May 8–Jun 7 2026, Submit Payment CTA); Payment History; Invoices — both empty |
| `/child-panel` | **White-label reseller:** Rs 20,000 one-time; "Your Brand. Our Technology."; 21 included tools; FAQ accordion |
| `/affiliate` | **Affiliate Program:** 10% commission hero, gated behind paid plan; How-It-Works (3 steps); Why Join benefits; real-time tracking + monthly payouts promised |

### I. Support & Help
| Route | Features |
|---|---|
| `/ai-chat` | **AI Chat:** recent-chats sidebar, Creative/Professional/Friendly mode chips, voice-replies toggle, AI Settings; message input with "50/50 messages left" quota; suggestion chips |
| `/support` | **Support Tickets:** New Ticket CTA; 6 status tabs (All/Open/In Progress/Waiting/Resolved/Closed); empty state |
| `/help` | **Help Center:** search; **15 FAQ categories** (Getting Started, Video Studio, Bulk Videos & Templates, TTS, Image Tools, YouTube Tools, Tags Generator, Character Hub & UGC Ads, Master Prompt, API Access, Plans & Billing, Affiliate, Account & Settings, Support & Tickets, Security & Privacy) as accordions |

### J. Public Pages
| Route | Features |
|---|---|
| `/` | Landing: hero (badge, headline, CTAs, 4 stats: 10k+ videos / 500+ creators / 18+ tools / 4.9 rating); Features; AI Tools grid; How-It-Works (4 steps); Pricing teaser; White-label CTA |
| `/about` | Mission, team card (Zain Ali — Founder & Lead Developer, LinkedIn CTA), 3 tech cards (AI-Powered Content, Cloud Processing, 580+ TTS Voices), vision, Get-Started CTA |
| `/contact` | Contact form (name/email/subject/message); email support@devzea.com; WhatsApp; LinkedIn/DevZea links; 5-question FAQ accordion |
| `/terms` `/privacy` `/refund-policy` | 12 / 11 / 7-section legal pages ("ALL SALES ARE FINAL — NO REFUNDS" banner on refund policy) |

### K. Video Editor (separate app, `editor.veostudioai.com`)
| Route | Features |
|---|---|
| `/` | Browser-local editor landing: Dashboard / Tools / Pricing cards |
| `/projects` | Editor projects (localStorage-saved): search, Newest/Oldest/Name sort, New Project |

---

## 3. Feature Matrix (cross-cutting)

- **Plan gating:** 8 tool routes redirect to `/dashboard` on Free; locked selects/buttons show upgrade prompts; image quota 0/1 with reset countdown; TTS 100 chars/day; niche tools 10 analyses/day; scenes 0/1/day.
- **AI safety layer:** Prompting Rules (Google Flow safe-output refiner); Auto Prompt Refine toggle on video tools.
- **Quotas everywhere:** scenes/day, images/day, TTS chars/day, analyses/day, AI chat 50/50 messages — all with reset semantics.
- **History:** per-tool generation histories, job history, voice history, YouTube search history, login activity.
- **White-label / monetization:** Child Panel (Rs 20k), Affiliate 10%, 5-tier plans, manual "Submit Payment" flow.
- **i18n:** EN dropdown (English, Français, Español, Türkçe, Italiano, Khmer).
- **Theming:** light/dark toggle persisted in localStorage; collapsible sidebar; mobile bottom nav; quick-actions FAB.

---

## 4. Clone Coverage Notes

The static clone in `veostudio-clone/app/` covers all 45 routes listed above (34 app routes + 6 public + login + 2 editor + dashboard etc.). Verbatim assets: the real compiled stylesheet, real sidebar/mobile-nav/FAB markup, real logo, real `/tools` page HTML (27 tool cards). Reconstructed content: page bodies built from accessibility snapshots + screenshots. Interactive behavior is stubbed (forms, generation, auth, API calls) — backend wiring is the next phase per the agreed sequencing.
