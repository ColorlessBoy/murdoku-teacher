import "./assets/modulepreload-polyfill-COaX8i6R.js";
const tabId = Number(new URLSearchParams(location.search).get("tabId"));
const statusText = document.getElementById("status");
const shareButton = document.getElementById("share");
const cancelButton = document.getElementById("cancel");
cancelButton.addEventListener("click", () => {
  window.close();
});
shareButton.addEventListener("click", async () => {
  shareButton.disabled = true;
  statusText.classList.remove("error");
  statusText.textContent = "Starting…";
  const result = await chrome.runtime.sendMessage({ action: "remoteControlStart", tabId }).catch((error) => {
    return { success: false, error: error.message };
  });
  if (result?.success) {
    statusText.textContent = "Copied prompt. Paste it to your agent.";
    window.setTimeout(() => {
      window.close();
    }, 1500);
    return;
  }
  statusText.classList.add("error");
  statusText.textContent = `Remote control failed: ${result?.error || "unknown error"}`;
  shareButton.disabled = false;
});
