; CallerFlash NSIS installer customisation
; Require 64-bit Windows — refuse to install on 32-bit

!include "x64.nsh"

!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "CallerFlash requires a 64-bit version of Windows.$\r$\n$\r$\nPlease download the 64-bit edition of Windows or run this on a 64-bit system."
    Abort
  ${EndIf}
!macroend
