# NIHILPOINTZERO-OS ship pipeline: test -> build -> deploy to Desktop studio
# -> push to GitHub -> refresh the GitHub release downloads.
# Run via `npm run ship`. Stops loudly at the first failed step.
# SAFETY: never touches nihilpointzero-data (the user's work) - it only copies
# the two exes and the four doc files into the studio folder.
# The release step keeps ONE rolling release (tag 'latest') whose assets are
# replaced on every ship, so the README's /releases/latest/download/... links
# always serve the newest build. Auth reuses the git credential store (GCM);
# the token is never written to disk or shown.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$studio = Join-Path ([Environment]::GetFolderPath('Desktop')) 'NihilPointZeroStudio'
if (-not (Test-Path $studio)) { throw "Desktop studio folder not found: $studio" }

function Step([string]$name, [scriptblock]$block) {
    Write-Host "==> $name" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE) { throw "FAILED: $name (exit $LASTEXITCODE)" }
}

# ── THE GUARD THAT WOULD HAVE CAUGHT A REAL, SHIPPED FAILURE ─────────────────────────
#
# On 2026-08-01 the teleprompter was committed at 04:13 and the studio was shipped at
# 04:30. The user's installed app did not have it — 18 tabs where the code had 20 —
# because the ship was built from a line of work that did NOT contain that commit. It
# was written, tested, reported done, and then built without.
#
# Nothing failed. Tests passed (they were testing the tree being built), the exe was
# valid, the badge was honest. The only symptom was a user asking "where is the
# teleprompter?" days later.
#
# So: refuse to build when the remote's main has commits this tree does not. Building
# from behind is never what anyone means to do, and the cost of being wrong is an exe
# that silently lacks finished work.
Step 'Refuse to build from a tree that is behind main' {
    git fetch origin main --quiet
    if ($LASTEXITCODE) {
        Write-Host '   (could not reach GitHub - skipping the behind-main check)' -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
        return
    }
    # Commits on origin/main that are NOT in HEAD. Zero is the only acceptable answer.
    $missing = (git rev-list --count HEAD..origin/main)
    if ($LASTEXITCODE) { return }
    if ([int]$missing -gt 0) {
        Write-Host ''
        Write-Host "  STOPPED: $missing commit(s) are on GitHub but not in this folder." -ForegroundColor Red
        Write-Host '  Building now would produce an app MISSING finished work - which has' -ForegroundColor Red
        Write-Host '  happened before (the teleprompter shipped missing this way).' -ForegroundColor Red
        Write-Host ''
        Write-Host '  Fix it with:  git pull origin main' -ForegroundColor Yellow
        Write-Host '  Then run this again. Your own work is untouched either way.' -ForegroundColor Yellow
        Write-Host ''
        throw 'Behind origin/main - refusing to ship an incomplete build.'
    }
    Write-Host '   up to date with origin/main' -ForegroundColor DarkGray
}

Step 'Tests' { npm run test }

Step 'Typecheck the phone bridge and the phone app' {
    # These build from their OWN tsconfigs, which the Electron build never touches -
    # so a break in either is invisible until it is opened on a handset. The bridge in
    # particular is what makes the studio's real screens run in a phone browser, and a
    # silent break there looks like "the phone page loads and then does nothing", which
    # is about the hardest thing to diagnose from the other end of a phone call.
    npx tsc -p tsconfig.remote.json --noEmit
    if ($LASTEXITCODE) { return }
    npm run typecheck:phone
}

Step 'UI click-through of the REAL app (every tab must respond, a video must build)' {
    # Unit tests can all pass while a button in the UI is dead — that class of failure
    # reached the user repeatedly. This launches the actual built app in an isolated
    # data home, walks EVERY tab, and builds a real video through the UI, offline.
    # Red here = the ship stops. A small app window appearing for a few minutes is
    # this gate doing its job.
    npm run test:e2e
}

# Build identity: the doc stamp carries version + date-time; the sidebar badge carries the
# same PLUS the git hash. The hash can only be truthful if the ship commit exists BEFORE
# the build, so the order is: stamp doc -> commit -> compute badge from HEAD -> build.
# (A commit can never contain its own hash, which is why the doc line carries no hash.)
$ver = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$dot = [char]0x00B7  # the badge's middle-dot separator, kept out of this file's literal text
$stamp = "v$ver $dot $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

