// cookie-banner.js – General cookie consent utility
(function () {
  "use strict";

  // Check if we're on the donations page - if so, don't run this script
  // as donations.html handles its own cookie banner
  if (window.location.pathname.includes("donations.html")) {
    return;
  }

  // Utility function to check cookie consent status
  window.checkCookieConsent = function () {
    return localStorage.getItem("bitcircus-cookie-consent") === "accepted";
  };

  // Utility function to set cookie consent
  window.setCookieConsent = function (accepted) {
    if (accepted) {
      localStorage.setItem("bitcircus-cookie-consent", "accepted");
    } else {
      localStorage.removeItem("bitcircus-cookie-consent");
    }
  };

  // Initialize consent check on page load for non-donations pages
  document.addEventListener("DOMContentLoaded", function () {
    // This script is now just a utility - specific pages can implement
    // their own cookie banner logic if needed
  });
})();
