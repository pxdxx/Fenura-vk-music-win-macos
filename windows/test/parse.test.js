'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAjax, tracksIn, playlistsIn, parseTracks, parsePlaylists, cleanURL, reloadKey, reloadId, formBody, intValue
} = require('../src/main/vk-parse');
const { firstNonEmpty } = require('../src/main/util');
const { humanize } = require('../src/main/errors');

test('parseAjax понимает обычный JSON, <!json>...<!> и мусор перед объектом', () => {
  assert.deepEqual(parseAjax('{"a":1}'), { a: 1 });
  assert.deepEqual(parseAjax('<!bool>1<!json>{"payload":[0,[1]]}<!>x'), { payload: [0, [1]] });
  assert.deepEqual(parseAjax('<!json>[1,2]<!>'), { list: [1, 2] });
  assert.deepEqual(parseAjax('junk {"b":2}'), { b: 2 });
  assert.equal(parseAjax('nothing here'), null);
});

test('tracksIn находит треки в объектах и в массивах веб-формата', () => {
  const json = {
    payload: [0, [{
      list: [
        [456, -7, '//cdn.example/a/index.m3u8', 'Название', 'Артист', 201, 0, 0, 0, 0, 0, 0, 0, 'aa/bb/cc/dd', 'x.jpg,https://img/300.jpg'],
        { id: 5, owner_id: 9, title: 'Second', artist: 'Band', duration: '99', url: 'https://x/y.m3u8', access_key: 'k' }
      ]
    }]]
  };
  const tracks = tracksIn(json);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].id, '-7_456');
  assert.equal(tracks[0].url, 'https://cdn.example/a/index.m3u8');
  assert.equal(tracks[0].artworkURL, 'https://img/300.jpg');
  assert.equal(tracks[0].accessKey, '-7_456_cc_dd');
  assert.equal(tracks[1].duration, 99);
  assert.equal(tracks[1].artist, 'Band');
});

test('tracksIn не дублирует треки и пропускает пустые заголовки', () => {
  const dup = { id: 1, owner_id: 2, title: 'T' };
  assert.equal(tracksIn({ a: dup, b: [dup], c: { id: 3, owner_id: 4, title: '' } }).length, 1);
});

test('parseTracks разбирает ответ официального API', () => {
  const tracks = parseTracks({
    items: [{
      id: 1, owner_id: 2, artist: 'A', title: 'T', duration: 10, url: 'https://a/b',
      album: { thumb: { photo_300: 'https://p/300', photo_1200: 'https://p/1200' } }, access_key: 'zz'
    }, { title: 'без идентификаторов' }]
  });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].artworkURL, 'https://p/1200');
  assert.equal(tracks[0].accessKey, 'zz');
});

test('parsePlaylists и playlistsIn', () => {
  const list = parsePlaylists({ items: [{ id: 3, owner_id: 4, title: 'Mix', count: 12, photo: { photo_300: 'https://p/3' } }] });
  assert.equal(list[0].subtitle, '12 треков');
  assert.equal(list[0].artworkURL, 'https://p/3');
  const web = playlistsIn({ x: { id: '8', owner_id: '9', title: 'W', description: 'd', access_hash: 'h' } });
  assert.equal(web[0].id, '9_8');
  assert.equal(web[0].accessKey, 'h');
});

test('cleanURL отсекает заглушки и достраивает протокол', () => {
  assert.equal(cleanURL('https://a/audio_api_unavailable.mp3'), '');
  assert.equal(cleanURL('//a/b'), 'https://a/b');
  assert.equal(cleanURL('  https://a/b '), 'https://a/b');
  assert.equal(cleanURL('ftp://x'), '');
  assert.equal(cleanURL(undefined), '');
});

test('reloadKey и reloadId', () => {
  assert.equal(reloadKey({ ownerId: 1, audioId: 2, accessKey: null }), '1_2');
  assert.equal(reloadKey({ ownerId: 1, audioId: 2, accessKey: 'abc' }), '1_2_abc');
  assert.equal(reloadKey({ ownerId: 1, audioId: 2, accessKey: '1_2_x_y' }), '1_2_x_y');
  assert.equal(reloadId(1, 2, ''), '1_2');
});

test('formBody кодирует кириллицу и служебные символы', () => {
  assert.equal(formBody({ q: 'привет мир', a: "x'y~z" }), 'q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%D0%BC%D0%B8%D1%80&a=x%27y%7Ez');
});

test('intValue', () => {
  assert.equal(intValue('42'), 42);
  assert.equal(intValue(4.9), 4);
  assert.equal(intValue('4x'), null);
  assert.equal(intValue(null), null);
});

test('firstNonEmpty отдаёт первый непустой результат и отменяет остальные', async () => {
  let aborted = false;
  const result = await firstNonEmpty([
    (signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; resolve([]); });
    }),
    async () => [],
    async () => [1, 2]
  ], [], (list) => list.length === 0);
  assert.deepEqual(result, [1, 2]);
  assert.equal(aborted, true);
  assert.deepEqual(await firstNonEmpty([async () => [], async () => { throw new Error('x'); }], [], (l) => l.length === 0), []);
});

test('humanize переводит ошибки VK', () => {
  assert.match(humanize('Unknown method passed'), /VK не открыл музыку/);
  assert.match(humanize('User authorization failed'), /Профиль открылся/);
  assert.equal(humanize('что-то ещё'), 'что-то ещё');
});