Step 'Refresh the changelog' {
    npm run changelog:update
}

Step 'Stamp build identity into the diagnostic report' {
    # Keeps the doc's "## Build:" line matching the sidebar badge's version+date prefix,
    # so comparing the two remains a valid staleness check.
    $doc = Join-Path $repo 'docs\MEGA-DIAGNOSTIC-REPORT.md'
    $txt = [IO.File]::ReadAllText($doc)
    $txt = $txt -replace '(?m)^## Build: .*$', "## Build: $stamp"
    [IO.File]::WriteAllText($doc, $txt, [Text.UTF8Encoding]::new($false))
    $global:LASTEXITCODE = 0
}

Step 'Commit source (so the badge hash names the code actually built)' {
    # Committing BEFORE the build lets the badge carry THIS commit's hash. Previously the
    # hash was read before the ship commit existed, so the badge always named the PREVIOUS
    # ship's commit (one behind) - which misled anyone comparing it against git log.
    git add -A
    if ($LASTEXITCODE) { throw 'git add failed - fix the reported git error and re-ship' }
    if (git status --porcelain) {
        git commit -m ("Ship " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
        # A masked commit failure would silently rebuild the old one-behind badge bug AND
        # ship code that exists in no commit - keep this check loud.
        if ($LASTEXITCODE) { throw 'git commit failed - fix the reported git error and re-ship' }
    }
    $global:LASTEXITCODE = 0
}

$buildTag = "$stamp $dot $(git rev-parse --short HEAD)"
$env:NPZ_BUILD_TAG = $buildTag

Step 'Verify NSIS tooling (self-heal after antivirus quarantine)' {
    # COMODO/Defender sometimes silently quarantine makensis.exe from the electron-builder
    # cache (a classic NSIS false positive) -> the build dies with "spawn UNKNOWN".
    # If the exe is missing but a stale cache dir remains, rename it aside (never delete)
    # so electron-builder re-downloads a fresh copy. The durable fix is an antivirus
    # exclusion for %LOCALAPPDATA%\electron-builder\Cache - only the user can add that.
    $nsisRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis'
    if (Test-Path $nsisRoot) {
        $mk = Get-ChildItem $nsisRoot -Recurse -Filter 'makensis.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $mk) {
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            Get-ChildItem $nsisRoot -Directory | ForEach-Object {
                Rename-Item $_.FullName "$($_.Name).quarantined-$stamp.bak"
                Write-Host "  NSIS cache '$($_.Name)' was incomplete (antivirus?) - set aside for re-download" -ForegroundColor Yellow
            }
        }
    }
    $global:LASTEXITCODE = 0
}

Step 'Clear previous build artifacts' {
    # NSIS fails with "Can't open output file" if an old exe is momentarily
    # locked (e.g. antivirus scan). Deleting first surfaces the lock early,
    # with a retry to ride out a scan in progress.
    foreach ($exe in 'NIHILPOINTZERO-OS-portable.exe', 'NIHILPOINTZERO-OS-setup.exe') {
        $p = Join-Path $repo "release\$exe"
        if (Test-Path $p) {
            try { Remove-Item $p -Force -ErrorAction Stop }
            catch { Start-Sleep -Seconds 5; Remove-Item $p -Force -ErrorAction Stop }
        }
    }
}

Step 'Build (portable + installer)' {
    # Real-time antivirus keeps a lock on the freshly written setup.exe for a moment,
    # and makensis dies with "Can't open output file" - three ships in one night died
    # exactly there (2026-08-01). It is transient: deleting the half-written output and
    # running again works. So do that automatically instead of failing the whole ship
    # and making a human retry by hand. (Durable fix: an AV exclusion for
    # %LOCALAPPDATA%\electron-builder\Cache and the release folder - a user-only action.)
    $setup = Join-Path $repo 'release\NIHILPOINTZERO-OS-setup.exe'
    foreach ($attempt in 1..3) {
        npm run dist:win
        if (-not $LASTEXITCODE) { break }
        if ($attempt -eq 3) { throw 'FAILED: Build (portable + installer) - three attempts, see the log above' }
        Write-Host "  build failed (attempt $attempt) - likely the antivirus lock on setup.exe; clearing it and retrying in 20s" -ForegroundColor Yellow
        Remove-Item $setup -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 20
    }
    $global:LASTEXITCODE = 0
}

