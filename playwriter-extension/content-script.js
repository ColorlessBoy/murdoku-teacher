function installPlaywriterContentScript() {
  if (window.__playwriterContentScript) {
    return;
  }
  window.__playwriterContentScript = true;
  window.__playwriterContextTarget = null;
  document.addEventListener(
    "contextmenu",
    (e) => {
      const target = e.composedPath()[0];
      window.__playwriterContextTarget = target instanceof Element ? target : null;
    },
    true
  );
  let toastTimer;
  let toastHost = null;
  window.__playwriterShowToast = (message) => {
    toastHost?.remove();
    window.clearTimeout(toastTimer);
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = [
      "background:#393B44",
      "border:1px solid rgba(255,255,255,0.1)",
      "border-radius:9999px",
      "padding:6px 14px",
      "color:#e4e4e7",
      'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      "box-shadow:0 12px 60px rgba(0,0,0,0.6),0 4px 20px rgba(0,0,0,0.4)",
      "white-space:nowrap"
    ].join(";");
    toast.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);
    toastHost = host;
    toastTimer = window.setTimeout(() => {
      host.remove();
    }, 1900);
  };
}
installPlaywriterContentScript();
