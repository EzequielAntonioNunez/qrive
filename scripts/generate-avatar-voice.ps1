$ErrorActionPreference = 'Stop'

$lines = [ordered]@{
    prepare = 'Gracias por venir. Nuestros costes han subido y necesitamos revisar el precio. Si encontramos una propuesta equilibrada, podremos seguir trabajando juntos.'
    counteroffer = 'Podría reducir la subida si acordamos tres años de colaboración. Necesito saber qué garantías y compromisos estaríais dispuestos a aceptar.'
    close = 'Estamos cerca de un acuerdo. Para cerrarlo hoy, necesito una decisión final y una forma clara de comprobar que cumplimos los compromisos.'
}

$speaker = New-Object -ComObject SAPI.SpVoice
$spanishVoice = @($speaker.GetVoices() | Where-Object { $_.GetAttribute('Language') -match 'C0A' })[0]
if (-not $spanishVoice) { throw 'No hay una voz española SAPI instalada.' }
$speaker.Voice = $spanishVoice
$speaker.Rate = -1
$outputDirectory = Join-Path $PSScriptRoot '..\unity\AXYRO.Simulation\Assets\AXYRO\Audio'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

foreach ($entry in $lines.GetEnumerator()) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $target = Join-Path $outputDirectory "$($entry.Key).wav"
    $stream.Open($target, 3, $false)
    $speaker.AudioOutputStream = $stream
    [void]$speaker.Speak($entry.Value, 0)
    $stream.Close()
}

Write-Output "Audio generado en $outputDirectory"
