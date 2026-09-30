#!/usr/bin/env python3
"""Builds the VEO Studio Ai frontend clone from captured materials.
Real stylesheet + real app shell (verbatim), page content reconstructed
from accessibility snapshots, screenshots, and the full site inventory.
"""
import os, re, html as ihtml

BASE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(BASE, "app")
RECON = os.path.join(BASE, "recon", "html", "veo-tools.html")

raw = open(RECON, encoding="utf-8").read()

# ---- verbatim shell pieces ---------------------------------------------
m = re.search(r'<aside class="sidebar.*?</aside>', raw, re.S)
SIDEBAR = m.group(0)
m = re.search(r'<nav class="mobile-nav">.*?</nav>', raw, re.S)
MOBILE_NAV = m.group(0)
# quick-actions FAB (fixed div + style block + button) from start of #root
m = re.search(r'<div style="position: fixed; right: 24px; bottom: 24px; z-index: 9998;">.*?</button></div>', raw, re.S)
FAB = m.group(0)

# main content of /tools page, verbatim (used for the Tools index page)
m = re.search(r'<main class="main-content fade-in">(.*?)</main>', raw, re.S)
TOOLS_MAIN = m.group(1)

def set_active(sidebar, href):
    """Mark the nav item with the given href as active."""
    s = sidebar.replace('aria-current="page" ', '')
    s = s.replace('class="sidebar-nav-item active"', 'class="sidebar-nav-item "')
    needle = f'class="sidebar-nav-item " href="{href}"'
    if needle in s:
        s = s.replace(needle, f'aria-current="page" class="sidebar-nav-item active" href="{href}"', 1)
    return s

def fix_assets(s, rel):
    s = s.replace('/api/branding/logo_0cf8b798.png', rel + 'assets/img/logo.png')
    s = s.replace('/api/branding/favicon_f9041a45.png', rel + 'assets/img/logo.png')
    return s

JS = """
document.addEventListener('DOMContentLoaded', function() {
  // theme toggle
  var toggles = document.querySelectorAll('[data-theme-toggle]');
  function setTheme(t){ document.documentElement.setAttribute('data-theme', t); document.body.setAttribute('data-theme', t); try{localStorage.setItem('veo-theme', t);}catch(e){} toggles.forEach(function(el){ el.classList.toggle('on', t==='dark'); }); }
  var saved = null; try{ saved = localStorage.getItem('veo-theme'); }catch(e){}
  if (saved) setTheme(saved);
  toggles.forEach(function(el){ el.addEventListener('click', function(){ setTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark'); }); });
  // sidebar collapse
  var sb = document.querySelector('.sidebar');
  document.querySelectorAll('[data-collapse]').forEach(function(el){ el.addEventListener('click', function(){ if(sb) sb.classList.toggle('sidebar-collapsed'); document.body.classList.toggle('sidebar-is-collapsed'); }); });
  // dropdowns
  document.querySelectorAll('[data-dropdown]').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.stopPropagation(); var m = btn.parentElement.querySelector('.dropdown-menu'); document.querySelectorAll('.dropdown-menu.open').forEach(function(x){ if(x!==m) x.classList.remove('open'); }); if(m) m.classList.toggle('open'); });
  });
  document.addEventListener('click', function(){ document.querySelectorAll('.dropdown-menu.open').forEach(function(x){ x.classList.remove('open'); }); });
  // tabs
  document.querySelectorAll('[data-tabs]').forEach(function(wrap){
    var btns = wrap.querySelectorAll('.tab-btn');
    btns.forEach(function(b){ b.addEventListener('click', function(){
      btns.forEach(function(x){ x.classList.remove('active'); }); b.classList.add('active');
      var panes = wrap.parentElement.querySelectorAll(':scope > .tab-pane, #'+wrap.getAttribute('data-tabs')+' .tab-pane');
      document.querySelectorAll('#'+wrap.getAttribute('data-tabs')+' .tab-pane').forEach(function(p){ p.style.display = (p.getAttribute('data-pane')===b.getAttribute('data-tab')) ? '' : 'none'; });
    }); });
  });
  // accordions
  document.querySelectorAll('[data-accordion]').forEach(function(btn){ btn.addEventListener('click', function(){ var body = btn.nextElementSibling; var open = btn.classList.toggle('open'); if(body && body.classList.contains('accordion-body')) body.style.display = open ? '' : 'none'; }); });
  // quick actions FAB toggle
  var qaf = document.querySelector('.qaf-fab');
  var qafActions = document.getElementById('qafActions');
  if (qaf && qafActions) qaf.addEventListener('click', function(){ qafActions.style.display = qafActions.style.display==='none' ? 'flex' : 'none'; });
  // rate modal
  var rf = document.getElementById('rateFloat');
  if (rf) rf.addEventListener('click', function(){ var m=document.getElementById('rateModal'); if(m) m.style.display='flex'; });
  document.querySelectorAll('[data-close]').forEach(function(b){ b.addEventListener('click', function(){ var m=document.getElementById(b.getAttribute('data-close')); if(m) m.style.display='none'; }); });
  var aiF = document.getElementById('aiFloat');
  if (aiF) aiF.addEventListener('click', function(){ toast('AI Assistant — demo build'); });
  // copy buttons
  document.querySelectorAll('[data-copy]').forEach(function(btn){ btn.addEventListener('click', function(){ var t = document.querySelector(btn.getAttribute('data-copy')); if(t){ var txt = t.innerText || t.value || ''; if(navigator.clipboard) navigator.clipboard.writeText(txt); toast('Copied to clipboard'); } }); });
  // toast helper
  window.toast = function(msg){ var c = document.querySelector('.toast-container'); if(!c){ c = document.createElement('div'); c.className='toast-container'; document.body.appendChild(c);} var el=document.createElement('div'); el.className='toast toast-success'; el.textContent=msg; c.appendChild(el); setTimeout(function(){ el.remove(); }, 2500); };
  // demo: prevent real submits
  document.querySelectorAll('form[data-demo]').forEach(function(f){ f.addEventListener('submit', function(e){ e.preventDefault(); toast('Demo build — connect an API to enable this action.'); }); });
  document.querySelectorAll('form[data-demo]').forEach(function(f){ f.addEventListener('submit', function(e){ e.preventDefault(); toast('Demo build — connect an API to enable this action.'); }); });
});
"""

def page_head(title, desc, rel, theme_css=True):
    return f"""<!DOCTYPE html><html lang="en" data-theme="light"><head>
<meta charset="UTF-8">
<link rel="icon" type="image/png" href="{rel}assets/img/logo.png">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{ihtml.escape(title)} | VEO Studio Ai</title>
<meta name="description" content="{ihtml.escape(desc)}">
<meta name="author" content="Zain Ali">
<meta name="publisher" content="DevZea">
<meta name="theme-color" content="#8B5CF6">
<link rel="stylesheet" href="{rel}assets/css/index-DCalCK4u.css">
<link rel="stylesheet" href="{rel}assets/css/clone-extras.css">
</head>"""

def shell_app(title, desc, active_href, content, rel):
    sidebar = fix_assets(set_active(SIDEBAR, active_href), rel)
    fab = fix_assets(FAB, rel)
    mobile = fix_assets(MOBILE_NAV, rel)
    return (page_head(title, desc, rel) +
f"""<body data-theme="light">
<div class="app-layout ">
{fab}
<div class="float-stack" id="qafActions" style="display:none;">
<button class="qaf-action-btn" id="rateFloat">{ic("star",16)} Rate this Platform</button>
<button class="qaf-action-btn" id="aiFloat">AI Assistant {ic("msg",16)}</button>
</div>
<div class="modal-overlay" id="rateModal" style="display:none;"><div class="modal">
<div class="modal-header"><h3 class="modal-title">Rate Your Experience</h3><button class="modal-close" data-close="rateModal">{ic("x",18)}</button></div>
<div class="stars-row">{"".join([f'<button class="star-btn">{ic("star",26)}</button>' for _ in range(5)])}</div>
<div class="form-group"><label class="form-label">Category</label><select class="form-select"><option>Overall Experience</option><option>Video Quality</option><option>Ease of Use</option><option>Support</option></select></div>
<div class="form-group"><label class="form-label">Feedback</label><textarea class="form-textarea" rows="3" placeholder="Tell us what you think..."></textarea></div>
<div class="modal-actions"><button class="btn btn-ghost" data-close="rateModal">Cancel</button><button class="btn btn-primary" data-close="rateModal">Submit Rating</button></div>
</div></div>
{sidebar}
<main class="main-content fade-in">
<div class="fade-in">
{content}
</div>
</main>
{mobile}
</div>
<script>{JS}</script>
</body></html>""")

PUBLIC_NAV = """<nav class="public-nav"><div class="public-nav-inner">
<a class="public-brand" href="{rel}index.html"><img alt="Logo" src="{rel}assets/img/logo.png" style="width:30px;height:30px;object-fit:contain;"><span>VEO Studio Ai</span></a>
<div class="public-links">
<a href="{rel}index.html">Home</a><a href="{rel}about/index.html">About</a><a href="{rel}contact/index.html">Contact</a><a href="{rel}terms/index.html">Terms</a><a href="{rel}privacy/index.html">Privacy</a><a href="{rel}refund-policy/index.html">Refund Policy</a>
</div>
<div class="public-actions">
<button class="btn btn-ghost btn-sm" data-dropdown-btn>EN</button>
<a class="btn btn-primary btn-sm" href="{rel}dashboard/index.html">Dashboard</a>
</div></div></nav>"""

