#Requires -Version 7
<#
.SYNOPSIS
  Vary: Accept の有無で、共有キャッシュがどう壊れるかを実演する（演習2）。

.DESCRIPTION
  server.js と cache-proxy.js を Vary あり／なしの2通りで起動し、
  「ブラウザが先にアクセス → 次にエージェントがアクセス」を再現する。

  Vary が無いと、エージェントが Accept: text/markdown を送っているのに
  キャッシュ済みの HTML が返る。サーバのコードは正しいまま壊れる。

.EXAMPLE
  ./demo-vary.ps1
#>
param(
    [int] $BasePort = 3100
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot

$BrowserAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

function Wait-Port {
    param([int] $Port, [int] $TimeoutMs = 8000)
    $deadline = [datetime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([datetime]::UtcNow -lt $deadline) {
        try {
            $client = [Net.Sockets.TcpClient]::new('localhost', $Port)
            $client.Close()
            return $true
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    return $false
}

function Get-Representation {
    param([int] $Port, [string] $Accept)
    $res = Invoke-WebRequest -Uri "http://localhost:$Port/docs/hello" `
        -Headers @{ Accept = $Accept } -SkipHttpErrorCheck
    [pscustomobject]@{
        Status      = [int] $res.StatusCode
        ContentType = (($res.Headers['Content-Type'] -join ',') -split ';')[0]
        Cache       = ($res.Headers['x-cache'] -join ',')
        Vary        = ($res.Headers['Vary']    -join ',')
    }
}

function Invoke-Scenario {
    param([string] $NoVary, [int] $SrvPort, [int] $PrxPort, [string] $Label)

    $log = [IO.Path]::GetTempPath()
    $env:NO_VARY = $NoVary
    $env:PORT = "$SrvPort"
    Remove-Item Env:UPSTREAM -ErrorAction SilentlyContinue
    $srv = Start-Process node -ArgumentList 'server.js' -PassThru -NoNewWindow `
        -RedirectStandardOutput "$log srv$SrvPort.out".Replace(' ', '') `
        -RedirectStandardError  "$log srv$SrvPort.err".Replace(' ', '')

    $env:PORT = "$PrxPort"
    $env:UPSTREAM = "http://localhost:$SrvPort"
    $prx = Start-Process node -ArgumentList 'cache-proxy.js' -PassThru -NoNewWindow `
        -RedirectStandardOutput "$log prx$PrxPort.out".Replace(' ', '') `
        -RedirectStandardError  "$log prx$PrxPort.err".Replace(' ', '')

    try {
        if (-not (Wait-Port $SrvPort)) { throw "server が $SrvPort で起動しなかった" }
        if (-not (Wait-Port $PrxPort)) { throw "cache-proxy が $PrxPort で起動しなかった" }

        # 前提の確認を先にやる。ここを飛ばすと、ポートを掴まれた古いプロセスが
        # 応答していても気づけない（実際にそれで誤った結論に至った）。
        $upstream = Get-Representation -Port $SrvPort -Accept 'text/markdown'
        $varyState = if ($upstream.Vary) { "あり ($($upstream.Vary))" } else { 'なし' }

        Write-Host ''
        Write-Host "=== $Label ===" -ForegroundColor Cyan
        Write-Host "  前提確認: 上流の Vary = $varyState"

        $steps = @(
            @{ Who = '① ブラウザが先'; Accept = $BrowserAccept }
            @{ Who = '② 次にエージェント'; Accept = 'text/markdown' }
        )
        foreach ($step in $steps) {
            $r = Get-Representation -Port $PrxPort -Accept $step.Accept
            $wrong = $step.Who.StartsWith('②') -and $r.ContentType -ne 'text/markdown'
            $color = if ($wrong) { 'Red' } else { 'Green' }
            Write-Host ("  {0,-20} -> {1,-14} (cache: {2})" -f $step.Who, $r.ContentType, $r.Cache) -ForegroundColor $color
        }
    } finally {
        Stop-Process -Id $srv.Id, $prx.Id -Force -ErrorAction SilentlyContinue
    }
}

try {
    Invoke-Scenario -NoVary '1' -SrvPort $BasePort       -PrxPort ($BasePort + 1) -Label 'Vary なし（演習2の状態）'
    Invoke-Scenario -NoVary '0' -SrvPort ($BasePort + 2) -PrxPort ($BasePort + 3) -Label 'Vary: Accept あり（正しい実装）'

    Write-Host ''
    Write-Host '②が赤（text/html）なら再現成功。' -ForegroundColor Yellow
    Write-Host 'エージェントは Accept: text/markdown を送っているのに HTML を受け取っている。'
    Write-Host 'サーバのコードは正しい。壊れているのはキャッシュ層。'
} finally {
    Remove-Item Env:NO_VARY, Env:PORT, Env:UPSTREAM -ErrorAction SilentlyContinue
    Pop-Location
}
