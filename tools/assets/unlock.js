// Password gate: derive the key, decrypt this page's payload, replace the gate with the page.
// The derived key (not the password) is kept for the tab, or on the device if "Keep me signed in" is ticked.
(() => {
  const STORE = "dfc-film-key";
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u => btoa(String.fromCharCode(...u));
  const kdf = JSON.parse(document.getElementById("kdf").textContent);
  const payload = b64(document.getElementById("payload").textContent.trim());

  const saved = () => { try { return sessionStorage.getItem(STORE) || localStorage.getItem(STORE); } catch { return null; } };
  const save = (raw, remember) => {
    try { sessionStorage.setItem(STORE, raw); if (remember) localStorage.setItem(STORE, raw); } catch { /* storage blocked: ask again next page */ }
  };
  const forget = () => { try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch { /* nothing stored */ } };

  async function derive(pw) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(kdf.salt), iterations: kdf.iterations }, base, 256);
    return new Uint8Array(bits);
  }
  async function open(raw) {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.slice(0, 12) }, key, payload.slice(12));
    return new TextDecoder().decode(plain);
  }
  function show(html) { document.open(); document.write(html); document.close(); }

  const gate = document.getElementById("gate");
  const form = document.getElementById("unlock");
  const msg = document.getElementById("msg");
  const go = document.getElementById("go");

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    go.disabled = true; msg.textContent = "Checking…";
    try {
      const raw = await derive(document.getElementById("pw").value);
      const html = await open(raw);
      save(toB64(raw), document.getElementById("remember").checked);
      show(html);
    } catch {
      msg.textContent = "That password didn't work. Check it with your coach and try again.";
      go.disabled = false;
    }
  });

  const stored = saved();
  if (stored) {
    open(b64(stored)).then(show, () => { forget(); gate.hidden = false; });
  } else {
    gate.hidden = false;
  }
})();
