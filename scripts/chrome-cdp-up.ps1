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

# Close GRACEFULLY. Stop-Process -Force was killing the user's real browser
# without letting it write its session file — that is what produced the
# "Chrome didn't shut down correctly / Restore pages?" banner and lost open
# tabs. CloseMainWindow() is the same as clicking the X: Chrome saves session
# state and reopens cleanly. Force is a last resort, only for a window that
# refuses to close.
$chrome = Get-Process chrome -ErrorAction SilentlyContinue
if ($chrome) {
  "closing Chrome gracefully so it saves its session..."
  foreach ($p in $chrome) { if (-not $p.HasExited -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) { break }
  }
  $stubborn = Get-Process chrome -ErrorAction SilentlyContinue
  if ($stubborn) {
    "  (still up after 15s — forcing; session may not be saved)"
    $stubborn | Stop-Process -Force
    Start-Sleep -Seconds 3
  }
}

$exe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$udd = "$env:LOCALAPPDATA\Google\Chrome\User Data"
Start-Process -FilePath $exe -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$udd",
  "--disable-extensions",
  "--no-first-run",
  "--restore-last-session"
)

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  $c = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
  if ($c) { "CDP LISTENING pid " + $c[0].OwningProcess; exit 0 }
}
"FAILED: port 9222 never came up"
exit 1
