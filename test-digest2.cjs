const sip = require('sip');
const digest = require('sip/digest');

function unq(a) {
  if (a && a[0] === '"' && a[a.length - 1] === '"') {
    return a.substr(1, a.length - 2);
  }
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

let realm = 'atlanta1.voip.ms';
let authHeaders = rs.headers['www-authenticate'];
if (authHeaders && authHeaders.length > 0) {
    realm = unq(authHeaders[0].realm) || realm;
}

const creds = { user: 'u', password: 'p', realm: realm };

try {
    digest.signRequest({}, authRq, rs, creds);
    console.log('Success!', authRq.headers);
} catch(e) {
    console.log('Failed:', e.message);
}
