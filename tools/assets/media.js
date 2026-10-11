// Injected into every decrypted page. Decrypts <video data-enc-src> clips on demand, and wires the Lock button.
(() => {
  const STORE = "dfc-film-key";
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const stored = () => { try { return sessionStorage.getItem(STORE) || localStorage.getItem(STORE); } catch { return null; } };

  document.querySelectorAll("[data-lock]").forEach(b => b.addEventListener("click", () => {
    try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch { /* nothing stored */ }
    location.reload();
  }));

  // Links in the source point at real paths (games/<slug>/play-by-play.html); the published
  // files have opaque flat names. Map each link through the routes the build injected.
  const ROUTES = window.DFC_ROUTES || {};
  const SELF = window.DFC_SELF || "index.html";
  const route = ref => {
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return null;
    const url = new URL(ref, "https://site.invalid/" + SELF);
    const name = ROUTES[decodeURIComponent(url.pathname.slice(1))];
    return name ? name + url.hash : null;
  };
  document.querySelectorAll("a[href]").forEach(a => {
    const to = route(a.getAttribute("href"));
    if (to) a.setAttribute("href", to);
  });

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
      const res = await fetch(route(video.dataset.encSrc) || video.dataset.encSrc);
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
