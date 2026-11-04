"""Builds a single-file demo page from web/ (dist/rahoitusvahti-demo.html)."""
import json, os, re, sys
root = os.path.join(os.path.dirname(__file__), "..", "web")
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "..", "dist", "rahoitusvahti-demo.html")
r = lambda f: open(os.path.join(root, f), encoding="utf-8").read()
data = json.loads(r("demo-data.json"))
network = json.loads(r("demo-network.json"))
strip = lambda t: re.sub(r"^export ", "", re.sub(r"^import .*?;\n", "", t, flags=re.M), flags=re.M)
prompt_js = strip(r("idea-prompt.js"))
portfolio_js = strip(r("portfolio.js"))
data_js = strip(r("data.js"))
app_js = strip(r("app.js"))
page = f"""<title>Rahoitusvahti</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400..800;1,400..600&display=swap" rel="stylesheet">
<style>
{r("styles.css")}
</style>
<div id="app" aria-live="polite"></div>
<div id="drawer-root"></div>
<div id="modal-root"></div>
<div id="confirm-root"></div>
<div id="toast" role="status"></div>
<script>
window.RV_CONFIG = {{ firebase: null, appName: "Rahoitusvahti", orgName: "NERC · Turku UAS", noDownloads: true }};
window.RV_DEMO_DATA = {json.dumps(data, ensure_ascii=False).replace("</", "<\\/")};
window.RV_DEMO_NETWORK = {json.dumps(network, ensure_ascii=False).replace("</", "<\\/")};
</script>
<script type="module">
{prompt_js}
{portfolio_js}
{data_js}
{app_js}
</script>
"""
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write(page)
print(out, len(page) // 1024, "kB")
