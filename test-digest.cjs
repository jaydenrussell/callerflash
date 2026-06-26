const sip = require('sip');
const digest = require('sip/digest');

function unq(a) {
  if(a && a[0] === '"' && a[a.length-1] === '"')
    return a.substr(1, a.length - 2);
  return a;
}

const rs = {
    status: 401,
    headers: {
        'www-authenticate': [
            {
                scheme: 'Digest',
                algorithm: 'MD5',
                realm: '"atlanta1.voip.ms"',
                nonce: '"48ce755f"'
            }
        ]
    }
};

const authRq = { uri: 'sip:test', method: 'REGISTER', headers: {} };

let realm = rs.headers['www-authenticate'][0].realm;
console.log('Without unq:', realm);

try {
    digest.signRequest({}, authRq, rs, { user: 'u', password: 'p', realm: realm });
    console.log('Success without unq!');
} catch(e) {
    console.log('Failed without unq:', e.message);
}

try {
    digest.signRequest({}, authRq, rs, { user: 'u', password: 'p', realm: unq(realm) });
    console.log('Success with unq!');
} catch(e) {
    console.log('Failed with unq:', e.message);
}