PUBLIC_FOOTER = """<footer class="public-footer"><div class="public-footer-inner">
<div class="public-footer-brand"><img alt="Logo" src="{rel}assets/img/logo.png" style="width:28px;height:28px;"><span>VEO Studio Ai</span>
<p>Your complete AI-powered YouTube studio.</p></div>
<div class="public-footer-cols">
<div><h4>Product</h4><a href="{rel}index.html">Home</a><a href="{rel}about/index.html">About</a><a href="{rel}contact/index.html">Contact</a></div>
<div><h4>Legal</h4><a href="{rel}terms/index.html">Terms &amp; Conditions</a><a href="{rel}privacy/index.html">Privacy Policy</a><a href="{rel}refund-policy/index.html">Refund Policy</a></div>
<div><h4>Account</h4><a href="{rel}dashboard/index.html">Dashboard</a><a href="{rel}login/index.html">Sign In</a></div>
</div></div>
<div class="public-footer-bottom"><span>Developed by <a href="#">Zain Ali</a> | Powered by <a href="#">DevZea</a></span><span>&copy; 2026 VEO Studio Ai. All rights reserved.</span></div></footer>"""

def shell_public(title, desc, content, rel, active=""):
    nav = PUBLIC_NAV.format(rel=rel)
    foot = PUBLIC_FOOTER.format(rel=rel)
    return (page_head(title, desc, rel) +
f"""<body data-theme="light">
{nav}
<main class="public-main">{content}</main>
{foot}
<script>{JS}</script>
</body></html>""")

def shell_auth(title, desc, content, rel):
    return (page_head(title, desc, rel) +
f"""<body data-theme="light">
<div class="auth-page"><div class="auth-card">
<div class="auth-brand"><img alt="Logo" src="{rel}assets/img/logo.png" style="width:44px;height:44px;object-fit:contain;"><h2>VEO Studio Ai</h2></div>
{content}
</div></div>
<script>{JS}</script>
</body></html>""")

PAGES = []

def add(route, title, desc, shell, active, content):
    PAGES.append(dict(route=route, title=title, desc=desc, shell=shell, active=active, content=content))

def write_all():
    for p in PAGES:
        route = p["route"]
        depth = 0 if route == "" else len(route.split("/"))
        rel = "../" * depth
        if p["shell"] == "app":
            out = shell_app(p["title"], p["desc"], p["active"], p["content"], rel)
        elif p["shell"] == "public":
            out = shell_public(p["title"], p["desc"], p["content"], rel)
        else:
            out = shell_auth(p["title"], p["desc"], p["content"], rel)
        d = os.path.join(APP, route) if route else APP
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(out)
    print(f"wrote {len(PAGES)} pages")

# ---------------------------------------------------------------- part 2
ICONS = {
"bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
"globe": '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
"plus": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
"crown": '<path d="M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3l4.27-3.67a.5.5 0 0 1 .8.52l-2.83 10.24a1 1 0 0 1-.96.74H5.81a1 1 0 0 1-.96-.74L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.66a1 1 0 0 0 1.52-.29z"/><path d="M5 21h14"/>',
"folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 1 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
"check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
"clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
"xcirc": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
"film": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/><path d="M13 7.5h4"/><path d="M13 16.5h4"/>',
"image": '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
"mic": '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
"search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
"zap": '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
"star": '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"/>',
"trend": '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
"users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
"video": '<path d="m16 10 6-3v10l-6-3"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
"music": '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
"msg": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
"copy": '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
"refresh": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
"eye": '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
"chev": '<path d="m6 9 6 6 6-6"/>',
"arrow": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
"upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
"x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
"spark": '<path d="M12 3v3m0 12v3M5.6 5.6l2.2 2.2m8.4 8.4 2.2 2.2M3 12h3m12 0h3M5.6 18.4l2.2-2.2m8.4-8.4 2.2-2.2"/>',
"key": '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
"card": '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
"gift": '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
"help": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
"file": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
"send": '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
"play": '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/>',
"layers": '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
"activity": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
"shield": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
"wallet": '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
"link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
"moon": '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
"filter": '<path d="M22 3H2l8 9.46V19l4 2v-8.54Z"/>',
"cal": '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
"book": '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
"trash": '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
"yt": '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
"tag": '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>',
"gauge": '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
"wand": '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
}

def ic(name, size=20, sw=2):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>'

def stat_card(icon, tint, value, label, sub=""):
    sub_h = f'<div class="dash-stat-sub">{sub}</div>' if sub else ''
    return f'''<div class="dash-stat-card stagger-3"><div class="dash-stat-icon" style="background:{tint};">{ic(icon,22)}</div>
<div class="dash-stat-info"><div class="dash-stat-value">{value}</div><div class="dash-stat-label">{label}</div>{sub_h}</div></div>'''

def page_header(title, subtitle, actions=""):
    return f'''<div class="page-header stagger-1"><div><h1 class="page-title">{title}</h1><p class="page-subtitle">{subtitle}</p></div>
<div class="page-actions">{actions}</div></div>'''

# ============================ DASHBOARD ============================
dash_stats = "".join([
 stat_card("folder","rgba(139,92,246,.1)","0","Total Projects"),
 stat_card("check","rgba(16,185,129,.1)","0","Completed"),
 stat_card("clock","rgba(245,158,11,.12)","0","Processing"),
 stat_card("xcirc","rgba(239,68,68,.1)","0","Failed"),
 stat_card("film","rgba(59,130,246,.1)","0","Scenes Generated"),
 stat_card("clock","rgba(14,165,233,.1)","0m","Total Duration"),
 stat_card("image","rgba(139,92,246,.1)","0/1","Images",'<span class="dash-usage-reset">Resets in 23h 51m 8s</span>'),
 stat_card("mic","rgba(236,72,153,.1)","0/100","TTS Characters"),
 stat_card("search","rgba(59,130,246,.1)","0/10","Niche Analyses"),
 stat_card("zap","rgba(245,158,11,.12)","0","AI Usage"),
])

bars = "".join([f'<div class="chart-bar" style="height:{h}%" title="{d}"></div>' for d,h in
 [("Sep 17",12),("Sep 18",28),("Sep 19",20),("Sep 20",45),("Sep 21",32),("Sep 22",60),("Sep 23",40),("Sep 24",25),("Sep 25",52),("Sep 26",35),("Sep 27",48),("Sep 28",30),("Sep 29",18),("Sep 30",8)]])
bar_labels = "".join([f'<span>{d}</span>' for d in ["Sep 17","Sep 19","Sep 21","Sep 23","Sep 25","Sep 27","Sep 30"]])

add("dashboard","Dashboard","Your complete overview and analytics","app","/dashboard", f"""
{page_header("Welcome back, milan","Here&rsquo;s your complete overview and analytics", f'''
<button class="icon-btn" title="Notifications">{ic("bell",20)}</button>
<div class="dropdown-wrap"><button class="btn btn-ghost btn-sm" data-dropdown>{ic("globe",16)} EN {ic("chev",14)}</button>
<div class="dropdown-menu"><a href="#">English</a><a href="#">Fran&ccedil;ais</a><a href="#">Espa&ntilde;ol</a><a href="#">T&uuml;rk&ccedil;e</a><a href="#">Italiano</a><a href="#">Khmer</a></div></div>
<a class="btn btn-primary" href="../projects/new/index.html">{ic("plus",18)} New Project</a>''')}

<div class="plan-banner stagger-2" style="background:linear-gradient(120deg,#8B5CF6,#3B82F6);border-radius:20px;padding:22px 26px;display:flex;align-items:center;gap:18px;color:#fff;margin-bottom:26px;">
<div style="background:rgba(255,255,255,.18);border-radius:14px;padding:12px;">{ic("crown",26)}</div>
<div style="flex:1;"><div style="font-weight:700;font-size:1.15rem;">Free Plan</div>
<div style="opacity:.92;font-size:.9rem;">1 threads &middot; 2 min max &middot; 1 scenes/cycle &middot; Daily Reset</div></div>
<a class="btn" style="background:#fff;color:#6D28D9;font-weight:700;" href="../plans/index.html">Upgrade {ic("arrow",16)}</a></div>

<div class="dash-stats">{dash_stats}</div>

<div class="grid grid-2 gap-4 mt-4">
<div class="card stagger-3"><div class="card-header"><h3>AI Token Usage</h3></div>
<div class="dash-usage-3col">
<div class="dash-usage-card"><div class="dash-usage-count">23.9K</div><div class="dash-usage-title">Input Tokens</div></div>
<div class="dash-usage-card"><div class="dash-usage-count">5.4K</div><div class="dash-usage-title">Output Tokens</div></div>
<div class="dash-usage-card"><div class="dash-usage-count">29.4K</div><div class="dash-usage-title">Total Tokens</div></div>
</div></div>

<div class="card stagger-3"><div class="card-header"><h3>Project Activity</h3><span class="text-muted text-sm">Last 14 days</span></div>
<div class="chart-legend"><span><i class="dot" style="background:#8B5CF6"></i>Completed</span><span><i class="dot" style="background:#3B82F6"></i>Created</span></div>
<div class="chart-bars">{bars}</div><div class="chart-x">{bar_labels}</div></div>
</div>

<div class="grid grid-2 gap-4 mt-4">
<div class="card stagger-4"><div class="card-header"><h3>Status Breakdown</h3></div><div class="empty-state"><p>No project data yet</p></div></div>
<div class="card stagger-4"><div class="card-header"><h3>Login Activity</h3></div>
<div class="chart-legend"><span><i class="dot" style="background:#ef4444"></i>Failed</span><span><i class="dot" style="background:#10b981"></i>Logins</span></div>
<div class="chart-bars">{"".join([f'<div class="chart-bar" style="height:{h}%" title="{d}"></div>' for d,h in [("Sep 22",70),("Sep 23",20),("Sep 24",40),("Sep 25",30),("Sep 26",85),("Sep 27",45),("Sep 28",55)]])}</div>
<div class="chart-x"><span>Sep 22</span><span>Sep 26</span></div></div>
</div>

<div class="grid grid-3 gap-4 mt-4">
<div class="card stagger-4"><div class="card-header"><h3>Project Types</h3></div><div class="empty-state"><p>No data yet</p></div></div>
<div class="card stagger-4"><div class="card-header"><h3>Scenes Generated</h3></div><div class="empty-state"><p>No data yet</p></div></div>
<div class="card stagger-5"><div class="card-header"><h3>Scenes Status</h3></div><p class="text-muted text-sm">Total Scenes</p><div class="dash-stat-value">0</div></div>
</div>

<div class="dash-tools-section stagger-5"><div class="dash-section-header"><h3>Quick Tools</h3></div>
<div class="dash-tools-grid">
<a class="dash-tool-card" href="../tools/index.html"><div class="dash-tool-icon">{ic("zap",20)}</div><div class="dash-tool-name">All tools</div></a>
<a class="dash-tool-card" href="../tools/bulk-videos/index.html"><div class="dash-tool-icon">{ic("film",20)}</div><div class="dash-tool-name">Bulk Videos</div></a>
<a class="dash-tool-card" href="../tools/first-last-video/index.html"><div class="dash-tool-icon">{ic("image",20)}</div><div class="dash-tool-name">First &amp; Last Frame</div></a>
<a class="dash-tool-card" href="../tools/text-to-speech/index.html"><div class="dash-tool-icon">{ic("mic",20)}</div><div class="dash-tool-name">Text to Speech</div></a>
<a class="dash-tool-card" href="../tools/multi-character-tts/index.html"><div class="dash-tool-icon">{ic("users",20)}</div><div class="dash-tool-name">Multi Voice TTS</div></a>
<a class="dash-tool-card" href="../tools/bulk-images-to-video/index.html"><div class="dash-tool-icon">{ic("video",20)}</div><div class="dash-tool-name">Images to Video</div></a>
</div></div>

<div class="grid grid-2 gap-4 mt-4">
<div class="card stagger-5"><div class="card-header"><h3>Recent Activity</h3></div>
<div class="activity-row"><div class="activity-dot"></div><div><div class="font-semibold">Successful login</div><div class="text-muted text-sm">Sep 28</div></div></div></div>
<div class="card stagger-5"><div class="card-header"><h3>Recent Projects</h3><a class="dash-see-all" href="../projects/index.html">View all</a></div>
<div class="empty-state"><p>No projects yet. Create your first one!</p><a class="btn btn-primary btn-sm mt-2" href="../projects/new/index.html">Create Project</a></div></div>
</div>
""")

