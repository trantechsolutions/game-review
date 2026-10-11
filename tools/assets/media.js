// Injected into every decrypted page. Decrypts <video data-enc-src> clips on demand, and wires the Lock button.
(() => {
  const STORE = "dfc-film-key";
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const stored = () => { try { return sessionStorage.getItem(STORE) || localStorage.getItem(STORE); } catch { return null; } };

  document.querySelectorAll("[data-lock]").forEach(b => b.addEventListener("click", () => {
    try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch { /* nothing stored */ }
    location.reload();
  }));

  let keyPromise;
  const key = () => keyPromise ??= (async () => {
    const raw = stored();
    if (!raw) throw new Error("signed out");
    return crypto.subtle.importKey("raw", b64(raw), "AES-GCM", false, ["decrypt"]);
  })();

  async function load(video, button) {
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const res = await fetch(video.dataset.encSrc + ".enc");
      if (!res.ok) throw new Error(res.status);
      const data = new Uint8Array(await res.arrayBuffer());
      button.textContent = "Decrypting…";
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, await key(), data.slice(12));
      video.src = URL.createObjectURL(new Blob([plain], { type: "video/mp4" }));
      button.remove();
      video.play().catch(() => { /* autoplay refused: controls are there */ });
    } catch {
      button.disabled = false;
      button.textContent = "Couldn't load. Tap to retry";
    }
  }

  document.querySelectorAll("video[data-enc-src]").forEach(video => {
    const button = video.parentElement.querySelector("[data-load]");
    if (button) button.addEventListener("click", () => load(video, button));
  });
})();
