const sipClient = require('./electron/sipClient.cjs');

// Mock out the sendRegister function to just log the response
const sip = require('sip');
sip.create({ port: 5061, udp: true }, (rq) => {}).send({
    method: 'REGISTER',
    uri: 'sip:atlanta1.voip.ms:5060',
    headers: {
      to: { uri: 'sip:123456@atlanta1.voip.ms' },
      from: { uri: 'sip:123456@atlanta1.voip.ms', params: { tag: '12345678' } },
      'call-id': 'test-call-id',
      cseq: { method: 'REGISTER', seq: 1 },
      contact: [{ uri: 'sip:123456@127.0.0.1:5061' }],
      expires: 300,
    }
}, (rs) => {
    console.log(JSON.stringify(rs.headers['www-authenticate'], null, 2));
    process.exit(0);
});
