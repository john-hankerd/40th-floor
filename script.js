document.getElementById("year").textContent = new Date().getFullYear();

const modal = document.getElementById("waitlist-modal");
const modalTitle = document.getElementById("modal-title");
const modalSub = document.getElementById("modal-sub");
const appField = document.getElementById("waitlist-app");
const form = document.getElementById("waitlist-form");
const statusEl = document.getElementById("form-status");
const submitBtn = document.getElementById("waitlist-submit");

function openModal(appName) {
  appField.value = appName;
  modalTitle.textContent = `Get notified — ${appName}`;
  modalSub.textContent = "We'll email you the moment this app is ready.";
  statusEl.textContent = "";
  statusEl.className = "form-status";
  form.reset();
  appField.value = appName;
  modal.classList.add("open");
}

function closeModal() {
  modal.classList.remove("open");
}

document.querySelectorAll(".app-cta[data-app]").forEach((btn) => {
  btn.addEventListener("click", () => openModal(btn.dataset.app));
});

document.getElementById("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  statusEl.className = "form-status";
  statusEl.textContent = "Sending...";

  try {
    const res = await fetch("/.netlify/functions/waitlist-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: appField.value,
        email: document.getElementById("waitlist-email").value,
      }),
    });

    if (!res.ok) throw new Error("request failed");

    statusEl.textContent = "You're on the list — we'll be in touch.";
    statusEl.className = "form-status success";
    setTimeout(closeModal, 1800);
  } catch (err) {
    statusEl.textContent = "Something went wrong. Please try again.";
    statusEl.className = "form-status error";
  } finally {
    submitBtn.disabled = false;
  }
});
