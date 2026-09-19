'use strict';

class VKAPIError extends Error {
  constructor(kind, text) {
    super(kind === 'api' ? humanize(text) : text);
    this.kind = kind;
  }
}

function humanize(text) {
  const lower = String(text).toLowerCase();
  if (lower.includes('sms sent') || lower.includes('use code param')) {
    return 'Код отправили в SMS. Введите его ниже';
  }
  if (lower.includes('wrong') && lower.includes('code')) {
    return 'Неверный код';
  }
  if (lower.includes('invalid') && (lower.includes('password') || lower.includes('client'))) {
    return 'Неверный логин или пароль ВКонтакте';
  }
  if (lower.includes('unknown method')) {
    return 'VK не открыл музыку для этого входа. Нажмите «Выйти» и войдите ещё раз';
  }
  if (lower.includes('access denied')) {
    return 'Нет доступа к музыке. Выйдите и войдите через страницу ВКонтакте ещё раз';
  }
  if (lower.includes('unauthorized')) {
    return 'Сессия ВКонтакте истекла. Выйдите и войдите ещё раз';
  }
  if (lower.includes('blocked') || lower.includes('authorization failed')) {
    return 'Профиль открылся, но VK не отдал музыку этим способом. Пробую другой доступ. Если список пустой, выйдите и войдите ещё раз';
  }
  return String(text);
}

const apiError = (text) => new VKAPIError('api', text);
const transportError = (text) => new VKAPIError('transport', text);
const emptyError = () => new VKAPIError('empty', 'Пустой ответ VK');

module.exports = { VKAPIError, humanize, apiError, transportError, emptyError };