# ============================ PROJECTS ============================
add("projects/new","Auto Pilot Video Gen","Create a new video project step by step","app","/projects/new", f"""
{page_header("Auto Pilot Video Gen","Create your video project in 4 simple steps")}
<div class="wizard-steps stagger-2">
<div class="wizard-step active"><span class="wizard-num">1</span> Content</div>
<div class="wizard-step"><span class="wizard-num">2</span> Video Settings</div>
<div class="wizard-step"><span class="wizard-num">3</span> Voice &amp; Language</div>
<div class="wizard-step"><span class="wizard-num">4</span> Captions &amp; Transitions</div>
</div>
<form data-demo>
<div class="card stagger-3"><div class="card-header"><h3>Step 1 &mdash; Content</h3></div>
<div class="form-group"><label class="form-label">Video Topic</label>
<textarea class="form-textarea" rows="4" placeholder="Describe your video topic or idea..."></textarea></div>
<div class="form-group"><label class="form-label">Content Mode</label>
<div class="radio-row"><label class="radio-pill"><input type="radio" name="cmode" checked> AI Prompt</label>
<label class="radio-pill"><input type="radio" name="cmode"> Manual Input</label></div></div>
<button type="button" class="btn btn-secondary">{ic("spark",18)} Generate Content Ideas</button>
<div class="form-group mt-3"><label class="form-label">Script Preview</label>
<textarea class="form-textarea" rows="6" readonly placeholder="Your generated script will appear here..."></textarea></div>
<div class="modal-actions"><span></span><button class="btn btn-primary" type="button">Continue {ic("arrow",16)}</button></div>
</div></form>
""")

TEMPLATES = ["Motivation Daily","Scary Stories","Fun Facts","History Facts","Billionaire Mindset","Animal Facts","Space Wonders","Tech News","Fitness Tips","Cooking Hacks","Travel Vlogs","Finance Tips","Relationship Advice","True Crime","Mythology Tales","Sports Highlights","Gaming Clips","Movie Recaps","Luxury Lifestyle","Nature Wonders","Science Experiments","Daily Quotes","Business Ideas","Health Tips","Comedy Skits"]
tpl_cards = "".join([f'''<div class="card hover-lift"><div class="tpl-thumb">{ic("film",28)}</div>
<h4 class="mt-2 font-semibold">{t}</h4><p class="text-muted text-sm">Ready-made viral niche template</p>
<button class="btn btn-primary btn-sm btn-block mt-2">Use Template</button></div>''' for t in TEMPLATES])

add("projects/templates","Viral Niches Templates","Browse ready-made viral video templates","app","/projects/templates", f"""
{page_header("Templates Gallery","Pick a viral niche template to kickstart your project", '<div class="search-wrapper">'+ic("search",18)+'<input class="form-input search-input" placeholder="Search templates..."></div>')}
<div class="chip-row stagger-2">
<button class="chip active">All</button><button class="chip">Motivation</button><button class="chip">Stories</button><button class="chip">Facts</button><button class="chip">Finance</button><button class="chip">Health</button><button class="chip">Entertainment</button>
</div>
<div class="grid grid-4 gap-4 mt-3 stagger-3">{tpl_cards}</div>
""")

add("projects","My Projects","All your video projects in one place","app","/projects", f"""
{page_header("My Projects","Manage all your video projects", '<a class="btn btn-primary" href="../projects/new/index.html">'+ic("plus",18)+' New Project</a>')}
<div data-tabs="projTabs" class="tab-row stagger-2">
<button class="tab-btn active" data-tab="projects">Projects</button>
<button class="tab-btn" data-tab="videos">Videos</button>
<button class="tab-btn" data-tab="archived">Archived</button>
</div>
<div class="filter-row stagger-2">
<div class="search-wrapper">{ic("search",18)}<input class="form-input search-input" placeholder="Search projects..."></div>
<select class="form-select" style="max-width:180px;"><option>All Types</option><option>Auto Pilot</option><option>Bulk</option><option>Long</option></select>
<select class="form-select" style="max-width:180px;"><option>All Statuses</option><option>Completed</option><option>Processing</option><option>Failed</option></select>
</div>
<div id="projTabs"><div class="tab-pane" data-pane="projects">
<div class="empty-state card stagger-3">{ic("folder",40)}<h3>No projects yet</h3><p>Create your first video project to get started.</p>
<a class="btn btn-primary mt-2" href="../projects/new/index.html">Create Project</a></div></div>
<div class="tab-pane" data-pane="videos" style="display:none;"><div class="empty-state card"><h3>No videos yet</h3></div></div>
<div class="tab-pane" data-pane="archived" style="display:none;"><div class="empty-state card"><h3>No archived projects</h3></div></div></div>
""")

add("projects/prompting-rules","Prompting Rules","AI prompt refiner rules for safe output","app","/projects/prompting-rules", f"""
{page_header("Prompting Rules","AI Prompt Refiner for Google Flow Safe Output")}
<div class="card stagger-2"><div class="card-header"><h3>AI Prompt Refiner for Google Flow Safe Output</h3>
<button class="btn btn-secondary btn-sm" data-copy="#promptText">{ic("copy",16)} Copy</button></div>
<pre id="promptText" class="prompt-block">You are an expert AI video prompt refiner for Google Flow (Veo).

RULES:
1. Rewrite the user's idea into a clear, cinematic, production-ready video prompt.
2. Keep all content family-friendly and platform-safe. Remove or soften anything violent, hateful, sexual, or otherwise unsafe.
3. Describe: subject, action, environment, lighting, camera movement, lens, mood, and style.
4. Keep prompts under 500 characters unless detail is essential.
5. Never include real people's names, brands, or copyrighted characters.
6. Output ONLY the refined prompt — no explanations, no preamble.</pre>
</div>
""")

add("my-jobs","My Jobs","Monitor your background generation jobs","app","/my-jobs", f"""
{page_header("My Jobs","Track and manage your generation jobs", '''
<label class="check-row"><input type="checkbox" checked> Auto-refresh</label>
<button class="btn btn-secondary btn-sm">'''+ic("refresh",16)+''' Refresh</button>
<button class="btn btn-ghost btn-sm">Clear Stuck</button>''')}
<div class="card stagger-2"><div class="card-header"><h3>Active Jobs</h3><span class="badge badge-gray">0</span></div>
<div class="empty-state"><p>No active jobs</p></div></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Recent History</h3></div>
<div class="empty-state"><p>No job history yet</p></div></div>
""")

# ---------------------------------------------------------------- part 3
def model_picker():
    return '''<div class="form-group"><label class="form-label">Video Generation Model</label>
<div class="model-picker"><div class="model-option active"><div class="model-name">Google Flow VEO</div><div class="text-muted text-sm">State-of-the-art AI video generation</div></div></div></div>'''

def aspect_row():
    return '''<div class="form-group"><label class="form-label">Aspect Ratio</label>
<div class="radio-row"><label class="radio-pill"><input type="radio" name="ar" checked> 16:9</label><label class="radio-pill"><input type="radio" name="ar"> 9:16</label></div></div>'''

def gen_btn(label):
    return f'<button class="btn btn-primary btn-lg btn-block" disabled>{label}</button>'

