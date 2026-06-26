const sip = require('sip');
const digest = require('sip/digest');

const rs = {
    status: 401,
    headers: {
        'www-authenticate': [
            {
                scheme: 'Digest',
                algorithm: 'MD5',
                realm: '"voip.ms"',
                nonce: '"48ce755f"'
            }
        ]
    }
};

const authRq = { uri: 'sip:test', method: 'REGISTER', headers: {} };

// Omitting realm here:
const creds = { user: '123456', password: 'password' };

try {
    digest.signRequest({}, authRq, rs, creds);
    console.log('Success!', authRq.headers);
} catch(e) {
    console.log('Failed:', e.message);
}
