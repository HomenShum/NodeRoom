# chrome-cdp-up.ps1 — bring up Chrome with CDP on the REAL signed-in profile.
#
# Idempotent: if port 9222 is already listening, does nothing. Every flag here
# was paid for:
#   --user-data-dir   MUST be explicit. Chrome ignores --remote-debugging-port
#                     when it is absent. Pass it UNQUOTED inside ArgumentList —
#                     the path contains a space and PowerShell double-quoting
#                     breaks the launch silently.
#   --disable-extensions  A real profile loads ~13 extension service workers as
#                     CDP targets, and connectOverCDP stalls attaching to them:
#                     the websocket connects, then times out. Cookies live in
#                     the profile, so the signed-in session survives.
$listening = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
if ($listening) { "CDP already up (pid " + $listening[0].OwningProcess + ")"; exit 0 }

Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4

$exe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$udd = "$env:LOCALAPPDATA\Google\Chrome\User Data"
Start-Process -FilePath $exe -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$udd",
  "--disable-extensions",
  "--no-first-run",
  "about:blank"
)

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  $c = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
  if ($c) { "CDP LISTENING pid " + $c[0].OwningProcess; exit 0 }
}
"FAILED: port 9222 never came up"
exit 1
