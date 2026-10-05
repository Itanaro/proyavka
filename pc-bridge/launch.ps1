# Проявка для ПК: мост (если ещё не запущен) + окно Проявки без интерфейса браузера
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$up = Get-NetTCPConnection -LocalPort 7861 -State Listen -ErrorAction SilentlyContinue
if (-not $up) {
  Start-Process -FilePath (Join-Path $here 'start-bridge.bat') -WorkingDirectory $here -WindowStyle Minimized
  for ($i = 0; $i -lt 40 -and -not (Get-NetTCPConnection -LocalPort 7861 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
}
$mark = Join-Path $here 'pc-trusted.txt'
$ca = Join-Path $here 'rootCA.crt'
if ((Test-Path $ca) -and -not (Test-Path $mark)) {
  # один раз: Windows спросит, доверять ли сертификату моста — нужно ответить «Да»
  certutil -user -addstore Root $ca | Out-Null
  if ($LASTEXITCODE -eq 0) { Set-Content -Path $mark -Value 'ok' }
}
$url = 'https://itanaro.github.io/proyavka/?pc=1'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=$url", '--start-maximized' }
else { Start-Process $url }