def history_block(title="Generation History"):
    return f'''<div class="card mt-4"><div class="card-header"><h3>{title}</h3></div><div class="empty-state"><p>No generations yet</p></div></div>'''

# ---------------- VIDEO STUDIO ----------------
add("tools/video-studio","Long Videos Generator","Create long-form AI videos scene by scene","app","/tools/video-studio", f"""
{page_header("Long Videos Generator","Full video generation studio with scene-by-scene editing")}
<form data-demo><div class="card stagger-2">
{model_picker()}
<div class="form-group"><label class="form-label">Content Type</label>
<div class="radio-row"><label class="radio-pill"><input type="radio" name="ctype" checked> Video Niche / Topic</label><label class="radio-pill"><input type="radio" name="ctype"> Own Script</label></div></div>
<div class="form-group"><label class="form-label">Topic / Script</label>
<textarea class="form-textarea" rows="4" placeholder="Enter your video niche, topic, or full script..."></textarea></div>
<div class="grid grid-2 gap-3">
<div class="form-group"><label class="form-label">Generation Type</label><select class="form-select"><option>Bulk</option><option>Extender</option></select></div>
<div class="form-group"><label class="form-label">Video Duration</label><select class="form-select" disabled><option>Locked &mdash; upgrade to unlock</option></select></div>
<div class="form-group"><label class="form-label">Video Style</label><select class="form-select"><option>Cinematic</option><option>Realistic</option><option>Anime</option><option>Documentary</option></select></div>
<div class="form-group"><label class="form-label">CC Mode</label><select class="form-select"><option>Off</option><option>On</option></select></div>
</div>
<div class="form-group"><label class="form-label">Character Consistency</label><select class="form-select"><option>Off</option><option>On</option></select></div>
<label class="toggle-row"><span>Auto Prompt Refine</span><button type="button" class="theme-toggle" data-theme-toggle><span class="theme-toggle-thumb"></span></button></label>
{aspect_row()}
<p class="form-hint">{ic("zap",14)} Frame Extender lets you extend scenes beyond the base duration.</p>
<p class="text-muted text-sm">Daily Scenes: <strong>0 / 1</strong></p>
{gen_btn("Create Project &amp; Enter Studio")}
<div class="chip-row mt-3"><span class="text-muted text-sm">Templates:</span><button type="button" class="chip">Motivation</button><button type="button" class="chip">Facts</button><button type="button" class="chip">Stories</button></div>
</div></form>
<div class="card mt-4 stagger-3"><div class="card-header"><h3>Recent Projects</h3></div><div class="empty-state"><p>No recent projects</p></div></div>
""")

# ---------------- BULK VIDEOS ----------------
add("tools/bulk-videos","Bulk Videos Generator","Generate many videos from one image and prompt","app","/tools/bulk-videos", f"""
{page_header("Bulk Videos Generator","Create multiple AI-generated videos from a single image and prompt")}
<form data-demo><div class="card stagger-2">
{model_picker()}
<div class="grid grid-2 gap-3">
<div class="form-group"><label class="form-label">Project Name</label><input class="form-input" placeholder="My bulk project"></div>
<div class="form-group"><label class="form-label">Video Style</label><select class="form-select">
<option>Cinematic</option><option>Realistic</option><option>Anime</option><option disabled>Locked &mdash; upgrade</option></select></div>
</div>
<label class="toggle-row"><span>Auto Prompt Refine</span><button type="button" class="theme-toggle" data-theme-toggle><span class="theme-toggle-thumb"></span></button></label>
{aspect_row()}
<div class="form-group"><label class="form-label">CC Mode / Character Consistency</label><select class="form-select"><option>Off</option><option>On</option></select></div>
<div class="form-group"><label class="form-label">Prompts <span class="text-muted">(0/100)</span></label>
<textarea class="form-textarea" rows="6" placeholder="Enter one prompt per line..."></textarea></div>
{gen_btn("Generate 0 Videos")}
</div></form>
{history_block()}
""")

# ---------------- FIRST & LAST FRAME ----------------
add("tools/first-last-video","First & Last Frame","Videos with smooth first-to-last frame transitions","app","/tools/first-last-video", f"""
{page_header("First &amp; Last Frame","Generate videos by specifying first and last frames with smooth transitions")}
<form data-demo><div class="card stagger-2">
<div class="grid grid-2 gap-3">
<div class="form-group"><label class="form-label">First Frame <span class="badge badge-danger">Required</span></label>
<label class="dropzone">{ic("upload",24)}<span>Click or drag to upload</span><input type="file" hidden accept="image/*"></label></div>
<div class="form-group"><label class="form-label">Last Frame <span class="text-muted">(Optional)</span></label>
<label class="dropzone">{ic("upload",24)}<span>Click or drag to upload</span><input type="file" hidden accept="image/*"></label></div>
</div>
<div class="form-group"><label class="form-label">Prompt</label>
<textarea class="form-textarea" rows="3" placeholder="Describe the motion between frames..."></textarea></div>
<div class="grid grid-2 gap-3">
<div class="form-group"><label class="form-label">Chain Count (1&ndash;10)</label><input type="number" class="form-input" min="1" max="10" value="1"></div>
<div class="form-group"><label class="form-label">Image Analyzer Model</label><select class="form-select"><option>Fast Image Analyzer</option></select></div>
</div>
{model_picker()}
{aspect_row()}
{gen_btn("Generate Video")}
</div></form>
{history_block()}
""")

# ---------------- BULK IMAGES TO VIDEO ----------------
add("tools/bulk-images-to-video","Bulk Images to Video","Numbered images with matching prompts, in bulk","app","/tools/bulk-images-to-video", f"""
{page_header("Bulk Images to Video","Upload numbered images with matching prompts to generate videos in bulk")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Images <span class="text-muted">(max 50 &middot; 50MB each)</span></label>
<label class="dropzone">{ic("upload",24)}<span>Upload numbered images (1.png, 2.png ...)</span><input type="file" hidden multiple accept="image/*"></label></div>
<div class="form-group"><label class="form-label">Bulk Prompts</label>
<div class="radio-row"><label class="radio-pill"><input type="radio" name="pmode" checked> Textbox</label><label class="radio-pill"><input type="radio" name="pmode"> Upload .txt</label></div>
<textarea class="form-textarea" rows="5" placeholder="Prompt 1: ...&#10;Prompt 2: ..."></textarea></div>
<label class="toggle-row"><span>Studio Project</span><button type="button" class="theme-toggle" data-theme-toggle><span class="theme-toggle-thumb"></span></button></label>
{model_picker()}
{aspect_row()}
{gen_btn("Generate Videos")}
</div></form>
{history_block()}
""")

# ---------------- LIP SYNC ----------------
add("tools/lip-sync","AI Lip Sync Video","Realistic lip-synced AI avatar videos","app","/tools/lip-sync", f"""
{page_header("AI Lip Sync Video","Generate realistic lip-synced AI avatar videos from a script")}
<div data-tabs="lipTabs" class="tab-row stagger-2">
<button class="tab-btn active" data-tab="audio">Audio File</button>
<button class="tab-btn" data-tab="story">Full Story</button>
<button class="tab-btn" data-tab="prompts">Prompts</button>
</div>
<form data-demo><div class="card stagger-3" id="lipTabs">
<div class="tab-pane" data-pane="audio">
<div class="grid grid-2 gap-3">
<div class="form-group"><label class="form-label">Avatar Image</label>
<label class="dropzone">{ic("upload",24)}<span>Upload avatar image</span><input type="file" hidden accept="image/*"></label></div>
<div class="form-group"><label class="form-label">Audio Voice File</label>
<label class="dropzone">{ic("upload",24)}<span>Upload audio file</span><input type="file" hidden accept="audio/*"></label></div>
</div></div>
<div class="tab-pane" data-pane="story" style="display:none;">
<div class="form-group"><label class="form-label">Full Story Script</label><textarea class="form-textarea" rows="5" placeholder="Paste the full story..."></textarea></div></div>
<div class="tab-pane" data-pane="prompts" style="display:none;">
<div class="form-group"><label class="form-label">Prompts</label><textarea class="form-textarea" rows="5" placeholder="One prompt per line..."></textarea></div></div>
{model_picker()}
{aspect_row()}
<label class="check-row"><input type="checkbox"> Enhance facial details</label>
<label class="check-row"><input type="checkbox"> Stabilize head motion</label>
<label class="check-row"><input type="checkbox"> HD upscale output</label>
{gen_btn("Generate Lip Sync Video")}
</div></form>
{history_block()}
""")

# ---------------- UGC ADS ----------------
add("tools/ugc-ads","UGC Ads Creator","User-generated-content style AI ads","app","/tools/ugc-ads", f"""
{page_header("UGC Ads Creator","Create user-generated content style ads with AI-powered characters")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Product Images <span class="text-muted">(max 10)</span></label>
<label class="dropzone">{ic("upload",24)}<span>Upload product images</span><input type="file" hidden multiple accept="image/*"></label></div>
<div class="form-group"><label class="form-label">AI Instructions</label>
<textarea class="form-textarea" rows="4" placeholder="Describe the ad style, script, and vibe..."></textarea></div>
<div class="form-group"><label class="form-label">Image Analyzer Model</label><select class="form-select"><option>Fast Image Analyzer</option></select></div>
{model_picker()}
{aspect_row()}
{gen_btn("Generate UGC Ad Video")}
</div></form>
{history_block()}
""")

