'use strict';

const { MusicClient } = require('./constants');

// Плейлисты HLS и ключи шифрования лежат на CDN ВКонтакте. Странице приложения нужны те же
// заголовки, что отправлял AVPlayer в macOS-версии, и разрешение CORS от самого CDN нет.
const AUDIO_HOSTS = [
  '*://*.vkuseraudio.net/*',
  '*://*.vkuseraudio.com/*',
  '*://*.vk-cdn.net/*',
  '*://*.vk.me/*',
  '*://*.userapi.com/*'
];

function installAudioHeaders(ses, getCookieHeader) {
  const filter = { urls: AUDIO_HOSTS };

  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = details.requestHeaders;
    headers['User-Agent'] = MusicClient.userAgent;
    headers.Referer = 'https://vk.ru/';
    headers.Origin = 'https://vk.ru';
    if (details.resourceType !== 'image') {
      const cookies = getCookieHeader();
      if (cookies) headers.Cookie = cookies;
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = {};
    for (const [name, value] of Object.entries(details.responseHeaders || {})) {
      if (!name.toLowerCase().startsWith('access-control-')) headers[name] = value;
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
    const result = { responseHeaders: headers };
    if (details.method === 'OPTIONS') result.statusLine = 'HTTP/1.1 204 No Content';
    callback(result);
  });
}

module.exports = { installAudioHeaders, AUDIO_HOSTS };
