(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function showMessage(message, type = "error") {
    let box = byId("loginMessage");

    if (!box) {
      box = document.createElement("div");
      box.id = "loginMessage";
      box.style.marginTop = "14px";
      box.style.padding = "12px";
      box.style.borderRadius = "12px";
      box.style.fontWeight = "800";
      box.style.fontSize = "13px";
      document.querySelector("form")?.appendChild(box);
    }

    box.textContent = message;
    box.style.background = type === "ok" ? "#ecfdf5" : "#fef2f2";
    box.style.color = type === "ok" ? "#166534" : "#991b1b";
    box.style.border = type === "ok" ? "1px solid #bbf7d0" : "1px solid #fecaca";
  }

  async function handleLogin(event) {
    event.preventDefault();
    event.stopPropagation();

    const email =
      byId("email")?.value ||
      byId("loginEmail")?.value ||
      document.querySelector('input[type="email"]')?.value;

    const password =
      byId("password")?.value ||
      byId("loginPassword")?.value ||
      document.querySelector('input[type="password"]')?.value;

    if (!email || !password) {
      showMessage("Enter your email and password.");
      return false;
    }

    if (typeof sb !== "function") {
      showMessage("Supabase helper sb() is not loaded.");
      return false;
    }

    const client = sb();

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) {
      showMessage(error.message || "Login failed.");
      return false;
    }

    if (!data?.session) {
      showMessage("Login failed: no session returned.");
      return false;
    }

    showMessage("Login successful. Redirecting...", "ok");

    window.location.assign("/operations-control-center.html");

    return false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form =
      byId("loginForm") ||
      document.querySelector("form");

    if (!form) {
      showMessage("Login form not found.");
      return;
    }

    form.setAttribute("novalidate", "novalidate");
    form.addEventListener("submit", handleLogin);

    const button =
      byId("loginButton") ||
      form.querySelector('button[type="submit"]') ||
      form.querySelector("button");

    if (button) {
      button.addEventListener("click", handleLogin);
    }
  });
})();