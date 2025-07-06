// cookie-banner.js – Einheitliche Cookie-Banner-Logik für alle Seiten
function showDonationContent() {
    var container = document.getElementById('donation-content');
    if (container) container.style.display = 'flex';
    var siteNotice = document.getElementById('site-notice');
    if (siteNotice) siteNotice.style.display = 'none';
}
function acceptCookies() {
    localStorage.setItem('bitcircus-cookie-consent', 'accepted');
    showDonationContent();
    var siteNotice = document.getElementById('site-notice');
    if (siteNotice) siteNotice.style.display = 'none';
}
function declineCookies() {
    var declineMessage = document.getElementById('decline-message');
    var donationContent = document.getElementById('donation-content');
    if (declineMessage) declineMessage.style.display = 'block';
    if (donationContent) donationContent.style.display = 'none';
    var siteNotice = document.getElementById('site-notice');
    if (siteNotice) siteNotice.style.display = 'none';
}
document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('bitcircus-cookie-consent') === 'accepted') {
        showDonationContent();
    }
});
