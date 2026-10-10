<#
.SYNOPSIS
  Installs, updates or removes the FlexiHome agent on this Windows PC.

.DESCRIPTION
  The agent sends your FlexiHome site a summary of this PC every few seconds
  (processor, memory, drives, network, graphics card, Docker containers), which
  the site's Server tab shows beside the server itself. It only calls out to
  the site, so nothing needs opening on your router.

  It is copied to %LOCALAPPDATA%\FlexiHomeAgent and started, with no window,
  each time you sign in to Windows. Needs Node 22 or newer, and the server code
  built first:  npm run build:server

.EXAMPLE
  scripts\install-agent.ps1 -Url https://home.example.com -Key fhm_...
  First install. The key comes from the site: Settings, Other machines, Add a machine.

.EXAMPLE
  scripts\install-agent.ps1 -Check 'ComfyUI=http://127.0.0.1:8188/'
  Run again without -Key to update the agent's files or change what it checks; the key is kept.

.EXAMPLE
  scripts\install-agent.ps1 -Uninstall
#>
param(
  [string] $Url,
  [string] $Key,
  # Seconds between reports.
  [int] $Interval = 10,
  # Apps on this PC that aren't Docker containers, as 'Name=address'. The agent tries each address and reports up or down.
  [string[]] $Check,
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
$name = 'FlexiHome agent'
$dir = Join-Path $env:LOCALAPPDATA 'FlexiHomeAgent'
$config = Join-Path $dir 'config.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Stop-Agent {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$dir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

function Remove-Autostart {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
  Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue
}

if ($Uninstall) {
  Remove-Autostart
  Stop-Agent
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -Confirm:$false }
  "Removed the agent. To stop this PC being listed, remove it on the site too (Settings, Other machines)."
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed (or not on the PATH). The agent needs Node 22 or newer.' }
if ([int](& $node -p 'process.versions.node.split(".")[0]') -lt 22) { throw "The agent needs Node 22 or newer; this is $(& $node -v)." }

$built = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist-server'
$files = 'agent.js', 'agent-lib.js', 'docker.js', 'npm-db.js'
foreach ($f in $files) { if (-not (Test-Path (Join-Path $built $f))) { throw "Can't find $f in $built. Run 'npm run build:server' first." } }

# Settings: what was passed, over what is already installed, over the defaults.
$old = if (Test-Path $config) { Get-Content $config -Raw | ConvertFrom-Json } else { $null }
if (-not $Url) { $Url = $old.url }
if (-not $Key) { $Key = $old.key }
if (-not $Url -or -not $Key) { throw 'First install needs -Url (your site''s address) and -Key (from the site: Settings, Other machines, Add a machine).' }
if (-not $PSBoundParameters.ContainsKey('Interval') -and $old.interval) { $Interval = $old.interval }
$checks = if ($PSBoundParameters.ContainsKey('Check')) {
  @($Check | ForEach-Object {
      $n, $u = $_ -split '=', 2
      if (-not $u -or $u -notmatch '^https?://') { throw "-Check wants 'Name=http://address', not '$_'." }
      @{ name = $n.Trim(); url = $u.Trim() }
    })
} else { @($old.checks | Where-Object { $_ }) }

Stop-Agent
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($f in $files) { Copy-Item (Join-Path $built $f) $dir -Force }
# The built files are ES modules; this is what tells Node so, away from the project's own package.json.
'{ "type": "module" }' | Set-Content (Join-Path $dir 'package.json')
# @() again here: PowerShell hands a one-item list back from the `if` above as the bare item, and the agent wants a list.
[ordered]@{ url = $Url.TrimEnd('/'); key = $Key; interval = $Interval; checks = @($checks); log = (Join-Path $dir 'agent.log') } |
  ConvertTo-Json -Depth 5 | Set-Content $config

# One reading, sent nowhere: shows that it runs here before it is left to run unseen.
$agent = Join-Path $dir 'agent.js'
$once = & $node --disable-warning=ExperimentalWarning $agent $config --once 2>&1
if ($LASTEXITCODE -ne 0) { throw "The agent wouldn't run: $once" }
$r = ($once -join "`n") | ConvertFrom-Json
"This PC, as the agent sees it: $($r.host.hostname), $($r.host.os), $($r.host.cores) cores, $($r.host.disks.Count) drive(s), " +
  "$(if ($r.host.gpus) { $r.host.gpus[0].name } else { 'no graphics card it can read' }), " +
  "Docker $(if ($r.docker.available) { "running with $($r.containers.Count) container(s)" } else { 'not running' })."

# conhost --headless runs a console program with no window at all.
$arguments = "--headless `"$node`" --disable-warning=ExperimentalWarning `"$agent`" `"$config`""
Remove-Autostart
try {
  # A task is preferred because Windows restarts it if it ever stops.
  $task = @{
    TaskName  = $name
    Action    = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arguments -WorkingDirectory $dir
    Trigger   = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    Settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  }
  Register-ScheduledTask @task | Out-Null
  Start-ScheduledTask -TaskName $name
  $how = 'a scheduled task'
} catch {
  # Creating a sign-in task can need an administrator; the per-user start-up list never does.
  Set-ItemProperty -Path $runKey -Name $name -Value "conhost.exe $arguments"
  Start-Process -FilePath 'conhost.exe' -ArgumentList $arguments -WorkingDirectory $dir -WindowStyle Hidden
  $how = 'your start-up programs'
}

Start-Sleep -Seconds 6
$log = Join-Path $dir 'agent.log'
"Installed in $dir and started; it will start again at each sign-in (through $how)."
if (Test-Path $log) { "Its log so far:"; Get-Content $log -Tail 3 | ForEach-Object { "  $_" } } else { "No log yet; look in $log in a moment." }
