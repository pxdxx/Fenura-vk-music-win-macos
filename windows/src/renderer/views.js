import { h, icon, clear, artwork, setArtwork, wordmark, formatDuration, formatClock } from './dom.js';
import { createScrubber } from './scrubber.js';
import { sameSection } from './store.js';

// ---------- Общие элементы ----------

function themeRound(store) {
  const button = h('button', { class: 'theme-round', title: 'Сменить тему', onclick: () => store.toggleTheme() });
  const paint = () => {
    button.replaceChildren(icon(store.isDark ? 'sun' : 'moon-star', 'filled'));
    button.title = store.isDark ? 'Светлая тема' : 'Тёмная тема';
  };
  paint();
  store.on('theme', paint);
  return button;
}

function themeWide(store) {
  const button = h('button', { class: 'theme-wide', onclick: () => store.toggleTheme() });
  const paint = () => {
    button.replaceChildren(
      icon(store.isDark ? 'sun' : 'moon-star', 'filled'),
      h('span', { text: store.isDark ? 'Светлая тема' : 'Тёмная тема' })
    );
  };
  paint();
  store.on('theme', paint);
  return button;
}

function playlistCard(playlist, onOpen) {
  return h('button', { class: 'pl-card', title: playlist.title, onclick: () => onOpen(playlist) },
    artwork(playlist.artworkURL, 132, 16),
    h('div', { class: 'name', text: playlist.title }));
}

// ---------- Вход ----------

export function createLogin({ api, store }) {
  const status = h('div', { class: 'status', text: 'Отдельное окно ВКонтакте' });
  const error = h('div', { class: 'error' });
  const action = h('div', {});
  const card = h('div', { class: 'card login-card' }, wordmark(44, 40), status, error, action);
  const root = h('div', { class: 'login' },
    h('div', { class: 'top' }, themeRound(store)),
    h('div', { class: 'middle' }, card));

  const open = () => api.login().catch((e) => {
    error.textContent = e.message;
  });

  const paint = () => {
    error.textContent = store.session.error || '';
    error.style.display = store.session.error ? '' : 'none';
    action.replaceChildren(store.session.busy
      ? h('div', { class: 'spinner-wrap', style: 'padding-top:4px' }, h('div', { class: 'spinner' }))
      : h('button', { class: 'pill accent', style: 'padding:12px 28px;font-size:15px', text: 'Войти', onclick: open }));
  };
  store.on('session', paint);
  api.onLoginStatus((text) => {
    status.textContent = text;
  });
  paint();
  // Как в macOS-версии: окно входа открывается сразу.
  if (!api.demo) setTimeout(open, 60);
  return root;
}

// ---------- Боковая панель ----------

export function createSidebar({ store }) {
  const nav = (label, glyph, section) => {
    const row = h('button', { class: 'nav-row', onclick: () => store.open(section) },
      icon(glyph), h('span', { class: 'label', text: label }));
    row.dataset.key = section.type;
    return row;
  };
  const rows = [
    nav('Моя музыка', 'list-music', { type: 'my' }),
    nav('Для вас', 'sparkles', { type: 'rec' }),
    nav('Популярное', 'trending-up', { type: 'pop' }),
    nav('Поиск', 'search', { type: 'search' })
  ];
  const playlistBox = h('div', {});
  const profileBox = h('div', {});
  const root = h('aside', { class: 'sidebar' }, themeWide(store), ...rows, playlistBox, h('div', { class: 'side-spacer' }), profileBox);

  const paintSelection = () => {
    rows.forEach((row) => row.classList.toggle('selected', row.dataset.key === store.section.type));
    playlistBox.querySelectorAll('.nav-row').forEach((row) => {
      row.classList.toggle('selected', store.section.type === 'playlist' && row.dataset.key === store.section.playlist.id);
    });
  };

  const paintPlaylists = () => {
    clear(playlistBox);
    playlistBox.style.cssText = store.playlists.length ? 'display:flex;flex-direction:column;min-height:0;flex:1' : 'display:none';
    if (store.playlists.length) {
      const list = h('div', { class: 'side-playlists' });
      for (const playlist of store.playlists) {
        const row = h('button', { class: 'nav-row', title: playlist.title, onclick: () => store.open({ type: 'playlist', playlist }) },
          icon('layers', 'filled'), h('span', { class: 'label', text: playlist.title }));
        row.dataset.key = playlist.id;
        list.append(row);
      }
      playlistBox.append(h('div', { class: 'side-heading', text: 'Плейлисты' }), list);
    }
    paintSelection();
  };

  const paintProfile = () => {
    clear(profileBox);
    const profile = store.session.profile;
    if (!profile) return;
    const name = `${profile.firstName} ${profile.lastName}`.trim();
    profileBox.append(h('div', { class: 'card profile' },
      artwork(profile.photoURL, 34, 14),
      h('div', { class: 'who' },
        h('div', { class: 'name', text: name, title: name }),
        h('button', { class: 'logout', text: 'Выйти', onclick: () => store.logout() }))));
  };

  store.on('section', paintSelection);
  store.on('search', paintSelection);
  store.on('playlists', paintPlaylists);
  store.on('session', paintProfile);
  paintPlaylists();
  paintProfile();
  paintSelection();
  return root;
}

