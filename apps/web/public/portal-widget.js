/*! LexOS client-portal button. Usage:
 *  <script src="https://lexos-ai-digitalvertises-projects.vercel.app/portal-widget.js" data-portal="your-firm" defer></script>
 *  Optional: data-label="Client portal" data-color="#1d3a5f" data-position="left|right"
 */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var slug = (s.getAttribute("data-portal") || "").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug)) return;
  var origin = new URL(s.src).origin;
  var color = /^#[0-9a-fA-F]{6}$/.test(s.getAttribute("data-color") || "") ? s.getAttribute("data-color") : "#1d3a5f";
  var side = s.getAttribute("data-position") === "left" ? "left" : "right";
  var a = document.createElement("a");
  a.href = origin + "/portal/" + slug;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = s.getAttribute("data-label") || "Client portal";
  a.setAttribute("aria-label", a.textContent + " (opens in a new tab)");
  a.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;padding:12px 18px;border-radius:999px;" +
    "background:" + color + ";color:#fff;font:600 14px/1 system-ui,-apple-system,sans-serif;text-decoration:none;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.18)";
  function add() { document.body.appendChild(a); }
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
})();
