// ==========================
// Firestore
// ==========================
const db = window.db;

// ==========================
// Anti-spam settings
// ==========================
const COOLDOWN_SECONDS = 30;
const LS_LAST_SUPPORT = "herway_last_support_at";
const LS_LAST_PREINSC = "herway_last_preinsc_at";

// ==========================
// Scroll bouton "S'inscrire"
// ==========================
function scrollToPreinscription() {
  const section = document.getElementById("preinscription");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.scrollToPreinscription = scrollToPreinscription;

// ==========================
// Toast
// ==========================
let toastEl = null;
let toastTimer = null;

function ensureToast() {
  if (toastEl) return;

  toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.innerHTML = `
    <div class="toast-icon" aria-hidden="true">✅</div>
    <div class="toast-body">
      <p class="toast-title">OK</p>
      <p class="toast-text">Message</p>
    </div>
    <button class="toast-close" type="button" aria-label="Fermer">×</button>
  `;
  document.body.appendChild(toastEl);

  toastEl.querySelector(".toast-close").addEventListener("click", hideToast);
}

function showToast({ title = "C'est bon !", text = "", icon = "✅" }) {
  ensureToast();
  toastEl.querySelector(".toast-title").textContent = title;
  toastEl.querySelector(".toast-text").textContent = text;
  toastEl.querySelector(".toast-icon").textContent = icon;

  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideToast(), 3500);
}

function hideToast() {
  if (!toastEl) return;
  toastEl.classList.remove("show");
}

// ==========================
// UI: compteur supports
// ==========================
function renderCounter(value) {
  const counter = document.getElementById("signatureCounter");
  if (!counter) return;

  const digits = String(Number(value || 0)).split("");
  counter.innerHTML = digits.map((d) => `<span class="digit">${d}</span>`).join("");
}

function popCounter() {
  const counter = document.getElementById("signatureCounter");
  if (!counter) return;

  counter.classList.add("pop");
  setTimeout(() => counter.classList.remove("pop"), 180);
}

// ==========================
// Temps réel : écoute stats/global (SECURE)
// ==========================
let statsUnsubscribe = null;
let lastCount = null;

function startSupportCountLiveCounter() {
  if (statsUnsubscribe) statsUnsubscribe();

  statsUnsubscribe = db.collection("stats").doc("global").onSnapshot(
    (doc) => {
      if (!doc.exists) {
        console.warn("⚠️ stats/global introuvable. Crée-le: supportCount=0, preinscriptionCount=0");
        renderCounter(0);
        return;
      }

      const data = doc.data() || {};
      const count = Number(data.supportCount || 0);

      renderCounter(count);
      if (lastCount !== null && count > lastCount) popCounter();
      lastCount = count;
    },
    (error) => {
      console.error("Erreur listener stats/global :", error);
    }
  );
}

// ==========================
// Helpers anti-spam
// ==========================
function nowMs() {
  return Date.now();
}

function getRemainingSeconds(lsKey) {
  const last = Number(localStorage.getItem(lsKey) || 0);
  const elapsed = nowMs() - last;
  const remainingMs = COOLDOWN_SECONDS * 1000 - elapsed;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function setJustSent(lsKey) {
  localStorage.setItem(lsKey, String(nowMs()));
}

function isHoneypotFilled(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return false;
  return el.value && el.value.trim().length > 0;
}

// ==========================
// Validation simple
// ==========================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function normalizePhone(phone) {
  const p = phone.trim();
  if (!p) return "";
  return p.replace(/[^\d+]/g, "");
}

function isValidPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return true;
  return p.length >= 9 && p.length <= 16;
}

// ==========================
// Firestore writes
// ==========================
async function incrementStat(fieldName) {
  // IMPORTANT : nécessite une règle qui autorise update uniquement sur stats/global
  await db.collection("stats").doc("global").update({
    [fieldName]: firebase.firestore.FieldValue.increment(1),
  });
}

async function savePreinscription(name, email, phone) {
  await db.collection("preinscriptions").add({
    name,
    email,
    phone: phone || null,
    city: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    source: "landing",
  });

  // Compteur préinscriptions (optionnel)
  await incrementStat("preinscriptionCount");
}