// ---------- Библиотека ----------

export function createLibrary({ store, player }) {
  const headerBox = h('div', {});
  const noticeBox = h('div', {});
  const extraBox = h('div', { style: 'display:contents' });
  const resultsBox = h('div', { style: 'display:contents' });
  const listBox = h('div', { style: 'display:contents' });
  const stateBox = h('div', { style: 'display:contents' });
  const root = h('main', { class: 'library' }, headerBox, noticeBox, extraBox, resultsBox, stateBox, listBox);

  let searchInput = null;
  let searchTimer = null;
  let lastTitle = null;

  // ----- Шапка -----
  const paintHeader = () => {
    const title = store.title;
    const animate = title !== lastTitle;
    lastTitle = title;
    const actions = h('div', { class: 'lib-actions' });
    if (store.section.type === 'rec') {
      const refresh = h('button', {
        class: 'pill soft',
        disabled: store.isRefreshing ? true : null,
        onclick: () => store.refreshRecommendations()
      }, store.isRefreshing ? h('div', { class: 'spinner small' }) : icon('refresh-cw'), 'Обновить');
      actions.append(refresh);
    }
    if (store.tracks.length) {
      actions.append(h('button', {
        class: 'pill accent',
        onclick: () => store.play(store.tracks[0])
      }, icon('play', 'filled'), 'Слушать'));
    }
    const header = h('div', { class: 'lib-header', style: animate ? '' : 'animation:none' },
      h('div', { class: 'lib-titles' },
        wordmark(34, 26),
        h('div', { class: 'text' },
          h('div', { class: 'lib-title', text: title, title }),
          h('div', { class: 'lib-subtitle', text: store.subtitle }))),
      actions);
    headerBox.replaceChildren(header);
  };

  // ----- Сообщение об ошибке -----
  const paintNotice = () => {
    const text = store.notice || player.lastError;
    noticeBox.replaceChildren(text ? h('div', { class: 'notice', text }) : '');
    noticeBox.style.display = text ? '' : 'none';
  };

  // ----- Верхняя часть раздела: поиск, обложка плейлиста или полоса плейлистов -----
  const openPlaylist = (playlist) => store.open({ type: 'playlist', playlist });

  const paintExtra = () => {
    clear(extraBox);
    searchInput = null;
    const section = store.section;
    if (section.type === 'search') {
      searchInput = h('input', {
        type: 'text',
        placeholder: 'Треки, плейлисты, исполнители',
        spellcheck: 'false',
        autocomplete: 'off',
        value: store.query
      });
      searchInput.value = store.query;
      searchInput.addEventListener('input', () => {
        store.query = searchInput.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => store.runSearch(), 380);
      });
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          clearTimeout(searchTimer);
          store.runSearch();
        }
        if (event.key === 'Escape') searchInput.blur();
        event.stopPropagation();
      });
      extraBox.append(h('div', { class: 'card searchbox' }, icon('search'), searchInput));
      requestAnimationFrame(() => searchInput && searchInput.focus());
    } else if (section.type === 'playlist') {
      const playlist = section.playlist;
      extraBox.append(h('div', { class: 'card hero' },
        artwork(playlist.artworkURL, 120, 18),
        h('div', {},
          h('div', { class: 'kicker', text: 'Плейлист' }),
          h('div', { class: 'title', text: playlist.title }),
          h('div', { class: 'sub', text: playlist.subtitle }))));
    } else if (section.type === 'my' && store.playlists.length) {
      extraBox.append(h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
        h('div', { class: 'section-label', text: 'Плейлисты' }),
        h('div', { class: 'strip' }, store.playlists.map((playlist) => playlistCard(playlist, openPlaylist)))));
    }
  };

  const paintResults = () => {
    clear(resultsBox);
    if (store.section.type !== 'search') return;
    if (store.search.playlists.length) {
      resultsBox.append(
        h('div', { class: 'section-label', text: 'Плейлисты' }),
        h('div', { class: 'grid' }, store.search.playlists.map((playlist) => playlistCard(playlist, openPlaylist))));
    }
    if (store.search.tracks.length) {
      resultsBox.append(h('div', { class: 'section-label', text: 'Треки' }));
    }
  };

  // ----- Список треков -----
  const trackAt = (node) => {
    const row = node.closest('.row');
    return row ? { row, track: store.tracks[Number(row.dataset.i)] } : null;
  };

  listBox.addEventListener('click', (event) => {
    const hit = trackAt(event.target);
    if (!hit || !hit.track) return;
    if (event.target.closest('.like')) {
      store.toggleLike(hit.track);
      return;
    }
    if (player.current && player.current.id === hit.track.id) {
      player.toggle();
    } else {
      store.play(hit.track);
    }
  });
  listBox.addEventListener('contextmenu', async (event) => {
    const hit = trackAt(event.target);
    if (!hit || !hit.track) return;
    event.preventDefault();
    const choice = await window.fenura.trackMenu(store.addedIds.has(hit.track.id)).catch(() => null);
    if (choice === 'play') store.play(hit.track);
    if (choice === 'toggle') store.toggleLike(hit.track);
  });

  const paintList = () => {
    clear(listBox);
    if (!store.tracks.length) return;
    const card = h('div', { class: 'card tracks' });
    const fragment = document.createDocumentFragment();
    store.tracks.forEach((track, index) => {
      const row = h('div', { class: 'row', dataset: { i: index, id: track.id }, role: 'button', tabindex: '-1' },
        h('div', { class: 'idx' },
          h('span', { class: 'num', text: String(index + 1) }),
          h('span', { class: 'glyph' }, icon('play', 'filled g-play'), icon('pause', 'filled g-pause'))),
        artwork(track.artworkURL, 40, 10),
        h('div', { class: 'meta' },
          h('div', { class: 't', text: track.title, title: track.title }),
          h('div', { class: 'a', text: track.artist, title: track.artist })),
        h('button', { class: 'like', title: 'В моей музыке', tabindex: '-1' }, icon('heart')),
        h('div', { class: 'dur', text: formatDuration(track.duration) }));
      row.classList.toggle('added', Boolean(track.isAdded));
      fragment.append(row);
    });
    card.append(fragment);
    listBox.append(card);
    markCurrent();
  };

  let currentRow = null;
  const markCurrent = () => {
    const id = player.current ? player.current.id : null;
    if (currentRow) currentRow.classList.remove('current', 'playing');
    currentRow = id ? listBox.querySelector(`.row[data-id="${CSS.escape(id)}"]`) : null;
    if (currentRow) {
      currentRow.classList.add('current');
      currentRow.classList.toggle('playing', player.isPlaying);
    }
  };

  const paintState = () => {
    clear(stateBox);
    if (store.isLoading && !store.tracks.length) {
      stateBox.append(h('div', { class: 'spinner-wrap' }, h('div', { class: 'spinner' })));
    } else if (!store.tracks.length && store.section.type !== 'search') {
      stateBox.append(h('div', { class: 'empty' },
        icon('headphones'),
        h('div', { class: 'big', text: 'Пока тихо' }),
        h('div', { class: 'small', text: 'Выберите раздел или обновите библиотеку.' })));
    }
  };

  const paintAll = () => {
    paintHeader();
    paintNotice();
    paintExtra();
    paintResults();
    paintState();
    paintList();
  };

  // Раздел сменился: перерисовываем всё. Пришли новые данные: только то, что от них зависит.
  let renderedSection = null;
  store.on('section', () => {
    const changed = !renderedSection || !sameSection(renderedSection, store.section);
    renderedSection = store.section;
    paintHeader();
    paintNotice();
    if (changed) {
      root.scrollTop = 0;
      paintExtra();
      paintResults();
    }
    paintState();
    paintList();
  });
  store.on('tracks', () => {
    paintHeader();
    paintNotice();
    paintState();
    paintList();
  });
  store.on('search', () => {
    renderedSection = store.section;
    if (!searchInput) {
      paintExtra();
    }
    paintHeader();
    paintNotice();
    paintResults();
    paintState();
    paintList();
  });
  store.on('notice', paintNotice);
  store.on('playlists', () => {
    if (store.section.type === 'my') paintExtra();
  });
  store.on('added', (id) => {
    const row = listBox.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    if (row) row.classList.toggle('added', store.addedIds.has(id));
  });
  player.on('track', markCurrent);
  player.on('playing', () => {
    if (currentRow) currentRow.classList.toggle('playing', player.isPlaying);
  });
  player.on('error', paintNotice);
  player.on('track', paintNotice);

  renderedSection = store.section;
  paintAll();
  return root;
}

