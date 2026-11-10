import "./assets/modulepreload-polyfill-COaX8i6R.js";
const btn = document.getElementById("copy-prompt");
const promptText = document.getElementById("prompt-text");
const original = btn.innerHTML;
const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="copy-btn-label">Copied</span>';
btn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(promptText.textContent.trim());
  btn.classList.add("copied");
  btn.innerHTML = checkIcon;
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.innerHTML = original;
  }, 1500);
});