# ---------------- TEXT TO SPEECH ----------------
VOICES = [("Aria","Female","US","en"),("Marcus","Male","US","en"),("Sofia","Female","UK","en"),("Liam","Male","UK","en"),
("Priya","Female","IN","hi"),("Arjun","Male","IN","hi"),("Camille","Female","FR","fr"),("Hugo","Male","FR","fr"),
("Lucia","Female","ES","es"),("Diego","Male","ES","es"),("Mei","Female","CN","zh"),("Kenji","Male","JP","ja"),
("Ava","Female","US","en"),("Noah","Male","US","en"),("Zara","Female","IN","en"),("Kabir","Male","IN","hi")]
voice_cards = "".join([f'''<div class="voice-card"><button class="voice-play">{ic("play",16)}</button>
<div><div class="font-semibold">{n}</div><div class="text-muted text-sm">{g} &middot; {c} &middot; {l}</div></div>
<button class="btn btn-ghost btn-sm">Use</button></div>''' for n,g,c,l in VOICES])

add("tools/text-to-speech","Text to Speech","Natural AI voices in 580+ styles","app","/tools/text-to-speech", f"""
{page_header("Text to Speech","Convert text to natural-sounding speech with 580+ voices")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Text <span class="text-muted">(0/100 characters used today)</span></label>
<textarea class="form-textarea" rows="5" placeholder="Type or paste your text here..."></textarea></div>
<div class="filter-row">
<div class="search-wrapper">{ic("search",18)}<input class="form-input search-input" placeholder="Search 322+ voices..."></div>
<select class="form-select" style="max-width:150px;"><option>All Languages</option><option>English</option><option>Hindi</option><option>French</option><option>Spanish</option></select>
<select class="form-select" style="max-width:130px;"><option>All Genders</option><option>Female</option><option>Male</option></select>
<select class="form-select" style="max-width:150px;"><option>All Countries</option><option>US</option><option>UK</option><option>IN</option></select>
</div>
<div class="voices-grid mt-3">{voice_cards}</div>
<button type="button" class="btn btn-secondary btn-block mt-3">Load More</button>
{gen_btn("Generate Audio")}
</div></form>
{history_block("Audio History")}
""")

# ---------------- MULTI CHARACTER TTS ----------------
add("tools/multi-character-tts","Multi Character Voice","Different voices per sentence","app","/tools/multi-character-tts", f"""
{page_header("Multi Character Voice","Assign different voices to each sentence for dialogues and narrations")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Paragraph Text</label>
<textarea class="form-textarea" rows="6" placeholder="Paste your paragraph here. Each sentence can get its own voice..."></textarea></div>
<button class="btn btn-secondary" disabled>Split into Sentences (0)</button>
{gen_btn("Generate Multi-Voice Audio")}
</div></form>
{history_block("Audio History")}
""")

# ---------------- VOICE HISTORY ----------------
add("tools/voice-history","Voice History","All your generated voiceovers","app","/tools/voice-history", f"""
{page_header("Voice History","Browse every voiceover you have generated")}
<div class="tab-row stagger-2"><button class="tab-btn active">All</button><button class="tab-btn">Single Voice</button><button class="tab-btn">Multi Character</button></div>
<div class="empty-state card stagger-3">{ic("mic",40)}<h3>No voiceovers yet</h3><p>Generate your first voiceover to see it here.</p></div>
""")

# ---------------- IMAGE TO PROMPT ----------------
add("tools/image-to-prompt","Image to Prompt","AI captions and prompts from images","app","/tools/image-to-prompt", f"""
{page_header("Image to Prompt","Upload an image and get an AI-generated caption or prompt")}
<form data-demo><div class="card stagger-2">
<div class="tab-row"><button type="button" class="tab-btn active">Single Image</button><button type="button" class="tab-btn">Bulk Images</button></div>
<div class="form-group"><label class="form-label">Image Analyzer Model</label><select class="form-select"><option>Fast Image Analyzer New</option><option>Fast Image Analyzer</option></select></div>
<div class="form-group"><label class="dropzone">{ic("upload",28)}<span>Drop an image here or click to browse</span><input type="file" hidden accept="image/*"></label></div>
{gen_btn("Get Prompt")}
</div></form>
{history_block()}
""")

# ---------------------------------------------------------------- part 4
# ---------------- YOUTUBE TOOLS ----------------
add("tools/youtube-niche-finder","Niche Finder","Analyze YouTube niches with AI","app","/tools/youtube-niche-finder", f"""
{page_header("Niche Finder","Analyze YouTube niches with demand, competition, and opportunity scores")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Keyword / Niche</label>
<input class="form-input" placeholder="e.g. AI history documentaries"></div>
{gen_btn("Analyze Niche")}
<p class="text-muted text-sm mt-2">Analyses used: <strong>0</strong> &middot; Resets every 24 hours</p>
</div></form>
""")

add("tools/youtube-seo-generator","SEO Metadata Generator","SEO titles, descriptions, tags & thumbnails","app","/tools/youtube-seo-generator", f"""
{page_header("SEO Metadata Generator","Generate SEO-optimized title, description, tags, and AI thumbnail")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Video Topic / Title</label>
<input class="form-input" placeholder="e.g. 10 Unsolved Mysteries of the Ocean"></div>
<label class="check-row"><input type="checkbox"> Generate AI Thumbnail</label>
{gen_btn("Generate SEO Metadata")}
</div></form>
""")

add("tools/tags-generator","Tags Generator","Optimized tags & hashtags for every platform","app","/tools/tags-generator", f"""
{page_header("Tags Generator","Generate optimized tags and hashtags for every platform")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Topic</label>
<input class="form-input" placeholder="e.g. morning routine"></div>
<div class="form-group"><label class="form-label">Platform</label>
<div class="chip-row"><button type="button" class="chip active">{ic("yt",14)} YouTube</button><button type="button" class="chip">Instagram</button><button type="button" class="chip">TikTok</button><button type="button" class="chip">Twitter</button><button type="button" class="chip">Facebook</button><button type="button" class="chip">LinkedIn</button><button type="button" class="chip">Pinterest</button></div></div>
{gen_btn("Generate Tags")}
</div></form>
""")

add("tools/channel-analyzer","Channel Analyzer","Extract winning patterns from any channel","app","/tools/channel-analyzer", f"""
{page_header("Channel Analyzer","Analyze competitor channels to extract content patterns")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Channel URL</label>
<input class="form-input" placeholder="https://youtube.com/@channel"></div>
{gen_btn("Analyze Channel")}
<p class="text-muted text-sm mt-2">Analyses used: <strong>0</strong> &middot; Resets every 24 hours</p>
</div></form>
""")

add("tools/video-breakdown","Video Breakdown","Structure & strategy of any YouTube video","app","/tools/video-breakdown", f"""
{page_header("Video Breakdown","Break down any YouTube video's structure and content strategy")}
<form data-demo><div class="card stagger-2">
<div class="form-group"><label class="form-label">Image Analyzer Model</label><select class="form-select"><option>Fast Image Analyzer</option></select></div>
<div class="form-group"><label class="form-label">Video URL</label>
<input class="form-input" placeholder="https://youtube.com/watch?v=..."></div>
{gen_btn("Analyze Video")}
</div></form>
""")

add("tools/video-master-prompt","Video Master Prompt","Master AI prompt from any video","app","/tools/video-master-prompt", f"""
{page_header("Video Master Prompt","Extract frames from any video and generate a master AI prompt")}
<div class="card stagger-2"><div class="card-header"><h3>How it works</h3></div>
<div class="steps-row">
<div class="step"><span class="wizard-num">1</span><p>Paste a YouTube URL or upload a video</p></div>
<div class="step"><span class="wizard-num">2</span><p>AI extracts key frames</p></div>
<div class="step"><span class="wizard-num">3</span><p>Frames are analyzed scene by scene</p></div>
<div class="step"><span class="wizard-num">4</span><p>Get a master prompt to recreate the style</p></div>
</div></div>
<form data-demo><div class="card stagger-3">
<div class="form-group"><label class="form-label">Image Analyzer Model</label><select class="form-select"><option>Fast Image Analyzer</option></select></div>
<div class="tab-row"><button type="button" class="tab-btn active">{ic("yt",14)} YouTube URL</button><button type="button" class="tab-btn">{ic("upload",14)} Upload Video</button></div>
<div class="form-group"><label class="form-label">Video URL / File</label>
<input class="form-input" placeholder="https://youtube.com/watch?v=..."></div>
<div class="form-group"><label class="form-label">Additional Notes</label>
<textarea class="form-textarea" rows="3" placeholder="Anything specific to focus on..."></textarea></div>
{gen_btn("Generate Master Prompt")}
</div></form>
""")

add("tools/youtube-history","YouTube Automation History","Every niche & SEO search in one place","app","/tools/youtube-history", f"""
{page_header("YouTube Automation History","0 total searches", '<div class="search-wrapper">'+ic("search",18)+'<input class="form-input search-input" placeholder="Search history..."></div><select class="form-select" style="max-width:180px;"><option>All Tools</option><option>Niche Finder</option><option>SEO Generator</option><option>Tags Generator</option><option>Channel Analyzer</option></select>')}
<div class="empty-state card stagger-2">{ic("yt",40)}<h3>No searches yet</h3><p>Your YouTube automation history will appear here.</p></div>
""")

# ---------------- API ----------------
add("api-keys","API Keys","Your API credentials and tokens","app","/api-keys", f"""
{page_header("API Keys","View your API credentials and authentication tokens")}
<div class="card stagger-2"><div class="card-header"><h3>API Token</h3><span class="api-auth-badge">JWT</span></div>
<div class="token-row"><code class="api-path">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</code>
<button class="btn btn-secondary btn-sm" data-copy="#tokFull">{ic("copy",16)} Copy</button>
<button class="btn btn-ghost btn-sm">{ic("refresh",16)} Regenerate</button></div>
<pre id="tokFull" style="display:none;">YOUR_JWT_TOKEN</pre>
<p class="form-hint">Keep this token secret. It grants full access to your account via the API.</p></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Base URL</h3></div>
<div class="token-row"><code class="api-path">https://veostudioai.com</code>
<button class="btn btn-secondary btn-sm" data-copy="#baseUrl">{ic("copy",16)} Copy</button></div>
<pre id="baseUrl" style="display:none;">https://veostudioai.com</pre></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Quick Start &mdash; cURL</h3></div>
<pre class="prompt-block">curl -X POST https://veostudioai.com/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{{"email":"you@example.com","password":"&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"}}'</pre></div>
""")