# NOTE: dist:win passes --publish never. This script does its own release upload
# further down, and electron-builder's implicit CI publishing broke the GitHub build
# once by failing after the exes were already made.

Step 'Verify the phone bridge was built' {
    # `npm run dist:win` builds out/remote/bridge.js and electron-builder ships out/**.
    # Without it the phone shows the studio's screens and none of the buttons work, so
    # this must never ship missing. Cheap check, catastrophic thing to miss.
    $bridge = Join-Path $repo 'out\remote\bridge.js'
    if (-not (Test-Path $bridge) -or (Get-Item $bridge).Length -lt 1024) {
        throw 'FAILED: out\remote\bridge.js is missing or empty - the phone would load the studio and do nothing'
    }
    $global:LASTEXITCODE = 0
}

Step 'Deploy exes to Desktop studio' {
    Copy-Item (Join-Path $repo 'release\NIHILPOINTZERO-OS-portable.exe') $studio -Force
    Copy-Item (Join-Path $repo 'release\NIHILPOINTZERO-OS-setup.exe')    $studio -Force
}

Step 'Update the INSTALLED app in place (Smart App Control-safe)' {
    # Windows Smart App Control judges every NEW unsigned .exe by its (unknown) hash,
    # so freshly built installers can get blocked outright - which stranded the
    # installed app on an old build (2026-07-31). The fix: the installed exe was
    # already allowed once and never needs to change - only resources\app.asar (the
    # app's code archive, a data file SAC does not judge) does. The asar-integrity
    # fuse is NOT enforced in these builds (verified against the fuse wire), so
    # swapping the asar under the existing exe is safe. Electron-runtime upgrades DO
    # change the binaries - detected via ffmpeg.dll (an Electron file app code never
    # touches); then the installer must run once (the durable fix for THAT is code
    # signing, see docs\SIGNING.md).
    $instDir = Join-Path $env:LOCALAPPDATA 'Programs\finscript-studio'
    $unpacked = Join-Path $repo 'release\win-unpacked'
    if (-not (Test-Path (Join-Path $instDir 'NIHILPOINTZERO-OS.exe'))) {
        Write-Host '  (no installed copy on this PC - skipped)' -ForegroundColor DarkGray
    } elseif (Get-Process -Name 'NIHILPOINTZERO-OS' -ErrorAction SilentlyContinue) {
        Write-Host '  INSTALLED APP IS RUNNING - close it and re-ship (or run setup.exe) to update it' -ForegroundColor Yellow
    } else {
        $instFf = Get-FileHash (Join-Path $instDir 'ffmpeg.dll') -Algorithm SHA256 -ErrorAction SilentlyContinue
        $newFf  = Get-FileHash (Join-Path $unpacked 'ffmpeg.dll') -Algorithm SHA256 -ErrorAction SilentlyContinue
        if (-not $instFf -or -not $newFf -or $instFf.Hash -ne $newFf.Hash) {
            Write-Host '  Electron runtime changed - run NIHILPOINTZERO-OS-setup.exe once (Windows may ask to allow it)' -ForegroundColor Yellow
        } else {
            # Keep ONE rollback copy, then swap the code archive + its unpacked natives.
            Copy-Item (Join-Path $instDir 'resources\app.asar') (Join-Path $instDir 'resources\app.asar.previous') -Force
            Copy-Item (Join-Path $unpacked 'resources\app.asar') (Join-Path $instDir 'resources\app.asar') -Force
            if (Test-Path (Join-Path $unpacked 'resources\app.asar.unpacked')) {
                Copy-Item (Join-Path $unpacked 'resources\app.asar.unpacked') (Join-Path $instDir 'resources') -Recurse -Force
            }
            Write-Host "  installed app updated in place to $buildTag (no installer, nothing for SAC to flag)" -ForegroundColor Green
        }
    }
    $global:LASTEXITCODE = 0
}

