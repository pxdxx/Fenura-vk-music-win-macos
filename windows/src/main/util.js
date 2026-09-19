'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const now = () => Math.floor(Date.now() / 1000);

// Запускает все задачи параллельно и отдаёт первый непустой результат.
// Остальные запросы отменяются через AbortSignal, чтобы не занимать сеть и мост к странице.
async function firstNonEmpty(jobs, empty, isEmpty) {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let pending = jobs.length;
    let done = false;
    if (pending === 0) {
      resolve(empty);
      return;
    }
    const settle = (value) => {
      if (done) return;
      if (!isEmpty(value)) {
        done = true;
        controller.abort();
        resolve(value);
        return;
      }
      if (--pending === 0) {
        done = true;
        resolve(empty);
      }
    };
    for (const job of jobs) {
      Promise.resolve()
        .then(() => job(controller.signal))
        .then(settle, () => settle(empty));
    }
  });
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }
}

module.exports = { sleep, now, firstNonEmpty, withTimeout, throwIfAborted };