API_ROWS = [
 ("POST","/api/auth/login","Authenticate and get a JWT token","auth"),
 ("GET","/api/auth/me","Get the current user info","auth"),
 ("GET","/api/projects","List all projects","projects"),
 ("POST","/api/projects","Create a new video project","projects"),
 ("GET","/api/projects/:id","Get project details","projects"),
 ("GET","/api/voices","List available TTS voices","voices"),
 ("GET","/api/voices/languages","List available TTS languages","voices"),
 ("POST","/api/tools/tts/generate","Generate text-to-speech audio","tools"),
 ("POST","/api/tools/bulk-images/generate","Generate bulk images","tools"),
 ("POST","/api/tools/bulk-videos/start","Start bulk video generation","tools"),
 ("POST","/api/tools/first-last-video/start","Start first &amp; last frame video","tools"),
]
api_rows = "".join([f'''<div class="api-endpoint-row"><span class="api-method-badge m-{m.lower()}">{m}</span>
<code class="api-path">{p}</code><span class="api-desc">{d}</span></div>''' for m,p,d,_ in API_ROWS])

add("api-docs","API Docs","Endpoints and usage examples","app","/api-docs", f"""
{page_header("API Docs","Explore available API endpoints and usage examples")}
<div class="card stagger-2"><div class="card-header"><h3>Authentication</h3></div>
<p class="text-muted">All requests require a <code>Authorization: Bearer &lt;token&gt;</code> header. Get your token from <a href="../api-keys/index.html">API Keys</a>.</p></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Endpoints</h3></div>{api_rows}</div>
""")

# ---------------- TOOLS INDEX (verbatim captured content) ----------------
add("tools","AI Tools","AI-powered creative tools at your fingertips","app","/tools",
    '<div class="page-header stagger-1"><div><h1 class="page-title">Tools</h1><p class="page-subtitle">AI-powered creative tools at your fingertips</p></div></div>' +
    re.sub(r'<div class="page-header stagger-1"><div>.*?</div></div>', '', TOOLS_MAIN, count=1, flags=re.S))

# ---------------- ACCOUNTS / BILLING ----------------
add("my-accounts","My Accounts","Connect your own Google Flow accounts","app","/my-accounts", f"""
{page_header("My Accounts","Use your own Google Flow accounts for generation")}
<div class="empty-state card stagger-2">{ic("key",40)}<h3>Feature Not Activated</h3>
<p>Connect your own Google Flow accounts to unlock higher limits.</p>
<a class="btn btn-primary mt-2" href="https://wa.me/" target="_blank" rel="noopener">Contact Admin on WhatsApp</a></div>
""")

PLANS = [
 ("Free","Rs.0","/ day",True,["1 thread","2 min max video","1 scene / cycle","Daily reset"]),
 ("Starter","Rs.3,500","/ month",False,["Everything in Free","Higher daily limits","Priority queue"]),
 ("Basic","Rs.4,000","/ month",False,["Everything in Starter","More scenes per cycle","Bulk tools unlocked"]),
 ("Premium","Rs.5,000","/ month",False,["Everything in Basic","Long videos generator","API access"]),
 ("Ultra Premium","Rs.7,000","/ month",False,["Everything in Premium","Maximum limits","Dedicated support"]),
]
plan_cards = "".join([f'''<div class="plan-card{' plan-card-active' if a else ''} stagger-3">
{f'<span class="plan-card-badge">Current</span>' if a else ''}
<div class="plan-card-header"><h3>{n}</h3><div class="plan-price"><span class="plan-price-amount">{p}</span><span class="plan-price-period">{per}</span></div></div>
<div class="plan-card-body"><ul class="plan-features">{"".join([f'<li class="plan-feature-item">{ic("check",16)} {f_}</li>' for f_ in feats])}</ul>
<a class="btn {'btn-primary' if not a else 'btn-ghost'} btn-block mt-3" href="#">{"Current Plan" if a else "Contact to Upgrade"}</a></div></div>'''
 for n,p,per,a,feats in PLANS])

add("plans","Plans","Upgrade your VEO Studio plan","app","/plans", f"""
{page_header("Plans","Choose the plan that fits your creation goals")}
<div class="card stagger-2"><div class="dash-usage-3col">
<div class="dash-usage-card"><div class="dash-usage-count">Free</div><div class="dash-usage-title">Current Plan</div></div>
<div class="dash-usage-card"><div class="dash-usage-count">0</div><div class="dash-usage-title">Scenes Used Today</div></div>
<div class="dash-usage-card"><div class="dash-usage-count">0</div><div class="dash-usage-title">Days Left</div></div>
</div></div>
<div class="plans-grid mt-4">{plan_cards}</div>
<div class="card stagger-4 mt-4"><div class="card-header"><h3>{ic("crown",20)} Child Panel &mdash; White Label</h3></div>
<p class="text-muted">Launch your own branded AI studio. One-time payment of <strong>Rs 20,000</strong>.</p>
<a class="btn btn-primary mt-2" href="../child-panel/index.html">Learn More</a></div>
""")

add("offers","Offers","Redeem offer codes","app","/offers", f"""
{page_header("Offers","Redeem promotional offer codes")}
<div class="card stagger-2"><div class="card-header"><h3>Activate Offer</h3></div>
<form data-demo><div class="form-group"><label class="form-label">Offer Code</label>
<div class="flex gap-2"><input class="form-input" placeholder="Enter offer code"><button class="btn btn-primary" disabled>Activate</button></div></div></form></div>
<div class="empty-state card stagger-3 mt-4">{ic("gift",40)}<h3>No Offers Available</h3><p>Check back later for promotions.</p></div>
""")

add("billing","Billing & Payments","Subscription and payment history","app","/billing", f"""
{page_header("Billing &amp; Payments","Manage your subscription and invoices")}
<div class="card stagger-2"><div class="card-header"><h3>Subscription</h3><span class="badge badge-success">Free Plan Active</span></div>
<div class="dash-usage-3col">
<div class="dash-usage-card"><div class="dash-usage-count">Free</div><div class="dash-usage-title">Plan</div></div>
<div class="dash-usage-card"><div class="dash-usage-count text-sm">May 8, 2026 &ndash; Jun 7, 2026</div><div class="dash-usage-title">Current Period</div></div>
<div class="dash-usage-card"><button class="btn btn-primary">Submit Payment</button><div class="dash-usage-title mt-2">Upgrade manually</div></div>
</div></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Payment History</h3></div><div class="empty-state"><p>No payments yet</p></div></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Invoices</h3></div><div class="empty-state"><p>No invoices yet</p></div></div>
""")

add("child-panel","Child Panel","White-label reseller panel","app","/child-panel", f"""
{page_header("Child Panel","Launch your own white-label AI studio")}
<div class="card stagger-2" style="background:linear-gradient(120deg,#8B5CF6,#3B82F6);color:#fff;border:none;">
<h2 style="color:#fff;">Your Brand. Our Technology.</h2>
<p style="opacity:.92;">Get a fully white-labeled VEO Studio with your logo, domain, and pricing.</p>
<div class="plan-price"><span class="plan-price-amount" style="color:#fff;">Rs 20,000</span><span class="plan-price-period" style="color:#fff;opacity:.85;">one-time</span></div>
<button class="btn mt-3" style="background:#fff;color:#6D28D9;font-weight:700;">Get Your Child Panel</button></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>21 Included Tools</h3></div>
<p class="text-muted">Every AI tool in the main platform is included in your white-label panel &mdash; video generation, TTS, image tools, and the full YouTube automation suite.</p></div>
<div class="card stagger-3 mt-4"><div class="card-header"><h3>Frequently Asked Questions</h3></div>
<button class="accordion-btn" data-accordion>Do I need technical skills? {ic("chev",16)}</button><div class="accordion-body" style="display:none;"><p class="text-muted">No. We set everything up for you &mdash; branding, domain, and payments.</p></div>
<button class="accordion-btn" data-accordion>Can I set my own prices? {ic("chev",16)}</button><div class="accordion-body" style="display:none;"><p class="text-muted">Yes, you control your own plans and pricing completely.</p></div>
<button class="accordion-btn" data-accordion>Is support included? {ic("chev",16)}</button><div class="accordion-body" style="display:none;"><p class="text-muted">Yes, technical support for your panel is included.</p></div>
</div>
""")

add("affiliate","Affiliate Program","Earn 10% commission","app","/affiliate", f"""
{page_header("Affiliate Program","Earn 10% commission on every referral")}
<div class="card stagger-2" style="text-align:center;padding:40px;">
<div style="font-size:3rem;font-weight:800;background:linear-gradient(135deg,#8B5CF6,#3B82F6);-webkit-background-clip:text;background-clip:text;color:transparent;">10%</div>
<h3>Commission on every sale</h3><p class="text-muted">Requires an active paid plan to join.</p>
<button class="btn btn-primary mt-2" disabled>Join Requires Paid Plan</button></div>
<div class="grid grid-2 gap-4 mt-4">
<div class="card stagger-3"><div class="card-header"><h3>How It Works</h3></div>
<div class="steps-row"><div class="step"><span class="wizard-num">1</span><p>Get your referral link</p></div><div class="step"><span class="wizard-num">2</span><p>Share with creators</p></div><div class="step"><span class="wizard-num">3</span><p>Earn 10% commission</p></div></div></div>
<div class="card stagger-3"><div class="card-header"><h3>Why Join</h3></div>
<ul class="plan-features"><li class="plan-feature-item">{ic("check",16)} Recurring commissions</li><li class="plan-feature-item">{ic("check",16)} Real-time tracking dashboard</li><li class="plan-feature-item">{ic("check",16)} Monthly payouts</li></ul></div>
</div>
""")

