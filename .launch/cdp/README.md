# Dedicated Launch Browser Profile

Use only `.launch/chrome-profile/` for launch QA and publishing sessions. The directory is gitignored.

Bind remote debugging to localhost:

```powershell
chrome.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="<repo>\.launch\chrome-profile"
```

Never attach launch automation to the user's everyday browser profile. Do not read, export, print, screenshot, or serialize passwords, cookies, tokens, OAuth codes, local storage credentials, authorization headers, or signed URLs. MFA, CAPTCHA, OAuth consent, and account-security prompts require the human owner.

Cross-check visual findings with DOM state, computed styles, a fresh profile, Playwright screenshots, console state, and network state before filing a product defect.