async function saveSupport(city) {
  await db.collection("supports").add({
    city: city || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    source: "landing",
  });

  // ✅ Compteur soutiens sécurisé
  await incrementStat("supportCount");
}

// ==========================
// Helpers UI bouton
// ==========================
function setBtnLoading(button, isLoading, loadingText = null) {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalText = button.textContent;
    if (loadingText) button.textContent = loadingText;
    button.classList.add("btn-loading");
    button.disabled = true;
  } else {
    button.classList.remove("btn-loading");
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

// ==========================
// Init
// ==========================
document.addEventListener("DOMContentLoaded", async () => {
  // ✅ Live counter sécurisé
  startSupportCountLiveCounter();

  // --------------------------
  // Préinscription form
  // --------------------------
  const supportForm = document.getElementById("supportForm");
  if (supportForm) {
    supportForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (isHoneypotFilled("hp_preinsc")) {
        showToast({
          title: "Préinscription enregistrée",
          text: "Merci ! On te préviendra dès que HerWay sortira.",
          icon: "🎉",
        });
        supportForm.reset();
        return;
      }

      const remaining = getRemainingSeconds(LS_LAST_PREINSC);
      if (remaining > 0) {
        showToast({
          title: "Doucement 🙂",
          text: `Tu peux réessayer dans ${remaining}s.`,
          icon: "⏳",
        });
        return;
      }

      const submitBtn = supportForm.querySelector('button[type="submit"]');
      const name = document.getElementById("name").value.trim();
      const email = document.getElementById("email").value.trim();
      const phoneRaw = document.getElementById("phone").value.trim();
      const phone = normalizePhone(phoneRaw);

      if (!name) {
        showToast({ title: "Nom manquant", text: "Indique ton nom pour valider.", icon: "⚠️" });
        return;
      }
      if (!isValidEmail(email)) {
        showToast({ title: "Email invalide", text: "Vérifie l’adresse e-mail.", icon: "⚠️" });
        return;
      }
      if (!isValidPhone(phoneRaw)) {
        showToast({ title: "Téléphone invalide", text: "Format incorrect (facultatif).", icon: "⚠️" });
        return;
      }

      try {
        setBtnLoading(submitBtn, true, "Envoi...");
        await savePreinscription(name, email, phone);

        setJustSent(LS_LAST_PREINSC);

        showToast({
          title: "Préinscription enregistrée",
          text: "Merci ! On te préviendra dès que HerWay sortira.",
          icon: "🎉",
        });

        supportForm.reset();
      } catch (err) {
        console.error(err);
        showToast({
          title: "Oups…",
          text: "Impossible d’enregistrer pour le moment. Réessaie.",
          icon: "⚠️",
        });
      } finally {
        setBtnLoading(submitBtn, false);
      }
    });
  }

  // --------------------------
  // Support form
  // --------------------------
  const petitionForm = document.getElementById("petitionForm");
  if (petitionForm) {
    petitionForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (isHoneypotFilled("hp_support")) {
        showToast({
          title: "Soutien enregistré",
          text: "Merci pour ton soutien 💪",
          icon: "💗",
        });
        petitionForm.reset();
        return;
      }

      const remaining = getRemainingSeconds(LS_LAST_SUPPORT);
      if (remaining > 0) {
        showToast({
          title: "Doucement 🙂",
          text: `Tu peux re-signer dans ${remaining}s.`,
          icon: "⏳",
        });
        return;
      }

      const submitBtn = petitionForm.querySelector('button[type="submit"]');
      const city = document.getElementById("petitionCity").value.trim();

      try {
        setBtnLoading(submitBtn, true, "Envoi...");
        await saveSupport(city);

        setJustSent(LS_LAST_SUPPORT);

        showToast({
          title: "Soutien enregistré",
          text: city ? `Merci pour ton soutien depuis ${city} 💪` : "Merci pour ton soutien 💪",
          icon: "💗",
        });

        petitionForm.reset();
      } catch (err) {
        console.error(err);
        showToast({
          title: "Oups…",
          text: "Impossible d’enregistrer le soutien. Réessaie.",
          icon: "⚠️",
        });
      } finally {
        setBtnLoading(submitBtn, false);
      }
    });
  }
});