# ---------------- SUPPORT ----------------
add("ai-chat","AI Chat","Your AI assistant","app","/ai-chat", f"""
{page_header("AI Chat","Chat with your AI assistant")}
<div class="chat-layout stagger-2">
<div class="chat-sidebar card"><div class="card-header"><h3>Recent Chats</h3></div><div class="empty-state"><p>No chats yet</p></div>
<div class="form-group mt-3"><label class="form-label">Mode</label><div class="chip-row"><button class="chip active">Creative</button><button class="chip">Professional</button><button class="chip">Friendly</button></div></div>
<label class="toggle-row"><span>Voice Replies</span><button type="button" class="theme-toggle" data-theme-toggle><span class="theme-toggle-thumb"></span></button></label>
<button class="btn btn-secondary btn-sm btn-block mt-2">{ic("book",16)} AI Settings</button></div>
<div class="chat-main card"><div class="chat-messages"><div class="chat-empty">{ic("msg",40)}<h3>Start a conversation</h3><p class="text-muted">Ask anything about the platform.</p>
<div class="chip-row" style="justify-content:center;"><button class="chip">Video ideas</button><button class="chip">Plan limits</button><button class="chip">API help</button></div></div></div>
<form data-demo class="chat-input"><input class="form-input" placeholder="Type a message... (50/50 messages left)"><button class="btn btn-primary">{ic("send",18)}</button></form></div>
</div>
""")

add("support","Support Tickets","Get help from the team","app","/support", f"""
{page_header("Support Tickets","We usually reply within 24 hours", '<button class="btn btn-primary">'+ic("plus",18)+' New Ticket</button>')}
<div class="tab-row stagger-2"><button class="tab-btn active">All</button><button class="tab-btn">Open</button><button class="tab-btn">In Progress</button><button class="tab-btn">Waiting</button><button class="tab-btn">Resolved</button><button class="tab-btn">Closed</button></div>
<div class="empty-state card stagger-3">{ic("help",40)}<h3>No tickets yet</h3><p>Open a ticket and our team will help you out.</p></div>
""")

HELP_FAQS = [
 ("Getting Started",["How do I create my first video?","What is the Free plan limit?","How do I upgrade?"]),
 ("Video Studio",["How does scene-by-scene generation work?","What is Frame Extender?"]),
 ("Bulk Videos & Templates",["How do bulk videos work?","How do I use a template?"]),
 ("TTS",["How many voices are available?","What is Multi Character Voice?"]),
 ("Image Tools",["How does Image to Prompt work?"]),
 ("YouTube Tools",["How does Niche Finder score opportunities?","What is the Master Prompt?"]),
 ("Tags Generator",["Which platforms are supported?"]),
 ("Character Hub & UGC Ads",["How do I keep characters consistent?"]),
 ("Master Prompt",["Can I upload my own video?"]),
 ("API Access",["How do I authenticate?","Where is my token?"]),
 ("Plans & Billing",["How do I pay?","Can I cancel anytime?"]),
 ("Affiliate",["How much commission do I earn?"]),
 ("Account & Settings",["How do I change my password?"]),
 ("Support & Tickets",["How fast is support?"]),
 ("Security & Privacy",["Is my data safe?"]),
]
help_acc = "".join([f'''<div class="card mb-2"><button class="accordion-btn" data-accordion><strong>{cat}</strong> {ic("chev",16)}</button>
<div class="accordion-body" style="display:none;">{"".join([f'<p class="faq-q">{q}</p>' for q in qs])}</div></div>''' for cat, qs in HELP_FAQS])

add("help","Help Center","Answers to common questions","app","/help", f"""
{page_header("Help Center","Find answers to common questions", '<div class="search-wrapper">'+ic("search",18)+'<input class="form-input search-input" placeholder="Search help articles..."></div>')}
<div class="stagger-2">{help_acc}</div>
""")

add("profile","Profile","Manage your account settings","app","/profile", f"""
{page_header("Profile","Manage your profile and security")}
<div class="grid grid-2 gap-4">
<div class="card stagger-2"><div class="card-header"><h3>Profile Information</h3></div>
<form data-demo>
<div class="form-group"><label class="form-label">Full Name</label><input class="form-input" value="milan"></div>
<div class="form-group"><label class="form-label">Email</label><input class="form-input" value="milanparmar9621@gmail.com" disabled></div>
<div class="grid grid-2 gap-3"><div class="form-group"><label class="form-label">Role</label><input class="form-input" value="User" disabled></div>
<div class="form-group"><label class="form-label">Member Since</label><input class="form-input" value="May 8, 2026" disabled></div></div>
<button class="btn btn-primary">Save Changes</button></form></div>
<div class="card stagger-3"><div class="card-header"><h3>Change Password</h3></div>
<form data-demo>
<div class="form-group"><label class="form-label">Current Password</label><input type="password" class="form-input"></div>
<div class="form-group"><label class="form-label">New Password</label><input type="password" class="form-input"></div>
<div class="form-group"><label class="form-label">Confirm New Password</label><input type="password" class="form-input"></div>
<button class="btn btn-primary">Change Password</button></form></div>
</div>
""")

# ---------------------------------------------------------------- part 5
# ---------------- LANDING ----------------
LANDING_TOOLS = [("Bulk Videos Generator","/tools/bulk-videos"),("First & Last Frame","/tools/first-last-video"),
 ("Text to Speech","/tools/text-to-speech"),("Niche Finder","/tools/youtube-niche-finder"),
 ("SEO Metadata Generator","/tools/youtube-seo-generator"),("Channel Analyzer","/tools/channel-analyzer")]
landing_tools = "".join([f'''<a class="tool-card-uniform" href=".{h}/index.html"><div class="tool-card-uniform-icon" style="background:rgba(139,92,246,.08);">{ic("zap",22)}</div>
<div class="tool-card-uniform-content"><h3 class="tool-card-uniform-name">{n}</h3><p class="tool-card-uniform-desc">AI-powered &mdash; included in every plan.</p></div>
<div class="tool-card-uniform-btn">{ic("eye",16)}<span>View</span></div></a>''' for n,h in LANDING_TOOLS])

add("","VEO Studio Ai","Your complete AI-powered YouTube studio","public","", f"""
<section class="hero stagger-1">
<div class="hero-badge">{ic("spark",14)} AI-Powered YouTube Studio</div>
<h1>Create Viral YouTube Videos<br>with <span class="grad-text">AI Automation</span></h1>
<p class="hero-sub">Generate long videos, bulk content, voiceovers, and SEO metadata &mdash; all from one dashboard.</p>
<div class="hero-cta"><a class="btn btn-primary btn-lg" href="./login/index.html">Get Started Free</a>
<a class="btn btn-secondary btn-lg" href="./about/index.html">Learn More</a></div>
<div class="hero-stats">
<div><strong>10k+</strong><span>Videos Created</span></div>
<div><strong>500+</strong><span>Creators</span></div>
<div><strong>18+</strong><span>AI Tools</span></div>
<div><strong>4.9</strong><span>Average Rating</span></div>
</div></section>

<section class="lp-section stagger-2"><h2>Features</h2><p class="text-muted">Everything you need to run a faceless YouTube channel.</p>
<div class="grid grid-3 gap-4 mt-3">
<div class="card"><h3>{ic("film",22)} Long Video Generator</h3><p class="text-muted">Scene-by-scene AI video creation with transitions and captions.</p></div>
<div class="card"><h3>{ic("zap",22)} Bulk Generation</h3><p class="text-muted">Produce dozens of videos from a single prompt in one run.</p></div>
<div class="card"><h3>{ic("mic",22)} 580+ AI Voices</h3><p class="text-muted">Natural text-to-speech with multi-character dialogue support.</p></div>
</div></section>

<section class="lp-section stagger-3"><h2>AI Tools</h2><p class="text-muted">A complete creative toolkit at your fingertips.</p>
<div class="tools-grid-uniform mt-3">{landing_tools}</div></section>

<section class="lp-section stagger-3"><h2>How It Works</h2>
<div class="steps-row">
<div class="step"><span class="wizard-num">1</span><p>Pick a tool or template</p></div>
<div class="step"><span class="wizard-num">2</span><p>Enter your topic or script</p></div>
<div class="step"><span class="wizard-num">3</span><p>AI generates your video</p></div>
<div class="step"><span class="wizard-num">4</span><p>Publish and grow</p></div>
</div></section>

<section class="lp-section stagger-4"><h2>Pricing</h2><p class="text-muted">Start free. Upgrade when you grow.</p>
<div class="plans-grid mt-3">
<div class="plan-card"><div class="plan-card-header"><h3>Free</h3><div class="plan-price"><span class="plan-price-amount">Rs.0</span><span class="plan-price-period">/ day</span></div></div>
<div class="plan-card-body"><a class="btn btn-primary btn-block" href="./login/index.html">Start Free</a></div></div>
<div class="plan-card"><div class="plan-card-header"><h3>Starter</h3><div class="plan-price"><span class="plan-price-amount">Rs.3,500</span><span class="plan-price-period">/ month</span></div></div>
<div class="plan-card-body"><a class="btn btn-secondary btn-block" href="./contact/index.html">Contact to Upgrade</a></div></div>
<div class="plan-card"><div class="plan-card-header"><h3>Ultra Premium</h3><div class="plan-price"><span class="plan-price-amount">Rs.7,000</span><span class="plan-price-period">/ month</span></div></div>
<div class="plan-card-body"><a class="btn btn-secondary btn-block" href="./contact/index.html">Contact to Upgrade</a></div></div>
</div></section>

<section class="lp-section stagger-4"><div class="card" style="background:linear-gradient(120deg,#8B5CF6,#3B82F6);color:#fff;border:none;text-align:center;padding:48px;">
<h2 style="color:#fff;">Want your own AI studio?</h2><p style="opacity:.92;">White-label Child Panel &mdash; Rs 20,000 one-time.</p>
<a class="btn mt-2" style="background:#fff;color:#6D28D9;font-weight:700;" href="./contact/index.html">Get White-Label</a></div></section>
""")

