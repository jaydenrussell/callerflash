import { useAppStore } from '../store/useAppStore';
import { sanitizeCallerNumberForClipboard } from '../security/secretRedactor';

const sampleCallers = [
  { number: '(514) 555-0123', name: 'John Smith' },
  { number: '(416) 555-0456', name: 'Jane Doe' },
  { number: '(604) 555-0789', name: 'Acuity Client' },
  { number: '(905) 555-1234', name: 'Dr. Wilson' },
  { number: '(613) 555-5678', name: 'Mary Johnson' },
  { number: '(438) 555-9012', name: 'Bob Williams' },
  { number: '(647) 555-3456', name: 'Sarah Davis' },
  { number: '(250) 555-7890', name: 'Tech Support' },
];

export function simulateIncomingCall(source: 'dashboard' | 'toast-settings' | 'background' = 'dashboard') {
  const { addCallRecord, addToast, addDiagnosticLog, isMinimized } = useAppStore.getState();
  const caller = sampleCallers[Math.floor(Math.random() * sampleCallers.length)];

  // Sanitize once at the trust boundary (parser exit). A malicious SIP
  // server can stuff CRLF, null bytes, or HTML into the From display name;
  // we strip everything outside the printable-ASCII + common-punctuation
  // range to keep the field safe to render and copy.
  const safeName = caller.name.replace(/[^\x20-\x7E]/g, '').slice(0, 64);
  const safeNumber = sanitizeCallerNumberForClipboard(caller.number);

  const record = {
    id: crypto.randomUUID(),
    callerNumber: caller.number,
    callerName: safeName,
    timestamp: new Date(),
    duration: 0,
    direction: 'inbound' as const,
    status: 'answered' as const,
  };

  addCallRecord(record);

  // Always add to the in-app store so ToastContainer can render the
  // toast in the main window. In Electron, also fire the IPC bridge
  // so the dedicated toast window shows the alert (visible even when
  // the main app is hidden to the tray).
  const { toastConfig } = useAppStore.getState();
  addToast(record);

  if (typeof window !== 'undefined' && window.callerflash?.toast?.show) {
    window.callerflash.toast.show({
      id: record.id,
      callerNumber: record.callerNumber,
      callerName: record.callerName,
      timestamp: record.timestamp.toISOString(),
      config: {
        duration: toastConfig.duration,
        backgroundColor: toastConfig.backgroundColor,
        accentColor: toastConfig.accentColor,
        textColor: toastConfig.textColor,
        borderRadius: toastConfig.borderRadius,
        opacity: toastConfig.opacity,
        fontFamily: toastConfig.fontFamily,
        fontSize: toastConfig.fontSize,
        autoCopyToClipboard: toastConfig.autoCopyToClipboard,
        showCallerName: toastConfig.showCallerName,
        showTimestamp: toastConfig.showTimestamp,
        maxWidth: toastConfig.maxWidth,
      },
    });
  }

  addDiagnosticLog({
    level: 'info',
    category: 'SIP',
    message: `INVITE received from ${caller.number} (${safeName})`,
    details: `SIP/2.0 180 Ringing\nFrom: "${safeName}" <sip:${safeNumber}@sip.provider>\nCall-ID: ${crypto.randomUUID()}\nSource: ${source}${isMinimized ? ' • app minimized' : ''}`,
  });
  addDiagnosticLog({
    level: 'info',
    category: 'TOAST',
    message: `Toast notification displayed for ${caller.number}${isMinimized ? ' while minimized' : ''}`,
  });
}
