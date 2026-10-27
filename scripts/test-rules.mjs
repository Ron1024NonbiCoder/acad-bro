/* Firestore rules check against the local emulator (REST). Needs Java.
   Run: cd <repo> && npx -y firebase-tools@latest emulators:exec --only firestore "node scripts/test-rules.mjs" --project acadbro-166c4
   Never touches the live project. */
var host = process.env.FIRESTORE_EMULATOR_HOST;
function jwt(uid) {
  var b = function (o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); };
  return b({ alg: 'none', typ: 'JWT' }) + '.' + b({ user_id: uid, sub: uid, aud: 'acadbro-166c4', iss: 'https://securetoken.google.com/acadbro-166c4' }) + '.';
}
var base = 'http://' + host + '/v1/projects/acadbro-166c4/databases/(default)/documents/';
function arr(n) { return { arrayValue: { values: Array.from({ length: n }, function (_, i) { return { mapValue: { fields: { id: { stringValue: 'x' + i } } } }; }) } }; }
function doc(over) {
  var f = {
    schema: { integerValue: '1' },
    areaLabels: { mapValue: { fields: { living: { stringValue: 'Living' } } } },
    projects: arr(2), tasks: arr(3), completions: arr(5),
    updatedAt: { timestampValue: new Date().toISOString() },
    rev: { stringValue: 'rev-abc-123' }
  };
  Object.assign(f, over || {});
  Object.keys(f).forEach(function (k) { if (f[k] === null) delete f[k]; });
  return { fields: f };
}
async function call(method, path, uid, body) {
  var r = await fetch(base + path, { method: method, headers: { 'content-type': 'application/json', ...(uid ? { authorization: 'Bearer ' + jwt(uid) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.status;
}
var fails = 0;
async function expect(name, want, p) { var got = await p; var ok = got === want; if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + name + ' -> ' + got + (ok ? '' : ' (wanted ' + want + ')')); }
await expect('owner creates valid doc', 200, call('PATCH', 'users/u1', 'u1', doc()));
await expect('owner updates valid doc', 200, call('PATCH', 'users/u1', 'u1', doc({ projects: arr(200) })));
await expect('owner reads own doc', 200, call('GET', 'users/u1', 'u1'));
await expect('other user cannot read', 403, call('GET', 'users/u1', 'u2'));
await expect('anonymous cannot read', 403, call('GET', 'users/u1', null));
await expect('other user cannot write', 403, call('PATCH', 'users/u1', 'u2', doc()));
await expect('cannot write to another uid path', 403, call('PATCH', 'users/u3', 'u1', doc()));
await expect('extra field denied', 403, call('PATCH', 'users/u1', 'u1', doc({ evil: { stringValue: 'x' } })));
await expect('missing field denied', 403, call('PATCH', 'users/u1', 'u1', doc({ completions: null })));
await expect('schema 2 denied', 403, call('PATCH', 'users/u1', 'u1', doc({ schema: { integerValue: '2' } })));
await expect('projects not a list denied', 403, call('PATCH', 'users/u1', 'u1', doc({ projects: { stringValue: 'x' } })));
await expect('updatedAt not timestamp denied', 403, call('PATCH', 'users/u1', 'u1', doc({ updatedAt: { stringValue: 'x' } })));
await expect('missing rev denied', 403, call('PATCH', 'users/u1', 'u1', doc({ rev: null })));
await expect('rev not a string denied', 403, call('PATCH', 'users/u1', 'u1', doc({ rev: { integerValue: '5' } })));
await expect('empty rev denied', 403, call('PATCH', 'users/u1', 'u1', doc({ rev: { stringValue: '' } })));
await expect('rev over 64 chars denied', 403, call('PATCH', 'users/u1', 'u1', doc({ rev: { stringValue: 'r'.repeat(65) } })));
await expect('rev of exactly 64 chars allowed', 200, call('PATCH', 'users/u1', 'u1', doc({ rev: { stringValue: 'r'.repeat(64) } })));
await expect('realistic big doc (5000 tasks) allowed', 200, call('PATCH', 'users/u1', 'u1', doc({ tasks: arr(5000), completions: arr(8000) })));
await expect('over projects cap (1001) denied', 403, call('PATCH', 'users/u1', 'u1', doc({ projects: arr(1001) })));
await expect('delete denied', 403, call('DELETE', 'users/u1', 'u1'));
await expect('other collection denied', 403, call('PATCH', 'notes/n1', 'u1', { fields: { a: { stringValue: 'x' } } }));
process.exit(fails ? 1 : 0);