# ---------------- ABOUT ----------------
add("about","About Us","Empowering YouTube creators with AI automation","public","", """
<section class="lp-section stagger-1" style="text-align:center;"><p class="text-muted">About Us</p>
<h1>Empowering YouTube Creators with AI Automation</h1>
<p class="hero-sub">We believe every creator deserves access to powerful tools that simplify video production, enhance quality, and unlock growth.</p></section>
<section class="lp-section"><h2>Our Mission</h2><p class="text-muted">At VEO Studio Ai, our mission is to democratize video content creation. We harness the power of AI to turn ideas into publish-ready videos in minutes.</p>
<h2 class="mt-4">Our Team</h2><div class="card" style="max-width:420px;"><div class="team-avatar">ZA</div><h3>Zain Ali</h3><p class="text-muted">Founder &amp; Lead Developer</p><p class="text-muted text-sm">Zain Ali is the visionary behind VEO Studio Ai, with deep expertise in AI, cloud computing, and full-stack development.</p><a class="btn btn-secondary btn-sm mt-2" href="#">Connect on LinkedIn</a></div>
<h2 class="mt-4">Our Technology</h2><div class="grid grid-3 gap-4 mt-3">
<div class="card"><h3>AI-Powered Content</h3><p class="text-muted text-sm">Advanced AI models generate scripts, optimize SEO, create thumbnails, and analyze channels.</p></div>
<div class="card"><h3>Cloud Processing</h3><p class="text-muted text-sm">All heavy processing runs on scalable cloud infrastructure for fast, reliable rendering.</p></div>
<div class="card"><h3>580+ TTS Voices</h3><p class="text-muted text-sm">Choose from over 580 text-to-speech voices across multiple languages and styles, with multi-character dialogue support.</p></div>
</div>
<h2 class="mt-4">Our Vision</h2><p class="text-muted">We envision a future where anyone can create professional-grade YouTube content without expensive equipment or editing skills.</p>
<div class="mt-3"><a class="btn btn-primary btn-lg" href="../login/index.html">Get Started Today</a></div></section>
""")

# ---------------- CONTACT ----------------
add("contact","Contact Us","Get in touch with the VEO Studio team","public","", """
<section class="lp-section stagger-1" style="text-align:center;"><p class="text-muted">Get in Touch</p>
<h1>Contact Us</h1><p class="hero-sub">Have a question, suggestion, or need support? We'd love to hear from you.</p></section>
<section class="lp-section"><div class="grid grid-2 gap-4">
<div class="card"><div class="card-header"><h3>Send us a Message</h3></div><form data-demo>
<div class="form-group"><label class="form-label">Name</label><input class="form-input" placeholder="Your full name"></div>
<div class="form-group"><label class="form-label">Email</label><input class="form-input" placeholder="you@example.com"></div>
<div class="form-group"><label class="form-label">Subject</label><input class="form-input" placeholder="How can we help?"></div>
<div class="form-group"><label class="form-label">Message</label><textarea class="form-textarea" rows="4" placeholder="Tell us more about your inquiry..."></textarea></div>
<button class="btn btn-primary">Send Message</button></form></div>
<div><div class="card"><div class="card-header"><h3>Contact Information</h3></div>
<p><strong>Email Support</strong><br><a href="mailto:support@devzea.com">support@devzea.com</a></p>
<p><strong>WhatsApp Support</strong><br><a href="https://wa.me/" target="_blank" rel="noopener">Chat on WhatsApp</a></p>
<h3 class="mt-3">Connect With Us</h3><p><a href="#">Zain Ali on LinkedIn</a><br><a href="#">DevZea Website</a></p></div></div>
</div>
<h2 class="mt-4">Frequently Asked Questions</h2>
<button class="accordion-btn card mb-2" data-accordion>How do I get started with the platform?</button><div class="accordion-body card" style="display:none;"><p class="text-muted">Create a free account and pick any tool to generate your first video.</p></div>
<button class="accordion-btn card mb-2" data-accordion>What payment methods do you accept?</button><div class="accordion-body card" style="display:none;"><p class="text-muted">Contact us on WhatsApp for payment options in your region.</p></div>
<button class="accordion-btn card mb-2" data-accordion>Can I cancel my subscription anytime?</button><div class="accordion-body card" style="display:none;"><p class="text-muted">Yes, subscriptions can be cancelled anytime from the billing page.</p></div>
<button class="accordion-btn card mb-2" data-accordion>How many videos can I create per month?</button><div class="accordion-body card" style="display:none;"><p class="text-muted">Limits depend on your plan &mdash; see the Plans page for details.</p></div>
<button class="accordion-btn card mb-2" data-accordion>Do you offer support for custom integrations?</button><div class="accordion-body card" style="display:none;"><p class="text-muted">Yes &mdash; reach out via the contact form or WhatsApp.</p></div>
</section>
""")

def legal_page(title, sections):
    body = "".join([f'<h2>{h}</h2><p class="text-muted">{" ".join(["This section describes the " + h.lower() + " as published on veostudioai.com."]*1)} Replace with the full legal text from the live site when wiring the backend.</p>' for h in sections])
    return f'<section class="lp-section legal stagger-1"><p class="text-muted">Legal</p><h1>{title}</h1>{body}</section>'

add("terms","Terms & Conditions","Terms of service for VEO Studio Ai","public","",
    legal_page("Terms and Conditions",["1. Acceptance of Terms","2. Account Registration","3. User-Generated Data and Content License","4. User Responsibilities","5. Intellectual Property","6. Subscription and Payments","7. Service Limitations and Modifications","8. Termination","9. Limitation of Liability","10. Indemnification","11. Governing Law","12. Contact Information"]))
add("privacy","Privacy Policy","How VEO Studio Ai handles your data","public","",
    legal_page("Privacy Policy",["1. Information We Collect","2. How We Use Your Information","3. Data Sharing and Disclosure","4. Cookies and Tracking Technologies","5. Data Retention","6. User Rights","7. Data Security","8. Children's Privacy","9. International Data Transfers","10. Changes to This Privacy Policy","11. Contact Information"]))
add("refund-policy","Refund Policy","Refund terms for VEO Studio Ai","public","",
    '<section class="lp-section legal stagger-1"><p class="text-muted">Legal</p><h1>Refund Policy</h1><div class="error-box"><strong>ALL SALES ARE FINAL &mdash; NO REFUNDS</strong></div>' +
    "".join([f'<h2>{h}</h2><p class="text-muted">This section describes the {h.lower()} as published on veostudioai.com.</p>' for h in ["1. No Refund Policy","2. Digital Services Are Non-Refundable","3. Subscription Cancellation","4. Free Trial","5. Exceptions","6. Chargebacks","7. Contact for Billing Issues"]]) + '</section>')

# ---------------- LOGIN ----------------
add("login","Login","Sign in to your VEO Studio account","auth","", """
<h1 class="auth-title">Sign in to your account</h1>
<p class="auth-subtitle">Welcome back! Please enter your details.</p>
<form data-demo>
<div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" placeholder="you@example.com" value="milanparmar9621@gmail.com"></div>
<div class="form-group"><label class="form-label">Password</label><input type="password" class="form-input" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"></div>
<button class="btn btn-primary btn-lg btn-block">Sign In</button>
</form>
<p class="auth-footer">Don&rsquo;t have an account? <a href="#">Sign up</a></p>
<p class="text-muted text-sm" style="text-align:center;">Demo build &mdash; sign-in is stubbed.</p>
""")

# ---------------- VIDEO EDITOR (separate app) ----------------
add("editor","Video Editor","Browser-based video editor","public","", f"""
<section class="hero stagger-1"><div class="hero-badge">{ic("film",14)} VEO Video Editor</div>
<h1>Edit Videos <span class="grad-text">Right in Your Browser</span></h1>
<p class="hero-sub">A separate, browser-local editor. Your projects are saved in this browser.</p>
<div class="hero-cta"><a class="btn btn-primary btn-lg" href="./projects/index.html">Open My Projects</a></div></section>
<section class="lp-section"><div class="grid grid-3 gap-4">
<div class="card"><h3>Dashboard</h3><p class="text-muted">Jump back into your recent edits.</p></div>
<div class="card"><h3>Tools</h3><p class="text-muted">Trim, captions, transitions, and more.</p></div>
<div class="card"><h3>Pricing</h3><p class="text-muted">The editor is included with your plan.</p></div>
</div></section>
""")
add("editor/projects","Editor Projects","Your browser-local editor projects","public","", """
<section class="lp-section stagger-1">
<div class="page-header"><div><h1 class="page-title">My Editor Projects</h1><p class="page-subtitle">Saved in this browser</p></div>
<div class="page-actions"><button class="btn btn-primary">New Project</button></div></div>
<div class="filter-row"><div class="search-wrapper">"""+"""<input class="form-input search-input" placeholder="Search projects..."></div>
<select class="form-select" style="max-width:150px;"><option>Newest first</option><option>Oldest first</option><option>Name A&ndash;Z</option></select></div>
<div class="empty-state card"><h3>No projects yet</h3><p>Editor projects are saved locally in this browser.</p><button class="btn btn-primary mt-2">New Project</button></div>
</section>
""")

if __name__ == "__main__":
    write_all()