// ---------- Плеер ----------

export function createPlayerBar({ store, player }) {
  const art = artwork(null, 52, 12);
  const title = h('div', { class: 'title', text: 'Ничего не играет' });
  const artist = h('div', { class: 'artist', text: 'Выберите трек' });
  const like = h('button', { class: 'like', title: 'В моей музыке', style: 'display:none', onclick: () => {
    if (player.current) store.toggleLike(player.current);
  } }, icon('heart'));

  const shuffle = h('button', { class: 'ctl', title: 'Перемешать', onclick: () => player.toggleShuffle() }, icon('shuffle'));
  const prev = h('button', { class: 'ctl', title: 'Предыдущий (Ctrl+←)', onclick: () => player.previous() }, icon('skip-back', 'filled'));
  const playBtn = h('button', { class: 'play-btn', title: 'Играть / пауза (Пробел)', onclick: () => player.toggle() });
  const next = h('button', { class: 'ctl', title: 'Следующий (Ctrl+→)', onclick: () => player.next() }, icon('skip-forward', 'filled'));
  const repeat = h('button', { class: 'ctl', title: 'Повтор', onclick: () => player.cycleRepeat() });

  const cur = h('div', { class: 'time cur', text: '0:00' });
  const dur = h('div', { class: 'time', text: '0:00' });
  const seek = createScrubber({
    label: 'Позиция',
    onInput: (value) => {
      cur.textContent = formatClock(value);
    },
    onCommit: (value) => player.seek(value)
  });
  const volume = createScrubber({
    label: 'Громкость',
    live: true,
    onCommit: (value) => {
      player.setVolume(value);
      window.fenura.setVolume(value).catch(() => undefined);
    }
  });
  volume.el.classList.add('vol');
  volume.enable(true);
  volume.set(player.volume, [0, 1]);

  const volumeIcon = h('span', { style: 'display:contents' }, icon('volume-2', 'filled'));

  const root = h('footer', { class: 'card player paused' },
    h('div', { class: 'now' }, art, h('div', { class: 'text' }, title, artist), like),
    h('div', { class: 'transport' },
      h('div', { class: 'controls' }, shuffle, prev, playBtn, next, repeat),
      h('div', { class: 'timeline' }, cur, seek.el, dur)),
    h('div', { class: 'extras' }, volumeIcon, volume.el));

  const paintTrack = () => {
    const track = player.current;
    title.textContent = track ? track.title : 'Ничего не играет';
    title.title = track ? track.title : '';
    artist.textContent = track ? track.artist : 'Выберите трек';
    setArtwork(art, track ? track.artworkURL : null);
    like.style.display = track ? '' : 'none';
    paintLike();
    seek.enable(Boolean(track));
    paintTime();
  };

  const paintLike = () => {
    const on = Boolean(player.current && store.addedIds.has(player.current.id));
    like.classList.toggle('on', on);
  };

  const paintTime = () => {
    seek.set(player.currentTime, [0, Math.max(player.duration, 1)]);
    if (!seek.dragging) cur.textContent = formatClock(player.currentTime);
    dur.textContent = formatClock(player.duration);
  };

  const paintPlay = () => {
    root.classList.toggle('playing', player.isPlaying);
    root.classList.toggle('paused', !player.isPlaying);
    playBtn.replaceChildren(player.isBuffering
      ? h('div', { class: 'spinner small light' })
      : icon(player.isPlaying ? 'pause' : 'play', `filled ic-${player.isPlaying ? 'pause' : 'play'}`));
    playBtn.title = player.isPlaying ? 'Пауза (Пробел)' : 'Играть (Пробел)';
  };

  const paintModes = () => {
    shuffle.classList.toggle('on', player.shuffle);
    repeat.classList.toggle('on', player.repeatMode !== 'off');
    repeat.replaceChildren(icon(player.repeatMode === 'one' ? 'repeat-1' : 'repeat'));
    repeat.title = player.repeatMode === 'off' ? 'Повтор выключен' : player.repeatMode === 'all' ? 'Повторять всё' : 'Повторять трек';
  };

  const paintVolume = () => {
    volume.set(player.volume, [0, 1]);
    volumeIcon.replaceChildren(icon(player.volume === 0 ? 'volume-x' : player.volume < 0.5 ? 'volume-1' : 'volume-2', 'filled'));
  };

  player.on('track', paintTrack);
  player.on('time', paintTime);
  player.on('playing', paintPlay);
  player.on('buffering', paintPlay);
  player.on('modes', paintModes);
  player.on('volume', paintVolume);
  store.on('added', paintLike);
  store.on('section', paintLike);
  paintTrack();
  paintPlay();
  paintModes();
  paintVolume();
  return root;
}
