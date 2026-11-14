// Popcorn Sort: lets phones install the game to the home screen.
// It does not cache anything, so players always get the newest version.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function () {});
