$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
python -m venv (Join-Path $projectRoot '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
# Do not replace an existing system driver with the older installer bundled in vgamepad.
$env:VGAMEPAD_SKIP_VIGEMBUS_INSTALL = 'true'
& (Join-Path $projectRoot '.venv/Scripts/python.exe') -m pip install vgamepad==0.1.0
if ($LASTEXITCODE -ne 0) { throw 'vgamepad installation failed' }
Write-Host 'Python bridge installed. ViGEmBus must already be installed. Select real gamepad mode and connect in GamePilot.'
