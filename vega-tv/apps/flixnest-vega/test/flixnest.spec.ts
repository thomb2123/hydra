import {accessIsValid, cookieHeader, formatPairCode, normalisePairCode, pairUrl, parseSetCookie, routedOperation} from '../src/flixnest/api';

describe('FlixNest API helpers', () => {
  it('routes account metadata operations like the web player', () => {
    const account = {type: 'account' as const, scope: 'a'.repeat(64)};
    const xtream = {type: 'xtream' as const, url: 'http://x.example', username: 'u', password: 'p'};
    expect(routedOperation('catalog', account)).toBe('account-data/catalog');
    expect(routedOperation('play', account)).toBe('account-data/play');
    expect(routedOperation('account/login', null)).toBe('account/login');
    expect(routedOperation('catalog', xtream)).toBe('catalog');
  });

  it('parses comma-joined Set-Cookie headers including Expires dates', () => {
    const header = 'fx_session=abc123; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure, fx_csrf=zz9; Path=/';
    expect(parseSetCookie(header)).toEqual({fx_session: 'abc123', fx_csrf: 'zz9'});
    expect(cookieHeader({a: '1', b: '2'})).toBe('a=1; b=2');
    expect(parseSetCookie(undefined)).toEqual({});
  });

  it('normalises pairing codes like the web player', () => {
    expect(normalisePairCode('bcdf-ghjk')).toBe('BCDFGHJK');
    expect(normalisePairCode('ABCD-EFGH')).toBe(''); // vowels are never used
    expect(formatPairCode('BCDFGHJK')).toBe('BCDF-GHJK');
    expect(pairUrl('BCDFGHJK')).toBe('https://player.flixnest.app/webplayer/pair?code=BCDFGHJK');
  });

  it('validates access objects', () => {
    expect(accessIsValid({type: 'account', scope: 'f'.repeat(64)})).toBe(true);
    expect(accessIsValid({type: 'account', scope: 'short'})).toBe(false);
    expect(accessIsValid({type: 'xtream', url: 'http://srv.example:8080', username: 'u', password: 'p'})).toBe(true);
    expect(accessIsValid({type: 'xtream', url: 'ftp://srv', username: 'u', password: 'p'})).toBe(false);
    expect(accessIsValid({type: 'playlist', url: 'https://list.example/get.php'})).toBe(true);
    expect(accessIsValid(null)).toBe(false);
  });
});