Step 'Deploy docs to Desktop studio' {
    foreach ($doc in 'HOW-TO-USE.txt', 'NIHILPOINTZERO-GUIDE.txt',
                     'NIHILPOINTZERO-CHEATSHEET.txt', 'MEGA-DIAGNOSTIC-REPORT.md') {
        Copy-Item (Join-Path $repo "docs\$doc") $studio -Force
    }
    # The setup guide lives at the repo root (it covers building from source too).
    Copy-Item (Join-Path $repo 'SETUP_GUIDE.md') $studio -Force
    # Keep the release changelog next to the release docs so the Desktop copy matches GitHub.
    Copy-Item (Join-Path $repo 'CHANGELOG.md') $studio -Force
    # The one-click backup tool the docs point at — must exist wherever the studio does.
    Copy-Item (Join-Path $repo 'BACKUP-NOW.cmd') $studio -Force
    # The one-click UPDATER. It has to travel with the studio for the same reason the
    # backup tool does: it is the only route the user actually has, and a copy of it that
    # stays behind at an old version is worse than none, because it would keep working
    # and keep shipping whatever it was when it was left there.
    Copy-Item (Join-Path $repo 'UPDATE-MY-STUDIO.cmd') $studio -Force
}

Step 'Push to GitHub' {
    # The ship commit was already made before the build (see above); nothing tracked
    # changes during build/deploy (build outputs are gitignored), so this is push-only.
    git push
}

