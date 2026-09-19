'use strict';

const KateClient = {
  userAgent: 'KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown Android SDK built for x86; ru)',
  clientID: '2685278',
  version: '5.131'
};

const MusicClient = {
  appID: '6287487',
  version: '5.282',
  // Заполняется при старте из UA самого Chromium, чтобы вход и запросы к API шли с одним и тем же браузерным отпечатком.
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
};

const PARTITION = 'persist:vk';

function setBrowserUserAgent(raw) {
  MusicClient.userAgent = raw
    .replace(/\sElectron\/\S+/i, '')
    .replace(/\sfenura\/\S+/i, '')
    .trim();
}

module.exports = { KateClient, MusicClient, PARTITION, setBrowserUserAgent };
