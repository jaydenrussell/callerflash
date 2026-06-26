const sip = require('sip');
const digest = require('sip/digest');
const os = require('os');
const { randomUUID: uuidv4 } = require('crypto');

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

let client = null;
let currentConfig = null;
let registerInterval = null;
let cseq = 1;
let currentCallId = null;

function createContactUri() {
  const ip = getLocalIp();
  return `sip:${currentConfig.username}@${ip}:5060`;
}

function sendRegister(callbacks) {
  if (!client) return;

  const uri = `sip:${currentConfig.server}:${currentConfig.port}`;
  const rq = {
    method: 'REGISTER',
    uri: uri,
    headers: {
      to: { uri: `sip:${currentConfig.username}@${currentConfig.server}` },
      from: { uri: `sip:${currentConfig.username}@${currentConfig.server}`, params: { tag: uuidv4().substring(0, 8) } },
      'call-id': currentCallId,
      cseq: { method: 'REGISTER', seq: cseq++ },
      contact: [{ uri: createContactUri() }],
      expires: currentConfig.registerExpiry || 300,
    }
  };

  sip.send(rq, (rs) => {
    if (rs.status === 401 || rs.status === 407) {
      // Digest Challenge
      const authRq = {
        method: 'REGISTER',
        uri: uri,
        headers: {
          to: rq.headers.to,
          from: rq.headers.from,
          'call-id': rq.headers['call-id'],
          cseq: { method: 'REGISTER', seq: cseq++ },
          contact: rq.headers.contact,
          expires: rq.headers.expires,
        }
      };

      const creds = {
        user: currentConfig.authUsername || currentConfig.username,
        password: currentConfig.password,
        realm: rs.headers['www-authenticate']?.[0]?.realm || currentConfig.server
      };

      digest.signRequest({}, authRq, rs, creds);

      sip.send(authRq, (rs2) => {
        if (rs2.status >= 200 && rs2.status < 300) {
          callbacks.onRegistered();
        } else {
          callbacks.onError(`SIP Registration Failed: ${rs2.status} ${rs2.reason}`);
        }
      });
    } else if (rs.status >= 200 && rs.status < 300) {
      callbacks.onRegistered();
    } else {
      callbacks.onError(`SIP Registration Failed: ${rs.status} ${rs.reason}`);
    }
  });
}

function connect(config, callbacks) {
  disconnect(); // Clean up existing
  
  currentConfig = config;
  currentCallId = uuidv4();
  cseq = 1;

  try {
    const isTcp = config.protocol === 'TCP' || config.protocol === 'TLS';
    // Start SIP listener
    client = sip.create({
      port: 5060,
      tcp: isTcp,
      udp: !isTcp
    }, (rq) => {
      // Handle incoming requests (INVITE)
      if (rq.method === 'INVITE') {
        const callerMatch = rq.headers.from.uri.match(/sip:([^@]+)@/);
        const callerNumber = callerMatch ? callerMatch[1] : 'Unknown';
        let callerName = '';
        if (rq.headers.from.name) {
          callerName = rq.headers.from.name.replace(/^"|"$/g, '');
        }

        // Notify UI immediately
        callbacks.onInvite({ callerNumber, callerName });

        // Reject automatically (CallerFlash is just a monitor, it doesn't answer audio)
        // 486 Busy Here is appropriate for a monitor that doesn't accept the call.
        const rs = sip.makeResponse(rq, 486, 'Busy Here');
        sip.send(rs);
      }
    });

    callbacks.onConnected();

    // Initial Registration
    sendRegister(callbacks);

    // Keep-alive loop
    const expiryMs = (config.registerExpiry || 300) * 1000;
    const refreshMs = Math.max(expiryMs - 15000, 30000); // 15 seconds before expiry, min 30s
    registerInterval = setInterval(() => {
      sendRegister(callbacks);
    }, refreshMs);

  } catch (err) {
    callbacks.onError(err.message);
  }
}

function disconnect() {
  if (registerInterval) {
    clearInterval(registerInterval);
    registerInterval = null;
  }
  
  if (client && currentConfig) {
    // Send un-register (expires: 0)
    try {
      const uri = `sip:${currentConfig.server}:${currentConfig.port}`;
      const rq = {
        method: 'REGISTER',
        uri: uri,
        headers: {
          to: { uri: `sip:${currentConfig.username}@${currentConfig.server}` },
          from: { uri: `sip:${currentConfig.username}@${currentConfig.server}`, params: { tag: uuidv4().substring(0, 8) } },
          'call-id': currentCallId,
          cseq: { method: 'REGISTER', seq: cseq++ },
          contact: [{ uri: createContactUri() }],
          expires: 0, // 0 = unregister
        }
      };
      
      sip.send(rq, (rs) => {
        if (rs.status === 401 || rs.status === 407) {
          const authRq = { ...rq, headers: { ...rq.headers, cseq: { method: 'REGISTER', seq: cseq++ } } };
          digest.signRequest({}, authRq, rs, {
            user: currentConfig.authUsername || currentConfig.username,
            password: currentConfig.password,
            realm: currentConfig.server
          });
          sip.send(authRq);
        }
      });
    } catch { /* ignore */ }

    // Destroy client
    sip.destroy(client);
    client = null;
  }
}

module.exports = { connect, disconnect };