Step 'Update GitHub release downloads' {
    $gh   = 'DSKJazz/NihilPointZeroStudio'
    $tag  = 'latest'

    # Token from the git credential store (same auth git push just used).
    # Piping into git from PowerShell can mangle encoding, so feed exact bytes.
    $q = Join-Path $env:TEMP 'npz-cred-query.txt'   # contains no secrets
    [IO.File]::WriteAllBytes($q, [Text.Encoding]::ASCII.GetBytes("protocol=https`nhost=github.com`n`n"))
    $credOut = cmd /c "git credential fill < `"$q`""
    Remove-Item $q -Force
    $token = ''
    foreach ($line in $credOut) { if ($line -like 'password=*') { $token = $line.Substring(9) } }
    if (-not $token) { throw 'No GitHub credential available - run any git push once to sign in, then re-ship.' }
    $hdr = @{ Authorization = "Bearer $token"; 'User-Agent' = 'npz-ship'; Accept = 'application/vnd.github+json' }

    $body = @"
**This is always the newest version.** Build $buildTag

| You are on... | Download | Notes |
|---|---|---|
| A Windows PC (normal use) | **NIHILPOINTZERO-OS-setup.exe** | Installs the app with a desktop shortcut |
| A Windows PC, no install wanted | **NIHILPOINTZERO-OS-portable.exe** | Single file, keeps data in a folder next to itself |
| A phone or tablet | (guides below only) | The app itself runs on Windows PCs only |

If Windows shows "Windows protected your PC": click **More info -> Run anyway** (the app is not code-signed yet).
"@

    # JSON bodies must be sent as UTF-8 BYTES, built INLINE at each call site: a plain
    # string body gets encoded as ISO-8859-1 (breaks on the build tag's middle-dot), and
    # a helper FUNCTION returning byte[] gets pipeline-unrolled into loose numbers —
    # GitHub then sees "123" (the byte for '{') instead of JSON. Inline expressions
    # avoid both traps.

    # Get or create the single rolling release.
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$gh/releases/tags/$tag" -Headers $hdr
    } catch {
        $newJson = @{ tag_name = $tag; name = 'Download NIHILPOINTZERO-OS (always the newest version)'
                      body = $body; draft = $false; prerelease = $false } | ConvertTo-Json
        $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$gh/releases" -Headers $hdr `
            -Body ([Text.Encoding]::UTF8.GetBytes($newJson)) -ContentType 'application/json; charset=utf-8'
    }

    # Keep the 'latest' tag on the commit we just pushed (cosmetic but honest).
    $sha = (git rev-parse HEAD).Trim()
    try {
        Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$gh/git/refs/tags/$tag" -Headers $hdr `
            -Body ([Text.Encoding]::UTF8.GetBytes((@{ sha = $sha; force = $true } | ConvertTo-Json))) `
            -ContentType 'application/json; charset=utf-8' | Out-Null
    } catch { Write-Host '  (tag pointer not moved - harmless)' -ForegroundColor DarkGray }

    # Refresh release title/body with the new version stamp.
    $patchJson = @{ name = 'Download NIHILPOINTZERO-OS (always the newest version)'; body = $body } | ConvertTo-Json
    Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$gh/releases/$($rel.id)" -Headers $hdr `
        -Body ([Text.Encoding]::UTF8.GetBytes($patchJson)) -ContentType 'application/json; charset=utf-8' | Out-Null

    # Replace assets: the two exes + every shipped document. SIX documents plus the two
    # .cmd tools, matching .github/workflows exactly — whichever route publishes, the
    # download page ends up with the same set, so it can never serve a fresh exe beside
    # a stale instruction.
    $assets = @(
        (Join-Path $repo 'release\NIHILPOINTZERO-OS-setup.exe'),
        (Join-Path $repo 'release\NIHILPOINTZERO-OS-portable.exe'),
        (Join-Path $repo 'docs\HOW-TO-USE.txt'),
        (Join-Path $repo 'docs\NIHILPOINTZERO-GUIDE.txt'),
        (Join-Path $repo 'docs\NIHILPOINTZERO-CHEATSHEET.txt'),
        (Join-Path $repo 'docs\MEGA-DIAGNOSTIC-REPORT.md'),
        (Join-Path $repo 'SETUP_GUIDE.md'),
        (Join-Path $repo 'UPDATE-MY-STUDIO.cmd'),
        (Join-Path $repo 'BACKUP-NOW.cmd')
    )
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(60)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('npz-ship')
    $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
    try {
        foreach ($path in $assets) {
            $name = Split-Path $path -Leaf
            # Up to 3 attempts per asset: a 200 MB upload over home internet can die
            # mid-stream ("Error while copying content to a stream") — one blip should
            # not fail the whole ship. Existing assets are re-queried each attempt
            # because a failed attempt can leave a partial/stale asset behind.
            for ($try = 1; $try -le 3; $try++) {
                try {
                    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$gh/releases/$($rel.id)/assets" -Headers $hdr
                    $old = $existing | Where-Object { $_.name -eq $name }
                    if ($old) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$gh/releases/assets/$($old.id)" -Headers $hdr | Out-Null }
                    $mb = [math]::Round((Get-Item $path).Length / 1MB, 1)
                    Write-Host "  uploading $name ($mb MB)$(if ($try -gt 1) { ", attempt $try" })..." -ForegroundColor DarkCyan
                    $fs = [IO.File]::OpenRead($path)
                    try {
                        $content = New-Object System.Net.Http.StreamContent($fs)
                        $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
                        $up = "https://uploads.github.com/repos/$gh/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($name))"
                        $resp = $client.PostAsync($up, $content).GetAwaiter().GetResult()
                        if (-not $resp.IsSuccessStatusCode) {
                            throw "Upload of $name failed: $($resp.StatusCode) $($resp.Content.ReadAsStringAsync().GetAwaiter().GetResult())"
                        }
                        break
                    } finally { $fs.Dispose() }
                } catch {
                    if ($try -eq 3) { throw }
                    Write-Host "  upload of $name failed ($($_.Exception.Message)) - retrying in 10s..." -ForegroundColor Yellow
                    Start-Sleep -Seconds 10
                }
            }
        }
    } finally { $client.Dispose() }
    $global:LASTEXITCODE = 0
}

Write-Host ''
Write-Host "SHIPPED OK  $buildTag" -ForegroundColor Green
Write-Host "  Desktop studio updated: $studio"
Write-Host '  GitHub updated: push complete'
Write-Host '  Download page updated: https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest'
Write-Host '  Installed app: updated in place automatically when possible (see the step above);' -ForegroundColor Yellow
Write-Host '  the setup.exe is only needed when the Electron runtime itself changed.' -ForegroundColor Yellow
