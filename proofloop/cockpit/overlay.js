(function () {
  if (window.__proximittyProofLoopCockpit) return;
  const root = document.createElement("aside");
  root.id = "proximitty-proofloop-cockpit";
  root.setAttribute("aria-label", "Proof Loop cockpit");
  root.innerHTML = [
    "<strong>Proof Loop</strong>",
    "<span data-proofloop-field='suite'>proximitty-underwriting-pr0</span>",
    "<span data-proofloop-field='status'>waiting</span>"
  ].join("");
  document.documentElement.appendChild(root);
  window.__proximittyProofLoopCockpit = {
    update(fields) {
      for (const [key, value] of Object.entries(fields || {})) {
        const node = root.querySelector(`[data-proofloop-field='${key}']`);
        if (node) node.textContent = String(value);
      }
    }
  };
})();
