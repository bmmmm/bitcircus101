// cookie-banner.js – Cookie banner logic for donations page
(function () {
  "use strict";

  function showDonationContent() {
    var container = document.getElementById("donation-content");
    if (container) {
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.alignItems = "center";
    }
    hideBanner();
  }

  function hideBanner() {
    var siteNotice = document.getElementById("site-notice");
    if (siteNotice) siteNotice.style.display = "none";
    document.body.classList.remove("cookie-banner-shown");
  }

  function showDeclineMessage() {
    var declineMessage = document.getElementById("decline-message");
    var donationContent = document.getElementById("donation-content");
    if (declineMessage) declineMessage.style.display = "block";
    if (donationContent) donationContent.style.display = "none";
    hideBanner();
  }

  // Global functions for button clicks
  window.acceptCookies = function () {
    localStorage.setItem("bitcircus-cookie-consent", "accepted");
    showDonationContent();
  };

  window.declineCookies = function () {
    showDeclineMessage();
  };

  // Initialize on page load
  document.addEventListener("DOMContentLoaded", function () {
    var siteNotice = document.getElementById("site-notice");

    // Only run cookie banner logic if site notice exists (donations page)
    if (!siteNotice) return;

    if (localStorage.getItem("bitcircus-cookie-consent") === "accepted") {
      showDonationContent();
    } else {
      // Show banner and add body padding
      document.body.classList.add("cookie-banner-shown");
    }
  });
})();
